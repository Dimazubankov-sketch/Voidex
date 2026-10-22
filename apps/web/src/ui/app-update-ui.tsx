import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiCloseLine, RiRefreshLine } from "@remixicon/react";
import { VoidexMark } from "@/brand/brand";
import { useT } from "@/lib/i18n";
import { applyUpdate, resetFailedChunks, startUpdateChecks, useAppUpdate } from "@/lib/app-update";
import { toast } from "@/ui/overlays";
import { Button } from "@/ui/controls";

/** A1: «Доступна новая версия» — a quiet pill under the status bar; the update waits for the person. */
export function UpdateBanner() {
  const t = useT();
  const available = useAppUpdate((s) => s.available);
  const dismissed = useAppUpdate((s) => s.dismissed);
  const dismiss = useAppUpdate((s) => s.dismiss);
  const [busy, setBusy] = useState(false);
  useEffect(() => startUpdateChecks(), []);
  const show = !!available && !dismissed;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="update"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-auto fixed left-1/2 top-[max(var(--safe-top),10px)] z-[310] flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/60 bg-surface/90 py-1 pl-3.5 pr-1 shadow-float backdrop-blur-xl"
          role="status"
          data-testid="update-banner"
        >
          <span className="whitespace-nowrap text-[13px] font-medium text-text">{t("os.updateAvailable")}</span>
          <button
            className="pressable flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await applyUpdate();
              if (!ok) {
                setBusy(false);
                toast({ title: t("os.updateUnsaved"), tone: "danger" });
              }
            }}
          >
            <RiRefreshLine className="size-3.5" />
            {t("os.updateNow")}
          </button>
          <button className="pressable grid size-7 place-items-center rounded-full text-text-tertiary hover:bg-black/5" aria-label={t("common.close")} onClick={dismiss}>
            <RiCloseLine className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Last line of defence: a crash or a chunk that never loads shows a way back instead of a blank screen. */
export class RootBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("VOIDEX crashed", error, info.componentStack);
  }
  override render() {
    if (this.state.error)
      return (
        <RootCrashed
          onRetry={() => {
            resetFailedChunks();
            this.setState({ error: null });
          }}
        />
      );
    return this.props.children;
  }
}

function RootCrashed({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-8 text-center" data-testid="root-crashed">
      <VoidexMark className="size-14 opacity-80" />
      <div className="text-[15px] font-semibold text-text">{t("os.loadFailed")}</div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {t("os.reloadPage")}
        </Button>
      </div>
    </div>
  );
}
