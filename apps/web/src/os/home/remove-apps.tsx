import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { RiDeleteBin6Line } from "@remixicon/react";
import type { AppId } from "@voidex/shared";
import { AppTile } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { appLabel, removeAppsFromDesktop } from "./actions";
import { AppGlyph } from "./icons";
import { useWorkspaceLayout } from "./layout";
import { useHomeUi } from "./ui-store";

const EASE = [0.22, 1, 0.36, 1] as const;
/** The second step's "Удалить" ignores taps this soon after it appears (no accidental double click). */
const ARM_MS = 700;

/**
 * Edit mode (Step 2.5): apps marked with "−" wait here; "Удалить" starts the
 * two-step confirmation. Nothing is removed by the "−" itself.
 */
export function RemoveSelectionBar() {
  const t = useT();
  const editing = useHomeUi((s) => s.editing);
  const sel = useHomeUi((s) => s.removeSel);
  const confirming = useHomeUi((s) => s.removeConfirm !== null);
  const show = editing && sel.length > 0 && !confirming;
  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          className="vx-glass fixed inset-x-0 bottom-[calc(max(var(--safe-bottom),12px)+84px)] z-[120] mx-auto flex w-fit items-center gap-3 rounded-full py-2 pl-5 pr-2"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.22, ease: EASE }}
          data-testid="remove-selection-bar"
          data-home-control
        >
          <span className="text-[14px] font-medium text-text">{t("home.removeSelected", { n: sel.length })}</span>
          <button
            type="button"
            className="pressable rounded-full px-4 py-2 text-[14px] font-medium text-text-secondary hover:bg-black/5"
            onClick={() => useHomeUi.setState({ removeSel: [] })}
            data-testid="remove-selection-clear"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="pressable flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[14px] font-semibold text-white shadow-glow"
            onClick={() => useHomeUi.getState().setRemoveConfirm([...sel])}
            data-testid="remove-selection-delete"
          >
            <RiDeleteBin6Line className="size-4" /> {t("home.delete")}
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * "Удалить выбранные приложения?" — asked twice (Step 2.5). The first
 * "Удалить" only turns the card into the second, more explicit question (same
 * card, same icons); only the second removes the icons from the desktop.
 * Esc, a tap outside or "Отмена" at either step cancels everything.
 */
export function RemoveAppsConfirm() {
  const t = useT();
  const ff = useFormFactor();
  const ids = useHomeUi((s) => s.removeConfirm);
  const { layout } = useWorkspaceLayout();
  const [step, setStep] = useState<1 | 2>(1);
  const armedAt = useRef(0);
  const [armed, setArmed] = useState(true);
  const open = ids !== null && ids.length > 0;
  const mobile = ff === "mobile";

  useEffect(() => {
    if (!open) setStep(1);
  }, [open]);

  const cancel = () => useHomeUi.getState().setRemoveConfirm(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [open]);

  const confirm = () => {
    if (!ids) return;
    if (step === 1) {
      armedAt.current = Date.now();
      setArmed(false);
      window.setTimeout(() => setArmed(true), ARM_MS);
      setStep(2);
      return;
    }
    if (Date.now() - armedAt.current < ARM_MS) return;
    const remove: AppId[] = [...ids];
    useHomeUi.setState((s) => ({ removeConfirm: null, removeSel: s.removeSel.filter((a) => !remove.includes(a)) }));
    removeAppsFromDesktop(remove);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <Layer mobile={mobile} step={step}>
          <motion.div
            className="absolute inset-0 bg-[rgba(30,26,50,0.32)] backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={cancel}
            data-testid="remove-confirm-backdrop"
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-confirm-title"
            aria-describedby="remove-confirm-text"
            className={cx(
              "vx-remove-card relative flex w-full max-w-[440px] flex-col items-center overflow-hidden px-6 pt-3 text-center",
              mobile ? "mx-2 mb-[max(var(--safe-bottom),8px)] rounded-[34px] pb-6" : "mx-4 rounded-[34px] pb-6",
            )}
            initial={mobile ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={mobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={mobile ? { y: "100%" } : { opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: mobile ? 0.32 : 0.2, ease: EASE }}
          >
            {mobile ? <div className="mb-3 h-1.5 w-10 rounded-full bg-black/15" /> : <div className="h-3" />}
            <div className="relative mb-4 mt-2 flex h-[104px] w-[180px] items-center justify-center" aria-hidden>
              <span className="absolute inset-x-2 top-1/2 h-14 -translate-y-1/2 rotate-[-8deg] rounded-[50%] bg-primary/15 blur-[2px]" />
              <span className="absolute left-3 top-[58%] size-5 rounded-full bg-white/70 shadow-[inset_0_-2px_4px_rgba(108,92,255,0.35)]" />
              <span className="absolute right-6 top-2 size-6 rounded-full bg-white/70 shadow-[inset_0_-2px_4px_rgba(108,92,255,0.35)]" />
              <motion.span
                key={step}
                className="vx-remove-icon relative grid size-[84px] rotate-[-6deg] place-items-center rounded-[24px]"
                initial={{ scale: 0.9, rotate: -14 }}
                animate={{ scale: 1, rotate: -6 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                <RiDeleteBin6Line className="size-10 text-primary" />
              </motion.span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="flex flex-col items-center"
              >
                <h2 id="remove-confirm-title" className="max-w-[340px] text-[24px] font-bold leading-tight tracking-tight text-text" data-testid="remove-confirm-title">
                  {step === 1 ? t("home.removeConfirmTitle") : t("home.removeConfirmTitle2")}
                </h2>
                <p id="remove-confirm-text" className="mt-2 max-w-[340px] text-[15px] leading-snug text-text-secondary">
                  {step === 1 ? t("home.removeConfirmText") : t("home.removeConfirmText2")}
                </p>
              </motion.div>
            </AnimatePresence>
            <div className="vx-remove-apps mt-5 w-full rounded-[26px] p-4" data-testid="remove-confirm-apps">
              <div className="flex max-h-[220px] flex-wrap justify-center gap-x-6 gap-y-4 overflow-y-auto">
                {(ids ?? []).map((id) => (
                  <div key={id} className="flex w-[76px] flex-col items-center gap-1.5" data-testid={`remove-confirm-app-${id}`}>
                    <AppTile size={56}>
                      <AppGlyph id={id} />
                    </AppTile>
                    <span className="max-w-full truncate text-[13px] font-medium text-text">{appLabel(layout, id)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={cancel}
                className="pressable h-[52px] rounded-full bg-white/70 text-[16px] font-semibold text-text-secondary shadow-[inset_0_0_0_1px_rgba(20,20,40,0.06)] hover:bg-white/90"
                data-testid="remove-confirm-cancel"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={step === 2 && !armed}
                className="pressable h-[52px] rounded-full bg-gradient-to-r from-[#8b7bff] to-primary text-[16px] font-semibold text-white shadow-glow disabled:opacity-60"
                data-testid="remove-confirm-ok"
              >
                {t("home.delete")}
              </button>
            </div>
          </motion.div>
        </Layer>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** The full-screen layer; while it fades out it no longer catches taps meant for the icons. */
function Layer({ mobile, step, children }: { mobile: boolean; step: number; children: React.ReactNode }) {
  const present = useIsPresent();
  return (
    <div
      className={cx("fixed inset-0 z-[210] flex justify-center", mobile ? "items-end" : "items-center", !present && "pointer-events-none")}
      data-testid={present ? "remove-confirm" : undefined}
      data-step={step}
    >
      {children}
    </div>
  );
}
