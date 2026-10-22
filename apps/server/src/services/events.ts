import type { ServerEvent } from "@voidex/shared";

type Listener = (event: ServerEvent) => void;

interface Subscription {
  userId: string;
  sessionId: string;
  listener: Listener;
}

/**
 * Real-time fan-out to every connected device of an account (Server-Sent
 * Events). In-process for a single server instance; to scale horizontally,
 * back `publish*` with Redis/NATS pub-sub — the interface stays the same.
 */
export class EventHub {
  private readonly subs = new Set<Subscription>();
  /** Update 2 · C3: told when an account's first device connects and when its last one goes. */
  private readonly presence = new Set<(userId: string, online: boolean) => void>();

  subscribe(userId: string, sessionId: string, listener: Listener): () => void {
    const sub = { userId, sessionId, listener };
    const first = this.connectionCount(userId) === 0;
    this.subs.add(sub);
    if (first) this.presenceChanged(userId, true);
    return () => {
      if (!this.subs.delete(sub)) return;
      if (this.connectionCount(userId) === 0) this.presenceChanged(userId, false);
    };
  }

  onPresence(fn: (userId: string, online: boolean) => void): () => void {
    this.presence.add(fn);
    return () => this.presence.delete(fn);
  }

  private presenceChanged(userId: string, online: boolean) {
    for (const fn of this.presence) {
      try {
        fn(userId, online);
      } catch {
        /* a presence listener never breaks the stream */
      }
    }
  }

  /** Update 2 · C3: a device of this account is connected right now. */
  isOnline(userId: string) {
    return this.connectionCount(userId) > 0;
  }

  toUser(userId: string, event: ServerEvent, opts: { exceptSessionId?: string } = {}) {
    for (const s of this.subs) {
      if (s.userId === userId && s.sessionId !== opts.exceptSessionId) s.listener(event);
    }
  }

  /** Every connected device (public changes, e.g. the Vibex feed). */
  toAll(event: ServerEvent) {
    for (const s of this.subs) s.listener(event);
  }

  toSession(sessionId: string, event: ServerEvent) {
    for (const s of this.subs) if (s.sessionId === sessionId) s.listener(event);
  }

  connectionCount(userId?: string) {
    let n = 0;
    for (const s of this.subs) if (!userId || s.userId === userId) n++;
    return n;
  }
}
