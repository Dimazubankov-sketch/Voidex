import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { create } from "zustand";

/**
 * A1 — staying on the current deployment.
 *
 * index.html is revalidated on every load (server: Cache-Control no-cache) and the hashed chunks are
 * immutable, so a normal open always starts the newest build. What remains is the page that is already
 * running when a deployment lands:
 *
 *  - it polls /version.json (never cached) on focus / return from background / every 10 min and, when the
 *    build differs, offers «Обновить» — saving open work first, never reloading by surprise;
 *  - a code-split chunk that fails to load (deleted by the new deployment, or a flaky network) is retried
 *    once; if a newer build exists the page reloads into it (once per build, so a broken server can never
 *    cause a reload loop), otherwise the error reaches an error boundary with «Повторить».
 */

export const BUILD_ID: string = typeof __VOIDEX_BUILD__ === "string" ? __VOIDEX_BUILD__ : "dev";

interface UpdateState {
  /** Build id of a newer deployment, once seen. */
  available: string | null;
  dismissed: boolean;
  /** Bumped when failed lazy chunks are reset so their wrappers re-render with a fresh import. */
  lazyGen: number;
  dismiss(): void;
}

export const useAppUpdate = create<UpdateState>((set) => ({
  available: null,
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
      if (useAppUpdate.getState().available !== remote) useAppUpdate.setState({ available: remote, dismissed: false });
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

function isChunkError(err: unknown): boolean {
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
  window.setTimeout(() => void checkForUpdate(true), 20_000);
  window.setInterval(() => {
    if (document.visibilityState === "visible") void checkForUpdate();
  }, CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
  // iOS restores pages from the back/forward cache without running anything else.
  window.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) void checkForUpdate(true);
  });
  window.addEventListener("online", () => void checkForUpdate());
  // Vite's preload of a chunk's dependencies failed: same story as a failed import.
  window.addEventListener("vite:preloadError", () => void checkForUpdate(true));
}
