import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RiArrowLeftSLine, RiArrowUpSLine, RiCameraSwitchLine, RiDeleteBinLine, RiLock2Line, RiLockUnlockLine, RiMicLine, RiSendPlaneFill } from "@remixicon/react";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { CircleMessageGlyph } from "./media-bubbles";
import { formatDuration, recordingSupported, useRecorder, type RecordKind, type Recording } from "./recorder";

/**
 * Step 2.9 — one button for voice messages and video circles.
 *
 * The gesture is a small state machine:
 *
 *   idle ──press──▶ holding ──(held 220 ms)──▶ recording
 *     ▲               │ released early: a tap → microphone ↔ video circle
 *     │               ▼
 *     │   recording ──slide left──▶ cancel-zone ──(far / release)──▶ cancelled
 *     │       │ ──slide up────▶ lock-zone ──(far / release)──▶ locked
 *     │       │ released: the recording is sent
 *     │   locked: hands free — Cancel, Send (video: switch camera)
 *     └── sending (upload) ◀── Send
 *
 * PC: a click starts a recording that is already "locked" (trash on the
 * left, send on the right) — a stray mouse-up never sends anything; the
 * mode changes with a right click or by holding the button.
 */
export type RecState = "idle" | "holding" | "recording" | "cancel-zone" | "lock-zone" | "locked" | "sending";

const HOLD_MS = 220;
/** Slide distances (px). */
const CANCEL_HINT = 50;
const CANCEL_AT = 130;
const LOCK_HINT = 36;
const LOCK_AT = 96;
/** Shorter than this is a slip of the finger, not a message. */
const MIN_MS = 600;

