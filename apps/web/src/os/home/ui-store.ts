import { create } from "zustand";
import type { AppId, LayoutItem } from "@voidex/shared";

/**
 * Device-local UI state of the home screen (not synced: what is open *here*).
 * The arrangement itself is in the synced layout (layout.ts).
 */
export type ContextTarget =
  | { kind: "app"; id: AppId; inFolder?: string }
  | { kind: "folder"; id: string }
  | { kind: "desktop" }
  | { kind: "launcher-app"; id: AppId }
  | { kind: "dock-app"; id: AppId }
  | { kind: "dock-desktops" }
  | { kind: "widget"; id: string }
  | { kind: "space"; id: string };

export type RenameTarget = { kind: "app"; id: AppId } | { kind: "space"; id: string };

export interface ContextMenuState {
  x: number;
  y: number;
  target: ContextTarget;
  /** Unique per opening, so a menu reopened at the same spot starts fresh. */
  seq?: number;
}

let menuSeq = 0;

export interface DragState {
  item: LayoutItem;
  /** Folder the dragged app is being moved inside of (open folder). */
  fromFolder?: string;
  /** Size of the icon tile being dragged, for the floating copy. */
  size: number;
  /** Item the dragged app would merge with on release (folder creation). */
  mergeWith?: string;
  /** PC dock: the drag started in the dock. */
  fromDock?: boolean;
  /** PC dock: a desktop icon hovers the dock and would be pinned at this index. */
  overDock?: number;
  /** PC dock: dragged up and out of the dock — released, it is unpinned. */
  unpin?: boolean;
  /** PC dock reorder preview: where the dragged dock app would land (committed on drop only). */
  dockIndex?: number;
  /** Step 2.3 grid: the cell the dragged item would land in (grid id + column / row). */
  cell?: { grid: string; c: number; r: number };
  /** A widget (not an icon) is being dragged: its own card moves, there is no floating copy. */
  widget?: string;
}

interface HomeUi {
  editing: boolean;
  mobilePage: number;
  openFolder: { id: string; origin: DOMRect | null } | null;
  renamingFolder: string | null;
  renaming: RenameTarget | null;
  menu: ContextMenuState | null;
  search: { open: boolean; query: string };
  appearanceOpen: boolean;
  /** The brush menu (Wallpaper / View / Widgets), anchored at the brush. */
  brushOpen: boolean;
  widgetsOpen: boolean;
  launcherOpen: boolean;
  drag: DragState | null;
  /** Step 2.5: apps marked with "−" in edit mode, waiting for "Удалить". */
  removeSel: AppId[];
  /** Step 2.5: the apps in the two-step delete confirmation (null: closed). */
  removeConfirm: AppId[] | null;
  /** Step 2.5.1: the PC desktop waiting for "Удалить рабочий стол" to be confirmed. */
  removeSpaceConfirm: string | null;
  setRemoveSpaceConfirm: (id: string | null) => void;
  toggleRemoveSel: (id: AppId) => void;
  setRemoveConfirm: (ids: AppId[] | null) => void;
  setEditing: (v: boolean) => void;
  setMobilePage: (p: number) => void;
  setOpenFolder: (f: HomeUi["openFolder"]) => void;
  setRenamingFolder: (id: string | null) => void;
  setRenaming: (r: RenameTarget | null) => void;
  openMenu: (m: ContextMenuState) => void;
  closeMenu: () => void;
  setSearch: (s: Partial<HomeUi["search"]>) => void;
  setAppearanceOpen: (v: boolean) => void;
  setBrushOpen: (v: boolean) => void;
  setWidgetsOpen: (v: boolean) => void;
  setLauncherOpen: (v: boolean) => void;
  setDrag: (d: DragState | null) => void;
  patchDrag: (d: Partial<DragState>) => void;
}

export const useHomeUi = create<HomeUi>((set) => ({
  editing: false,
  mobilePage: 0,
  openFolder: null,
  renamingFolder: null,
  renaming: null,
  menu: null,
  search: { open: false, query: "" },
  appearanceOpen: false,
  brushOpen: false,
  widgetsOpen: false,
  launcherOpen: false,
  drag: null,
  removeSel: [],
  removeConfirm: null,
  removeSpaceConfirm: null,
  setRemoveSpaceConfirm: (removeSpaceConfirm) => set({ removeSpaceConfirm, menu: null }),
  toggleRemoveSel: (id) => set((st) => ({ removeSel: st.removeSel.includes(id) ? st.removeSel.filter((a) => a !== id) : [...st.removeSel, id] })),
  setRemoveConfirm: (removeConfirm) => set({ removeConfirm, menu: null }),
  setEditing: (editing) =>
    set(editing ? { editing, menu: null, launcherOpen: false } : { editing, renamingFolder: null, brushOpen: false, removeSel: [] }),
  setMobilePage: (mobilePage) => set({ mobilePage }),
  setOpenFolder: (openFolder) => set(openFolder ? { openFolder, menu: null } : { openFolder, menu: null, renamingFolder: null }),
  setRenamingFolder: (renamingFolder) => set({ renamingFolder }),
  setRenaming: (renaming) => set({ renaming, menu: null }),
  openMenu: (menu) => set({ menu: { ...menu, seq: ++menuSeq } }),
  closeMenu: () => set({ menu: null }),
  setSearch: (s) => set((st) => ({ search: { ...st.search, ...s } })),
  setAppearanceOpen: (appearanceOpen) => set({ appearanceOpen, menu: null, launcherOpen: false, brushOpen: false }),
  setBrushOpen: (brushOpen) => set({ brushOpen, menu: null, launcherOpen: false }),
  setWidgetsOpen: (widgetsOpen) => set({ widgetsOpen, menu: null, launcherOpen: false, brushOpen: false }),
  setLauncherOpen: (launcherOpen) => set({ launcherOpen, menu: null }),
  setDrag: (drag) => set({ drag }),
  patchDrag: (d) => set((st) => (st.drag ? { drag: { ...st.drag, ...d } } : {})),
}));
