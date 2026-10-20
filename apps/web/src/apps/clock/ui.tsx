import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { closeSwipes, mountSwipes, mountWheel, setWheelChange, setWheelValue, wheelSpec, type WheelElement } from "@voidex/clock";
import { cx } from "@/lib/cx";
import { playWheelTick, unlockAudio } from "./audio";
import { ClockIcon } from "./icons";

/** The current time, refreshed every `ms` (only while the component is on screen). */
export function useNow(ms: number, active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
  return now;
}

/** Whether the browser tab is visible (a hidden tab is "in the background" too). */
export function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const h = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
  return visible;
}

/**
 * A number drum (h / m / s). The markup is React's; the scrolling, snapping,
 * cycling and keys are the ported Voidex-Clock controller. `onChange` comes
 * on every real step of the drum (and plays the tick), never on the first
 * render or when `value` is set from outside.
 */
export function Wheel({
  name,
  label,
  value,
  count,
  unit,
  padded = true,
  onChange,
  testId,
}: {
  name: string;
  label: string;
  value: number;
  count: number;
  unit?: string;
  padded?: boolean;
  onChange: (value: number) => void;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = useRef(value);
  const spec = useMemo(() => wheelSpec(label, initial.current, count, padded), [label, count, padded]);
  const change = useRef(onChange);
  change.current = onChange;

  useLayoutEffect(() => {
    const el = ref.current as unknown as WheelElement;
    return mountWheel(el, (_k, v) => {
      playWheelTick();
      change.current(v);
    });
  }, []);
  useEffect(() => {
    setWheelChange(ref.current as unknown as WheelElement, (_k, v) => {
      playWheelTick();
      change.current(v);
    });
    setWheelValue(ref.current as unknown as WheelElement, value);
  }, [value]);

  return (
    <div className="vc-wheel-field">
      <div
        ref={ref}
        className="vc-wheel"
        data-wheel={name}
        data-count={count}
        data-value={spec.selected}
        {...spec.attrs}
        aria-valuetext={`${String(value).padStart(padded ? 2 : 1, "0")}${unit ? " " + unit : ""}`}
        data-testid={testId}
        // Step 2.16: the touch that turns the drum also lets it click (audio may start inside a gesture).
        onPointerDownCapture={unlockAudio}
        onKeyDownCapture={unlockAudio}
        onWheelCapture={unlockAudio}
      >
        <div className="vc-wheel-values" aria-hidden="true">
          {spec.options.map((text, i) => (
            <button key={i} type="button" tabIndex={-1} className="wheel-option" data-wheel-option={i}>
              {text}
            </button>
          ))}
        </div>
      </div>
      {unit && (
        <span className="vc-wheel-unit" aria-hidden="true">
          {unit}
        </span>
      )}
      <span className="vc-wheel-label" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}

/** A list whose rows reveal a trash button with a swipe to the left (ported swipe controller). */
export function SwipeList({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const stop = mountSwipes(el as never);
    return () => {
      closeSwipes(el as never);
      stop();
    };
  }, []);
  return (
    <div ref={ref} className={className} data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * One removable row. Swipe left (or ArrowLeft / Delete) reveals the trash;
 * only a press on the trash deletes. On a PC a small trash button also shows
 * on hover and focus.
 */
export function SwipeRow({ id, label, deleteLabel, onDelete, children, testId, focused }: { id: string; label: string; deleteLabel: string; onDelete: () => void; children: ReactNode; testId?: string; focused?: boolean }) {
  return (
    <div className={cx("swipe-row vc-swipe-row", focused && "vc-focused")} data-swipe-row={id} data-swipe-open="false" tabIndex={0} aria-label={label} data-testid={testId}>
      <button type="button" className="swipe-delete" tabIndex={-1} aria-hidden="true" aria-label={deleteLabel} onClick={onDelete} data-testid="clock-swipe-delete">
        <ClockIcon name="trash" />
      </button>
      <div className="swipe-front">{children}</div>
      <button
        type="button"
        className="vc-hover-delete"
        aria-label={deleteLabel}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        data-testid="clock-hover-delete"
      >
        <ClockIcon name="trash" />
      </button>
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={cx("vc-switch", checked && "on")} onClick={() => onChange(!checked)} data-testid={testId}>
      <i />
    </button>
  );
}

/** The Clock window's root: its dialogs are drawn there (over the whole window, not inside a scrolled page). */
export const SheetHost = createContext<HTMLElement | null>(null);

const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"]';

/**
 * A Clock dialog inside the window: a sheet from the bottom on a phone, a
 * centred card on a PC. Focus moves in, Tab stays in, Esc closes, focus goes
 * back where it was. Its content can change (form → sound list) without a
 * close and reopen, so there is no close race.
 */
export function ClockSheet({ open, onClose, labelledBy, phone, children, testId, wide }: { open: boolean; onClose: () => void; labelledBy: string; phone: boolean; children: ReactNode; testId?: string; wide?: boolean }) {
  const reduced = useReducedMotion();
  const host = useContext(SheetHost);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(id);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const sheet = (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scrim"
          className={cx("vc-scrim", phone ? "vc-scrim-phone" : "vc-scrim-desktop")}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.16 } }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close.current();
          }}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className={cx("vc-sheet", phone ? "vc-sheet-phone" : "vc-sheet-desktop", wide && "vc-sheet-wide")}
            initial={reduced ? false : phone ? { y: 48, opacity: 0 } : { y: 10, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : phone ? { y: 40, opacity: 0, transition: { duration: 0.16 } } : { y: 8, opacity: 0, transition: { duration: 0.16 } }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            onKeyDown={onKeyDown}
            data-testid={testId}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return host ? createPortal(sheet, host) : sheet;
}

/** Header of a Clock dialog: close / back on the left, the title, an optional save on the right. */
export function SheetHeader({ id, title, onClose, closeLabel, back, onSave, saveLabel, saving }: { id: string; title: string; onClose: () => void; closeLabel: string; back?: boolean; onSave?: () => void; saveLabel?: string; saving?: boolean }) {
  return (
    <div className="vc-sheet-header">
      <button type="button" className="vc-icon-button" onClick={onClose} aria-label={closeLabel} data-testid={back ? "clock-sheet-back" : "clock-sheet-close"}>
        <ClockIcon name={back ? "back" : "x"} />
      </button>
      <h2 id={id}>{title}</h2>
      {onSave ? (
        <button type="button" className="vc-icon-button primary" onClick={onSave} disabled={saving} aria-label={saveLabel} data-testid="clock-sheet-save">
          <ClockIcon name="check" />
        </button>
      ) : (
        <span className="vc-header-spacer" />
      )}
    </div>
  );
}

/** The short arrival of a section's content (cancelled when the next one starts; none with reduced motion). */
export function useArrive(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduced || !el.animate) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 140, easing: "cubic-bezier(.2,.8,.2,1)" });
  }, [key, reduced]);
  return ref;
}