export function RecordButton({
  mode,
  onMode,
  onRecorded,
  barHost,
}: {
  mode: RecordKind;
  onMode: (m: RecordKind) => void;
  /** Upload and send; throws on failure. */
  onRecorded: (kind: RecordKind, rec: Recording) => Promise<void>;
  /** The composer row: the recording bar is drawn over it. */
  barHost: HTMLElement | null;
}) {
  const t = useT();
  const ff = useFormFactor();
  const reduced = useReducedMotion();
  const voice = useRecorder("voice");
  const circle = useRecorder("circle");
  const rec = mode === "voice" ? voice : circle;
  const [state, setState] = useState<RecState>("idle");
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const stateRef = useRef<RecState>("idle");
  stateRef.current = state;
  const press = useRef<{ x: number; y: number; id: number; timer: number; mouse: boolean } | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const begin = useCallback(
    async (kind: RecordKind, locked: boolean) => {
      if (!recordingSupported(kind)) {
        toast({ title: t("vibex.voice.unsupported"), tone: "danger" });
        return setState("idle");
      }
      setState(locked ? "locked" : "recording");
      try {
        await (kind === "voice" ? voice : circle).start();
        if (navigator.vibrate) navigator.vibrate(10);
      } catch {
        setState("idle");
        toast({ title: t(kind === "voice" ? "vibex.voice.noMic" : "vibex.circle.noCamera"), tone: "danger" });
      }
    },
    [voice, circle, t],
  );
  const cancel = useCallback(() => {
    rec.cancel();
    setState("idle");
    setDrag({ x: 0, y: 0 });
  }, [rec]);
  const send = useCallback(async () => {
    const kind = modeRef.current;
    const r = kind === "voice" ? voice : circle;
    if (r.elapsed < MIN_MS) {
      r.cancel();
      setState("idle");
      setDrag({ x: 0, y: 0 });
      toast({ title: t("vibex.record.tooShort") });
      return;
    }
    setState("sending");
    setDrag({ x: 0, y: 0 });
    try {
      const out = await r.stop();
      if (out) await onRecorded(kind, out);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t("error.generic"), tone: "danger" });
    } finally {
      setState("idle");
    }
  }, [voice, circle, onRecorded, t]);

  // Leaving the chat (unmount) never leaves a microphone or camera running.
  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer);
    },
    [],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || (state !== "idle" && state !== "locked")) return;
    if (state === "locked") return; // the button is "send" now (onClick)
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer: nothing to capture */
    }
    const mouse = e.pointerType === "mouse";
    const timer = window.setTimeout(() => {
      if (!press.current) return;
      if (mouse) {
        // PC: holding the button switches microphone ↔ video circle.
        press.current = null;
        onMode(modeRef.current === "voice" ? "circle" : "voice");
        setState("idle");
        return;
      }
      void begin(modeRef.current, false);
    }, mouse ? 450 : HOLD_MS);
    press.current = { x: e.clientX, y: e.clientY, id: e.pointerId, timer, mouse };
    setState("holding");
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId || p.mouse) return;
    const s = stateRef.current;
    if (s !== "recording" && s !== "cancel-zone" && s !== "lock-zone") return;
    const dx = Math.min(0, e.clientX - p.x);
    const dy = Math.min(0, e.clientY - p.y);
    // One direction at a time: whichever is clearly larger.
    const horizontal = -dx > -dy;
    setDrag(horizontal ? { x: dx, y: 0 } : { x: 0, y: dy });
    if (horizontal && -dx >= CANCEL_AT) {
      press.current = null;
      return cancel();
    }
    if (!horizontal && -dy >= LOCK_AT) {
      press.current = null;
      setDrag({ x: 0, y: 0 });
      if (navigator.vibrate) navigator.vibrate(8);
      return setState("locked");
    }
    setState(horizontal && -dx >= CANCEL_HINT ? "cancel-zone" : !horizontal && -dy >= LOCK_HINT ? "lock-zone" : "recording");
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p || p.id !== e.pointerId) return;
    window.clearTimeout(p.timer);
    const s = stateRef.current;
    if (s === "holding") {
      if (p.mouse) {
        // PC: a click starts the recording straight in the hands-free state.
        void begin(modeRef.current, true);
      } else {
        // Phone: a quick tap switches microphone ↔ video circle.
        onMode(modeRef.current === "voice" ? "circle" : "voice");
        setState("idle");
      }
      return;
    }
    if (s === "cancel-zone") return cancel();
    if (s === "lock-zone") {
      setDrag({ x: 0, y: 0 });
      return setState("locked");
    }
    if (s === "recording") void send();
  };
  const onPointerCancel = () => {
    const p = press.current;
    press.current = null;
    if (p) window.clearTimeout(p.timer);
    const s = stateRef.current;
    // The system took the touch: a recording that is not locked is dropped, never sent.
    if (s === "holding") setState("idle");
    else if (s === "recording" || s === "cancel-zone" || s === "lock-zone") cancel();
  };

  const active = state !== "idle" && state !== "holding";
  const locked = state === "locked";

  const label = locked ? t("vibex.chat.send") : mode === "voice" ? t("vibex.record.voiceHint") : t("vibex.record.circleHint");
  return (
    <>
      {/* The lock pill above the button while recording (slide up to it). */}
      <AnimatePresence>
        {(state === "recording" || state === "lock-zone" || state === "cancel-zone") && (
          <motion.span
            className="pointer-events-none absolute -top-[86px] right-1.5 z-30 flex h-[74px] w-11 flex-col items-center justify-center gap-0.5 rounded-full border border-border bg-surface text-text-secondary shadow-float"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: Math.max(-40, drag.y * 0.4) }}
            exit={{ opacity: 0, y: 10 }}
            data-testid="record-lock-hint"
          >
            {state === "lock-zone" ? <RiLock2Line className="size-5 text-primary" /> : <RiLockUnlockLine className="size-5" />}
            <RiArrowUpSLine className="size-5" />
          </motion.span>
        )}
      </AnimatePresence>
      <motion.button
        type="button"
        className={cx(
          "relative z-20 flex size-10 shrink-0 touch-none select-none items-center justify-center rounded-full text-white",
          state === "cancel-zone" ? "bg-danger" : "bg-primary",
        )}
        style={{ x: drag.x * 0.5, y: drag.y * 0.5 }}
        animate={{ scale: active && !locked ? 1.45 : 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={() => press.current && onPointerCancel()}
        onContextMenu={(e) => {
          // PC: right click switches microphone ↔ video circle.
          e.preventDefault();
          if (state === "idle") onMode(mode === "voice" ? "circle" : "voice");
        }}
        onClick={() => locked && void send()}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          if (state === "idle") void begin(mode, true);
          else if (locked) void send();
        }}
        aria-label={label}
        title={label}
        data-testid="chat-record"
        data-mode={mode}
        data-state={state}
      >
        {state === "sending" ? (
          <Spinner size={16} />
        ) : locked ? (
          <RiSendPlaneFill className="size-[18px]" />
        ) : mode === "voice" ? (
          <RiMicLine className="size-[19px]" />
        ) : (
          <CircleMessageGlyph className="size-[21px]" />
        )}
      </motion.button>
      {/* The bar over the composer row (for circles the overlay shows the same). */}
      {active &&
        barHost &&
        createPortal(
          <RecordingBar elapsed={rec.elapsed} levels={mode === "voice" ? voice.levels.current : []} state={state} dragX={drag.x} onCancel={cancel} reduced={!!reduced} />,
          barHost,
        )}
      {mode === "circle" && active && (
        <CircleCapture
          stream={circle.stream}
          elapsed={circle.elapsed}
          max={circle.max}
          state={state}
          dragX={drag.x}
          facing={circle.facing}
          onFlip={circle.canFlip ? () => void circle.flip() : undefined}
          onCancel={cancel}
          onSend={() => void send()}
          desktop={ff === "desktop"}
        />
      )}
    </>
  );
}

