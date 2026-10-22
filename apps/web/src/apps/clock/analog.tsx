import { useEffect, useRef } from "react";
import { handAngles, localZone, shownZone } from "@voidex/clock";
import { useReducedMotion } from "motion/react";
import { useClock } from "./runtime";

/**
 * A1 / A2: the zone the world clock's top panel and the Clock widget show (the selected city, else
 * this device's zone). One source for both, so the widget can never drift from the app.
 */
export function useShownZone(): string {
  return useClock((s) => shownZone(s.state, localZone()));
}

/**
 * Drives the hands of an analog clock with CSS animations (Update 2 · D): each hand turns once per
 * minute / hour / 12 hours on the compositor, started at the right phase, so no JavaScript runs per
 * frame. It re-syncs once a minute (summer time, drift), when the page shows again and when the zone
 * changes. Reduced motion: the second hand ticks once per second. `data-angle` follows once a second
 * (for tests and accessibility tools).
 */
export function useHands(zone: string, hands: { hour: React.RefObject<SVGElement | HTMLElement | null>; minute: React.RefObject<SVGElement | HTMLElement | null>; second?: React.RefObject<SVGElement | HTMLElement | null> }, svg = false) {
  const reduced = useReducedMotion();
  useEffect(() => {
    let sync = 0;
    let tick = 0;
    const list: [React.RefObject<SVGElement | HTMLElement | null> | undefined, "hour" | "minute" | "second", number][] = [
      [hands.hour, "hour", 43_200],
      [hands.minute, "minute", 3_600],
      [hands.second, "second", 60],
    ];
    const start = () => {
      const a = handAngles(zone, Date.now());
      for (const [ref, key, period] of list) {
        const el = ref?.current;
        if (!el) continue;
        const s = (el as HTMLElement).style;
        if (svg) {
          s.transformOrigin = "100px 100px";
          s.transformBox = "view-box";
        }
        // Restart from the current phase: a negative delay puts the animation where the hand is now.
        const steps = key === "second" && reduced ? "steps(60, end)" : "linear";
        s.animation = `vx-hand-spin ${period}s ${steps} ${(-(a[key] / 360) * period).toFixed(3)}s infinite`;
      }
      angles();
    };
    const angles = () => {
      const a = handAngles(zone, Date.now());
      for (const [ref, key] of list) ref?.current?.setAttribute("data-angle", a[key].toFixed(1));
    };
    const schedule = () => {
      window.clearTimeout(sync);
      sync = window.setTimeout(() => {
        start();
        schedule();
      }, 60_000 - (Date.now() % 60_000) + 20);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        start();
        schedule();
      }
    };
    start();
    schedule();
    tick = window.setInterval(angles, 1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(sync);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [zone, reduced, svg, hands.hour, hands.minute, hands.second]);
}

/** The world clock's analog face (Clock app): hour, minute and a thin second hand. */
export function AnalogFace({ zone, size = "m", label }: { zone: string; size?: "s" | "m"; label: string }) {
  const hour = useRef<HTMLDivElement>(null);
  const minute = useRef<HTMLDivElement>(null);
  const second = useRef<HTMLDivElement>(null);
  useHands(zone, { hour, minute, second });
  return (
    <div className={size === "s" ? "vc-analog vc-analog-s" : "vc-analog"} role="img" aria-label={label} data-testid="clock-analog" data-zone={zone}>
      <div className="vc-face">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={{ transform: `rotate(${i * 30}deg)` }} />
        ))}
        <span className="n12">12</span>
        <span className="n3">3</span>
        <span className="n6">6</span>
        <span className="n9">9</span>
        <div ref={hour} className="vc-hand hour" data-testid="clock-hand-hour" />
        <div ref={minute} className="vc-hand minute" data-testid="clock-hand-minute" />
        <div ref={second} className="vc-hand second" data-testid="clock-hand-second" />
        <div className="vc-pin" />
      </div>
    </div>
  );
}

