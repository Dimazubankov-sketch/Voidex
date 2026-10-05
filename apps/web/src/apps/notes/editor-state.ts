/**
 * The document open in Notes right now (one window): what the shell needs to
 * ask before closing / navigating, and to lock it when access is removed.
 */
export interface ActiveDocument {
  docId: string;
  projectId: string;
  isDirty(): boolean;
  /** Saves now; true when nothing is left unsaved. */
  flush(): Promise<boolean>;
  /** Access is gone: stop editing and never save again. */
  lock(): void;
}

export const activeDoc: { current: ActiveDocument | null } = { current: null };
