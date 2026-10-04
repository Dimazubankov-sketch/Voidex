import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { RiCloseLine } from "@remixicon/react";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { AppTile } from "@/brand/brand";
import { useWM } from "../window-manager";
import { appLabel } from "./actions";
import { spaceLabel } from "./context-menu";
import { AppGlyph } from "./icons";
import { useWorkspaceLayout } from "./layout";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * PC: every open app across all desktops, to jump to one (double click on
 * the dock's Desktops item). A card switches to its desktop and brings the
 * window forward; × closes the app. Cards show the app, not a live picture of
 * the window. Uses the window manager's switcher flag (the phone's app
 * switcher shows the same list in its own layout).
 */
export function WindowOverview() {
  const t = useT();
  const open = useWM((s) => s.switcherOpen);
  const wm = useWM();
  const { layout } = useWorkspaceLayout();
  const close = () => useWM.getState().setSwitcher(false);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  // Newest on top within each desktop, desktops in their own order.
  const groups = layout.desktop.spaces
    .map((s) => ({
      id: s.id,
      label: spaceLabel(t, layout, s.id),
      wins: [...wm.order].reverse().map((id) => wm.windows[id]!).filter((w) => w && w.space === s.id),
    }))
    .filter((g) => g.wins.length > 0);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[150] flex flex-col items-center overflow-y-auto bg-[rgba(244,242,252,0.72)] px-6 pb-16 pt-20 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={t("overview.title")}
          data-testid="window-overview"
        >
          <motion.h2 className="mb-6 text-[22px] font-semibold tracking-tight text-text" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.25, ease: EASE }}>
            {t("overview.title")}
          </motion.h2>
          {groups.length === 0 ? (
            <p className="text-[15px] text-text-secondary" data-testid="window-overview-empty">
              {t("overview.empty")}
            </p>
          ) : (
            <div className="flex w-full max-w-[1100px] flex-col gap-7">
              {groups.map((g) => (
                <section key={g.id} data-testid="overview-space">
                  <div className={cx("mb-2.5 px-1 text-[12px] font-semibold uppercase tracking-[0.08em]", g.id === wm.space ? "text-primary" : "text-text-tertiary")}>{g.label}</div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                    {g.wins.map((w, i) => (
                      <motion.div
                        key={w.id}
                        initial={{ opacity: 0, y: 14, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.26, ease: EASE, delay: Math.min(i, 8) * 0.025 }}
                        className="group relative"
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            useWM.getState().focus(w.id);
                          }}
                          className={cx(
                            "flex w-full flex-col items-center gap-3 rounded-[24px] border bg-white/85 px-4 pb-4 pt-6 shadow-tile transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-window",
                            w.id === wm.focusedId && w.space === wm.space ? "border-primary/40 ring-2 ring-primary/25" : "border-white",
                          )}
                          data-testid={`overview-window-${w.appId}`}
                        >
                          <AppTile size={64}>
                            <AppGlyph id={w.appId} />
                          </AppTile>
                          <span className="max-w-full truncate text-[14.5px] font-semibold text-text">{appLabel(layout, w.appId)}</span>
                          <span className="text-[12px] text-text-tertiary">{w.state === "minimized" ? t("overview.minimized") : w.state === "maximized" ? t("overview.maximized") : t("overview.open")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            useWM.getState().close(w.id);
                          }}
                          aria-label={t("os.close")}
                          className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full bg-black/[0.06] text-text-secondary opacity-0 transition hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                          data-testid={`overview-close-${w.appId}`}
                        >
                          <RiCloseLine className="size-4" />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
