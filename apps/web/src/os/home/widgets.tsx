import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { RiAddCircleFill, RiArrowLeftSLine, RiCloseLine, RiSubtractLine } from "@remixicon/react";
import {
  APP_REGISTRY,
  MOBILE_PAGES_MAX,
  WIDGETS_MAX,
  WIDGET_CELLS,
  addToStack,
  addWidget,
  carouselSpot,
  deleteWidgetHalf,
  joinWidgets,
  setStackActive,
  stackWidgets,
  widgetCells,
  widgetColumns,
  type StackResult,
  type WidgetItem,
  freeBlock,
  moveWidget,
  type AppId,
  display,
  emptyCalc,
  placeInCell,
  press,
  removeWidget,
  widgetKey,
  type Widget,
  type WidgetType,
  type WorkspaceLayout,
} from "@voidex/shared";
import { cx } from "@/lib/cx";
import { getFormFactor, useFormFactor } from "@/lib/form-factor";
import { t as translateNow, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { Button, IconButton } from "@/ui/controls";
import { ConfirmDialog, Sheet, toast } from "@/ui/overlays";
import { createPortal } from "react-dom";
import { useWM } from "../window-manager";
import { CalculatorGlyph, ClockGlyph } from "@/brand/brand";
import { cityClock, localZone } from "@voidex/clock";
import { desktopGeometry, geometryFor } from "./desktop-geometry";
import { cellAt, placeOfGrid } from "./grid";
import { openApp } from "./actions";
import { currentLayout, updateLayout, useWorkspaceLayout } from "./layout";
import { useHomeUi } from "./ui-store";
import { VoidexSearchField } from "@/ui/search-field";

/**
 * Home-screen widgets. A small system catalogue (no widget store yet); the
 * placed widgets are part of the synced workspace layout (`layout.widgets`)
 * and sit in the home grid like icons, covering a block of cells (the
 * Calculator: 2 × 2). In edit mode a widget is dragged to another cell.
 *
 * Adding a widget type = an entry in WIDGET_TYPES / WIDGET_CELLS (shared) + one here.
 * Widgets stay light: nothing heavy (the full Calculator's OCR, KaTeX…) loads for them.
 */

interface WidgetDef {
  type: WidgetType;
  /** The app the widget comes from (its name and icon in the catalogue). */
  app: AppId;
  title: MessageKey;
  /** Step 2.15: the widget's own name under its app («Аналоговые часы»). */
  name: MessageKey;
  description: MessageKey;
  keywords: string;
  Icon: ComponentType<{ className?: string }>;
  Body: ComponentType<{ preview?: boolean }>;
}

const KEYS = ["C", "±", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "0", ".", "⌫", "="] as const;

/** A working mini calculator: display + the basic keys. Its title opens the Calculator app. */
function CalculatorWidget({ preview }: { preview?: boolean }) {
  const t = useT();
  const [state, setState] = useState(emptyCalc);
  const shown = display(state);
  const openFull = (e: React.MouseEvent<HTMLElement>) => openApp("calculator", e.currentTarget);
  return (
    <div className={cx("flex h-full min-h-0 flex-col gap-1.5 p-2.5", preview && "pointer-events-none")} data-testid="calc-widget">
      <button type="button" onClick={openFull} className="flex items-center gap-1.5 self-start rounded-lg px-1 text-left" data-testid="calc-widget-open" aria-label={t("widgets.calculatorOpen")}>
        <CalculatorGlyph className="size-4" />
        <span className="text-[12px] font-semibold text-text">{t("widgets.calculator")}</span>
      </button>
      <div className="flex min-h-0 flex-col items-end justify-end px-1" aria-live="polite">
        <span className="h-3.5 max-w-full truncate text-[11px] leading-none text-text-tertiary">{shown.expression}</span>
        <span className={cx("max-w-full truncate text-[22px] font-semibold leading-tight tabular-nums", state.error ? "text-danger" : "text-text")} data-testid="calc-widget-display">
          {state.error ? t("widgets.calcError") : shown.value}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-1" role="group" aria-label={t("widgets.calculator")}>
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            tabIndex={preview ? -1 : 0}
            onClick={() => setState((s) => press(s, k))}
            className={cx(
              "flex min-h-0 items-center justify-center rounded-[10px] text-[14px] font-semibold transition-transform active:scale-95",
              k === "=" ? "bg-primary text-white" : "×÷−+".includes(k) ? "bg-primary/12 text-primary" : k === "C" || k === "±" || k === "%" || k === "⌫" ? "bg-black/[0.06] text-text-secondary" : "bg-white/70 text-text",
            )}
            aria-label={k === "⌫" ? t("widgets.calcBackspace") : k === "C" ? t("widgets.calcClear") : k}
            data-testid={`calc-key-${k}`}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The current time, re-rendered on every new second (aligned to the clock, paused while the tab is hidden). */
function useSecond(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const tick = () => {
      setNow(Date.now());
      id = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    const onVisible = () => document.visibilityState === "visible" && setNow(Date.now());
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
  return now;
}

/**
 * Step 2.14: Clock widget (2 × 2): a large analog clock of this device's
 * time, in the system's colours (light and dark), no logo. A tap opens
 * Clock on the world clock.
 */
function ClockWidget({ preview }: { preview?: boolean }) {
  const t = useT();
  const now = useSecond(true);
  const d = new Date(now);
  const s = d.getSeconds();
  const m = d.getMinutes() + s / 60;
  const h = (d.getHours() % 12) + m / 60;
  const label = t("widgets.clockNow", { time: cityClock(localZone(), now) });
  const hand = (deg: number, len: number, width: number, cls: string, tail = 0) => (
    <line x1={100} y1={100 + tail} x2={100} y2={100 - len} strokeWidth={width} strokeLinecap="round" className={cls} transform={`rotate(${deg} 100 100)`} />
  );
  return (
    <button
      type="button"
      tabIndex={preview ? -1 : 0}
      onClick={(e) => openApp("clock", e.currentTarget, { tab: "world" })}
      className={cx("flex size-full items-center justify-center rounded-[24px] p-[7%]", preview && "pointer-events-none")}
      aria-label={label}
      title={label}
      data-testid="clock-widget"
      data-time={cityClock(localZone(), now)}
    >
      <svg viewBox="0 0 200 200" className="size-full max-h-full drop-shadow-[0_6px_14px_rgba(20,16,50,0.16)]" aria-hidden>
        <circle cx={100} cy={100} r={98} className="fill-[var(--surface)]" />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1={100} y1={13} x2={100} y2={i % 3 === 0 ? 33 : 28} strokeWidth={i % 3 === 0 ? 6 : 4.5} strokeLinecap="round" className="stroke-[color-mix(in_srgb,var(--text)_70%,transparent)]" transform={`rotate(${i * 30} 100 100)`} />
        ))}
        {hand(h * 30, 46, 7, "stroke-[var(--text)]")}
        {hand(m * 6, 70, 5.5, "stroke-[var(--text)]")}
        <g data-testid="clock-widget-second" data-angle={s * 6}>
          {hand(s * 6, 78, 2, "stroke-[var(--primary)]", 16)}
        </g>
        <circle cx={100} cy={100} r={6} className="fill-[var(--text)]" />
        <circle cx={100} cy={100} r={3} className="fill-[var(--primary)]" />
      </svg>
    </button>
  );
}

export const WIDGETS: WidgetDef[] = [
  {
    type: "calculator",
    app: "calculator",
    title: "widgets.calculator",
    name: "widgets.calculatorName",
    description: "widgets.calculatorHint",
    keywords: "calculator calc math калькулятор счёт",
    Icon: ({ className }) => <CalculatorGlyph className={className} />,
    Body: CalculatorWidget,
  },
  {
    type: "clock",
    app: "clock",
    title: "widgets.clock",
    name: "widgets.clockName",
    description: "widgets.clockHint",
    keywords: "clock time analog watch часы время циферблат",
    Icon: ({ className }) => <ClockGlyph className={className} />,
    Body: ClockWidget,
  },
];

const defOf = (type: string) => WIDGETS.find((w) => w.type === type);

function RemoveBadge({ onRemove }: { onRemove: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("widgets.remove")}
      title={t("widgets.remove")}
      data-home-control
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="absolute -left-2 -top-2 z-10 flex size-[22px] items-center justify-center rounded-full border border-white/70 bg-[rgba(60,60,72,0.72)] text-white shadow-md backdrop-blur-md animate-pop"
      data-testid="widget-remove"
    >
      <RiSubtractLine className="size-4" />
    </button>
  );
}

