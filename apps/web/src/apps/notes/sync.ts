import { create } from "zustand";
import type { ServerEvent } from "@voidex/shared";

export type NotesEvent = Extract<ServerEvent, { type: `notes.${string}` }>;

/**
 * Step 2.6: the latest Notes server event (saves by co-editors, revoked
 * access, deleted documents). Kept outside the lazy Notes chunk so the
 * shell's event handler stays small; Notes subscribes to it.
 */
export const useNotesSync = create<{ seq: number; event: NotesEvent | null; push: (e: NotesEvent) => void }>((set) => ({
  seq: 0,
  event: null,
  push: (event) => set((s) => ({ seq: s.seq + 1, event })),
}));
