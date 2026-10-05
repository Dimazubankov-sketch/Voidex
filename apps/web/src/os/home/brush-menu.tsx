import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { RiApps2Line, RiArrowDownSLine, RiArrowUpDownLine, RiImageLine, RiLayoutGridLine, RiListUnordered } from "@remixicon/react";
import type { WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { openWallpapers } from "./actions";
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
 * The brush menu: Wallpaper · View · Widgets. Opened by the brush (edit mode)
 * on phone and PC. "View" is a toggle (Step 2.3): one tap switches Grid ⇄
 * Categories at once — no second panel; the row shows the current view.
 */
export function BrushMenu({ anchor, layout }: { anchor: RefObject<HTMLElement | null>; layout: WorkspaceLayout }) {
  const t = useT();
  const ff = useFormFactor();
  const open = useHomeUi((s) => s.brushOpen);
  const ui = useHomeUi.getState;
  const [pos, setPos] = useState({ left: 12, top: 60 });

  useLayoutEffect(() => {
    if (!open) return;
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, r.left), top: r.bottom + 8 });
  }, [open, anchor]);

  const view = currentView(layout, ff);
  const next: HomeView = view === "grid" ? "categories" : "grid";

  return createPortal(
    <>
      {open && <div className="fixed inset-0 z-[205]" onPointerDown={() => ui().setBrushOpen(false)} data-testid="brush-backdrop" />}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="vx-glass-strong fixed z-[210] w-[264px] overflow-hidden rounded-[20px] p-1.5"
            style={{ left: pos.left, top: pos.top, transformOrigin: "top left" }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, pointerEvents: "none" }}
            transition={{ duration: 0.15, ease: EASE }}
            data-testid="brush-menu"
          >
            <Row icon={<RiImageLine />} label={t("home.wallpaper")} onClick={() => openWallpapers("home")} testId="brush-wallpaper" />
            <button
              type="button"
              role="menuitemradio"
              aria-checked={view === "categories"}
              onClick={() => setView(ff, next)}
              className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-text transition-colors hover:bg-surface-hover [&_svg]:size-[18px]"
              data-testid="brush-view-row"
              data-view={view}
            >
              <span className="flex size-5 items-center justify-center text-text-secondary">{view === "grid" ? <RiLayoutGridLine /> : <RiListUnordered />}</span>
              <span className="min-w-0 flex-1 truncate">{t("home.view")}</span>
              <span className="relative h-5 overflow-hidden text-right text-[13px] text-text-tertiary">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={view}
                    className="block whitespace-nowrap"
                    initial={{ y: 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -12, opacity: 0 }}
                    transition={{ duration: 0.18, ease: EASE }}
                    data-testid="brush-view-value"
                  >
                    {view === "grid" ? t("home.viewGrid") : t("home.viewCategories")}
                  </motion.span>
                </AnimatePresence>
              </span>
              <RiArrowUpDownLine className="text-text-tertiary" />
            </button>
            <Row icon={<RiApps2Line />} label={t("widgets.title")} onClick={() => ui().setWidgetsOpen(true)} testId="brush-widgets" />
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