/** Phone: holding a dragged widget this close to the side of the screen carries it to the next page. */
const EDGE = 26;
const EDGE_HOLD_MS = 600;
/** Long press that picks a widget up (as for icons), and how far the finger may wander meanwhile. */
const LONG_PRESS_MS = 450;
const PRESS_SLOP = 8;

/**
 * One placed widget in its grid cells: glass card. In edit mode it wiggles
 * and is removed with the badge. Step 2.15: dragging is free (the widget
 * follows the finger / mouse, no hopping between cells); it stays inside the
 * home area (never under the dock or the navigation, never past the bottom);
 * it snaps to the nearest cell when it is let go, gliding into place. On the
 * phone, holding it at the side of the screen carries it to the next (or a
 * new) page, where it takes the first free place; a page with a widget is
 * kept even when it has no icons.
 */
export function GridWidget({ widget, size, editing }: { widget: Widget; size: { w: number; h: number }; editing: boolean }) {
  const def = defOf(widget.type);
  const columns = useMemo(() => widgetColumns(widget), [widget]);
  /** E1 / E2 while dragging: a stack (ring on the target) or a carousel (the «+» beside it). */
  const [hover, setHover] = useState<Hover | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [dragging, setDragging] = useState(false);
  const touchPress = useRef(false);
  /** After a drop: the rect it was let go at, and the cell it was sent to (the glide starts once it is there). */
  const snap = useRef<{ from: DOMRect; cell: string } | null>(null);

  // FLIP: once the widget is in its new cell, start from where it was let go and glide to 0.
  useLayoutEffect(() => {
    const el = ref.current;
    const s = snap.current;
    if (!el || !s) return;
    const cellNow = el.parentElement?.dataset.cell;
    if (cellNow !== s.cell) return;
    snap.current = null;
    const now = el.getBoundingClientRect();
    const natural = { left: now.left - x.get(), top: now.top - y.get() };
    x.set(s.from.left - natural.left);
    y.set(s.from.top - natural.top);
    void animate(x, 0, { type: "spring", stiffness: 520, damping: 42 });
    void animate(y, 0, { type: "spring", stiffness: 520, damping: 42 });
  });

  if (!def) return null;

  /**
   * Step 2.16: outside edit mode a long press picks the widget up like an app
   * icon: edit mode starts and the same finger / mouse carries it on, free
   * under the pointer; the grid only applies when it is let go.
   */
  const pressStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing) return beginDrag(e.clientX, e.clientY);
    const id = e.pointerId;
    const from = { x: e.clientX, y: e.clientY };
    let at = { ...from };
    touchPress.current = e.pointerType !== "mouse";
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    let menuOpen = false;
    // F: held, the widget grows a little; it settles back when let go or picked up.
    const glass = ref.current?.querySelector<HTMLElement>("[data-widget-press]");
    glass?.setAttribute("data-pressed", "");
    const unpress = () => glass?.removeAttribute("data-pressed");
    window.addEventListener("pointerup", unpress, { once: true });
    window.addEventListener("pointercancel", unpress, { once: true });
    const track = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      at = { x: ev.clientX, y: ev.clientY };
      if (Math.hypot(at.x - from.x, at.y - from.y) <= PRESS_SLOP) return;
      stop();
      unpress();
      if (!menuOpen) return;
      // E: the finger moves on after the menu opened: the menu goes and the widget is picked up instead.
      useHomeUi.getState().closeMenu();
      useHomeUi.getState().setEditing(true);
      beginDrag(from.x, from.y);
    };
    const timer = window.setTimeout(() => {
      navigator.vibrate?.(8);
      // E1: holding a widget shows its menu (Добавить виджет / Убрать из стопки / Удалить стопку / Убрать карусель);
      // moving the finger then picks it up (as before).
      menuOpen = true;
      const box = ref.current?.getBoundingClientRect();
      const half: 0 | 1 = columns.length > 1 && box && from.x > box.left + box.width / 2 ? 1 : 0;
      useHomeUi.getState().openMenu({ x: from.x, y: from.y, target: { kind: "widget", id: widget.id, half } });
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      const done = () => {
        window.removeEventListener("pointermove", track);
        window.removeEventListener("pointerup", done);
        window.removeEventListener("pointercancel", done);
      };
      window.addEventListener("pointerup", done);
      window.addEventListener("pointercancel", done);
    }, LONG_PRESS_MS);
    window.addEventListener("pointermove", track);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const beginDrag = (clientX: number, clientY: number) => {
    const el = ref.current;
    const grid = el?.closest<HTMLElement>("[data-home-grid]");
    const host = el?.closest<HTMLElement>("[data-grid-host]") ?? grid;
    if (!el || !grid || !host) return;
    x.stop();
    y.stop();
    const start = { x: clientX - x.get(), y: clientY - y.get() };
    const box0 = el.getBoundingClientRect();
    const natural = { left: box0.left - x.get(), top: box0.top - y.get(), w: box0.width, h: box0.height };
    const area = host.getBoundingClientRect();
    const ui = useHomeUi.getState;
    const mobile = getFormFactor() === "mobile";
    let edgeTimer: number | undefined;
    let edgeDir = 0;
    setDragging(true);
    ui().setDrag({ item: { kind: "app", id: "settings" }, size: 0, widget: widget.id });

    const clampX = (dx: number) => Math.max(area.left - natural.left, Math.min(area.right - natural.w - natural.left, dx));
    const clampY = (dy: number) => Math.max(area.top - natural.top, Math.min(area.bottom - natural.h - natural.top, dy));
    const finish = () => {
      hoverRef.current = null;
      setHover(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.clearTimeout(edgeTimer);
      setDragging(false);
      ui().setDrag(null);
    };
    const settleBack = () => {
      void animate(x, 0, { type: "spring", stiffness: 520, damping: 42 });
      void animate(y, 0, { type: "spring", stiffness: 520, damping: 42 });
    };
    /** Phone: carry the widget to the page beside this one (a new one past the last). */
    const toPage = (dir: -1 | 1) => {
      finish();
      const l = currentLayout();
      const from = Number(widget.container);
      let to = from + dir;
      if (to < 0) return settleBack();
      const create = to >= l.mobile.pages.length;
      if (create && l.mobile.pages.length >= MOBILE_PAGES_MAX) return settleBack();
      if (create) to = l.mobile.pages.length;
      updateLayout((cur) => {
        const n = create ? { ...cur, mobile: { ...cur.mobile, pages: [...cur.mobile.pages, []] } } : cur;
        const moved = moveWidget(n, widget.id, { container: String(to) });
        const dest = { surface: "mobile" as const, page: to };
        const cell = freeBlock(moved, dest, widgetCells(widget), undefined, geometryFor(dest));
        // A2: no room on that page: the widget stays where it was.
        if (!cell) {
          toast({ title: translateNow("widgets.noRoom") });
          return cur;
        }
        return placeInCell(moved, widgetKey(widget.id), dest, cell, geometryFor(dest));
      });
      x.set(0);
      y.set(0);
      ui().setMobilePage(to);
    };
    const move = (ev: PointerEvent) => {
      x.set(clampX(ev.clientX - start.x));
      y.set(clampY(ev.clientY - start.y));
      const hv = hoverAt(ev.clientX, ev.clientY, widget, el, columns.length > 1, grid);
      if (JSON.stringify(hv) !== JSON.stringify(hoverRef.current)) {
        hoverRef.current = hv;
        setHover(hv);
      }
      if (!mobile) return;
      const dir = ev.clientX < area.left + EDGE ? -1 : ev.clientX > area.right - EDGE ? 1 : 0;
      if (dir !== edgeDir) {
        edgeDir = dir;
        window.clearTimeout(edgeTimer);
        if (dir) edgeTimer = window.setTimeout(() => toPage(dir as -1 | 1), EDGE_HOLD_MS);
      }
    };
    const up = () => {
      const intent = hoverRef.current;
      finish();
      const place = placeOfGrid(grid.dataset.homeGrid!);
      // E1 / E2: dropped on the middle of a widget (a stack) or on the «+» beside it (a carousel).
      if (intent && (intent.kind === "stack" || intent.kind === "carousel") && place) {
        let failed: StackResult["error"];
        updateLayout((l) => {
          const r = intent.kind === "stack" ? stackWidgets(l, widget.id, intent.target, intent.half) : joinWidgets(l, widget.id, intent.target, intent.side, geometryFor(place));
          failed = r.error;
          return r.layout ?? l;
        });
        if (failed) {
          toast({ title: translateNow(failed === "full" ? "widgets.stackFull" : failed === "carousel" ? "widgets.noCarouselInStack" : "widgets.noRoom") });
          settleBack();
        }
        return;
      }
      const box = el.getBoundingClientRect();
      // The cell under the widget's top-left cell (its centre), not under the finger.
      const cw = Number(grid.dataset.cellW) || box.width;
      const rh = Number(grid.dataset.rowH) || box.height;
      const hit = cellAt(grid, box.left + Math.min(cw, box.width) / 2, box.top + Math.min(rh, box.height) / 2);
      // The whole block stays on the page / desktop (never past the last row or the last column).
      const sz = widgetCells(widget);
      // Phone: only the rows that fit on the page (in edit mode the grid offers one more row below it).
      const gr = grid.getBoundingClientRect();
      const gy = Number(grid.dataset.gapY) || 0;
      const fitRows = Math.max(sz.h, Math.floor((area.bottom - gr.top + gy) / (rh + gy)));
      const maxRows = Math.min(Number(grid.dataset.maxRows) || Infinity, fitRows);
      const cols = Number(grid.dataset.cols) || sz.w;
      const target = { c: Math.max(0, Math.min(hit.c, cols - sz.w)), r: Math.max(0, Math.min(hit.r, maxRows - sz.h)) };
      const current = el.parentElement?.dataset.cell;
      if (!place || current === `${target.c},${target.r}`) return settleBack();
      snap.current = { from: box, cell: `${target.c},${target.r}` };
      updateLayout((l) => placeInCell(l, widgetKey(widget.id), place, target, geometryFor(place)));
      // The cell was refused (an icon never pushes a widget away, a full area…): glide back.
      window.setTimeout(() => {
        if (snap.current) {
          snap.current = null;
          settleBack();
        }
      }, 400);
    };
    const cancel = () => {
      finish();
      settleBack();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  return (
    <motion.div
      ref={ref}
      className={cx("relative rounded-[24px]", editing && "cursor-grab touch-none", dragging && "z-30 cursor-grabbing")}
      style={{ width: size.w, height: size.h, x, y }}
      data-no-home-gesture
      data-system-ui
      data-widget={widget.id}
      data-dragging={dragging || undefined}
      data-testid={`widget-${widget.type}`}
      onPointerDown={pressStart}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // A finger's long press picks the widget up (the browser also reports it as a context menu).
        if (touchPress.current) return;
        const box = ref.current?.getBoundingClientRect();
        const half: 0 | 1 = columns.length > 1 && box && e.clientX > box.left + box.width / 2 ? 1 : 0;
        useHomeUi.getState().openMenu({ x: e.clientX, y: e.clientY, target: { kind: "widget", id: widget.id, half } });
      }}
    >
      {/* The wiggle is its own layer: the drag moves the outer one, so the two never fight over the transform. */}
      <div className={cx("vx-glass vx-press relative size-full rounded-[24px]", editing && !dragging && "vx-wiggle", dragging && "scale-[1.03] shadow-float transition-transform")} data-widget-press>
        {editing && !dragging && (
          <RemoveBadge
            onRemove={() =>
              // E1 / E3: a stack or a carousel goes only after a confirmation (a single widget at once).
              columns.length > 1 || columns[0]!.length > 1
                ? useHomeUi.getState().setWidgetConfirm({ id: widget.id, half: 0, kind: columns.length > 1 ? "carousel" : "stack" })
                : updateLayout((l) => removeWidget(l, widget.id))
            }
          />
        )}
        <div className={cx("h-full", editing && "pointer-events-none")}>
          {columns.length > 1 ? (
            // E2: one wide block, two halves of their own (a widget or a stack each).
            <div className="flex size-full" data-testid="widget-carousel">
              {columns.map((col, h) => (
                <div key={h} className={cx("relative h-full w-1/2 min-w-0", h === 1 && "border-l border-[var(--glass-border)]")} data-widget-half={h}>
                  <WidgetColumn widgetId={widget.id} items={col} half={h as 0 | 1} active={h === 0 ? (widget.active ?? 0) : (widget.active2 ?? 0)} side={h === 0 ? "left" : "right"} />
                </div>
              ))}
            </div>
          ) : (
            <WidgetColumn widgetId={widget.id} items={columns[0]!} half={0} active={widget.active ?? 0} side="right" />
          )}
        </div>
        {hover && createPortal(<HoverMark hover={hover} />, document.body)}
      </div>
    </motion.div>
  );
}


