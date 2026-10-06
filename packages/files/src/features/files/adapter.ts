import type { ReactNode } from 'react';
import type { Listing, OpenFile, Kind, FileData, Entry, Folder } from './model';
export interface FilesAdapter {
  list(): Promise<Listing>;
  open(id: string, token?: string): Promise<OpenFile>;
  receive(name: string, kind: Kind, data: FileData, folder?: string | null, downloaded?: boolean): Promise<OpenFile>;
  save(id: string, data: FileData, revision: number, token?: string): Promise<OpenFile>;
  patch(id: string, changes: Partial<Pick<Entry, 'name' | 'folder' | 'favorite' | 'trashed' | 'downloaded'>>): Promise<Entry>;
  folder(name: string, id?: string, remove?: boolean): Promise<Folder>;
  share(id: string, editable: boolean): Promise<{ token: string }>;
  revoke(token: string): Promise<void>;
  shares(): Promise<{ token: string; file: string; name: string; editable: boolean }[]>;
  /** Host integration: called when files arrive from outside (optionally the one to open). */
  subscribe?(listener: (openId?: string) => void): () => void;
}
async function request(method: string, body?: unknown, query = ''): Promise<any> {
  const r = await fetch('/api/files' + query, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data: any = await r.json();
  if (!r.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
  return data;
}
export const httpAdapter: FilesAdapter = {
  list: () => request('GET'),
  open: (id, token) => request('GET', undefined, '?id=' + encodeURIComponent(id) + (token ? '&token=' + encodeURIComponent(token) : '')),
  receive: (name, kind, data, folder = null, downloaded = true) => request('POST', { op: 'receive', name, kind, data, folder, downloaded }),
  save: (id, data, revision, token) => request('PUT', { id, data, revision, token }),
  patch: (id, changes) => request('PATCH', { id, changes }),
  folder: (name, id, remove) => request('POST', { op: 'folder', name, id, remove }),
  share: (id, editable) => request('POST', { op: 'share', id, editable }),
  revoke: (token) => request('DELETE', { token }),
  shares: () => request('GET', undefined, '?shares=1'),
};
export type ShareRecipient = { id: string; name: string; email?: string; avatar?: string };
export type FilesHost = {
  shareTo?: (
    channel: 'vibex' | 'voidops',
    payload: { url: string; name: string; editable: boolean; recipientId?: string },
  ) => Promise<void>;
  currentUser?: { name: string; email?: string };
  searchRecipients?: (channel: 'vibex' | 'voidops', query: string) => Promise<ShareRecipient[]>;
  onDirtyChange?: (dirty: boolean) => void;
  /** The host's own cloud dialog (one for the whole system). */
  onOpenCloud?: () => void;
  /** Cloud state from the host; `available: false` shows an honest "not available" card, no quota. */
  cloud?: { available: boolean };
  /** The host's own share flow (replaces the built-in FileShare). */
  onShare?: (file: OpenFile) => void;
  /** A host message shown above the files (e.g. "not saved to the cloud"). */
  notice?: ReactNode;
  /** Open this file once the app starts. */
  initialOpen?: string;
};
