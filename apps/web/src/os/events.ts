import { useEffect } from "react";
import { create } from "zustand";
import type { MeDto, ServerEvent } from "@voidex/shared";
import { isSigningOut } from "@/lib/account";
import { accessToken, api, refreshSession } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { visibleChats } from "@/apps/vibex/store";
import { useNotesSync } from "@/apps/notes/sync";
import { layoutEpoch, mergeServerUser } from "./home/layout";
import { notificationsChanged, receiveNotification } from "./notifications/store";
import { popupNotification } from "./notifications/popups";
import { lockInFlight } from "./lock/auto-lock";

export const useConnection = create<{ connected: boolean; online: boolean; everConnected: boolean }>(() => ({
  connected: false,
  /** Step 2.11: the stream was up at least once (before that, not connected yet is just starting). */
  everConnected: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
}));

async function refreshMe() {
  const epoch = layoutEpoch();
  const me = mergeServerUser(await api.get<MeDto>("/api/me"), epoch);
  useSession.getState().setUser(me);
  queryClient.setQueryData(qk.me, me);
}

/** No byte from the event stream for this long (the server pings every 25 s): it is dead. */
const STREAM_SILENCE_MS = 45_000;

function handle(event: ServerEvent) {
  const session = useSession.getState();
  switch (event.type) {
    case "mail.changed":
      void queryClient.invalidateQueries({ queryKey: qk.mail });
      break;
    case "mail.received":
      // Step 2.11: the pop-up and its sound come with the notification itself ("notification.new").
      void queryClient.invalidateQueries({ queryKey: qk.mail });
      break;
    case "vibex.message": {
      void queryClient.invalidateQueries({ queryKey: ["vibex", "chats"] });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "chat", event.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "messages", event.conversationId] });
      // Step 2.11: the pop-up and its sound come with the notification itself ("notification.new").
      break;
    }
    case "vibex.message.deleted":
      void queryClient.invalidateQueries({ queryKey: ["vibex", "messages", event.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "chats"] });
      break;
    case "vibex.message.updated":
      // Step 2.10: an edited message / a new pinned message.
      void queryClient.invalidateQueries({ queryKey: ["vibex", "messages", event.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "chat", event.conversationId] });
      break;
    case "vibex.activity":
      // Step 2.10: the Vibex activity tab (badge at once, the list on its next look).
      queryClient.setQueryData(["vibex", "activity", "count"], { unread: event.unread });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "activity"], exact: true });
      break;
    case "notes.document.updated":
    case "notes.access.revoked":
    case "notes.resource.deleted":
    case "notes.share.updated":
    case "notes.projects.changed":
      // Step 2.6: Notes reacts in its own (lazy) chunk; lists refresh here too.
      useNotesSync.getState().push(event);
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      break;
    case "vibex.feed":
      // Someone posted, edited, liked or commented: feeds and that post refresh.
      void queryClient.invalidateQueries({ queryKey: ["vibex", "feed"] });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "posts"] });
      if (event.postId) {
        void queryClient.invalidateQueries({ queryKey: ["vibex", "post", event.postId] });
        void queryClient.invalidateQueries({ queryKey: ["vibex", "comments", event.postId] });
      }
      break;
    case "vibex.chats":
      void queryClient.invalidateQueries({ queryKey: ["vibex", "chats"] });
      if (event.conversationId) void queryClient.invalidateQueries({ queryKey: ["vibex", "chat", event.conversationId] });
      break;
    case "notification.new": {
      receiveNotification(event.notification);
      // Step 2.11: the system pop-up (no pop-up for a chat that is already on screen).
      const chatId = event.notification.target.chatId;
      const onScreen = !!chatId && visibleChats.has(chatId) && document.visibilityState === "visible";
      // Step 2.9: notifications of this chat are off (the server sends none; a stale one is not popped up).
      const muted = !!chatId && !!queryClient.getQueryData<{ id: string; muted?: boolean }[]>(["vibex", "chats"])?.some((c) => c.id === chatId && c.muted);
      popupNotification(event.notification, { onScreen: onScreen || muted });
      break;
    }
    case "notifications.changed":
      notificationsChanged();
      break;
    case "vibex.stories":
      void queryClient.invalidateQueries({ queryKey: ["vibex", "stories"] });
      break;
    case "vibex.profile":
      void queryClient.invalidateQueries({ queryKey: ["vibex", "profile", event.userId] });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "me"] });
      break;
    case "account.updated":
    case "preferences.updated":
      void refreshMe();
      break;
    case "apps.updated":
      void queryClient.invalidateQueries({ queryKey: qk.apps });
      break;
    case "store.reviews":
      // Step 2.11: my review changed on another device.
      void queryClient.invalidateQueries({ queryKey: ["store", "reviews", event.appId] });
      void queryClient.invalidateQueries({ queryKey: ["store", "stats"] });
      break;
    case "sessions.updated":
      void queryClient.invalidateQueries({ queryKey: qk.sessions });
      break;
    case "approval.requested":
    case "approval.resolved":
      void queryClient.invalidateQueries({ queryKey: qk.approvals });
      break;
    case "session.locked":
      // This device was locked (another tab, inactivity, the server): the lock screen takes over.
      if (event.sessionId === session.sessionId && !lockInFlight()) session.lockLocal();
      break;
    case "security.updated":
      void queryClient.invalidateQueries({ queryKey: qk.security });
      break;
    case "session.revoked":
      if (event.sessionId === session.sessionId && !isSigningOut()) session.signOutLocal("revoked");
      break;
    case "hello":
      break;
  }
}

