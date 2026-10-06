import { create } from "zustand";

/**
 * VOIDEX Cloud (Step 2.7): the future single object store with one quota per
 * account, shared by Files and Media. It is not running yet, so nothing in
 * the interface pretends otherwise: no usage, no sync, no uploads.
 *
 * When it ships, `voidexCloud` becomes an HTTP implementation of
 * VoidexCloudStorage and the Files / Media adapters (`./session.ts`) store
 * their objects through it. The UI only talks to the adapters and to
 * `useCloudStatus`, never to browser storage.
 */
export const VOIDEX_CLOUD_QUOTA_BYTES = 5 * 1024 ** 3;

export type CloudApp = "files" | "media";

export interface VoidexCloudStatus {
  available: boolean;
  /** The quota every account will get (one for Files and Media together). */
  quotaBytes: number;
  /** Known only while the cloud is available. */
  usedBytes: number | null;
}

export interface CloudObject {
  id: string;
  app: CloudApp;
  name: string;
  mime: string;
  size: number;
}

export interface VoidexCloudStorage {
  status(): VoidexCloudStatus;
  put(app: CloudApp, name: string, blob: Blob): Promise<CloudObject>;
  get(id: string): Promise<Blob>;
  remove(id: string): Promise<void>;
}

export class CloudUnavailableError extends Error {
  constructor() {
    super("cloud_unavailable");
    this.name = "CloudUnavailableError";
  }
}

const unavailable = () => Promise.reject(new CloudUnavailableError());

/** The cloud as it is today: off. Every operation is refused, honestly. */
export const voidexCloud: VoidexCloudStorage = {
  status: () => ({ available: false, quotaBytes: VOIDEX_CLOUD_QUOTA_BYTES, usedBytes: null }),
  put: unavailable,
  get: unavailable,
  remove: unavailable,
};

export function useCloudStatus(): VoidexCloudStatus {
  return voidexCloud.status();
}

/** The one Cloud dialog of the system (Media's cloud button, Files, the attach chooser). */
export const useCloudDialog = create<{ open: boolean; from: CloudApp | "attach" | null; show: (from: CloudApp | "attach") => void; hide: () => void }>((set) => ({
  open: false,
  from: null,
  show: (from) => set({ open: true, from }),
  hide: () => set({ open: false }),
}));
