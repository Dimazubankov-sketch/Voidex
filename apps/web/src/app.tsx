import { Suspense, useEffect, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { isUnreachable, refreshSession } from "@/lib/api";
import { bootMark, bootReady, reportClientEvent } from "@/lib/boot";
import { Button } from "@/ui/controls";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { VoidexMark } from "@/brand/brand";
import { LogoIntro } from "@/brand/logo-intro";
import { ToastViewport } from "@/ui/overlays";
import { SystemPopups } from "@/os/notifications/popups";
import { ClockRuntime } from "@/apps/clock/ring-sheet";
import { lazyWithRecovery } from "@/lib/app-update";
import { RootBoundary, UpdateBanner } from "@/ui/app-update-ui";

const AuthRoot = lazyWithRecovery(() => import("@/auth/auth-root").then((m) => ({ default: m.AuthRoot })));
const Workspace = lazyWithRecovery(() => import("@/os/workspace").then((m) => ({ default: m.Workspace })));
const LockScreen = lazyWithRecovery(() => import("@/os/lock/lock-screen").then((m) => ({ default: m.LockScreen })));
const SecurityLayer = lazyWithRecovery(() => import("@/os/lock/security-layer").then((m) => ({ default: m.SecurityLayer })));

/**
 * Boot: "VOIDEX doesn't forget me". If this device holds a valid refresh
 * cookie, the session is restored; with a code-password it opens on the lock
 * screen first (Step 2.4). Otherwise the sign-in / create-account screens
 * appear.
 */
export function App() {
  const status = useSession((s) => s.status);
  const locked = useSession((s) => s.locked);
  const userId = useSession((s) => s.user?.id);

  const [problem, setProblem] = useState<BootProblem | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The first commit has happened: tell the boot guard the page started (its single success signal).
  useEffect(() => {
    bootMark("auth");
    bootReady();
  }, []);

  useEffect(() => {
    refreshSession({ lock: true })
      .then(() => setProblem(null))
      .catch((err: unknown) => {
        if (useSession.getState().status !== "booting") return;
        if (isUnreachable(err)) {
          // The server (or the road to it) is down: say so. Signing the person out here would look like a lost account.
          const status = (err as { status?: number }).status ?? 0;
          setProblem(status === 0 ? "offline" : "server");
          reportClientEvent({ kind: "api_unreachable", phase: "boot", detail: `status ${status}` });
          return;
        }
        useSession.getState().signOutLocal(null);
      });
  }, [attempt]);

  // While unreachable: try again by itself (when the network returns, and with a gentle back-off).
  useEffect(() => {
    if (!problem) return;
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener("online", again);
    const timer = window.setTimeout(again, Math.min(30_000, 6_000 * 2 ** Math.min(attempt, 3)));
    return () => {
      window.removeEventListener("online", again);
      window.clearTimeout(timer);
    };
  }, [problem, attempt]);

  // Never let one account's cached data leak into the next session on this device.
  useEffect(() => {
    if (status === "signedOut") queryClient.clear();
  }, [status]);

  // Every motion animation follows the system "reduce motion" setting.
  return (
    <MotionConfig reducedMotion="user">
      <RootBoundary>
      {status === "signedIn" ? (
        // Unmounted immediately on sign-out: nothing of the previous account may
        // keep rendering (or crash) while an exit animation plays.
        <motion.div
          key={`ws-${userId}`}
          className="h-dvh"
          initial={{ opacity: 0, scale: 1.03 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Locked: the workspace stays (open windows and drafts survive) but is hidden and inert under the lock screen. */}
          <div className="h-dvh" style={locked ? { visibility: "hidden" } : undefined} inert={locked} aria-hidden={locked || undefined}>
            <Suspense fallback={<BootScreen />}>
              <Workspace />
            </Suspense>
          </div>
          <Suspense fallback={null}>
            <SecurityLayer />
          </Suspense>
        </motion.div>
      ) : (
        <AnimatePresence mode="wait">
          {status === "booting" && (problem ? <BootUnavailable key="unavailable" problem={problem} onRetry={() => setAttempt((n) => n + 1)} /> : <BootScreen key="boot" />)}
          {status === "locked" && (
            <Suspense key="locked" fallback={<BootScreen />}>
              <LockScreen />
            </Suspense>
          )}
          {status === "signedOut" && (
            <motion.div key="auth" className="h-dvh" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25 }}>
              <Suspense fallback={<BootScreen />}>
                <AuthRoot />
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>
      )}
      </RootBoundary>
      <ToastViewport />
      <UpdateBanner />
      <SystemPopups />
      <ClockRuntime />
      <LogoIntro />
    </MotionConfig>
  );
}

function BootScreen() {
  const t = useT();
  return (
    <motion.div className="flex h-dvh flex-col items-center justify-center gap-6 bg-background" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <div className="relative">
        <div className="absolute inset-3 rounded-full bg-primary/30 blur-2xl animate-glow" />
        <VoidexMark className="relative size-20" />
      </div>
      <div className="text-[13px] text-text-tertiary" aria-live="polite">
        {t("os.restoring")}
      </div>
    </motion.div>
  );
}

type BootProblem = "offline" | "server";

/** Start-up could not reach the server: not "signed out", not a blank screen — a calm message that retries. */
function BootUnavailable({ problem, onRetry }: { problem: BootProblem; onRetry: () => void }) {
  const t = useT();
  return (
    <motion.div
      className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-8 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      data-testid="boot-unavailable"
      role="alert"
    >
      <VoidexMark className="size-16 opacity-80" />
      <div className="text-[16px] font-semibold text-text">{t(problem === "offline" ? "os.noConnection" : "os.serverDown")}</div>
      <div className="max-w-xs text-[13px] text-text-tertiary">{t(problem === "offline" ? "os.noConnectionHint" : "os.serverDownHint")}</div>
      <Button variant="secondary" onClick={onRetry} data-testid="boot-unavailable-retry">
        {t("common.retry")}
      </Button>
    </motion.div>
  );
}
