import { useMemo, type ReactNode } from "react";
import { WIDGET_CELLS, WIDGET_TYPES, gridPlacement, layoutItemKey, placementOf, widgetKey, type LayoutItem, type Place, type PlacedCell, type WidgetType, type WorkspaceLayout } from "@voidex/shared";
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
  /** Step 2.5 (PC): columns that fit the free width; the grid never gets wider than its area. */
  maxCols?: number;
}

export function HomeGrid({ layout, place, items, metrics: m, label, editing, sorted, minRows = 0, renderItem, renderWidget, testId, maxCols }: GridProps) {
  const id = gridId(place);
  const wanted = place.surface === "mobile" ? layout.mobile.columns : layout.desktop.columns;
  const cols = Math.max(1, maxCols ? Math.min(wanted, maxCols) : wanted);
  const rowH = rowHeight(m, label);
  const target = useHomeUi((s) => (s.drag?.cell?.grid === id ? s.drag.cell : null));
  const container = place.surface === "mobile" ? String(place.page) : place.space;
  const widgets = layout.widgets.filter((w) => w.surface === place.surface && w.container === container && (WIDGET_TYPES as readonly string[]).includes(w.type));

  const placed: Map<string, PlacedCell> = useMemo(() => {
    // Fewer columns fit than chosen: items further right flow into the free cells (stored cells are kept).
    if (!sorted) return placementOf(cols === wanted || place.surface === "mobile" ? layout : { ...layout, desktop: { ...layout.desktop, columns: cols } }, place);
    const blocks = widgets.map((w) => ({ key: widgetKey(w.id), ...WIDGET_CELLS[w.type as WidgetType] }));
    const cells = Object.fromEntries(widgets.flatMap((w) => {
      const all = place.surface === "mobile" ? layout.mobile.cells : layout.desktop.cells;
      const c = all[widgetKey(w.id)];
      return c ? [[widgetKey(w.id), c]] : [];
    }));
    return gridPlacement(cols, items.map(layoutItemKey), cells, blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, sorted, items, cols, JSON.stringify(place)]);

  let rows = 0;
  for (const p of placed.values()) rows = Math.max(rows, p.r + p.h);
  // While something is dragged here the grid grows to the row under the pointer (PC desktops grow downwards).
  const shownRows = Math.max(minRows, rows + (editing ? 1 : 0), target ? target.r + 1 : 0, 1);
  const area = (p: PlacedCell) => ({ gridColumn: `${p.c + 1} / span ${p.w}`, gridRow: `${p.r + 1} / span ${p.h}` });

  return (
    <div
      className="relative mx-auto grid"
      style={{ gridTemplateColumns: `repeat(${cols}, ${m.cell}px)`, gridTemplateRows: `repeat(${shownRows}, ${rowH}px)`, columnGap: m.gapX, rowGap: m.gapY, width: cols * m.cell + (cols - 1) * m.gapX }}
      data-home-grid={sorted ? undefined : id}
      data-home-container={sorted ? undefined : id}
      data-home-free
      data-cols={cols}
      data-max-rows={place.surface === "mobile" ? shownRows : undefined}
      data-cell-w={m.cell}
      data-row-h={rowH}
      data-gap-x={m.gapX}
      data-gap-y={m.gapY}
      // Step 2.3.1: the cell under a dragged icon is not drawn (no grid outline while moving icons);
      // the icon still snaps to it on drop. Kept as data for tests.
      data-drop-cell={target ? `${target.c},${target.r}` : undefined}
      data-testid={testId}
    >
      {widgets.map((w) => {
        const p = placed.get(widgetKey(w.id));
        if (!p) return null;
        return (
          <div key={w.id} style={area(p)} className="relative min-h-0 min-w-0" data-widget-cell={w.id} data-cell={`${p.c},${p.r}`}>
            {renderWidget(w.id, { w: p.w * m.cell + (p.w - 1) * m.gapX, h: p.h * rowH + (p.h - 1) * m.gapY })}
          </div>
        );
      })}
      {items.map((item, j) => {
        const p = placed.get(layoutItemKey(item));
        if (!p) return null;
        return (
          <div key={layoutItemKey(item)} style={area(p)} className="flex justify-center" data-cell={`${p.c},${p.r}`}>
            {renderItem(item, j)}
          </div>
        );
      })}
    </div>
  );
}
