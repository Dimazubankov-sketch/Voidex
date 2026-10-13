import { useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";

const SPRING = { type: "spring", stiffness: 420, damping: 44 } as const;
/** Share of its width the menu travels behind the screen (it slides out from under it). */
const PARALLAX = 0.32;

/**
 * Step 2.9 — the VOIDEX side drawer (one behaviour for every app).
 *
 * The menu is the LOWER layer, on the left. Opening it moves the app's own
 * screen to the right, over the menu: the screen keeps its colours (no
 * dimming, no blur), gets a rounded left edge and a soft shadow, and the menu
 * slides out from under it. A tap on the visible part of the screen, a swipe
 * to the left or Esc closes it. `progress` (0 closed … 1 open) can be shared
 * with an edge swipe so the drawer follows the finger.
 */
export function PushDrawer({
  open,
  onClose,
  menu,
  children,
  width = 300,
  progress: external,
  testId = "push-drawer",
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** The menu (rendered under the screen). */
  menu: ReactNode;
  /** The app's screen. */
  children: ReactNode;
  width?: number;
  progress?: MotionValue<number>;
  testId?: string;
  className?: string;
}) {
  const t = useT();
  const own = useMotionValue(0);
  const progress = external ?? own;
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const w = useRef(width);
  // The menu never covers more than 84% of a narrow window.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => (w.current = Math.min(width, el.clientWidth * 0.84));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const fgX = useTransform(progress, (p) => p * w.current);
  const menuX = useTransform(progress, (p) => (p - 1) * w.current * PARALLAX);
  const radius = useTransform(progress, [0, 0.15, 1], [0, 18, 30]);
  const shadow = useTransform(progress, (p) => `-${Math.round(14 * p)}px 0 ${Math.round(40 * p)}px rgba(20, 16, 60, ${(0.14 * p).toFixed(3)})`);
  const menuWidth = useTransform(progress, () => w.current);
  const menuVisibility = useTransform(progress, (p) => (p <= 0.001 ? "hidden" : "visible"));
  const contentOpacity = useTransform(progress, [0, 1], [1, 0.5]);

  // Step 2.11: one animation at a time. A new open / close replaces the running one from where it is
  // (rapid toggles never stack, never leave a half-open screen); unmounting stops it.
  useEffect(() => {
    if (reduced) {
      progress.stop();
      progress.set(open ? 1 : 0);
      return;
    }
    const a = animate(progress, open ? 1 : 0, SPRING);
    return () => a.stop();
  }, [open, progress, reduced]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);

  // Swipe left on the screen (or on the menu) closes; the drawer follows the finger.
  const drag = useRef<{ id: number; x: number; y: number; t: number; on: boolean } | null>(null);
  const down = (e: React.PointerEvent) => {
    if (!open || e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), on: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      if (dx > -8) return;
      d.on = true;
      // Step 2.11: the finger takes over from whatever animation is running (no tug of war).
      progress.stop();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* the pointer is gone already */
      }
    }
    progress.set(Math.max(0, Math.min(1, 1 + dx / w.current)));
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.on) return;
    const v = (e.clientX - d.x) / Math.max(1, performance.now() - d.t);
    if (progress.get() < 0.65 || v < -0.5) {
      onClose();
      // Already closing by state (a tap raced the swipe): still settle.
      if (!open) void animate(progress, 0, SPRING);
    } else void animate(progress, 1, SPRING);
  };
  const cancel = () => {
    if (drag.current?.on) void animate(progress, open ? 1 : 0, SPRING);
    drag.current = null;
  };

  return (
    <div ref={root} className={cx("relative flex min-h-0 min-w-0 flex-1 overflow-hidden", className)} data-testid={testId} data-open={open || undefined}>
      <motion.aside
        className="absolute inset-y-0 left-0 z-0 flex touch-pan-y flex-col bg-surface"
        // Fully closed: not painted at all (it is off screen under the app, and must not be found or hit).
        style={{ x: menuX, width: menuWidth, visibility: menuVisibility }}
        aria-hidden={!open}
        inert={!open}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        data-testid={`${testId}-menu`}
      >
        {menu}
      </motion.aside>
      <motion.div
        className="vx-app-bg relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        style={{ x: fgX, borderTopLeftRadius: radius, borderBottomLeftRadius: radius, boxShadow: shadow }}
        data-testid={`${testId}-screen`}
      >
        {/* Step 2.10: while the menu is out, the screen's contents (texts, pictures) fade to half; its background stays. */}
        <motion.div className="relative flex min-h-0 min-w-0 flex-1 flex-col" style={{ opacity: contentOpacity }} data-testid={`${testId}-content`}>
          {children}
        </motion.div>
        {open && (
          // The visible part of the screen: a tap closes the menu. Transparent: the screen is never dimmed.
          <button
            type="button"
            // touch-none: a swipe here is the drawer's (the browser must not claim it and cancel the pointer).
            className="absolute inset-0 z-[70] cursor-default touch-none bg-transparent"
            aria-label={t("common.close")}
            onClick={onClose}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={cancel}
            data-testid={`${testId}-catcher`}
          />
        )}
      </motion.div>
    </div>
  );
}
