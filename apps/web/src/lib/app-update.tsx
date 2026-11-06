import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { create } from "zustand";
import { BUILD_ID, reportClientEvent } from "./boot";
import { criticalOperationsRunning, onCriticalOperationsIdle } from "./critical-ops";

/**
 * A1 — staying on the current deployment.
 *
 * index.html is revalidated on every load (server: Cache-Control no-cache) and the hashed chunks are
 * immutable, so a normal open always starts the newest build. What remains is the page that is already
 * running when a deployment lands:
 *
 *  - it polls /version.json (never cached) on focus / return from background / every 10 min and, when the
 *    build differs, applies it by itself — but only when that cannot lose anything (see `blocker()`): nothing
 *    being saved or sent, no half-typed text, every registered saver flushed. Otherwise it waits (for the
 *    operation to end, for the person to leave the app, for idle time). The «Обновить» pill appears only
 *    when an update has been waiting for a long time;
 *  - a code-split chunk that fails to load (deleted by the new deployment, or a flaky network) is retried
 *    once; if a newer build exists the page reloads into it (once per build, so a broken server can never
 *    cause a reload loop), otherwise the error reaches an error boundary with «Повторить».
 */

export { BUILD_ID };

interface UpdateState {
  /** Build id of a newer deployment, once seen. */
  available: string | null;
  /** The update has been waiting (unsafe to apply) for a long time: only then the manual pill is shown. */
  stalled: boolean;
  dismissed: boolean;
  /** Bumped when failed lazy chunks are reset so their wrappers re-render with a fresh import. */
  lazyGen: number;
  dismiss(): void;
}

export const useAppUpdate = create<UpdateState>((set) => ({
  available: null,
  stalled: false,
  dismissed: false,
  lazyGen: 0,
  dismiss: () => set({ dismissed: true }),
}));

const CHECK_EVERY_MS = 10 * 60_000;
const MIN_GAP_MS = 60_000;
let lastCheck = 0;
let inflight: Promise<string | null> | null = null;

/** Parses /version.json; anything else (an HTML error page, a proxy message) is "unknown", never "new". */
export function parseVersion(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const build = (body as { build?: unknown }).build;
  return typeof build === "string" && build.length > 0 && build.length < 200 ? build : null;
}

/** Asks the server which build it serves. Resolves to the newer build id, or null (same build / unknown). */
export function checkForUpdate(force = false): Promise<string | null> {
  if (import.meta.env.DEV) return Promise.resolve(null);
  if (inflight) return inflight;
  if (!force && Date.now() - lastCheck < MIN_GAP_MS) return Promise.resolve(useAppUpdate.getState().available);
  lastCheck = Date.now();
  inflight = (async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store", credentials: "omit" });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
      const remote = parseVersion(await res.json());
      if (!remote || remote === BUILD_ID) return null;
      if (useAppUpdate.getState().available !== remote) {
        useAppUpdate.setState({ available: remote, dismissed: false, stalled: false });
        reportClientEvent({ kind: "update_found", phase: "poll", detail: `${BUILD_ID}>${remote}` });
        armStallTimer();
      }
      queueMicrotask(() => void tryApplyAutomatically("found"));
      return remote;
    } catch {
      return null; // offline: nothing to say
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

type Saver = () => Promise<boolean> | boolean;
const savers = new Set<Saver>();

/** Apps with unsaved work register a saver; it must resolve true when nothing is left unsaved. */
export function registerUpdateSaver(fn: Saver): () => void {
  savers.add(fn);
  return () => savers.delete(fn);
}

/** Saves everything that registered; false when something could not be saved (then we do not reload). */
export async function saveBeforeReload(): Promise<boolean> {
  const results = await Promise.all([...savers].map(async (s) => {
    try {
      return await s();
    } catch {
      return false;
    }
  }));
  return results.every(Boolean);
}

const RELOADED_KEY = "vx.reloadedFor";

function alreadyReloadedFor(build: string): boolean {
  try {
    return sessionStorage.getItem(RELOADED_KEY) === build;
  } catch {
    return false;
  }
}

/** Reloads into the newest build after saving. Returns false (and stays) when saving failed. */
export async function applyUpdate(): Promise<boolean> {
  if (!(await saveBeforeReload())) return false;
  const build = useAppUpdate.getState().available;
  try {
    if (build) sessionStorage.setItem(RELOADED_KEY, build);
  } catch {
    /* private mode */
  }
  window.location.reload();
  return true;
}


// ---------------------------------------------------------------------------------------------------------------
// Applying an update by itself, without ever losing work.

const IDLE_APPLY_MS = 90_000;
const STALL_AFTER_MS = 20 * 60_000;
const pageStart = Date.now();
let lastInput = pageStart;
let visibleSince = pageStart;
let stallTimer: number | undefined;

/** Why the page must NOT reload right now, or null when reloading is safe. */
export function blocker(): string | null {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  if (criticalOperationsRunning() > 0) return "busy";
  const el = typeof document === "undefined" ? null : document.activeElement;
  if (el instanceof HTMLElement) {
    const typing =
      ((el instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "range", "file"].includes(el.type)) || el instanceof HTMLTextAreaElement) && el.value.length > 0;
    const editing = el.isContentEditable && (el.textContent ?? "").trim().length > 0;
    if (typing || editing) return "typing";
  }
  return null;
}

function armStallTimer() {
  window.clearTimeout(stallTimer);
  stallTimer = window.setTimeout(() => {
    if (useAppUpdate.getState().available) useAppUpdate.setState({ stalled: true });
  }, STALL_AFTER_MS);
}

let applying = false;

/**
 * Reloads into the newest build if (and only if) nothing can be lost. Called when an update is found, when the
 * person leaves or returns, when a save/upload finishes and while they are idle. Never loops: one automatic
 * reload per target build per tab session.
 */
export async function tryApplyAutomatically(trigger: "found" | "hidden" | "return" | "idle" | "idle-ops" | "launch"): Promise<boolean> {
  const build = useAppUpdate.getState().available;
  if (!build || applying || alreadyReloadedFor(build)) return false;
  const visible = document.visibilityState === "visible";
  const quiet = Date.now() - lastInput > IDLE_APPLY_MS;
  // While the person is actively using the app, only an idle moment, leaving the app, or the very start qualifies.
  const startingUp = Date.now() - pageStart < 30_000 && lastInput === pageStart;
  const allowed = trigger === "hidden" || trigger === "return" || startingUp || (visible ? quiet : true);
  if (!allowed) return false;
  const why = blocker();
  if (why) {
    reportClientEvent({ kind: "update_deferred", phase: trigger, detail: why });
    return false;
  }
  applying = true;
  try {
    if (!(await saveBeforeReload())) return false;
    if (blocker()) return false; // something started while saving
    try {
      sessionStorage.setItem(RELOADED_KEY, build);
    } catch {
      /* private mode: the once-per-build guard is then per page load only */
    }
    reportClientEvent({ kind: "update_applied", phase: trigger, detail: `${BUILD_ID}>${build}` });
    window.location.reload();
    return true;
  } finally {
    applying = false;
  }
}

export function isChunkError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch|module script|Unable to preload|expected a JavaScript/i.test(msg);
}