// ---------------------------------------------------------------- Stage E: stacks and carousels

type Hover =
  | { kind: "stack"; target: string; half: 0 | 1; rect: { left: number; top: number; width: number; height: number } }
  | { kind: "plus" | "carousel"; target: string; side: "left" | "right"; x: number; y: number };

const PLUS_R = 26;

/**
 * E1 / E2: what a dragged widget is over. The middle of another widget (of a half of a carousel) makes a
 * stack; near its left / right side a small «+» appears where a carousel would fit, and the widget let
 * go on the «+» makes the carousel. Anywhere else: an ordinary move to a cell.
 */
function hoverAt(x: number, y: number, me: Widget, mine: HTMLElement, meIsCarousel: boolean, grid: HTMLElement): Hover | null {
  const els = document.elementsFromPoint(x, y);
  let target: HTMLElement | null = null;
  for (const e of els) {
    const w = (e as HTMLElement).closest?.<HTMLElement>("[data-widget]");
    if (w && w !== mine && !mine.contains(w)) {
      target = w;
      break;
    }
  }
  // The «+» sits just outside a widget's side: look for a widget a little to the left / right too.
  if (!target) {
    for (const dx of [-PLUS_R - 10, PLUS_R + 10]) {
      for (const e of document.elementsFromPoint(x + dx, y)) {
        const w = (e as HTMLElement).closest?.<HTMLElement>("[data-widget]");
        if (w && w !== mine && !mine.contains(w)) {
          target = w;
          break;
        }
      }
      if (target) break;
    }
  }
  if (!target) return null;
  const id = target.dataset.widget!;
  const r = target.getBoundingClientRect();
  const l = currentLayout();
  const tw = l.widgets.find((w) => w.id === id);
  if (!tw) return null;
  const tCarousel = widgetColumns(tw).length > 1;
  const halfW = tCarousel ? r.width / 2 : r.width;
  const half: 0 | 1 = tCarousel && x > r.left + r.width / 2 ? 1 : 0;
  const hl = r.left + half * halfW;
  const rx = (x - hl) / halfW;
  const ry = (y - r.top) / r.height;
  if (!meIsCarousel && rx > 0.22 && rx < 0.78 && ry > 0.15 && ry < 0.85) return { kind: "stack", target: id, half, rect: { left: hl, top: r.top, width: halfW, height: r.height } };
  if (meIsCarousel || tCarousel) return null;
  const side: "left" | "right" = x < r.left + r.width / 2 ? "left" : "right";
  const place = placeOfGrid(grid.dataset.homeGrid!);
  if (!place || !carouselSpot(l, me.id, id, side, geometryFor(place))) return null;
  const px = side === "left" ? r.left - 4 : r.right + 4;
  const py = r.top + r.height / 2;
  const on = Math.hypot(x - px, y - py) <= PLUS_R + 6;
  return { kind: on ? "carousel" : "plus", target: id, side, x: px, y: py };
}

