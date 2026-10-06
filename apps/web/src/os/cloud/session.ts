import type { FilesAdapter } from "@voidex/files";
import type { Entry, FileData, Folder, Kind, OpenFile } from "@voidex/files/model";
import { MAX_FILE, QUOTA, parseFile, serialize, validData, cleanName } from "@voidex/files/model";
import type { MediaAdapter } from "@voidex/media";
import type { MediaLibrary } from "@voidex/media/model";
import { useSession } from "@/lib/session";
import { CloudUnavailableError } from "./cloud";

/**
 * Files and Media while VOIDEX Cloud is off (Step 2.7): everything lives in
 * memory for this session of this account only. Nothing is written to the
 * server, to browser storage or to another device, and the apps say so
 * («Не сохранено в Облаке VOIDEX»). When the cloud ships, these adapters are
 * replaced by ones that keep their objects in VoidexCloudStorage; the apps
 * do not change.
 */

const encoder = new TextEncoder();
const sizeOf = (kind: Kind, data: FileData) => encoder.encode(serialize(kind, data)).length;

export interface FilesSession extends FilesAdapter {
  /** A .txt / .prsn that arrived from outside (a Vibex / Mail attachment, a device file). */
  importFile(name: string, text: string): Promise<OpenFile>;
  count(): number;
  /** Files and their contents right now (the attach chooser). */
  peek(): { entry: Entry; data: FileData }[];
  /** The file to open when the Files window starts (it arrived before the window existed). */
  takePending(): string | undefined;
}

function createFilesSession(): FilesSession {
  const files = new Map<string, { entry: Entry; data: FileData }>();
  const folders: Folder[] = [];
  const listeners = new Set<(openId?: string) => void>();
  let pending: string | undefined;
  const find = (id: string) => {
    const f = files.get(id);
    if (!f) throw new Error("Файл не найден");
    return f;
  };
  const opened = (id: string): OpenFile => {
    const f = find(id);
    return { file: { ...f.entry }, data: structuredClone(f.data), editable: !f.entry.trashed };
  };
  const adapter: FilesSession = {
    async list() {
      const all = [...files.values()].map((f) => ({ ...f.entry }));
      return { files: all, folders: folders.map((f) => ({ ...f })), used: 0, quota: QUOTA };
    },
    async open(id) {
      if (id === "shared") throw new CloudUnavailableError();
      return opened(id);
    },
    async receive(name, kind, data, folder = null, downloaded = true) {
      if (!validData(kind, data)) throw new Error("Некорректный файл");
      const entry: Entry = {
        id: crypto.randomUUID(),
        name: cleanName(name, kind),
        kind,
        folder: folder && folders.some((f) => f.id === folder) ? folder : null,
        favorite: false,
        trashed: false,
        downloaded,
        updated: Date.now(),
        revision: 1,
        size: sizeOf(kind, data),
      };
      files.set(entry.id, { entry, data: structuredClone(data) });
      return opened(entry.id);
    },
    async save(id, data, revision) {
      const f = find(id);
      if (f.entry.revision !== revision) throw new Error("Файл изменён в другом окне. Откройте его заново.");
      if (!validData(f.entry.kind, data)) throw new Error("Некорректный файл");
      f.data = structuredClone(data);
      f.entry = { ...f.entry, revision: revision + 1, updated: Date.now(), size: sizeOf(f.entry.kind, data) };
      return opened(id);
    },
    async patch(id, changes) {
      const f = find(id);
      const next = { ...f.entry, ...changes };
      if (changes.name !== undefined) next.name = cleanName(changes.name, f.entry.kind);
      if (changes.folder !== undefined && changes.folder !== null && !folders.some((x) => x.id === changes.folder)) next.folder = null;
      f.entry = { ...next, updated: changes.name !== undefined ? Date.now() : f.entry.updated };
      return { ...f.entry };
    },
    async folder(name, id, remove) {
      if (id) {
        const i = folders.findIndex((f) => f.id === id);
        if (i < 0) throw new Error("Папка не найдена");
        if (remove) {
          const [gone] = folders.splice(i, 1);
          for (const f of files.values()) if (f.entry.folder === id) f.entry = { ...f.entry, folder: null };
          return gone!;
        }
        folders[i] = { id, name: name.trim().slice(0, 80) || folders[i]!.name };
        return folders[i]!;
      }
      const folder = { id: crypto.randomUUID(), name: name.trim().slice(0, 80) || "Новая папка" };
      folders.push(folder);
      return folder;
    },
    share: () => Promise.reject(new CloudUnavailableError()),
    revoke: () => Promise.reject(new CloudUnavailableError()),
    shares: async () => [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async importFile(name, text) {
      if (encoder.encode(text).length > MAX_FILE) throw new Error("Файл больше 1 МБ");
      const { kind, data } = parseFile(name, text);
      const f = await adapter.receive(name, kind, data, null, true);
      if (listeners.size) for (const l of listeners) l(f.file.id);
      else pending = f.file.id;
      return f;
    },
    count: () => files.size,
    peek: () => [...files.values()].filter((f) => !f.entry.trashed),
    takePending() {
      const id = pending;
      pending = undefined;
      return id;
    },
  };
  return adapter;
}

export interface MediaSession extends MediaAdapter {
  /** Object URLs made this session, released on sign-out. */
  dispose(): void;
  /** What is in the library right now (the attach chooser). */
  peek(): MediaLibrary;
}

function createMediaSession(): MediaSession {
  let library: MediaLibrary = { version: 1, items: [], albums: [] };
  let revision = 0;
  const urls: string[] = [];
  return {
    async load() {
      return { data: structuredClone(library), revision };
    },
    async save(data, rev) {
      if (rev !== revision) throw new Error("Медиатека изменена в другом окне");
      library = structuredClone(data);
      revision += 1;
      return revision;
    },
    async upload(file) {
      // Session preview only: the picture stays on this device until the cloud exists.
      const url = URL.createObjectURL(file);
      urls.push(url);
      return url;
    },
    peek: () => library,
    dispose() {
      for (const u of urls) URL.revokeObjectURL(u);
      urls.length = 0;
    },
  };
}

let owner: string | null = null;
let filesSession: FilesSession | null = null;
let mediaSession: MediaSession | null = null;

function ensure() {
  const id = useSession.getState().user?.id ?? null;
  if (id !== owner) {
    mediaSession?.dispose();
    owner = id;
    filesSession = createFilesSession();
    mediaSession = createMediaSession();
  }
  return { files: filesSession!, media: mediaSession! };
}

export const sessionFiles = () => ensure().files;
export const sessionMedia = () => ensure().media;
