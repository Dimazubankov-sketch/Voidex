import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiCloseLine, RiRefreshLine } from "@remixicon/react";
import { VoidexMark } from "@/brand/brand";
import { useT } from "@/lib/i18n";
import { applyUpdate, isChunkError, resetFailedChunks, startUpdateChecks, useAppUpdate } from "@/lib/app-update";
import { freshReload, reportClientEvent } from "@/lib/boot";
import { toast } from "@/ui/overlays";
import { Button } from "@/ui/controls";

/**
 * Updates apply by themselves when that is safe (lib/app-update.tsx). This pill is only the fallback for an update
 * that has been waiting a long time (a note stayed unsaved, an upload never finished): then the person can decide.
 */
export function UpdateBanner() {
  const t = useT();
  const available = useAppUpdate((s) => s.available);
  const stalled = useAppUpdate((s) => s.stalled);
  const dismissed = useAppUpdate((s) => s.dismissed);
  const dismiss = useAppUpdate((s) => s.dismiss);
  const [busy, setBusy] = useState(false);
  useEffect(() => startUpdateChecks(), []);
  const show = !!available && stalled && !dismissed;
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
  private failedAt = 0;
  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.failedAt = Date.now();
    console.error("VOIDEX crashed", error, info.componentStack);
    // Name of the error and the component only: no props, no state, no user data.
    reportClientEvent({ kind: "root_crashed", phase: "boundary", detail: `${error.name}: ${error.message}` });
  }
  override render() {
    if (this.state.error)
      return (
        <RootCrashed
          onRetry={() => {
            // Browsers remember a failed import() of a module URL, so importing the chunk again in the same page
            // fails the same way: for a chunk error the only real retry is a fresh page load (the person tapped it,
            // so this cannot loop).
            if (isChunkError(this.state.error)) {
              // WebKit remembers the failed module for ~3 s (measured): reloading sooner fails the same way,
              // so a quick tap waits out the remainder before it reloads.
              window.setTimeout(freshReload, Math.max(0, 3500 - (Date.now() - this.failedAt)));
              return;
            }
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
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-8 text-center" data-testid="root-crashed">
      <VoidexMark className="size-14 opacity-80" />
      <div className="text-[15px] font-semibold text-text">{t("os.loadFailed")}</div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onRetry();
            window.setTimeout(() => setBusy(false), 6000); // a failed non-chunk retry must not leave the button dead
          }}
        >
          {t("common.retry")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => { setBusy(true); window.setTimeout(freshReload, 0); }}>
          {t("os.reloadPage")}
        </Button>
      </div>
    </div>
  );
}
