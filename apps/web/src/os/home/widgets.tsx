import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { RiAddCircleFill, RiArrowLeftSLine, RiCloseLine, RiSubtractLine } from "@remixicon/react";
import {
  APP_REGISTRY,
  MOBILE_PAGES_MAX,
  WIDGETS_MAX,
  WIDGET_CELLS,
  addWidget,
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
import { useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { Button, IconButton } from "@/ui/controls";
import { Sheet } from "@/ui/overlays";
import { useWM } from "../window-manager";
import { CalculatorGlyph, ClockGlyph } from "@/brand/brand";
import { cityClock, localZone } from "@voidex/clock";
import { desktopGeometry } from "./desktop-geometry";
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
    const track = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      at = { x: ev.clientX, y: ev.clientY };
      if (Math.hypot(at.x - from.x, at.y - from.y) > PRESS_SLOP) stop();
    };
    const timer = window.setTimeout(() => {
      stop();
      navigator.vibrate?.(8);
      useHomeUi.getState().setEditing(true);
      // The drag begins where the press began, so the widget jumps by nothing and follows from here.
      beginDrag(from.x, from.y);
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
        const cell = freeBlock(moved, { surface: "mobile", page: to }, WIDGET_CELLS[widget.type as WidgetType]) ?? { c: 0, r: 0 };
        return placeInCell(moved, widgetKey(widget.id), { surface: "mobile", page: to }, cell);
      });
      x.set(0);
      y.set(0);
      ui().setMobilePage(to);
    };
    const move = (ev: PointerEvent) => {
      x.set(clampX(ev.clientX - start.x));
      y.set(clampY(ev.clientY - start.y));
      if (!mobile) return;
      const dir = ev.clientX < area.left + EDGE ? -1 : ev.clientX > area.right - EDGE ? 1 : 0;
      if (dir !== edgeDir) {
        edgeDir = dir;
        window.clearTimeout(edgeTimer);
        if (dir) edgeTimer = window.setTimeout(() => toPage(dir as -1 | 1), EDGE_HOLD_MS);
      }
    };
    const up = () => {
      finish();
      const place = placeOfGrid(grid.dataset.homeGrid!);
      const box = el.getBoundingClientRect();
      // The cell under the widget's top-left cell (its centre), not under the finger.
      const cw = Number(grid.dataset.cellW) || box.width;
      const rh = Number(grid.dataset.rowH) || box.height;
      const hit = cellAt(grid, box.left + Math.min(cw, box.width) / 2, box.top + Math.min(rh, box.height) / 2);
      // The whole block stays on the page / desktop (never past the last row or the last column).
      const sz = WIDGET_CELLS[widget.type as WidgetType];
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
      updateLayout((l) => placeInCell(l, widgetKey(widget.id), place, target, desktopGeometry()));
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
        useHomeUi.getState().openMenu({ x: e.clientX, y: e.clientY, target: { kind: "widget", id: widget.id } });
      }}
    >
      {/* The wiggle is its own layer: the drag moves the outer one, so the two never fight over the transform. */}
      <div className={cx("vx-glass relative size-full rounded-[24px]", editing && !dragging && "vx-wiggle", dragging && "scale-[1.03] shadow-float transition-transform")}>
        {editing && !dragging && <RemoveBadge onRemove={() => updateLayout((l) => removeWidget(l, widget.id))} />}
        <div className={cx("h-full", editing && "pointer-events-none")}>
          <def.Body />
        </div>
      </div>
    </motion.div>
  );
}

/** Categories view (no grid): widgets of this page / desktop in a row above the groups. */
export function WidgetStrip({ layout, surface, container, editing }: { layout: WorkspaceLayout; surface: "mobile" | "desktop"; container: string; editing: boolean }) {
  const widgets = layout.widgets.filter((w) => w.surface === surface && w.container === container && defOf(w.type));
  if (!widgets.length) return null;
  return (
    <div className="mx-auto mb-5 flex flex-wrap justify-center gap-3" data-testid="widget-strip">
      {widgets.map((w) => {
        const cells = WIDGET_CELLS[w.type as WidgetType];
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
  const full = layout.widgets.length >= WIDGETS_MAX;
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

  const add = (type: WidgetType) => {
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
      updateLayout((l) => addWidget(l, type, { surface: "mobile", page: p, cell: freeBlock(l, { surface: "mobile", page: p }, size) ?? undefined }));
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
