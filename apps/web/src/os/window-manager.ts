import { create } from "zustand";
import { APP_REGISTRY, type AppId } from "@voidex/shared";

/**
 * VOIDEX window manager.
 *
 * One model, two presentations:
 *  - desktop: free-floating windows (move, resize, maximize, minimize, z-order);
 *  - mobile: one foreground app at a time, others kept alive in the background
 *    and reachable from the app switcher (iPhone-style multitasking).
 *
 * Apps stay mounted while minimized/backgrounded so their state survives
 * switching. Windows are device-local (a phone and a PC arrange apps
 * differently); the data inside apps is what syncs across devices.
 */

export type WindowState = "normal" | "maximized" | "minimized";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AppWindow {
  id: string;
  appId: AppId;
  state: WindowState;
  /** State to return to when restoring from minimized. */
  prevState: Exclude<WindowState, "minimized">;
  rect: Rect;
  /** Screen rect of the icon that launched it — windows grow out of it. */
  origin: Rect | null;
  /** Arbitrary launch parameters (e.g. { threadId }) — apps react to changes. */
  params: Record<string, unknown>;
  paramsVersion: number;
  openedAt: number;
}

interface WMState {
  windows: Record<string, AppWindow>;
  /** Back-to-front order. */
  order: string[];
  focusedId: string | null;
  switcherOpen: boolean;
  bounds: { w: number; h: number };
  setBounds: (w: number, h: number) => void;
  open: (appId: AppId, opts?: { origin?: Rect | null; params?: Record<string, unknown> }) => string;
  focus: (id: string) => void;
  close: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  restore: (id: string) => void;
  goHome: () => void;
  setRect: (id: string, rect: Rect) => void;
  setSwitcher: (open: boolean) => void;
  closeAll: () => void;
  /** Sign-out: forget this account's windows on this device session. */
  reset: () => void;
  hydrate: (userId: string) => void;
}

const STORAGE = (userId: string) => `vx.wm.${userId}`;
let persistKey: string | null = null;

function clampRect(r: Rect, b: { w: number; h: number }, min: { w: number; h: number }): Rect {
  const w = Math.max(min.w, Math.min(r.w, b.w - 16));
  const h = Math.max(min.h, Math.min(r.h, b.h - 16));
  const x = Math.max(8 - w + 120, Math.min(r.x, b.w - 120));
  const y = Math.max(8, Math.min(r.y, b.h - 60));
  return { x, y, w, h };
}

function defaultRect(appId: AppId, b: { w: number; h: number }, index: number): Rect {
  const m = APP_REGISTRY[appId].window;
  const w = Math.min(m.defaultWidth, b.w - 48);
  const h = Math.min(m.defaultHeight, b.h - 48);
  const cascade = (index % 5) * 28;
  return { x: Math.round((b.w - w) / 2) + cascade - 56, y: Math.max(16, Math.round((b.h - h) / 2) + cascade - 40), w, h };
}