/** The composer row while recording: level, time, "‹ slide to cancel" (or Cancel when locked). */
function RecordingBar({ elapsed, levels, state, dragX, onCancel, reduced }: { elapsed: number; levels: number[]; state: RecState; dragX: number; onCancel: () => void; reduced: boolean }) {
  const t = useT();
  const locked = state === "locked";
  const bars = levels.slice(-32);
  return (
    <div className={cx("vx-glass-strong absolute inset-0 z-10 flex items-center gap-2 rounded-[26px] py-1.5 pl-2 pr-14", !locked && "pointer-events-none")} data-testid="voice-recording" data-state={state}>
      {locked && (
        <button type="button" onClick={onCancel} aria-label={t("vibex.voice.cancel")} className="pointer-events-auto flex size-10 shrink-0 items-center justify-center rounded-full text-danger hover:bg-danger-soft" data-testid="voice-cancel">
          <RiDeleteBinLine className="size-5" />
        </button>
      )}
      <span className="ml-1 size-2.5 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
      <span className="w-12 shrink-0 text-[14px] tabular-nums text-text" data-testid="voice-elapsed">
        {formatDuration(elapsed)}
      </span>
      {locked ? (
        <span className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden>
          {bars.map((v, i) => (
            <span key={i} className="w-[3px] shrink-0 rounded-full bg-primary/70" style={{ height: `${Math.max(12, v * 100)}%` }} />
          ))}
        </span>
      ) : (
        <span
          className={cx("flex min-w-0 flex-1 items-center justify-center gap-1 text-[14px]", state === "cancel-zone" ? "text-danger" : "text-text-secondary")}
          style={{ transform: `translateX(${reduced ? 0 : dragX * 0.6}px)` }}
          data-testid="record-cancel-hint"
        >
          <RiArrowLeftSLine className="size-5" /> {t("vibex.record.slideCancel")}
        </span>
      )}
    </div>
  );
}

/** Video circle while recording: the round camera, time, hints; locked: Cancel, Send, switch camera. */
function CircleCapture({
  stream,
  elapsed,
  max,
  state,
  dragX,
  facing,
  onFlip,
  onCancel,
  onSend,
  desktop,
}: {
  stream: MediaStream | null;
  elapsed: number;
  max: number;
  state: RecState;
  dragX: number;
  facing: "user" | "environment";
  onFlip?: () => void;
  onCancel: () => void;
  onSend: () => void;
  desktop: boolean;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
  }, [stream]);
  const locked = state === "locked";
  const size = Math.min(window.innerWidth * 0.78, 340);
  const r = size / 2 + 6;
  const c = 2 * Math.PI * r;
  return createPortal(
    <motion.div
      className={cx("fixed inset-0 z-[280] flex flex-col items-center justify-center gap-6 bg-[rgba(12,12,20,0.78)] backdrop-blur-md", !locked && "pointer-events-none")}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={t("vibex.circle.recording")}
      data-testid="circle-recorder"
      data-state={state}
    >
      <div className="relative" style={{ width: size + 16, height: size + 16 }}>
        <svg className="absolute inset-0 -rotate-90" width={size + 16} height={size + 16} aria-hidden>
          <circle cx={(size + 16) / 2} cy={(size + 16) / 2} r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="4" />
          <circle cx={(size + 16) / 2} cy={(size + 16) / 2} r={r} fill="none" stroke="#8b7bff" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, elapsed / max))} />
        </svg>
        <video ref={video} autoPlay muted playsInline className={cx("absolute left-2 top-2 rounded-full bg-black object-cover", facing === "user" && "[transform:scaleX(-1)]")} style={{ width: size, height: size }} />
        {!stream && <Spinner className="absolute inset-0 m-auto text-white" />}
      </div>
      <span className="flex items-center gap-2 text-[15px] tabular-nums text-white">
        <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
        {formatDuration(elapsed)} / {formatDuration(max)}
      </span>
      {locked ? (
        <div className="flex items-center gap-5">
          <button type="button" onClick={onCancel} className="h-12 rounded-full bg-white/12 px-5 text-[15px] font-medium text-white hover:bg-white/20" data-testid="circle-cancel">
            {t("common.cancel")}
          </button>
          {onFlip && (
            <button type="button" onClick={onFlip} aria-label={t("vibex.circle.flip")} title={t("vibex.circle.flip")} className="flex size-12 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/20" data-testid="circle-flip">
              <RiCameraSwitchLine className="size-6" />
            </button>
          )}
          <button type="button" onClick={onSend} aria-label={t("vibex.chat.send")} className="flex size-14 items-center justify-center rounded-full bg-primary text-white" data-testid="circle-send">
            <RiSendPlaneFill className="size-6" />
          </button>
        </div>
      ) : (
        <span className={cx("flex items-center gap-1 text-[14px]", state === "cancel-zone" ? "text-danger" : "text-white/80")} style={{ transform: `translateX(${dragX * 0.6}px)` }}>
          {desktop ? null : (
            <>
              <RiArrowLeftSLine className="size-5" /> {t("vibex.record.slideCancel")} · {t("vibex.record.slideLock")}
            </>
          )}
        </span>
      )}
    </motion.div>,
    document.body,
  );
}