const resetters = new Set<() => void>();

/**
 * React.lazy that survives a deployment: retries a failed import once, then reloads into a newer build
 * if there is one (once per build). A failure is never cached: the next render after `resetFailedChunks()`
 * imports again.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRecovery<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  const load = async (): Promise<{ default: T }> => {
    try {
      return await factory();
    } catch (first) {
      if (!isChunkError(first)) throw first;
      await new Promise((r) => setTimeout(r, 500));
      try {
        return await factory();
      } catch (second) {
        const newer = await checkForUpdate(true);
        if (newer && !alreadyReloadedFor(newer) && (await saveBeforeReload())) {
          try {
            sessionStorage.setItem(RELOADED_KEY, newer);
          } catch {
            /* ignore */
          }
          window.location.reload();
          return new Promise<never>(() => {}); // the page is going away
        }
        reportClientEvent({ kind: "chunk_failed", phase: "lazy", detail: String((second as Error)?.message ?? second) });
        throw second;
      }
    }
  };
  let failed = false;
  const make = () =>
    lazy(() =>
      load().catch((e: unknown) => {
        failed = true;
        throw e;
      }),
    );
  let current = make();
  resetters.add(() => {
    if (!failed) return;
    failed = false;
    current = make();
  });
  const Wrapper = ((props: object) => {
    useAppUpdate((s) => s.lazyGen); // re-render after a reset
    const C = current as unknown as ComponentType<object>;
    return <C {...props} />;
  }) as unknown as LazyExoticComponent<T>;
  return Wrapper;
}


/** Called by error boundaries before «Повторить»: failed chunks import again on the next render. */
export function resetFailedChunks() {
  for (const r of resetters) r();
  useAppUpdate.setState((s) => ({ lazyGen: s.lazyGen + 1 }));
}

let started = false;

/** Starts the background checks (once). */
export function startUpdateChecks() {
  if (started || typeof window === "undefined") return;
  started = true;
  // The page reached a working state on this build: allow a future recovery reload for a newer one.
  window.setTimeout(() => {
    try {
      if (sessionStorage.getItem(RELOADED_KEY) && sessionStorage.getItem(RELOADED_KEY) !== BUILD_ID) return;
      sessionStorage.removeItem(RELOADED_KEY);
    } catch {
      /* ignore */
    }
  }, 15_000);

  const touch = () => {
    lastInput = Date.now();
  };
  for (const ev of ["pointerdown", "keydown", "touchstart", "wheel"] as const) window.addEventListener(ev, touch, { passive: true, capture: true });

  // An early look: a shell served from the offline cache or a slow network may be one release behind.
  window.setTimeout(() => void checkForUpdate(true).then(() => tryApplyAutomatically("launch")), 4_000);
  window.setInterval(() => {
    if (document.visibilityState === "visible") void checkForUpdate().then(() => tryApplyAutomatically("idle"));
  }, CHECK_EVERY_MS);
  // Idle moments: the check above is slow, this one only looks at a version that is already known.
  window.setInterval(() => void tryApplyAutomatically("idle"), 15_000);

  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      void tryApplyAutomatically("hidden");
      return;
    }
    visibleSince = Date.now();
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    // Coming back after a while: ask right away; reload before the person has touched anything.
    void checkForUpdate(away > 30_000).then(() => (away > 30_000 && lastInput < visibleSince ? tryApplyAutomatically("return") : tryApplyAutomatically("idle")));
  });
  // iOS restores pages from the back/forward cache without running anything else.
  window.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) void checkForUpdate(true).then(() => tryApplyAutomatically("return"));
  });
  window.addEventListener("online", () => void checkForUpdate().then(() => tryApplyAutomatically("idle")));
  // A save / send / upload finished: the update that was waiting for it may go now.
  onCriticalOperationsIdle(() => void tryApplyAutomatically(document.visibilityState === "visible" ? "idle-ops" : "hidden"));
  // Vite's preload of a chunk's dependencies failed: same story as a failed import.
  window.addEventListener("vite:preloadError", () => {
    reportClientEvent({ kind: "chunk_failed", phase: "preload" });
    void checkForUpdate(true);
  });
}
