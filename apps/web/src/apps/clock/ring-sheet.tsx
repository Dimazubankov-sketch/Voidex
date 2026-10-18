import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { localZone, cityClock } from "@voidex/clock";
import { useLanguage } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useClockAudio } from "./audio";
import { ClockIcon } from "./icons";
import { dismissRing, enableRingSound, loadClock, startClockLoop, unloadClock, useClock } from "./runtime";
import { clockText } from "./strings";

/**
 * Step 2.14: the shell side of Clock, mounted once for the signed-in
 * account: it loads the account's Clock on this device, runs the scheduler
 * and shows the ring sheet. The Clock window itself is not needed for an
 * alarm or a timer to ring.
 */
export function ClockRuntime() {
  const userId = useSession((s) => (s.status === "signedIn" ? (s.user?.id ?? null) : null));
  useEffect(() => {
    if (!userId) return;
    loadClock(userId);
    const stop = startClockLoop();
    return () => {
      stop();
      unloadClock();
    };
  }, [userId]);
  return userId ? <RingSheet /> : null;
}

/**
 * The alarm / timer sheet: what rings, the time now, «Ещё N мин» (when the
 * alarm repeats its signal), «Остановить», and «Включить звук» while the
 * browser holds the sound back (never a silent ring). One ring at a time;
 * the next one in the queue follows when this one is stopped.
 */
function RingSheet() {
  const lang = useLanguage();
  const ring = useClock((s) => s.rings[0] ?? null);
  const more = useClock((s) => Math.max(0, s.rings.length - 1));
  const dismissing = useClock((s) => s.dismissing);
  const ringing = useClockAudio((s) => s.ringing);
  const reduced = useReducedMotion();
  const stopRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [enabling, setEnabling] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const tr = (k: Parameters<typeof clockText>[1], v?: Record<string, string | number>) => clockText(lang, k, v);

  useEffect(() => {
    if (!ring) return;
    setBlocked(false);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    // The sound gets a moment to start before the sheet says it could not.
    const hint = window.setTimeout(() => setBlocked(!useClockAudio.getState().ringing), 900);
    const previous = document.activeElement as HTMLElement | null;
    stopRef.current?.focus({ preventScroll: true });
    return () => {
      window.clearInterval(id);
      window.clearTimeout(hint);
      if (previous?.isConnected) previous.focus?.({ preventScroll: true });
    };
  }, [ring?.key]);

  useEffect(() => {
    if (!ring) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        void dismissRing(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ring?.key]);

  const kind = ring?.kind === "timer" ? "timer" : "alarm";
  const name = ring ? ring.name || tr(kind === "alarm" ? "alarm.default" : "timer.default") : "";

  return createPortal(
    <AnimatePresence>
      {ring && (
        <motion.div
          key="clock-ring"
          className="vx-app fixed inset-0 z-[420] flex items-end justify-center bg-black/35 p-3 pb-[max(var(--safe-bottom),12px)] backdrop-blur-md sm:items-center"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: { duration: 0.17 } }}
          data-clock-ring
          data-testid="clock-ring"
          data-kind={kind}
          data-sound-on={ringing ? "true" : "false"}
        >
          <motion.div
            key={ring.key}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clock-ring-title"
            aria-describedby="clock-ring-time"
            className="relative w-full max-w-[420px] overflow-hidden rounded-[32px] border border-border bg-surface px-6 pb-6 pt-8 text-center text-text shadow-float"
            initial={reduced ? false : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? undefined : { opacity: 0, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div className="mx-auto grid size-[88px] place-items-center rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary" aria-hidden>
              <span className={reduced ? "" : "motion-safe:animate-pulse"}>
                <ClockIcon name={kind === "alarm" ? "alarm" : "timers"} className="size-10" />
              </span>
            </div>
            <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">{tr(kind === "alarm" ? "ring.alarm" : "ring.timer")}</p>
            <h2 id="clock-ring-title" className="mt-2 break-words text-[24px] font-semibold tracking-tight" data-testid="clock-ring-name">
              {name}
            </h2>
            <div id="clock-ring-time" className="mt-1 text-[56px] font-medium leading-tight tracking-[-0.04em] tabular-nums text-primary-strong">
              {cityClock(localZone(), now)}
            </div>
            {more > 0 && <p className="text-[12.5px] text-text-tertiary">{tr("ring.queue", { n: more })}</p>}
            {!ringing && blocked && (
              <p className="mx-auto mt-2 max-w-[300px] text-[12.5px] leading-snug text-text-secondary" data-testid="clock-ring-blocked">
                {tr("ring.blocked")}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2.5">
              {!ringing && (
                <button
                  type="button"
                  disabled={enabling}
                  onClick={async () => {
                    setEnabling(true);
                    const ok = await enableRingSound().finally(() => setEnabling(false));
                    setBlocked(!ok);
                  }}
                  className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-white shadow-[var(--glow-primary)] transition active:scale-[0.98] disabled:opacity-60"
                  data-testid="clock-ring-enable"
                >
                  <ClockIcon name="sound" className="size-5" />
                  {tr("ring.enable")}
                </button>
              )}
              {ring.snooze && ring.interval > 0 && (
                <button
                  type="button"
                  disabled={dismissing}
                  onClick={() => void dismissRing(true)}
                  className="h-12 rounded-full bg-surface-secondary text-[15px] font-semibold text-text transition hover:bg-surface-hover active:scale-[0.98]"
                  data-testid="clock-ring-snooze"
                >
                  {tr("ring.snooze", { n: ring.interval })}
                </button>
              )}
              <button
                ref={stopRef}
                type="button"
                disabled={dismissing}
                onClick={() => void dismissRing(false)}
                className="h-12 rounded-full border border-border-strong text-[15px] font-semibold text-text transition hover:bg-surface-hover active:scale-[0.98]"
                data-testid="clock-ring-stop"
              >
                {tr("ring.stop")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
