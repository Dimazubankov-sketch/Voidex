import { lazy, Suspense, useEffect } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { refreshSession } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { VoidexMark } from "@/brand/brand";
import { LogoIntro } from "@/brand/logo-intro";
import { ToastViewport } from "@/ui/overlays";

const AuthRoot = lazy(() => import("@/auth/auth-root").then((m) => ({ default: m.AuthRoot })));
const Workspace = lazy(() => import("@/os/workspace").then((m) => ({ default: m.Workspace })));
const LockScreen = lazy(() => import("@/os/lock/lock-screen").then((m) => ({ default: m.LockScreen })));
const SecurityLayer = lazy(() => import("@/os/lock/security-layer").then((m) => ({ default: m.SecurityLayer })));

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

  useEffect(() => {
    refreshSession({ lock: true }).catch(() => {
      if (useSession.getState().status === "booting") useSession.getState().signOutLocal(null);
    });
  }, []);

  // Never let one account's cached data leak into the next session on this device.
  useEffect(() => {
    if (status === "signedOut") queryClient.clear();
  }, [status]);

  // Every motion animation follows the system "reduce motion" setting.
  return (
    <MotionConfig reducedMotion="user">
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
          {status === "booting" && <BootScreen key="boot" />}
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
      <ToastViewport />
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
