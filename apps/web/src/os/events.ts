import { useEffect } from "react";
import { create } from "zustand";
import type { MeDto, ServerEvent } from "@voidex/shared";
import { isSigningOut } from "@/lib/account";
import { accessToken, api, refreshSession } from "@/lib/api";
import { t } from "@/lib/i18n";
import { qk, queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { toast } from "@/ui/overlays";
import { playNotificationSound } from "@/lib/sound";
import { visibleChats } from "@/apps/vibex/store";
import { useNotesSync } from "@/apps/notes/sync";
import { layoutEpoch, mergeServerUser } from "./home/layout";
import { notificationsChanged, receiveNotification } from "./notifications/store";
import { useWM } from "./window-manager";
import { lockInFlight } from "./lock/auto-lock";

export const useConnection = create<{ connected: boolean; online: boolean }>(() => ({
  connected: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
}));

async function refreshMe() {
  const epoch = layoutEpoch();
  const me = mergeServerUser(await api.get<MeDto>("/api/me"), epoch);
  useSession.getState().setUser(me);
  queryClient.setQueryData(qk.me, me);
}

const seenMessages = new Set<string>();

function handle(event: ServerEvent) {
  const session = useSession.getState();
  switch (event.type) {
    case "mail.changed":
      void queryClient.invalidateQueries({ queryKey: qk.mail });
      break;
    case "mail.received": {
      void queryClient.invalidateQueries({ queryKey: qk.mail });
      // One banner per message even if several streams were briefly open.
      if (seenMessages.has(event.messageId)) break;
      seenMessages.add(event.messageId);
      const prefs = session.user?.preferences.notifications;
      if (prefs?.newMailBanner) {
        toast({
          title: t("mail.newMail", { name: event.from.name ?? event.from.address }),
          body: prefs.showPreview ? event.subject || event.snippet : undefined,
          onClick: () => useWM.getState().open("mail", { params: { threadId: event.threadId } }),
          duration: 6000,
        });
      }
      if (prefs?.sound) playNotificationSound();
      break;
    }
    case "vibex.message": {
      void queryClient.invalidateQueries({ queryKey: ["vibex", "chats"] });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "chat", event.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "messages", event.conversationId] });
      if (event.senderId === session.user?.id || seenMessages.has(event.messageId)) break;
      seenMessages.add(event.messageId);
      // No banner for a chat that is already on screen.
      if (visibleChats.has(event.conversationId) && document.visibilityState === "visible") break;
      const prefs = session.user?.preferences.notifications;
      if (prefs?.newMailBanner) {
        toast({
          title: t("vibex.newMessage", { name: event.senderName }),
          body: prefs.showPreview ? event.snippet || t("vibex.chats.attachment") : undefined,
          onClick: () => useWM.getState().open("vibex", { params: { chatId: event.conversationId } }),
          duration: 6000,
        });
      }
      if (prefs?.sound) playNotificationSound();
      break;
    }
    case "vibex.message.deleted":
      void queryClient.invalidateQueries({ queryKey: ["vibex", "messages", event.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "chats"] });
      break;
    case "notes.changed":
      useNotesSync.setState({ revision: event.revision });
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
    case "notification.new":
      receiveNotification(event.notification);
      break;
    case "notifications.changed":
      notificationsChanged();
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

    const onOnline = () => useConnection.setState({ online: true });
    const onOffline = () => useConnection.setState({ online: false, connected: false });
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
          useConnection.setState({ connected: true });
          if (!first) void queryClient.invalidateQueries();
          first = false;
          backoff = 1000;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
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
        } catch {
          if (stopped) break;
        }
        useConnection.setState({ connected: false });
        if (stopped) break;
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 15_000);
      }
    })();

    return () => {
      stopped = true;
      controller?.abort();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [locked]);
}
