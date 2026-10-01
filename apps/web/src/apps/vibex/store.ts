import { createContext, useContext } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { VibexPostDto } from "@voidex/shared";
import type { HistoryKind } from "./data";

export type VibexSection = "feed" | "chats" | "people" | "me" | "history";

/** A page pushed on top of a section (phones slide it in; desktop shows it in the main pane). */
export type VibexPage = { kind: "chat"; id: string } | { kind: "person"; id: string } | { kind: "post"; id: string };

export interface VibexUiState {
  section: VibexSection;
  /** Desktop: the chat open next to the list. Phones: the chat page. */
  chatId: string | null;
  stack: VibexPage[];
  historyKind: HistoryKind;
  composing: boolean;
  sharing: VibexPostDto | null;
  /** Comments screen of this post (Voyzen: full surface over the app). */
  commentsFor: string | null;
  /** Phones: the side menu drawer. */
  drawer: boolean;
  go: (s: VibexSection) => void;
  openChat: (id: string | null) => void;
  push: (p: VibexPage) => void;
  back: () => void;
  setHistoryKind: (k: HistoryKind) => void;
  compose: (open: boolean) => void;
  share: (post: VibexPostDto | null) => void;
  openComments: (postId: string | null) => void;
  setDrawer: (open: boolean) => void;
}

/** UI state of one Vibex window (each window instance gets its own store). */
export function createVibexStore() {
  return createStore<VibexUiState>((set) => ({
    section: "feed",
    chatId: null,
    stack: [],
    historyKind: "liked",
    composing: false,
    sharing: null,
    commentsFor: null,
    drawer: false,
    go: (section) => set({ section, stack: [], chatId: null, commentsFor: null, drawer: false }),
    openChat: (chatId) => set({ section: "chats", chatId, stack: [] }),
    push: (p) => set((s) => (p.kind === "chat" ? { section: "chats", chatId: p.id, stack: [] } : { stack: [...s.stack, p] })),
    back: () => set((s) => (s.stack.length ? { stack: s.stack.slice(0, -1) } : { chatId: null })),
    setHistoryKind: (historyKind) => set({ historyKind }),
    compose: (composing) => set({ composing }),
    share: (sharing) => set({ sharing }),
    openComments: (commentsFor) => set({ commentsFor }),
    setDrawer: (drawer) => set({ drawer }),
  }));
}

export const VibexStoreContext = createContext<StoreApi<VibexUiState> | null>(null);

export function useVibex<T>(selector: (s: VibexUiState) => T): T {
  const store = useContext(VibexStoreContext);
  if (!store) throw new Error("VibexStoreContext missing");
  return useStore(store, selector);
}

export function useVibexStore() {
  const store = useContext(VibexStoreContext);
  if (!store) throw new Error("VibexStoreContext missing");
  return store;
}

/** Chats currently on screen in some Vibex window: no banner for those. */
export const visibleChats = new Map<string, number>();
export function markVisible(id: string) {
  visibleChats.set(id, (visibleChats.get(id) ?? 0) + 1);
  return () => {
    const n = (visibleChats.get(id) ?? 1) - 1;
    if (n <= 0) visibleChats.delete(id);
    else visibleChats.set(id, n);
  };
}
