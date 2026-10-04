import { create } from "zustand";
import type { Wallpaper } from "@voidex/shared";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { prepareWallpaper, type WallpaperSlot } from "./appearance";
import { updateLayout, useWorkspaceLayout } from "./layout";

/**
 * Step 2.5 — "Синхронизация обоев в VOIDEX".
 *   ON  (default): the desktop and lock-screen wallpapers are part of the
 *       account (workspace appearance) and are the same on every device.
 *   OFF: this device keeps its own wallpapers — the choice in localStorage,
 *       own pictures in IndexedDB — and the account's wallpapers stay as
 *       they were for the other devices. Turning it back on shows the
 *       account's wallpapers again; nothing is uploaded or lost.
 */

export interface LocalWallpapers {
  userId: string;
  wallpaper: Wallpaper;
  lockWallpaper: Wallpaper | null;
}

const KEY = "vx.wallpapers.device";
/** Own pictures kept on the device are marked by this version prefix. */
export const LOCAL_VERSION = "local:";

function read(): LocalWallpapers | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as LocalWallpapers | null;
    return v && typeof v.userId === "string" && v.wallpaper ? v : null;
  } catch {
    return null;
  }
}

export const useLocalWallpapers = create<{ local: LocalWallpapers | null }>(() => ({ local: typeof localStorage === "undefined" ? null : read() }));

function write(local: LocalWallpapers | null) {
  try {
    if (local) localStorage.setItem(KEY, JSON.stringify(local));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: kept for this session only */
  }
  useLocalWallpapers.setState({ local });
}

/** The device's local wallpapers for this account (lock screen too: it may run before sign-in data loads). */
export function localWallpapersFor(userId: string): LocalWallpapers | null {
  const l = useLocalWallpapers.getState().local;
  return l && l.userId === userId ? l : null;
}

// --------------------------------------------------------------- IndexedDB

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("voidex-wallpapers", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("images");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("images", mode);
    const req = run(tx.objectStore("images"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const imageKey = (userId: string, slot: WallpaperSlot) => `${userId}:${slot}`;
export async function readLocalImage(userId: string, slot: WallpaperSlot): Promise<Blob | null> {
  return ((await idb("readonly", (s) => s.get(imageKey(userId, slot)))) as Blob | undefined) ?? null;
}
async function writeLocalImage(userId: string, slot: WallpaperSlot, blob: Blob) {
  await idb("readwrite", (s) => s.put(blob, imageKey(userId, slot)));
}

// --------------------------------------------------------------- the hook

/** Effective wallpapers and how to change them, whichever way sync is set. */
export function useWallpapers() {
  const { layout } = useWorkspaceLayout();
  const userId = useSession((s) => s.user?.id ?? "");
  const local = useLocalWallpapers((s) => (s.local && s.local.userId === userId ? s.local : null));
  const sync = layout.appearance.syncWallpapers !== false;
  const useLocal = !sync && !!local;
  const wallpaper = useLocal ? local!.wallpaper : layout.appearance.wallpaper;
  const lockWallpaper = useLocal ? local!.lockWallpaper : (layout.appearance.lockWallpaper ?? null);

  const setWallpaper = (w: Wallpaper) => {
    if (useLocal) write({ ...local!, wallpaper: w });
    else updateLayout((l) => ({ ...l, appearance: { ...l.appearance, wallpaper: w } }));
  };
  const setLockWallpaper = (w: Wallpaper | null) => {
    if (useLocal) write({ ...local!, lockWallpaper: w });
    else updateLayout((l) => ({ ...l, appearance: { ...l.appearance, lockWallpaper: w } }));
  };

  /** Own picture: to the account (sync on) or kept on this device (sync off). */
  const upload = async (file: File, slot: WallpaperSlot): Promise<Wallpaper> => {
    const blob = await prepareWallpaper(file);
    if (useLocal) {
      await writeLocalImage(userId, slot, blob);
      return { kind: "image", version: `${LOCAL_VERSION}${Date.now().toString(36)}` };
    }
    const r = await api.put<{ version: string }>(`/api/account/wallpaper${slot === "lock" ? "?slot=lock" : ""}`, blob, { headers: { "Content-Type": "application/octet-stream" } });
    return { kind: "image", version: r.version };
  };

  const setSync = async (on: boolean) => {
    if (on) {
      write(null);
      updateLayout((l) => ({ ...l, appearance: { ...l.appearance, syncWallpapers: true } }));
      return;
    }
    // Start the device's own set from what the account shows now (pictures copied to the device).
    const copy = async (w: Wallpaper | null, slot: WallpaperSlot): Promise<Wallpaper | null> => {
      if (!w || w.kind !== "image" || w.version.startsWith(LOCAL_VERSION)) return w;
      try {
        await writeLocalImage(userId, slot, await api.get<Blob>(`/api/account/wallpaper${slot === "lock" ? "?slot=lock" : ""}`));
        return { kind: "image", version: `${LOCAL_VERSION}${Date.now().toString(36)}` };
      } catch {
        return { kind: "default" };
      }
    };
    const desk = (await copy(layout.appearance.wallpaper, "desktop")) ?? { kind: "default" };
    const lock = await copy(layout.appearance.lockWallpaper ?? null, "lock");
    write({ userId, wallpaper: desk, lockWallpaper: lock });
    updateLayout((l) => ({ ...l, appearance: { ...l.appearance, syncWallpapers: false } }));
    void queryClient.invalidateQueries({ queryKey: ["wallpaper"] });
  };

  return { wallpaper, lockWallpaper, sync, setWallpaper, setLockWallpaper, upload, setSync };
}