export const useWM = create<WMState>((set, get) => ({
  windows: {},
  order: [],
  focusedId: null,
  switcherOpen: false,
  bounds: { w: 1280, h: 800 },

  setBounds: (w, h) => set({ bounds: { w, h } }),

  open: (appId, opts = {}) => {
    const s = get();
    const manifest = APP_REGISTRY[appId];
    const existing = manifest.window.singleton ? Object.values(s.windows).find((w) => w.appId === appId) : undefined;
    if (existing) {
      const state = existing.state === "minimized" ? existing.prevState : existing.state;
      set({
        windows: {
          ...s.windows,
          [existing.id]: {
            ...existing,
            state,
            origin: opts.origin ?? existing.origin,
            ...(opts.params ? { params: opts.params, paramsVersion: existing.paramsVersion + 1 } : {}),
          },
        },
        order: [...s.order.filter((i) => i !== existing.id), existing.id],
        focusedId: existing.id,
        switcherOpen: false,
      });
      persist();
      return existing.id;
    }
    const id = manifest.window.singleton ? appId : `${appId}-${Date.now().toString(36)}`;
    const win: AppWindow = {
      id,
      appId,
      state: "normal",
      prevState: "normal",
      rect: savedRects[appId] ? clampRect(savedRects[appId]!, s.bounds, { w: manifest.window.minWidth, h: manifest.window.minHeight }) : defaultRect(appId, s.bounds, s.order.length),
      origin: opts.origin ?? null,
      params: opts.params ?? {},
      paramsVersion: 0,
      openedAt: Date.now(),
    };
    set({ windows: { ...s.windows, [id]: win }, order: [...s.order, id], focusedId: id, switcherOpen: false });
    persist();
    return id;
  },

  focus: (id) => {
    const s = get();
    const w = s.windows[id];
    if (!w) return;
    const state = w.state === "minimized" ? w.prevState : w.state;
    set({
      windows: { ...s.windows, [id]: { ...w, state } },
      order: [...s.order.filter((i) => i !== id), id],
      focusedId: id,
      switcherOpen: false,
    });
    persist();
  },

  close: (id) => {
    const s = get();
    const { [id]: _removed, ...rest } = s.windows;
    const order = s.order.filter((i) => i !== id);
    const nextFocus = [...order].reverse().find((i) => rest[i]?.state !== "minimized") ?? null;
    set({ windows: rest, order, focusedId: s.focusedId === id ? nextFocus : s.focusedId });
    persist();
  },

  minimize: (id) => {
    const s = get();
    const w = s.windows[id];
    if (!w) return;
    const prevState = w.state === "minimized" ? w.prevState : w.state;
    const windows = { ...s.windows, [id]: { ...w, state: "minimized" as const, prevState } };
    const nextFocus = [...s.order].reverse().find((i) => i !== id && windows[i]?.state !== "minimized") ?? null;
    set({ windows, focusedId: nextFocus });
    persist();
  },

  toggleMaximize: (id) => {
    const s = get();
    const w = s.windows[id];
    if (!w) return;
    const state = w.state === "maximized" ? "normal" : "maximized";
    set({ windows: { ...s.windows, [id]: { ...w, state, prevState: state } }, focusedId: id, order: [...s.order.filter((i) => i !== id), id] });
    persist();
  },

  restore: (id) => get().focus(id),

  /** Workspace / Home: every app steps aside, nothing is closed. */
  goHome: () => {
    const s = get();
    const windows = Object.fromEntries(
      Object.entries(s.windows).map(([id, w]) => [id, w.state === "minimized" ? w : { ...w, state: "minimized" as const, prevState: w.state }]),
    ) as Record<string, AppWindow>;
    set({ windows, focusedId: null, switcherOpen: false });
    persist();
  },

  setRect: (id, rect) => {
    const s = get();
    const w = s.windows[id];
    if (!w) return;
    const m = APP_REGISTRY[w.appId].window;
    const r = clampRect(rect, s.bounds, { w: m.minWidth, h: m.minHeight });
    savedRects[w.appId] = r;
    set({ windows: { ...s.windows, [id]: { ...w, rect: r } } });
    persist();
  },

  setSwitcher: (open) => set({ switcherOpen: open }),

  closeAll: () => {
    set({ windows: {}, order: [], focusedId: null, switcherOpen: false });
    persist();
  },

  reset: () => {
    persistKey = null;
    for (const k of Object.keys(savedRects)) delete savedRects[k as AppId];
    set({ windows: {}, order: [], focusedId: null, switcherOpen: false });
  },

  hydrate: (userId) => {
    persistKey = STORAGE(userId);
    try {
      const raw = localStorage.getItem(persistKey);
      if (!raw) return;
      const data = JSON.parse(raw) as { rects?: Record<string, Rect>; open?: { appId: AppId; state: WindowState }[] };
      Object.assign(savedRects, data.rects ?? {});
      const s = get();
      const windows: Record<string, AppWindow> = {};
      const order: string[] = [];
      for (const o of data.open ?? []) {
        if (!(o.appId in APP_REGISTRY)) continue;
        const m = APP_REGISTRY[o.appId];
        windows[o.appId] = {
          id: o.appId,
          appId: o.appId,
          state: "minimized",
          prevState: o.state === "maximized" ? "maximized" : "normal",
          rect: savedRects[o.appId] ? clampRect(savedRects[o.appId]!, s.bounds, { w: m.window.minWidth, h: m.window.minHeight }) : defaultRect(o.appId, s.bounds, order.length),
          origin: null,
          params: {},
          paramsVersion: 0,
          openedAt: Date.now(),
        };
        order.push(o.appId);
      }
      set({ windows, order, focusedId: null });
    } catch {
      /* corrupt or unavailable storage: start clean */
    }
  },
}));

const savedRects: Partial<Record<AppId, Rect>> = {};

function persist() {
  if (!persistKey) return;
  const s = useWM.getState();
  try {
    localStorage.setItem(
      persistKey,
      JSON.stringify({
        rects: savedRects,
        open: s.order.map((id) => ({ appId: s.windows[id]!.appId, state: s.windows[id]!.state === "minimized" ? s.windows[id]!.prevState : s.windows[id]!.state })),
      }),
    );
  } catch {
    /* ignore */
  }
}

/** Top-most visible window, if any. */
export function foregroundId(s: Pick<WMState, "order" | "windows">): string | null {
  for (let i = s.order.length - 1; i >= 0; i--) {
    const id = s.order[i]!;
    if (s.windows[id]?.state !== "minimized") return id;
  }
  return null;
}