function HoverMark({ hover }: { hover: Hover }) {
  if (hover.kind === "stack")
    return <div className="pointer-events-none fixed z-[250] rounded-[26px] ring-[3px] ring-white/80 shadow-[0_0_0_6px_rgba(108,92,255,0.35)]" style={hover.rect} data-testid="widget-stack-target" aria-hidden />;
  return (
    <div
      className={cx("vx-glass pointer-events-none fixed z-[250] grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition-transform", hover.kind === "carousel" ? "scale-110 text-primary" : "text-text")}
      style={{ left: hover.x, top: hover.y, width: PLUS_R * 2, height: PLUS_R * 2 }}
      data-testid="widget-carousel-plus"
      data-active={hover.kind === "carousel" || undefined}
      aria-hidden
    >
      <RiAddCircleFill className="size-7" />
    </div>
  );
}

/** One half of a widget block: a single widget, or a stack scrolled vertically (E1, E3). */
function WidgetColumn({ widgetId, items, half, active, side }: { widgetId: string; items: WidgetItem[]; half: 0 | 1; active: number; side: "left" | "right" }) {
  if (items.length === 1) {
    const d = defOf(items[0]!.type);
    return d ? <d.Body /> : null;
  }
  return <WidgetStack widgetId={widgetId} items={items} half={half} active={active} side={side} />;
}

