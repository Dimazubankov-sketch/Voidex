import { useEffect, useId, useRef } from "react";
import { handAngles, localZone } from "@voidex/clock";
import { cx } from "@/lib/cx";

/**
 * The Clock app's logo with live hands. `logo-clock.webp` is the delivered tile with its painted hands
 * taken out; the hour, minute and a thin second hand are drawn over it at the device's real time, in the
 * logo's colours. The hands turn with CSS animations started at the right phase (nothing runs per frame)
 * and are re-synced once a minute and whenever the page becomes visible again (summer time, a sleeping
 * phone). Where the dial sits in the picture is measured from the artwork: centre and radius, as
 * fractions of the tile.
 */
const DIAL = { x: 0.5004, y: 0.5059, r: 0.3147 } as const;

export function ClockGlyph({ className }: { className?: string }) {
  const hour = useRef<SVGGElement>(null);
  const minute = useRef<SVGGElement>(null);
  const second = useRef<SVGGElement>(null);
  const uid = useId().replace(/:/g, "");
  const id = (n: string) => `vxg-${uid}-${n}`;

  useEffect(() => {
    const zone = localZone();
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let sync = 0;
    const start = () => {
      const a = handAngles(zone, Date.now());
      const list = [
        [hour.current, a.hour, 43_200, "linear"],
        [minute.current, a.minute, 3_600, "linear"],
        // Reduced motion: the second hand ticks once a second instead of sweeping.
        [second.current, a.second, 60, reduce ? "steps(60, end)" : "linear"],
      ] as const;
      for (const [el, angle, period, ease] of list) {
        if (!el) continue;
        el.style.transformOrigin = "100px 100px";
        el.style.transformBox = "view-box";
        // A negative delay puts the animation where the hand is now.
        el.style.animation = `vx-hand-spin ${period}s ${ease} ${(-(angle / 360) * period).toFixed(3)}s infinite`;
        el.setAttribute("data-angle", angle.toFixed(1));
      }
    };
    const schedule = () => {
      window.clearTimeout(sync);
      sync = window.setTimeout(() => {
        start();
        schedule();
      }, 60_000 - (Date.now() % 60_000) + 20);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      start();
      schedule();
    };
    start();
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const url = (n: string) => `url(#${id(n)})`;
  return (
    <span className={cx("relative block", className)} data-tile-logo data-system-ui data-clock-glyph aria-hidden>
      <img src="/brand/logo-clock.webp" alt="" draggable={false} className="absolute inset-0 block size-full select-none object-contain" data-logo="/brand/logo-clock.webp" onContextMenu={(e) => e.preventDefault()} />
      <svg
        viewBox="0 0 200 200"
        className="pointer-events-none absolute overflow-visible"
        style={{ left: `${(DIAL.x - DIAL.r) * 100}%`, top: `${(DIAL.y - DIAL.r) * 100}%`, width: `${DIAL.r * 200}%`, height: `${DIAL.r * 200}%` }}
        data-testid="clock-glyph-face"
      >
        <defs>
          <linearGradient id={id("hour")} gradientUnits="userSpaceOnUse" x1="100" y1="100" x2="100" y2="40">
            <stop offset="0" stopColor="#6a2cff" />
            <stop offset="1" stopColor="#a45cff" />
          </linearGradient>
          <linearGradient id={id("minute")} gradientUnits="userSpaceOnUse" x1="100" y1="100" x2="100" y2="24">
            <stop offset="0" stopColor="#4a12e0" />
            <stop offset="1" stopColor="#6a2cff" />
          </linearGradient>
          <radialGradient id={id("hub")} cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#d9b8ff" />
            <stop offset="1" stopColor="#9a5cff" />
          </radialGradient>
          <filter id={id("sh")} filterUnits="userSpaceOnUse" x="-20" y="-20" width="240" height="240">
            <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="#4a12e0" floodOpacity="0.28" />
          </filter>
        </defs>
        <g ref={hour} data-testid="clock-glyph-hour">
          <line x1={100} y1={100} x2={100} y2={46} stroke={url("hour")} strokeWidth={13} strokeLinecap="round" filter={url("sh")} />
        </g>
        <g ref={minute} data-testid="clock-glyph-minute">
          <line x1={100} y1={100} x2={100} y2={27} stroke={url("minute")} strokeWidth={11} strokeLinecap="round" filter={url("sh")} />
        </g>
        <g ref={second} data-testid="clock-glyph-second">
          <line x1={100} y1={114} x2={100} y2={20} stroke="#c58bff" strokeWidth={3} strokeLinecap="round" />
        </g>
        <circle cx={100} cy={100} r={14.5} fill={url("hub")} filter={url("sh")} />
        <circle cx={100} cy={100} r={5} fill="#f1e6ff" />
      </svg>
    </span>
  );
}
