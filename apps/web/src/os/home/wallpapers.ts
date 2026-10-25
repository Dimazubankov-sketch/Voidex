import { create } from "zustand";
import { useQuery } from "@tanstack/react-query";
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
async function deleteLocalImage(userId: string, slot: WallpaperSlot) {
  await idb("readwrite", (s) => s.delete(imageKey(userId, slot)));
}

// --------------------------------------------------------------- Update 4 · D2: own wallpapers

/** One of my own wallpapers (the library on the account; built-in ones are presets, never here). */
export interface UserWallpaper {
  id: string;
  createdAt: string;
}

/** "lib-<tail>-…": the slot shows this library picture (see the server's userWallpaperVersion). */
export const isFromLibrary = (w: Wallpaper | null | undefined, id: string) => w?.kind === "image" && w.version.startsWith(`lib-${id.slice(-16)}-`);

export function useUserWallpapers(enabled: boolean) {
  return useQuery({ queryKey: ["wallpapers", "library"], queryFn: () => api.get<{ wallpapers: UserWallpaper[] }>("/api/account/wallpapers").then((r) => r.wallpapers), enabled, staleTime: 60_000 });
}

/** A library picture as an image URL (only the owner can read it). */
export function useUserWallpaperImage(id: string | null) {
  return useQuery({ queryKey: ["wallpaper", "lib", id], queryFn: async () => URL.createObjectURL(await api.get<Blob>(`/api/account/wallpapers/${encodeURIComponent(id!)}`)), enabled: !!id, staleTime: Infinity, gcTime: Infinity });
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

  /** Update 4 · D2: my own picture goes to the library (sync on) and is put on the slot. */
  const addOwn = async (file: File, slot: WallpaperSlot): Promise<Wallpaper> => {
    if (useLocal) return upload(file, slot);
    const blob = await prepareWallpaper(file);
    const { id } = await api.post<{ id: string }>("/api/account/wallpapers", blob, { headers: { "Content-Type": "application/octet-stream" } });
    void queryClient.invalidateQueries({ queryKey: ["wallpapers", "library"] });
    return applyOwn(id, slot);
  };
  const applyOwn = async (id: string, slot: WallpaperSlot): Promise<Wallpaper> => {
    const r = await api.post<{ version: string }>(`/api/account/wallpapers/${encodeURIComponent(id)}/apply${slot === "lock" ? "?slot=lock" : ""}`, {});
    return { kind: "image", version: r.version };
  };
  /**
   * Deletes one of my own wallpapers. Where it is in use (home screen, lock screen) the safe built-in one
   * takes its place first. `id` null: the picture of this slot that is not in the library (uploaded
   * before Update 4, or kept on this device with sync off). Built-in wallpapers are never deleted.
   */
  const removeOwn = async (id: string | null, slot: WallpaperSlot) => {
    const onDesk = id ? isFromLibrary(wallpaper, id) : slot === "desktop" && wallpaper.kind === "image";
    const onLock = id ? isFromLibrary(lockWallpaper, id) : slot === "lock" && lockWallpaper?.kind === "image";
    if (onDesk) setWallpaper({ kind: "default" });
    if (onLock) setLockWallpaper(null);
    if (useLocal) {
      if (onDesk) await deleteLocalImage(userId, "desktop");
      if (onLock) await deleteLocalImage(userId, "lock");
    } else {
      if (id) await api.delete(`/api/account/wallpapers/${encodeURIComponent(id)}`);
      // The copy on a slot that no longer shows it.
      if (onDesk) await api.delete("/api/account/wallpaper").catch(() => undefined);
      if (onLock) await api.delete("/api/account/wallpaper?slot=lock").catch(() => undefined);
    }
    void queryClient.invalidateQueries({ queryKey: ["wallpapers", "library"] });
    void queryClient.invalidateQueries({ queryKey: ["wallpaper"] });
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

  return { wallpaper, lockWallpaper, sync, local: useLocal, setWallpaper, setLockWallpaper, upload, addOwn, applyOwn, removeOwn, setSync };
}