/**
 * E1: a stack: one widget in view, a vertical swipe (or the mouse wheel) shows the next; the one in view
 * is kept with the layout. The dots (at most 10) show only while it moves and a moment after; a stack on
 * the left half of a carousel has them on the left, otherwise on the right.
 */
function WidgetStack({ widgetId, items, half, active, side }: { widgetId: string; items: WidgetItem[]; half: 0 | 1; active: number; side: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(Math.min(active, items.length - 1));
  const [dots, setDots] = useState(false);
  const timers = useRef<{ save?: number; hide?: number }>({});
  const saved = useRef(active);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = Math.min(active, items.length - 1) * el.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A new widget put on the stack (or the active one changed elsewhere) comes into view.
  useEffect(() => {
    const el = ref.current;
    if (!el || active === saved.current) return;
    saved.current = active;
    el.scrollTo({ top: active * el.clientHeight, behavior: "smooth" });
  }, [active]);
  useEffect(() => () => {
    window.clearTimeout(timers.current.save);
    window.clearTimeout(timers.current.hide);
  }, []);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / Math.max(1, el.clientHeight))));
    setIdx(i);
    setDots(true);
    window.clearTimeout(timers.current.hide);
    timers.current.hide = window.setTimeout(() => setDots(false), 1200);
    window.clearTimeout(timers.current.save);
    timers.current.save = window.setTimeout(() => {
      if (i === saved.current) return;
      saved.current = i;
      updateLayout((l) => setStackActive(l, widgetId, half, i));
    }, 220);
  };
  return (
    <div className="relative size-full" data-testid="widget-stack" data-count={items.length} data-active={idx} data-half={half}>
      <div ref={ref} className="no-scrollbar size-full snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-[24px]" style={{ touchAction: "pan-y" }} onScroll={onScroll} data-widget-stack>
        {items.map((it) => {
          const d = defOf(it.type);
          return (
            <div key={it.id} className="h-full w-full snap-start snap-always" data-stack-item={it.id}>
              {d ? <d.Body /> : null}
            </div>
          );
        })}
      </div>
      <div
        className={cx("pointer-events-none absolute top-1/2 flex -translate-y-1/2 flex-col gap-[5px] transition-opacity duration-300", side === "left" ? "left-1.5" : "right-1.5", dots ? "opacity-100" : "opacity-0")}
        data-testid="widget-stack-dots"
        data-visible={dots || undefined}
        aria-hidden
      >
        {items.map((it, i) => (
          <span key={it.id} className={cx("size-[6px] rounded-full", i === idx ? "bg-[var(--text)]" : "bg-[color-mix(in_srgb,var(--text)_28%,transparent)]")} />
        ))}
      </div>
    </div>
  );
}

