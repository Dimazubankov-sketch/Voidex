import type { AppId } from "@voidex/shared";
import { queryClient } from "@/lib/query";
import { sessionFiles, sessionMedia } from "@/os/cloud/session";
import { requestClose, useWM } from "@/os/window-manager";

/**
 * Step 2.8: «Хранилище Voidex», the storage of this device (not ViCloud).
 *
 * The total and the used space come from the browser (StorageManager: what
 * this site may keep on the device and what it keeps now). Per app we count
 * what we can attribute for real: the app's cached data (its queries) and,
 * for Files and Media, what was opened or added this session. The rest of
 * the used space is "System and cache" (the app code, the browser's caches).
 */
const QUERY_ROOTS: Record<AppId, string[]> = {
  settings: ["me", "sessions", "approvals", "security", "consents", "system-info", "legal", "legal-list", "face-id-support", "lock-state", "wallpaper", "lock-wallpaper", "avatar"],
  mail: ["mail"],
  vibex: ["vibex"],
  notes: ["notes"],
  calculator: [],
  files: [],
  media: [],
};

const encoder = new TextEncoder();

function cacheBytes(id: AppId): number {
  const roots = new Set(QUERY_ROOTS[id]);
  let n = 0;
  for (const q of queryClient.getQueryCache().getAll()) {
    if (!roots.has(String(q.queryKey[0])) || q.state.data === undefined) continue;
    try {
      n += encoder.encode(JSON.stringify(q.state.data)).length;
    } catch {
      /* not serialisable: not counted */
    }
  }
  return n;
}

/** Bytes an app keeps on this device right now. */
export function appBytes(id: AppId): number {
  const own = id === "files" ? sessionFiles().bytes() : id === "media" ? sessionMedia().bytes() : 0;
  return own + cacheBytes(id);
}

export interface DeviceStorage {
  /** What the browser lets VOIDEX keep on this device; null when the browser does not tell. */
  quota: number | null;
  usage: number | null;
}

export async function deviceStorage(): Promise<DeviceStorage> {
  try {
    const e = await navigator.storage?.estimate?.();
    return { quota: e?.quota ?? null, usage: e?.usage ?? null };
  } catch {
    return { quota: null, usage: null };
  }
}

/** Settings cannot be offloaded (it is the system itself). */
export const canOffload = (id: AppId) => id !== "settings";

/**
 * Offload: close the app's windows (asking about unsaved work, as a normal
 * close does) and drop its cached data on this device. Documents and
 * messages stay on the server; Files and Media keep this session's files.
 * Resolves false if the person kept a window open.
 */
export async function offloadApp(id: AppId): Promise<boolean> {
  if (!canOffload(id)) return false;
  for (const w of Object.values(useWM.getState().windows)) {
    if (w.appId !== id) continue;
    if (!(await requestClose(w.id))) return false;
  }
  for (const root of QUERY_ROOTS[id]) queryClient.removeQueries({ queryKey: [root], type: "inactive" });
  return true;
}
