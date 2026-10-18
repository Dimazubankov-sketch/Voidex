import { useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { RiAddLine, RiCheckLine, RiSubtractLine } from "@remixicon/react";
import {
  WIDGETS_MAX,
  WIDGET_CELLS,
  addWidget,
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
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { Button } from "@/ui/controls";
import { Sheet } from "@/ui/overlays";
import { useWM } from "../window-manager";
import { CalculatorGlyph, ClockGlyph } from "@/brand/brand";
import { cityClock, localZone } from "@voidex/clock";
import { desktopGeometry } from "./desktop-geometry";
import { cellAt, placeOfGrid } from "./grid";
import { openApp } from "./actions";
import { updateLayout, useWorkspaceLayout } from "./layout";
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
  title: MessageKey;
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
    title: "widgets.calculator",
    description: "widgets.calculatorHint",
    keywords: "calculator calc math калькулятор счёт",
    Icon: ({ className }) => <CalculatorGlyph className={className} />,
    Body: CalculatorWidget,
  },
  {
    type: "clock",
    title: "widgets.clock",
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

/**
 * One placed widget in its grid cells: glass card. In edit mode it wiggles,
 * is removed with the badge and dragged to another cell (drop highlights the cell).
 */
export function GridWidget({ widget, size, editing }: { widget: Widget; size: { w: number; h: number }; editing: boolean }) {
  const def = defOf(widget.type);
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  if (!def) return null;

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editing || e.button !== 0) return;
    e.stopPropagation();
    const grid = ref.current?.closest<HTMLElement>("[data-home-grid]");
    if (!grid) return;
    const start = { x: e.clientX, y: e.clientY };
    const box = ref.current!.getBoundingClientRect();
    // Grab point → the widget's top-left cell follows the pointer.
    const grab = { x: e.clientX - box.left, y: e.clientY - box.top };
    let target: { c: number; r: number } | null = null;
    const ui = useHomeUi.getState;
    const move = (ev: PointerEvent) => {
      setOffset({ x: ev.clientX - start.x, y: ev.clientY - start.y });
      const cell = cellAt(grid, ev.clientX - grab.x + 20, ev.clientY - grab.y + 20);
      target = cell;
      ui().setDrag({ item: { kind: "app", id: "settings" }, size: 0, cell: { grid: grid.dataset.homeGrid!, ...cell }, widget: widget.id });
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setOffset(null);
      ui().setDrag(null);
      const place = placeOfGrid(grid.dataset.homeGrid!);
      if (ev.type === "pointerup" && target && place) {
        const cell = target;
        updateLayout((l) => placeInCell(l, widgetKey(widget.id), place, cell, desktopGeometry()));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <div
      ref={ref}
      className={cx("vx-glass relative rounded-[24px]", editing && "vx-wiggle cursor-grab touch-none", offset && "z-30 opacity-90")}
      style={{ width: size.w, height: size.h, transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined }}
      data-no-home-gesture
      data-system-ui
      data-widget={widget.id}
      data-testid={`widget-${widget.type}`}
      onPointerDown={startDrag}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        useHomeUi.getState().openMenu({ x: e.clientX, y: e.clientY, target: { kind: "widget", id: widget.id } });
      }}
    >
      {editing && <RemoveBadge onRemove={() => updateLayout((l) => removeWidget(l, widget.id))} />}
      <div className={cx("h-full", editing && "pointer-events-none")}>
        <def.Body />
      </div>
    </div>
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

/** Brush → Widgets: the catalogue (search, cards, add) and the widgets already placed. */
export function WidgetsPanel() {
  const t = useT();
  const ff = useFormFactor();
  const open = useHomeUi((s) => s.widgetsOpen);
  const setOpen = useHomeUi((s) => s.setWidgetsOpen);
  const { layout } = useWorkspaceLayout();
  const space = useWM((s) => s.space);
  const page = useHomeUi((s) => s.mobilePage);
  const [q, setQ] = useState("");
  const surface = ff === "desktop" ? "desktop" : "mobile";
  const here = ff === "desktop" ? space : String(Math.min(page, layout.mobile.pages.length - 1));
  const placed = layout.widgets.filter((w) => w.surface === surface && defOf(w.type));
  const full = layout.widgets.length >= WIDGETS_MAX;
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return WIDGETS.filter((w) => !query || `${t(w.title)} ${t(w.description)} ${w.keywords}`.toLowerCase().includes(query));
  }, [q, t]);

  const add = (type: WidgetType) => {
    updateLayout((l) => (surface === "desktop" ? addWidget(l, type, { surface: "desktop", space }) : addWidget(l, type, { surface: "mobile", page: Number(here) })));
  };

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title={t("widgets.title")} width={ff === "desktop" ? 520 : 480} testId="widgets-panel">
      <div className="space-y-5">
        <VoidexSearchField value={q} onChange={setQ} placeholder={t("widgets.search")} aria-label={t("widgets.search")} testId="widgets-search" />

        <div className="grid gap-3" data-testid="widgets-catalog">
          {shown.map((def) => {
            const count = placed.filter((w) => w.type === def.type && w.container === here).length;
            return (
              <div key={def.type} className="overflow-hidden rounded-[22px] border border-border bg-surface" data-testid={`widget-card-${def.type}`}>
                <div className="flex justify-center bg-surface-secondary/70 p-3" data-system-ui aria-hidden>
                  <div className="vx-glass rounded-[22px]" style={{ width: 220, height: 236 }}>
                    <def.Body preview />
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-surface-secondary text-text-secondary">
                    <def.Icon className="size-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">{t(def.title)}</span>
                    <span className="block text-[13px] text-text-secondary">{t(def.description)}</span>
                  </span>
                  <Button size="sm" onClick={() => add(def.type)} disabled={full} data-testid={`widget-add-${def.type}`}>
                    {count ? <RiCheckLine className="size-4" /> : <RiAddLine className="size-4" />}
                    {t("widgets.add")}
                  </Button>
                </div>
              </div>
            );
          })}
          {!shown.length && <p className="px-1 text-[14px] text-text-secondary">{t("widgets.nothing")}</p>}
        </div>

        {placed.length > 0 && (
          <section>
            <h3 className="mb-2 text-[13px] font-medium uppercase tracking-wide text-text-tertiary">{t("widgets.placed")}</h3>
            <div className="overflow-hidden rounded-[20px] border border-border bg-surface">
              {placed.map((w) => {
                const def = defOf(w.type)!;
                return (
                  <motion.div layout key={w.id} className="flex h-14 items-center gap-3 px-4 [&:not(:last-child)]:border-b" data-testid={`widget-placed-${w.id}`}>
                    <def.Icon className="size-6" />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{t(def.title)}</span>
                    <Button variant="ghost" size="sm" onClick={() => updateLayout((l) => removeWidget(l, w.id))} data-testid="widget-placed-remove">
                      {t("widgets.remove")}
                    </Button>
                  </motion.div>
                );
              })}
            </div>
            <p className="mt-2 text-[12px] text-text-tertiary">{t("widgets.moveHint")}</p>
          </section>
        )}
      </div>
    </Sheet>
  );
}
