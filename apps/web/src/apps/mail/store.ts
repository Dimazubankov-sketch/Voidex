import { createContext, useContext } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { MailAttachmentDto, MailView } from "@voidex/shared";

export interface ComposerState {
  /** Local id so a new composer remounts cleanly. */
  key: number;
  draftId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  replyToMessageId?: string;
  forwardOfMessageId?: string;
  attachments?: MailAttachmentDto[];
}

export interface MailUiState {
  view: MailView;
  query: string;
  threadId: string | null;
  selection: string[];
  drawerOpen: boolean;
  composer: ComposerState | null;
  setView: (v: MailView) => void;
  setQuery: (q: string) => void;
  openThread: (id: string | null) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setDrawer: (open: boolean) => void;
  compose: (c?: Partial<Omit<ComposerState, "key">>) => void;
  closeComposer: () => void;
}

let composerSeq = 0;

/** UI state of one Mail window (each window instance gets its own store). */
export function createMailStore() {
  return createStore<MailUiState>((set) => ({
    view: "inbox",
    query: "",
    threadId: null,
    selection: [],
    drawerOpen: false,
    composer: null,
    setView: (view) => set({ view, threadId: null, selection: [], drawerOpen: false, query: "" }),
    setQuery: (query) => set({ query, threadId: null, selection: [] }),
    openThread: (threadId) => set({ threadId, selection: [] }),
    toggleSelect: (id) => set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
    clearSelection: () => set({ selection: [] }),
    setDrawer: (drawerOpen) => set({ drawerOpen }),
    compose: (c = {}) =>
      set({
        drawerOpen: false,
        composer: { key: ++composerSeq, draftId: null, to: [], cc: [], bcc: [], subject: "", body: "", ...c },
      }),
    closeComposer: () => set({ composer: null }),
  }));
}

export const MailStoreContext = createContext<StoreApi<MailUiState> | null>(null);

export function useMail<T>(selector: (s: MailUiState) => T): T {
  const store = useContext(MailStoreContext);
  if (!store) throw new Error("MailStoreContext missing");
  return useStore(store, selector);
}