/**
 * Keeps one Server-Sent Events stream open for this device. Uses fetch (not
 * EventSource) so the access token goes in the Authorization header. When the
 * stream drops (network, token expiry) it reconnects with backoff, and
 * refetches everything so nothing missed while offline stays stale.
 */
export function useServerEvents() {
  // Locked: no stream (the server refuses it); it reconnects right after unlocking.
  const locked = useSession((s) => s.locked);
  useEffect(() => {
    if (locked) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let backoff = 1000;
    // Step 2.11: the wait between reconnects ends at once when the network comes back.
    let wake: (() => void) | null = null;

    const onOnline = () => {
      useConnection.setState({ online: true });
      backoff = 1000;
      wake?.();
    };
    // Step 2.11: offline drops the stream at once (an open one would hang and never reconnect).
    const onOffline = () => {
      useConnection.setState({ online: false, connected: false });
      controller?.abort();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    (async () => {
      let first = true;
      while (!stopped && useSession.getState().status === "signedIn" && !useSession.getState().locked) {
        const token = await accessToken();
        if (!token || stopped) break;
        controller = new AbortController();
        try {
          const res = await fetch("/api/events", {
            headers: { Authorization: `Bearer ${token}`, "X-Voidex-Client": "web", Accept: "text/event-stream" },
            signal: controller.signal,
          });
          if (res.status === 401) {
            await refreshSession().catch(() => undefined);
            continue;
          }
          if (res.status === 423) {
            useSession.getState().lockLocal();
            break;
          }
          if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
          useConnection.setState({ connected: true, everConnected: true });
          if (!first) void queryClient.invalidateQueries();
          first = false;
          backoff = 1000;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = "";
          // Step 2.11: the server pings every 25 s; 45 s of silence is a dead stream (a timeout): reconnect.
          const ctl = controller;
          let silence = setTimeout(() => ctl.abort(), STREAM_SILENCE_MS);
          try {
            for (;;) {
              const { value, done } = await reader.read();
              clearTimeout(silence);
              if (done) break;
              silence = setTimeout(() => ctl.abort(), STREAM_SILENCE_MS);
              buf += value;
              let idx;
              while ((idx = buf.indexOf("\n\n")) !== -1) {
                const chunk = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                const data = chunk
                  .split("\n")
                  .filter((l) => l.startsWith("data: "))
                  .map((l) => l.slice(6))
                  .join("\n");
                if (data) {
                  try {
                    handle(JSON.parse(data) as ServerEvent);
                  } catch {
                    /* malformed event */
                  }
                }
              }
            }
          } finally {
            clearTimeout(silence);
          }
        } catch {
          if (stopped) break;
        }
        useConnection.setState({ connected: false });
        if (stopped) break;
        await new Promise<void>((r) => {
          const timer = setTimeout(r, backoff);
          wake = () => {
            clearTimeout(timer);
            r();
          };
        });
        wake = null;
        backoff = Math.min(backoff * 2, 15_000);
      }
    })();

    return () => {
      stopped = true;
      wake?.();
      controller?.abort();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [locked]);
}
