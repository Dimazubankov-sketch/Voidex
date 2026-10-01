import { useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { RiAddLine, RiCheckLine, RiSearchLine, RiSubtractLine } from "@remixicon/react";
import { WIDGETS_MAX, addWidget, moveWidget, removeWidget, type Widget, type WidgetType, type WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { Button } from "@/ui/controls";
import { Sheet } from "@/ui/overlays";
import { useWM } from "../window-manager";
import { updateLayout, useWorkspaceLayout } from "./layout";
import { DesktopsGlyph, SpacesList, useSpacesTitle } from "./spaces";
import { useHomeUi } from "./ui-store";

/**
 * Home-screen widgets. A small system catalogue (no widget store yet); the
 * placed widgets are part of the synced workspace layout (`layout.widgets`),
 * so they follow the account to every device of the same kind.
 *
 *   PC     free position on one desktop, dragged in edit mode
 *   phone  stacked at the top of one page, reordered by dragging in edit mode
 *
 * Adding a widget type = an entry in WIDGET_TYPES (shared) + one here.
 */

interface WidgetDef {
  type: WidgetType;
  title: MessageKey;
  description: MessageKey;
  keywords: string;
  Icon: ComponentType<{ className?: string }>;
  Body: ComponentType<{ layout: WorkspaceLayout; preview?: boolean }>;
  /** PC footprint in px (the phone uses the full width). */
  size: { w: number; h: number };
}

function DesktopsWidget({ layout, preview }: { layout: WorkspaceLayout; preview?: boolean }) {
  const title = useSpacesTitle();
  return (
    <div className={cx("flex flex-col gap-2 p-3", preview && "pointer-events-none")}>
      <div className="flex items-center gap-2 px-0.5">
        <DesktopsGlyph className="size-5" />
        <span className="text-[13px] font-semibold text-text">{title}</span>
      </div>
      <SpacesList layout={layout} compact testPrefix="widget-space" />
    </div>
  );
}

export const WIDGETS: WidgetDef[] = [
  {
    type: "desktops",
    title: "widgets.desktops",
    description: "widgets.desktopsHint",
    keywords: "desktops spaces pages рабочие столы страницы",
    Icon: ({ className }) => <DesktopsGlyph className={className} />,
    Body: DesktopsWidget,
    size: { w: 300, h: 128 },
  },
];

const defOf = (type: WidgetType) => WIDGETS.find((w) => w.type === type)!;

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

/** One placed widget: glass card; in edit mode it wiggles, can be dragged and removed. */
function WidgetCard({ widget, layout, editing, style, onDragStart }: { widget: Widget; layout: WorkspaceLayout; editing: boolean; style?: React.CSSProperties; onDragStart?: (e: ReactPointerEvent<HTMLDivElement>) => void }) {
  const def = defOf(widget.type);
  return (
    <div
      className={cx("vx-glass relative rounded-[22px]", editing && "vx-wiggle cursor-grab touch-none")}
      style={style}
      data-no-home-gesture
      data-system-ui
      data-widget={widget.id}
      data-testid={`widget-${widget.type}`}
      onPointerDown={editing ? onDragStart : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        useHomeUi.getState().openMenu({ x: e.clientX, y: e.clientY, target: { kind: "widget", id: widget.id } });
      }}
    >
      {editing && <RemoveBadge onRemove={() => updateLayout((l) => removeWidget(l, widget.id))} />}
      <div className={cx(editing && "pointer-events-none")}>
        <def.Body layout={layout} />
      </div>
    </div>
  );
}

/** PC: the widgets of one desktop, free over the desktop area. */
export function DesktopWidgets({ layout, space, editing }: { layout: WorkspaceLayout; space: string; editing: boolean }) {
  const area = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const widgets = layout.widgets.filter((w) => w.surface === "desktop" && w.container === space);
  if (!widgets.length) return null;

  const start = (w: Widget) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const box = area.current?.getBoundingClientRect();
    const card = e.currentTarget.getBoundingClientRect();
    if (!box) return;
    const dx = e.clientX - card.left;
    const dy = e.clientY - card.top;
    const at = (ev: PointerEvent) => ({
      x: Math.max(0, Math.min(1, (ev.clientX - dx - box.left) / Math.max(1, box.width - card.width))),
      y: Math.max(0, Math.min(1, (ev.clientY - dy - box.top) / Math.max(1, box.height - card.height))),
    });
    let last: { x: number; y: number } | null = null;
    const move = (ev: PointerEvent) => {
      last = at(ev);
      setDrag({ id: w.id, ...last });
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (ev.type === "pointerup" && last) {
        const pos = last;
        updateLayout((l) => moveWidget(l, w.id, pos));
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <div ref={area} className="pointer-events-none absolute inset-0 z-[2]" data-testid="desktop-widgets">
      {widgets.map((w) => {
        const def = defOf(w.type);
        const p = drag?.id === w.id ? drag : w;
        return (
          <div
            key={w.id}
            className="pointer-events-auto absolute"
            style={{ left: `calc((100% - ${def.size.w}px) * ${p.x})`, top: `calc((100% - ${def.size.h}px) * ${p.y})`, width: def.size.w }}
          >
            <WidgetCard widget={w} layout={layout} editing={editing} onDragStart={start(w)} />
          </div>
        );
      })}
    </div>
  );
}

/** Phone: the widgets of one page, stacked above the icons; drag to reorder in edit mode. */
export function MobileWidgets({ layout, page, editing }: { layout: WorkspaceLayout; page: number; editing: boolean }) {
  const widgets = layout.widgets.filter((w) => w.surface === "mobile" && w.container === String(page)).sort((a, b) => a.y - b.y);
  const list = useRef<HTMLDivElement>(null);
  if (!widgets.length) return null;

  const start = (w: Widget) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (ev.type !== "pointerup" || !list.current) return;
      // Order by where the finger was released among the other widgets.
      const others = [...list.current.querySelectorAll<HTMLElement>("[data-widget]")].filter((el) => el.dataset.widget !== w.id);
      const index = others.filter((el) => {
        const r = el.getBoundingClientRect();
        return ev.clientY > r.top + r.height / 2;
      }).length;
      const order = widgets.filter((x) => x.id !== w.id);
      order.splice(index, 0, w);
      updateLayout((l) => order.reduce((acc, x, i) => moveWidget(acc, x.id, { y: i / Math.max(1, order.length) }), l));
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <div ref={list} className="flex flex-col gap-3 px-2 pb-3" data-testid="mobile-widgets">
      {widgets.map((w) => (
        <WidgetCard key={w.id} widget={w} layout={layout} editing={editing} onDragStart={start(w)} />
      ))}
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
  const placed = layout.widgets.filter((w) => w.surface === surface);
  const full = layout.widgets.length >= WIDGETS_MAX;
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return WIDGETS.filter((w) => !query || `${t(w.title)} ${t(w.description)} ${w.keywords}`.toLowerCase().includes(query));
  }, [q, t]);

  const add = (type: WidgetType) => {
    updateLayout((l) =>
      surface === "desktop" ? addWidget(l, type, { surface: "desktop", space, x: 0.03, y: 0.04 }) : addWidget(l, type, { surface: "mobile", page: Number(here) }),
    );
  };

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title={t("widgets.title")} width={ff === "desktop" ? 520 : 480} testId="widgets-panel">
      <div className="space-y-5">
        <label className="flex h-11 items-center gap-2 rounded-2xl bg-surface-secondary px-3.5">
          <RiSearchLine className="size-[18px] text-text-tertiary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("widgets.search")}
            aria-label={t("widgets.search")}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-tertiary"
            data-testid="widgets-search"
          />
        </label>

        <div className="grid gap-3" data-testid="widgets-catalog">
          {shown.map((def) => {
            const count = placed.filter((w) => w.type === def.type && w.container === here).length;
            return (
              <div key={def.type} className="overflow-hidden rounded-[22px] border border-border bg-surface" data-testid={`widget-card-${def.type}`}>
                <div className="bg-surface-secondary/70 p-3" data-system-ui aria-hidden>
                  <div className="vx-glass mx-auto max-w-[320px] rounded-[20px]">
                    <def.Body layout={layout} preview />
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
                const def = defOf(w.type);
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
