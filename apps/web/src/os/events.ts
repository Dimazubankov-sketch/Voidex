import { useEffect } from "react";
import { create } from "zustand";
import type { MeDto, ServerEvent } from "@voidex/shared";
import { isSigningOut } from "@/lib/account";
import { accessToken, api, refreshSession } from "@/lib/api";
import { t } from "@/lib/i18n";
import { qk, queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { toast } from "@/ui/overlays";
import { useWM } from "./window-manager";

export const useConnection = create<{ connected: boolean; online: boolean }>(() => ({
  connected: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
}));

let chime: AudioContext | null = null;
function playChime() {
  try {
    chime ??= new AudioContext();
    const o = chime.createOscillator();
    const g = chime.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, chime.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, chime.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, chime.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, chime.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, chime.currentTime + 0.35);
    o.connect(g).connect(chime.destination);
    o.start();
    o.stop(chime.currentTime + 0.4);
  } catch {
    /* audio unavailable */
  }
}

async function refreshMe() {
  const me = await api.get<MeDto>("/api/me");
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
      if (prefs?.sound) playChime();
      break;
    }
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
  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    let backoff = 1000;

    const onOnline = () => useConnection.setState({ online: true });
    const onOffline = () => useConnection.setState({ online: false, connected: false });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    (async () => {
      let first = true;
      while (!stopped && useSession.getState().status === "signedIn") {
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
  }, []);
}
