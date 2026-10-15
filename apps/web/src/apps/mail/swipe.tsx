import { useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { RiArchiveLine } from "@remixicon/react";
import { useT } from "@/lib/i18n";

/** Share of the row's width a release must pass to archive (or a quick flick). */
const THRESHOLD = 0.32;
const FLICK = 700;
/** Movement (px) before the gesture picks an axis; vertical wins ties (the list scrolls). */
const LOCK = 8;

/**
 * Step 2.13: a letter row that a finger can swipe to the left to archive it
 * (phones). The row follows the finger over a violet «В архив» background;
 * released past the threshold (or flicked) it slides out and `onArchive`
 * runs (the caller shows the undo toast); a short swipe springs back. A
 * mostly vertical move is never taken: the list scrolls as usual
 * (touch-action: pan-y). Archiving stays available without the gesture
 * (the toolbar and the selection bar).
 */
export function SwipeToArchive({ enabled, onArchive, children }: { enabled: boolean; onArchive: () => void; children: ReactNode }) {
  const t = useT();
  const x = useMotionValue(0);
  const root = useRef<HTMLDivElement>(null);
  const g = useRef<{
    id: number;
    x0: number;
    y0: number;
    t0: number;
    axis: "x" | "y" | null;
    lastX: number;
    lastT: number;
    vx: number;
  } | null>(null);
  const [armed, setArmed] = useState(false);
  const swiped = useRef(false);
  const iconScale = useTransform(x, [0, -60, -120], [0.6, 0.9, 1]);
  const bgOpacity = useTransform(x, [0, -24], [0, 1]);
  // At rest the row keeps the list's own background; while it moves it is an opaque card over the action.
  const rowBg = useTransform(x, (v) => (v < 0 ? "var(--surface)" : "transparent"));

  if (!enabled) return <>{children}</>;

  const width = () => root.current?.offsetWidth ?? 360;
  const end = () => {
    const s = g.current;
    g.current = null;
    if (!s || s.axis !== "x") return;
    const dx = x.get();
    const pass = -dx > width() * THRESHOLD || (s.vx < -FLICK && -dx > 40);
    swiped.current = Math.abs(dx) > 6;
    if (pass) {
      void animate(x, -width() - 24, {
        duration: 0.22,
        ease: [0.32, 0.72, 0, 1],
      }).then(() => {
        onArchive();
        x.set(0);
      });
    } else {
      void animate(x, 0, { type: "spring", stiffness: 500, damping: 40 });
    }
    setArmed(false);
  };

  return (
    <div
      ref={root}
      className="relative overflow-hidden rounded-2xl"
      style={{ touchAction: "pan-y" }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" || e.button !== 0) return;
        swiped.current = false;
        g.current = {
          id: e.pointerId,
          x0: e.clientX,
          y0: e.clientY,
          t0: e.timeStamp,
          axis: null,
          lastX: e.clientX,
          lastT: e.timeStamp,
          vx: 0,
        };
      }}
      onPointerMove={(e) => {
        const s = g.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x0;
        const dy = e.clientY - s.y0;
        if (!s.axis) {
          if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
          // Vertical (or a rightward start): leave it to the list and the drawer.
          if (Math.abs(dy) >= Math.abs(dx) || dx > 0) {
            g.current = null;
            return;
          }
          s.axis = "x";
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }
        const dt = Math.max(1, e.timeStamp - s.lastT);
        s.vx = ((e.clientX - s.lastX) / dt) * 1000;
        s.lastX = e.clientX;
        s.lastT = e.timeStamp;
        // Leftward only; a little resistance past the threshold.
        const raw = Math.min(0, dx);
        const limit = width() * THRESHOLD;
        x.set(-raw > limit ? -(limit + (-raw - limit) * 0.6) : raw);
        setArmed(-raw > limit);
      }}
      onPointerUp={end}
      onPointerCancel={() => {
        if (g.current?.axis === "x") end();
        else g.current = null;
      }}
      onClickCapture={(e) => {
        // The click that ends a swipe doesn't open the letter.
        if (swiped.current) {
          e.stopPropagation();
          e.preventDefault();
          swiped.current = false;
        }
      }}
      data-testid="thread-swipe"
      data-armed={armed || undefined}
    >
      <motion.div className="absolute inset-0 flex items-center justify-end rounded-2xl bg-primary pr-6 text-white" style={{ opacity: bgOpacity }} aria-hidden data-testid="thread-swipe-action">
        <motion.span className="flex flex-col items-center gap-0.5 text-[11.5px] font-semibold" style={{ scale: iconScale }}>
          <RiArchiveLine className="size-6" />
          {t("mail.archiveAction")}
        </motion.span>
      </motion.div>
      <motion.div className="relative rounded-2xl" style={{ x, backgroundColor: rowBg }}>
        {children}
      </motion.div>
    </div>
  );
}
