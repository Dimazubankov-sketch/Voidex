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

  subscribe(userId: string, sessionId: string, listener: Listener): () => void {
    const sub = { userId, sessionId, listener };
    this.subs.add(sub);
    return () => this.subs.delete(sub);
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
