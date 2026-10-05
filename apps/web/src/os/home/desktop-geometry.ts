import { create } from "zustand";
import type { GridGeometry } from "@voidex/shared";

/**
 * Step 2.5.1 — the PC desktop grid as this screen shows it: columns × rows
 * that fit the free area (the desktop minus the system bar, the dock zone and
 * the margins), each cell `cellW × rowH` px. Measured by the desktop surface
 * on every resize (window, dock size, system bar); drops on the grid use the
 * same numbers, so a dropped icon lands exactly where it is drawn.
 */
export interface DesktopGrid extends GridGeometry {
  cellW: number;
  rowH: number;
}

export const useDesktopGrid = create<{ grid: DesktopGrid | null; set: (g: DesktopGrid) => void }>((set) => ({
  grid: null,
  set: (grid) => set((s) => (s.grid && s.grid.cols === grid.cols && s.grid.rows === grid.rows && s.grid.cellW === grid.cellW && s.grid.rowH === grid.rowH ? s : { grid })),
}));

/** The geometry for layout operations on a PC desktop (undefined until measured / on phones). */
export function desktopGeometry(): GridGeometry | undefined {
  const g = useDesktopGrid.getState().grid;
  return g ? { cols: g.cols, rows: g.rows } : undefined;
}

/** Columns × rows of `cell × row` px that fit `w × h` px with at least `gapX` / `gapY` between them. */
export function fitGrid(w: number, h: number, cell: number, row: number, gapX: number, gapY: number): DesktopGrid {
  const cols = Math.max(1, Math.floor((w + gapX) / (cell + gapX)));
  const rows = Math.max(1, Math.floor((h + gapY) / (row + gapY)));
  return { cols, rows, cellW: w / cols, rowH: h / rows };
}