/** E1 / E3: removing a whole stack or carousel is confirmed first (the apps and their data stay). */
export function WidgetConfirm() {
  const t = useT();
  const c = useHomeUi((s) => s.widgetConfirm);
  const close = () => useHomeUi.getState().setWidgetConfirm(null);
  return (
    <ConfirmDialog
      open={!!c}
      onClose={close}
      onConfirm={() => {
        if (!c) return;
        close();
        updateLayout((l) => (c.kind === "carousel" ? removeWidget(l, c.id) : deleteWidgetHalf(l, c.id, c.half)));
      }}
      title={c?.kind === "carousel" ? t("widgets.deleteCarouselTitle") : t("widgets.deleteStackTitle")}
      message={t("widgets.deleteStackBody")}
      confirmLabel={t("widgets.remove")}
      danger
      testId="widget-confirm"
    />
  );
}

/** Categories view (no grid): widgets of this page / desktop in a row above the groups. */
export function WidgetStrip({ layout, surface, container, editing }: { layout: WorkspaceLayout; surface: "mobile" | "desktop"; container: string; editing: boolean }) {
  const widgets = layout.widgets.filter((w) => w.surface === surface && w.container === container && defOf(w.type));
  if (!widgets.length) return null;
  return (
    <div className="mx-auto mb-5 flex flex-wrap justify-center gap-3" data-testid="widget-strip">
      {widgets.map((w) => {
        const cells = widgetCells(w);
        return <GridWidget key={w.id} widget={w} editing={editing} size={{ w: cells.w * 112, h: cells.h * 116 }} />;
      })}
    </div>
  );
}

