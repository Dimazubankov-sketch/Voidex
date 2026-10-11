import { create } from "zustand";
import { useSession } from "@/lib/session";
import { foregroundId, useWM } from "./window-manager";

/**
 * Step 2.9 — what the phone app switcher shows on each card: the last screen
 * of that app, as the person left it.
 *
 * A snapshot is a static copy of the window's DOM taken at the moment the app
 * steps aside (home, another app, the switcher, the gesture bar). Nothing is
 * re-rendered for it: no second React tree, no polling, no timers. The copy is
 * inert (no ids, test ids, form names, autoplay or focus) and dropped when the
 * window closes. Apps protected by Face ID / code-password never get one: the
 * card shows a lock instead.
 */

export interface Snapshot {
  node: HTMLElement;
  w: number;
  h: number;
  at: number;
}

const shots = new Map<string, Snapshot>();
export const useSnapshots = create<{ version: number }>(() => ({ version: 0 }));
const bump = () => useSnapshots.setState((s) => ({ version: s.version + 1 }));

/** Attributes that must not exist twice in the page (or would make the copy active). */
const STRIP = ["id", "data-testid", "name", "for", "autofocus", "autoplay", "tabindex", "aria-controls", "aria-labelledby", "aria-describedby", "href", "src-object"];

function sanitize(root: HTMLElement) {
  const all = [root, ...root.querySelectorAll<HTMLElement>("*")];
  for (const el of all) {
    for (const a of STRIP) el.removeAttribute(a);
    if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) {
      el.removeAttribute("src");
      el.preload = "none";
    }
    // Canvases come out blank; a neutral tile is better than a hole.
    if (el instanceof HTMLCanvasElement) el.style.background = "var(--surface-secondary)";
  }
  root.setAttribute("inert", "");
  root.setAttribute("aria-hidden", "true");
}

/** Whether this app is protected (Settings → Apps → Face ID / code-password): no picture of it is kept. */
export function isPrivateApp(appId: string): boolean {
  const apps = useSession.getState().user?.preferences.apps as Record<string, { lock?: boolean } | undefined> | undefined;
  return apps?.[appId]?.lock === true;
}

/** Takes the window's current screen (call before it animates away). */
export function captureWindow(id: string) {
  const win = useWM.getState().windows[id];
  if (!win || typeof document === "undefined") return;
  if (isPrivateApp(win.appId)) {
    if (shots.delete(id)) bump();
    return;
  }
  const el = document.querySelector<HTMLElement>(`[data-window-content="${CSS.escape(id)}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return;
  const node = el.cloneNode(true) as HTMLElement;
  sanitize(node);
  // Scroll positions are not part of a deep clone: keep what was on screen.
  const src = [el, ...el.querySelectorAll<HTMLElement>("*")];
  const dst = [node, ...node.querySelectorAll<HTMLElement>("*")];
  for (let i = 0; i < src.length && i < dst.length; i++) {
    const s = src[i]!;
    if (s.scrollTop || s.scrollLeft) {
      dst[i]!.dataset.snapScrollTop = String(s.scrollTop);
      dst[i]!.dataset.snapScrollLeft = String(s.scrollLeft);
    }
  }
  shots.set(id, { node, w: r.width, h: r.height, at: Date.now() });
  bump();
}

export function snapshotOf(id: string): Snapshot | undefined {
  return shots.get(id);
}

/** Puts a copy of the snapshot into `host` and restores its scroll positions. */
export function mountSnapshot(host: HTMLElement, snap: Snapshot) {
  host.replaceChildren();
  const copy = snap.node.cloneNode(true) as HTMLElement;
  host.appendChild(copy);
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>("[data-snap-scroll-top]")]) {
    const top = Number(el.dataset.snapScrollTop ?? 0);
    const left = Number(el.dataset.snapScrollLeft ?? 0);
    if (top) el.scrollTop = top;
    if (left) el.scrollLeft = left;
  }
}

let started = false;
/**
 * Captures automatically: an app that stops being the foreground one (home,
 * another app) or the switcher opening over it. Zustand calls listeners
 * before React re-renders, so the DOM still shows the app as it was.
 */
export function startSnapshots() {
  if (started) return;
  started = true;
  let prevFg = foregroundId(useWM.getState());
  let prevSwitcher = useWM.getState().switcherOpen;
  useWM.subscribe((s) => {
    const fg = foregroundId(s);
    if (prevFg && prevFg !== fg) captureWindow(prevFg);
    if (s.switcherOpen && !prevSwitcher && fg) captureWindow(fg);
    prevFg = fg;
    prevSwitcher = s.switcherOpen;
    // Closed windows leave no picture behind.
    let dropped = false;
    for (const id of shots.keys()) {
      if (!s.windows[id]) {
        shots.delete(id);
        dropped = true;
      }
    }
    if (dropped) bump();
  });
}
