import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { RiApps2Line, RiArrowDownSLine, RiDragMove2Line, RiImageLine, RiLayoutGridLine, RiListUnordered } from "@remixicon/react";
import type { WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { updateLayout } from "./layout";
import { useHomeUi } from "./ui-store";

const EASE = [0.22, 1, 0.36, 1] as const;

export type HomeView = "grid" | "categories";

/** The view of the home screen on this device. */
export function currentView(l: WorkspaceLayout, ff: "mobile" | "desktop"): HomeView {
  return ff === "mobile" ? l.mobile.view : l.desktop.view;
}

/** Switches this device's view (phone and PC keep their own). */
export function setView(ff: "mobile" | "desktop", view: HomeView) {
  updateLayout((l) => (ff === "mobile" ? { ...l, mobile: { ...l.mobile, view } } : { ...l, desktop: { ...l.desktop, view } }));
}

export function setArrange(arrange: "grid" | "free") {
  updateLayout((l) => ({ ...l, desktop: { ...l.desktop, arrange } }));
}

/** Grid | Categories — applied at once, the menu stays open. */
export function ViewSwitch({ layout, testId = "brush-view" }: { layout: WorkspaceLayout; testId?: string }) {
  const t = useT();
  const ff = useFormFactor();
  const view = currentView(layout, ff);
  return (
    <div className="grid grid-cols-2 gap-1 rounded-2xl bg-black/[0.04] p-1" role="radiogroup" aria-label={t("appearance.view")} data-testid={testId}>
      {(
        [
          ["grid", RiLayoutGridLine, "home.viewGrid"],
          ["categories", RiListUnordered, "home.viewCategories"],
        ] as const
      ).map(([v, Icon, key]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => setView(ff, v)}
          className={cx(
            "pressable flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-1 text-[13px] font-medium",
            view === v ? "bg-surface text-text shadow-sm" : "text-text-secondary hover:text-text",
          )}
          data-testid={`${testId}-${v}`}
        >
          <Icon className="size-[17px]" />
          {t(key)}
        </button>
      ))}
    </div>
  );
}

function Row({ icon, label, value, onClick, expanded, testId }: { icon: ReactNode; label: string; value?: string; onClick: () => void; expanded?: boolean; testId: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-expanded={expanded}
      onClick={onClick}
      className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-text transition-colors hover:bg-surface-hover [&_svg]:size-[18px]"
      data-testid={testId}
    >
      <span className="flex size-5 items-center justify-center text-text-secondary">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value && <span className="text-[13px] text-text-tertiary">{value}</span>}
      {expanded !== undefined && <RiArrowDownSLine className={cx("text-text-tertiary transition-transform", expanded && "rotate-180")} />}
    </button>
  );
}

/**
 * The brush menu: Wallpaper · View · Widgets. Opened by the brush (top-left in
 * edit mode) on phone and PC. "View" switches in place — the home screen
 * changes behind the menu, which stays open.
 */
export function BrushMenu({ anchor, layout }: { anchor: RefObject<HTMLElement | null>; layout: WorkspaceLayout }) {
  const t = useT();
  const ff = useFormFactor();
  const open = useHomeUi((s) => s.brushOpen);
  const ui = useHomeUi.getState;
  const [viewOpen, setViewOpen] = useState(true);
  const [pos, setPos] = useState({ left: 12, top: 60 });

  useLayoutEffect(() => {
    if (!open) return;
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, r.left), top: r.bottom + 8 });
  }, [open, anchor]);

  const view = currentView(layout, ff);
  const free = ff === "desktop" && layout.desktop.arrange === "free";

  return createPortal(
    <>
      {open && <div className="fixed inset-0 z-[205]" onPointerDown={() => ui().setBrushOpen(false)} data-testid="brush-backdrop" />}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="vx-glass-strong fixed z-[210] w-[300px] overflow-hidden rounded-[22px] p-1.5"
            style={{ left: pos.left, top: pos.top, transformOrigin: "top left" }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, pointerEvents: "none" }}
            transition={{ duration: 0.15, ease: EASE }}
            data-testid="brush-menu"
          >
            <Row icon={<RiImageLine />} label={t("home.wallpaper")} onClick={() => ui().setAppearanceOpen(true)} testId="brush-wallpaper" />
            <Row
              icon={view === "grid" ? <RiLayoutGridLine /> : <RiListUnordered />}
              label={t("home.view")}
              value={view === "grid" ? t("home.viewGrid") : t("home.viewCategories")}
              expanded={viewOpen}
              onClick={() => setViewOpen((v) => !v)}
              testId="brush-view-row"
            />
            <AnimatePresence initial={false}>
              {viewOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.16, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1.5 px-1.5 pb-2 pt-0.5">
                    <ViewSwitch layout={layout} />
                    {ff === "desktop" && view === "grid" && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={free}
                        onClick={() => setArrange(free ? "grid" : "free")}
                        className="flex h-10 w-full items-center gap-2.5 rounded-xl px-2 text-left text-[14px] text-text hover:bg-surface-hover"
                        data-testid="brush-free"
                      >
                        <RiDragMove2Line className="size-[17px] text-text-secondary" />
                        <span className="flex-1">{t("appearance.arrangeFree")}</span>
                        <span className={cx("relative h-[22px] w-[38px] rounded-full transition-colors", free ? "bg-primary" : "bg-black/15")}>
                          <span className={cx("absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-[left]", free ? "left-[18px]" : "left-[2px]")} />
                        </span>
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <Row icon={<RiApps2Line />} label={t("widgets.title")} onClick={() => ui().setWidgetsOpen(true)} testId="brush-widgets" />
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