/** The preview of a widget at its home-screen proportions (scaled to `size` px). */
function WidgetPreview({ def, size }: { def: WidgetDef; size: number }) {
  const base = 232;
  const k = size / base;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} data-system-ui aria-hidden>
      <div className="vx-glass absolute left-0 top-0 origin-top-left rounded-[26px]" style={{ width: base, height: base, transform: `scale(${k})` }}>
        <def.Body preview />
      </div>
    </div>
  );
}

/**
 * «Добавить виджет» (Step 2.15, the references): first the catalogue (search,
 * a preview of every widget, its name and the app it comes from), then the
 * chosen widget's page: a large preview, its options when it has any, and
 * «Добавить виджет». Phone: it lands in the first free place from the top of
 * the current page; PC: next to where the desktop menu was opened.
 */
export function WidgetsPanel() {
  const t = useT();
  const lang = useLanguage();
  const ff = useFormFactor();
  const open = useHomeUi((s) => s.widgetsOpen);
  const at = useHomeUi((s) => s.widgetsAt);
  const setOpen = useHomeUi((s) => s.setWidgetsOpen);
  const { layout } = useWorkspaceLayout();
  const space = useWM((s) => s.space);
  const page = useHomeUi((s) => s.mobilePage);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<WidgetType | null>(null);
  const full = !useHomeUi.getState().widgetsStack && layout.widgets.length >= WIDGETS_MAX;
  useEffect(() => {
    if (!open) {
      setChosen(null);
      setQ("");
    }
  }, [open]);
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return WIDGETS.filter((w) => !query || `${t(w.title)} ${t(w.name)} ${t(w.description)} ${APP_REGISTRY[w.app].name[lang]} ${w.keywords}`.toLowerCase().includes(query));
  }, [q, t, lang]);
  const def = chosen ? defOf(chosen) : undefined;

  const stack = useHomeUi((s) => s.widgetsStack);
  const add = (type: WidgetType) => {
    // E1: «Добавить виджет» from a widget's menu: on top of that stack (or that half of a carousel).
    if (stack) {
      let failed: StackResult["error"];
      updateLayout((l) => {
        const r = addToStack(l, stack.id, stack.half, type);
        failed = r.error;
        return r.layout ?? l;
      });
      if (failed) toast({ title: t(failed === "full" ? "widgets.stackFull" : "widgets.noRoom") });
      setOpen(false);
      return;
    }
    const size = WIDGET_CELLS[type];
    if (ff === "desktop") {
      const place = { surface: "desktop" as const, space };
      const grid = document.querySelector<HTMLElement>(`[data-home-grid="desktop:${space}"]`);
      const point = at && grid ? cellAt(grid, at.x, at.y) : undefined;
      const near = point ? { c: Math.max(0, point.c - Math.floor((size.w - 1) / 2)), r: Math.max(0, point.r - Math.floor((size.h - 1) / 2)) } : undefined;
      updateLayout((l) => {
        const cell = freeBlock(l, place, size, near, desktopGeometry()) ?? undefined;
        return addWidget(l, type, { surface: "desktop", space, cell });
      });
    } else {
      const p = Math.min(page, layout.mobile.pages.length - 1);
      const dest = { surface: "mobile" as const, page: p };
      // A2: only where the whole widget is visible; a full page says so instead of adding it out of sight.
      const cell = freeBlock(currentLayout(), dest, size, undefined, geometryFor(dest));
      if (!cell) {
        toast({ title: t("widgets.noRoom") });
        return;
      }
      updateLayout((l) => addWidget(l, type, { surface: "mobile", page: p, cell: freeBlock(l, dest, size, undefined, geometryFor(dest)) ?? cell }));
    }
    setOpen(false);
  };

  return (
    <Sheet open={open} onClose={() => setOpen(false)} width={ff === "desktop" ? 560 : 480} testId="widgets-panel">
      <AnimatePresence mode="wait" initial={false}>
        {!def ? (
          <motion.div key="list" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }} className="space-y-4" data-testid="widgets-list">
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-[19px] font-semibold tracking-tight">{t("widgets.add")}</h2>
              <IconButton label={t("common.close")} onClick={() => setOpen(false)} size="sm" data-testid="widgets-close">
                <RiCloseLine className="size-5" />
              </IconButton>
            </div>
            <VoidexSearchField value={q} onChange={setQ} placeholder={t("widgets.search")} aria-label={t("widgets.search")} testId="widgets-search" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-5" data-testid="widgets-catalog">
              {shown.map((d) => (
                // A div: the preview inside has buttons of its own (a button can't hold buttons).
                <div
                  key={d.type}
                  role="button"
                  tabIndex={0}
                  onClick={() => setChosen(d.type)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    setChosen(d.type);
                  }}
                  aria-label={`${APP_REGISTRY[d.app].name[lang]}: ${t(d.name)}`}
                  className="pressable flex flex-col items-center gap-2 rounded-[24px] p-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  data-testid={`widget-card-${d.type}`}
                >
                  <span className="flex aspect-square w-full items-center justify-center rounded-[26px] bg-surface-secondary/70 p-[8%]">
                    <ResponsivePreview def={d} />
                  </span>
                  <span className="block">
                    <span className="block text-[14.5px] font-semibold leading-tight text-text">{APP_REGISTRY[d.app].name[lang]}</span>
                    <span className="block text-[12.5px] text-text-secondary">{t(d.name)}</span>
                  </span>
                </div>
              ))}
            </div>
            {!shown.length && <p className="px-1 text-[14px] text-text-secondary">{t("widgets.nothing")}</p>}
          </motion.div>
        ) : (
          <motion.div key={`cfg-${def.type}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.18 }} className="flex flex-col" data-testid={`widget-config-${def.type}`}>
            <div className="flex items-center gap-2">
              <IconButton label={t("common.back")} onClick={() => setChosen(null)} size="sm" data-testid="widget-config-back">
                <RiArrowLeftSLine className="size-5" />
              </IconButton>
              <span className="flex size-7 items-center justify-center rounded-[9px] bg-surface shadow-tile">
                <def.Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{APP_REGISTRY[def.app].name[lang]}</span>
              <IconButton label={t("common.close")} onClick={() => setOpen(false)} size="sm" data-testid="widgets-close">
                <RiCloseLine className="size-5" />
              </IconButton>
            </div>
            <h2 className="mt-4 text-center text-[24px] font-bold tracking-tight">{t(def.name)}</h2>
            <p className="mx-auto mt-1 max-w-[340px] text-center text-[14px] text-text-secondary">{t(def.description)}</p>
            <div className="flex justify-center py-8" data-testid="widget-config-preview">
              <div className="rounded-[30px] shadow-[0_18px_40px_-18px_rgba(40,28,110,0.45)]">
                <WidgetPreview def={def} size={ff === "desktop" ? 232 : 220} />
              </div>
            </div>
            <Button className="h-12 w-full rounded-full text-[16px]" onClick={() => add(def.type)} disabled={full} data-testid={`widget-add-${def.type}`}>
              <RiAddCircleFill className="size-5" />
              {t("widgets.add")}
            </Button>
            {full && <p className="mt-2 text-center text-[12.5px] text-text-tertiary">{t("widgets.full")}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

/** A catalogue preview that fills its square, whatever the column width. */
function ResponsivePreview({ def }: { def: WidgetDef }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.clientWidth));
    ro.observe(el);
    setSize(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return <span ref={ref} className="block size-full">{size > 0 && <WidgetPreview def={def} size={size} />}</span>;
}
