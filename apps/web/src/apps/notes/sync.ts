import { create } from "zustand";

/**
 * Newest Notes revision saved on another device (server event "notes.changed").
 * Kept outside the lazy Notes chunk so the shell's event handler stays small.
 */
export const useNotesSync = create<{ revision: number }>(() => ({ revision: 0 }));
