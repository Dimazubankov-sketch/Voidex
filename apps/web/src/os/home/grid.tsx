import { useMemo, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { WIDGET_CELLS, WIDGET_TYPES, gridPlacement, layoutItemKey, placementOf, widgetKey, type LayoutItem, type Place, type PlacedCell, type WidgetType, type WorkspaceLayout } from "@voidex/shared";
import type { DesktopGrid } from "./desktop-geometry";
import type { IconMetrics, LabelStyle } from "./icons";
import { useHomeUi } from "./ui-store";

/**
 * The home grid (Step 2.3) — phone pages and PC desktops alike. Every icon and
 * widget sits in a cell (column, row) of the synced layout; empty cells stay
 * empty, so the user decides where things go. A 2×2 widget covers four cells.
 *
 * The grid carries its geometry in data attributes, so the gesture engine can
 * turn a pointer position into a cell without asking React.
 */

/** Height of one row: tile + label lines (none when labels are off) + the running dot. */
export function rowHeight(m: IconMetrics, label: LabelStyle): number {
  const text = label.show === false ? 0 : Math.round(label.name * 1.3) + 6 + (label.captions ? Math.round(label.caption * 1.3) : 0);
  return m.tile + 8 + text + 10;
}

export const gridId = (place: Place) => (place.surface === "mobile" ? `mobile:${place.page}` : `desktop:${place.space}`);

export function placeOfGrid(id: string): Place | null {
  const [surface, rest] = id.split(":");
  if (surface === "mobile") return { surface: "mobile", page: Number(rest) };
  if (surface === "desktop" && rest) return { surface: "desktop", space: rest };
  return null;
}

/** The cell under a pointer, from a grid element's geometry. */
export function cellAt(grid: HTMLElement, x: number, y: number): { c: number; r: number } {
  const r = grid.getBoundingClientRect();
  const cw = Number(grid.dataset.cellW);
  const rh = Number(grid.dataset.rowH);
  const gx = Number(grid.dataset.gapX);
  const gy = Number(grid.dataset.gapY);
  const cols = Number(grid.dataset.cols);
  // Phone pages have a fixed number of rows (the page height); PC desktops grow downwards.
  const maxRows = Number(grid.dataset.maxRows) || Infinity;
  const c = Math.max(0, Math.min(cols - 1, Math.floor((x - r.left + gx / 2) / (cw + gx))));
  const row = Math.max(0, Math.min(maxRows - 1, Math.floor((y - r.top + gy / 2) / (rh + gy))));
  return { c, r: row };
}

interface GridProps {
  layout: WorkspaceLayout;
  place: Place;
  items: LayoutItem[];
  metrics: IconMetrics;
  label: LabelStyle;
  editing: boolean;
  /** Sorted by name (PC): items flow in that order, stored cells are not used. */
  sorted?: boolean;
  /** Rows to show at least (the phone page fills its height). */
  minRows?: number;
  renderItem: (item: LayoutItem, index: number) => ReactNode;
  renderWidget: (id: string, size: { w: number; h: number }) => ReactNode;
  testId?: string;
  /**
   * Step 2.5.1 (PC): the desktop is exactly its screen area — columns × rows
   * that fit it, spread over the full width and height. Nothing is placed
   * outside it and the grid never grows (no scrolling desktop).
   */
  fixed?: DesktopGrid;
}

export function HomeGrid({ layout, place, items, metrics: m, label, editing, sorted, minRows = 0, renderItem, renderWidget, testId, fixed }: GridProps) {
  const id = gridId(place);
  const cols = Math.max(1, fixed ? fixed.cols : place.surface === "mobile" ? layout.mobile.columns : layout.desktop.columns);
  const rowH = rowHeight(m, label);
  const target = useHomeUi((s) => (s.drag?.cell?.grid === id ? s.drag.cell : null));
  const container = place.surface === "mobile" ? String(place.page) : place.space;
  const widgets = layout.widgets.filter((w) => w.surface === place.surface && w.container === container && (WIDGET_TYPES as readonly string[]).includes(w.type));

  const geometry = fixed ? { cols: fixed.cols, rows: fixed.rows } : undefined;
  const placed: Map<string, PlacedCell> = useMemo(() => {
    // PC: stored cells outside the screen area move to the nearest free cell inside it.
    if (!sorted) return placementOf(layout, place, geometry);
    const blocks = widgets.map((w) => ({ key: widgetKey(w.id), ...WIDGET_CELLS[w.type as WidgetType] }));
    const cells = Object.fromEntries(widgets.flatMap((w) => {
      const all = place.surface === "mobile" ? layout.mobile.cells : layout.desktop.cells;
      const c = all[widgetKey(w.id)];
      return c ? [[widgetKey(w.id), c]] : [];
    }));
    return gridPlacement(cols, items.map(layoutItemKey), cells, blocks, geometry?.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, sorted, items, cols, geometry?.rows, JSON.stringify(place)]);

  let rows = 0;
  for (const p of placed.values()) rows = Math.max(rows, p.r + p.h);
  // While something is dragged here the grid grows to the row under the pointer (PC desktops grow downwards).
  const shownRows = fixed ? Math.max(fixed.rows, rows) : Math.max(minRows, rows + (editing ? 1 : 0), target ? target.r + 1 : 0, 1);
  const area = (p: PlacedCell) => ({ gridColumn: `${p.c + 1} / span ${p.w}`, gridRow: `${p.r + 1} / span ${p.h}` });

  return (
    <div
      className={cx("relative grid", fixed ? "size-full" : "mx-auto")}
      style={
        fixed
          ? // Rows share the area exactly (never taller than it, even for a frame while the window resizes).
            { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: shownRows === fixed.rows ? `repeat(${shownRows}, minmax(0, 1fr))` : `repeat(${shownRows}, ${fixed.rowH}px)` }
          : { gridTemplateColumns: `repeat(${cols}, ${m.cell}px)`, gridTemplateRows: `repeat(${shownRows}, ${rowH}px)`, columnGap: m.gapX, rowGap: m.gapY, width: cols * m.cell + (cols - 1) * m.gapX }
      }
      data-home-grid={sorted ? undefined : id}
      data-home-container={sorted ? undefined : id}
      data-home-free
      data-cols={cols}
      data-rows={fixed ? fixed.rows : undefined}
      data-max-rows={place.surface === "mobile" ? shownRows : fixed ? fixed.rows : undefined}
      data-cell-w={fixed ? fixed.cellW : m.cell}
      data-row-h={fixed ? fixed.rowH : rowH}
      data-gap-x={fixed ? 0 : m.gapX}
      data-gap-y={fixed ? 0 : m.gapY}
      // Step 2.3.1: the cell under a dragged icon is not drawn (no grid outline while moving icons);
      // the icon still snaps to it on drop. Kept as data for tests.
      data-drop-cell={target ? `${target.c},${target.r}` : undefined}
      data-testid={testId}
    >
      {widgets.map((w) => {
        const p = placed.get(widgetKey(w.id));
        if (!p) return null;
        return (
          <div key={w.id} style={area(p)} className={cx("relative min-h-0 min-w-0", fixed && "flex items-start justify-center")} data-widget-cell={w.id} data-cell={`${p.c},${p.r}`}>
            {renderWidget(
              w.id,
              // PC: a widget fills its cells (with a small inset), like the icons spread over theirs.
              fixed ? { w: Math.round(p.w * fixed.cellW - 12), h: Math.round(p.h * fixed.rowH - 12) } : { w: p.w * m.cell + (p.w - 1) * m.gapX, h: p.h * rowH + (p.h - 1) * m.gapY },
            )}
          </div>
        );
      })}
      {items.map((item, j) => {
        const p = placed.get(layoutItemKey(item));
        if (!p) return null;
        return (
          <div key={layoutItemKey(item)} style={area(p)} className={cx("flex min-h-0 min-w-0 justify-center", fixed && "items-start")} data-cell={`${p.c},${p.r}`}>
            {renderItem(item, j)}
          </div>
        );
      })}
    </div>
  );
}
