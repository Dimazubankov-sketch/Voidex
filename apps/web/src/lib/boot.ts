/**
 * Start-up plumbing shared by main.tsx, the root component and the update/recovery code.
 *
 *  - `bootMark` / `bootReady` talk to public/boot-guard.js (the guard that covers a page which never started).
 *  - `reportClientEvent` sends a tiny anonymous diagnostic record to /api/client-events (no tokens, no user
 *    data; the server scrubs and only logs it). Best effort: a failed report is silently dropped.
 */
export const BUILD_ID: string = typeof __VOIDEX_BUILD__ === "string" ? __VOIDEX_BUILD__ : "dev";

interface BootGuard {
  ok?: boolean;
  build?: string | null;
  phase?: string;
  mark?: (phase: string) => void;
  ready?: () => void;
  fail?: (reason: string) => void;
}

function guard(): BootGuard | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { __vxBoot?: BootGuard }).__vxBoot;
}

export function bootMark(phase: string) {
  const g = guard();
  if (g) g.build = BUILD_ID;
  g?.mark?.(phase);
}

/** The first render has been committed: the page has started. Called from the root component's effect. */
export function bootReady() {
  guard()?.ready?.();
}

export function bootFail(reason: string) {
  guard()?.fail?.(reason);
}

export type ClientEventKind =
  | "boot_failed"
  | "boot_slow"
  | "root_crashed"
  | "chunk_failed"
  | "api_unreachable"
  | "update_found"
  | "update_applied"
  | "update_deferred"
  | "sw_error"
  | "storage_reset";

export interface ClientEventInput {
  kind: ClientEventKind;
  phase?: string;
  detail?: string;
  attempt?: number;
}

const sent = new Set<string>();
const MAX_PER_PAGE = 10;

const safeToken = (s: string | undefined) => s?.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 40) || undefined;

/** Never throws, never awaits anything the caller needs. */
export function reportClientEvent(ev: ClientEventInput): void {
  try {
    if (typeof fetch === "undefined" || import.meta.env.DEV) return;
    const key = `${ev.kind}:${ev.phase ?? ""}:${ev.detail ?? ""}`;
    if (sent.has(key) || sent.size >= MAX_PER_PAGE) return;
    sent.add(key);
    const body = {
      kind: ev.kind,
      phase: safeToken(ev.phase ?? guard()?.phase),
      build: safeToken(BUILD_ID),
      online: typeof navigator === "undefined" ? undefined : navigator.onLine !== false,
      standalone: typeof window !== "undefined" && (!!(navigator as unknown as { standalone?: boolean }).standalone || window.matchMedia?.("(display-mode: standalone)").matches),
      sw: typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller,
      attempt: ev.attempt,
      // Error text only; the server scrubs URLs, numbers and token-like strings again.
      detail: ev.detail?.slice(0, 300),
    };
    void fetch("/api/client-events", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Voidex-Client": "web" },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    /* diagnostics must never break the app */
  }
}

/** Runs one start-up step; a failure is reported and swallowed so one broken module cannot stop the shell. */
export function safeInit(name: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    reportClientEvent({ kind: "storage_reset", phase: `init-${name}`, detail: String((err as Error)?.message ?? err) });
  }
}

/**
 * Recovery reload. A plain `location.reload()` revalidates the page but WebKit keeps serving a module script that
 * failed to load (observed with Playwright's WebKit: the chunk is not even requested again), while a normal
 * navigation to a URL that differs by a throw-away query parameter loads everything afresh. Used only by recovery
 * paths the person triggered (a tap), so it cannot loop. `stripRecoveryParam` removes the parameter once started.
 */
const RECOVERY_PARAM = "_r";

export function freshReload(): void {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set(RECOVERY_PARAM, Date.now().toString(36));
    window.location.replace(u.toString());
  } catch {
    window.location.reload();
  }
}

export function stripRecoveryParam(): void {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has(RECOVERY_PARAM)) return;
    u.searchParams.delete(RECOVERY_PARAM);
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
  } catch {
    /* cosmetic only */
  }
}
