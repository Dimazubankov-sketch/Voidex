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
 * Drives the hands of an analog clock straight on the DOM, once per frame (no React render per
 * frame): the hour, minute and second hands glide. Reduced motion: one step per second. Paused while
 * the page is hidden; the hands are right the moment it shows again.
 */
export function useHands(zone: string, hands: { hour: React.RefObject<SVGElement | HTMLElement | null>; minute: React.RefObject<SVGElement | HTMLElement | null>; second?: React.RefObject<SVGElement | HTMLElement | null> }, svg = false) {
  const reduced = useReducedMotion();
  useEffect(() => {
    let raf = 0;
    let timer = 0;
    const set = (el: SVGElement | HTMLElement | null | undefined, deg: number) => {
      if (!el) return;
      if (svg) el.setAttribute("transform", `rotate(${deg.toFixed(3)} 100 100)`);
      else (el as HTMLElement).style.transform = `rotate(${deg.toFixed(3)}deg)`;
      el.setAttribute("data-angle", deg.toFixed(1));
    };
    const draw = () => {
      const now = reduced ? Math.floor(Date.now() / 1000) * 1000 : Date.now();
      const a = handAngles(zone, now);
      set(hands.hour.current, a.hour);
      set(hands.minute.current, a.minute);
      set(hands.second?.current, a.second);
    };
    const loop = () => {
      draw();
      if (reduced) timer = window.setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
      else raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
    const onVisible = () => {
      stop();
      if (document.visibilityState === "visible") loop();
    };
    loop();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
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

