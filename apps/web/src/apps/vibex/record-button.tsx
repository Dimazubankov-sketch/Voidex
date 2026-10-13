import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RiArrowLeftSLine, RiArrowUpSLine, RiCameraSwitchLine, RiDeleteBinLine, RiLock2Line, RiLockUnlockLine, RiMicLine, RiPauseFill, RiRecordCircleFill, RiSendPlaneFill } from "@remixicon/react";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { VideoMessageGlyph } from "./media-bubbles";
import { usePinch } from "./pinch";
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
          <VideoMessageGlyph className="size-[22px]" />
        )}
      </motion.button>
      {/* The bar over the composer row (for circles the overlay shows the same). */}
      {active &&
        barHost &&
        createPortal(
          <RecordingBar
            kind={mode}
            elapsed={rec.elapsed}
            paused={rec.state === "paused"}
            levels={mode === "voice" ? voice.levels.current : []}
            state={state}
            dragX={drag.x}
            onCancel={cancel}
            reduced={!!reduced}
          />,
          barHost,
        )}
      {mode === "circle" && active && (
        <CircleCapture
          stream={circle.stream}
          elapsed={circle.elapsed}
          max={circle.max}
          state={state}
          paused={circle.state === "paused"}
          dragX={drag.x}
          facing={circle.facing}
          onFlip={circle.canFlip ? () => void circle.flip() : undefined}
          onPause={circle.pause}
          onResume={circle.resume}
          zoom={circle.zoom}
          zoomRange={circle.zoomRange}
          onZoom={(z) => void circle.setZoom(z)}
          barHost={barHost}
          desktop={ff === "desktop"}
        />
      )}
    </>
  );
}

/**
 * The composer row while recording: level, time, "‹ slide to cancel" (or
 * Cancel when locked). Step 2.10: for a video circle the composer stays in
 * its place and, once locked, shows «Отмена» in its middle (the button on
 * the right sends).
 */
function RecordingBar({
  kind,
  elapsed,
  paused,
  levels,
  state,
  dragX,
  onCancel,
  reduced,
}: {
  kind: RecordKind;
  elapsed: number;
  paused: boolean;
  levels: number[];
  state: RecState;
  dragX: number;
  onCancel: () => void;
  reduced: boolean;
}) {
  const t = useT();
  const locked = state === "locked";
  const bars = levels.slice(-32);
  if (kind === "circle" && locked) {
    return (
      <div className="vx-glass-strong absolute inset-0 z-10 flex items-center gap-2 rounded-[26px] py-1.5 pl-3 pr-14" data-testid="voice-recording" data-state={state} data-kind="circle">
        <span className={cx("size-2.5 shrink-0 rounded-full", paused ? "bg-text-tertiary" : "animate-pulse bg-danger")} aria-hidden />
        <span className="w-12 shrink-0 text-[14px] tabular-nums text-text" data-testid="voice-elapsed">
          {formatDuration(elapsed)}
        </span>
        <span className="flex min-w-0 flex-1 justify-center">
          <button type="button" onClick={onCancel} className="h-10 rounded-full px-4 text-[15px] font-semibold text-primary hover:bg-surface-hover" data-testid="circle-cancel">
            {t("common.cancel")}
          </button>
        </span>
        <span className="w-12 shrink-0" aria-hidden />
      </div>
    );
  }
  return (
    <div className={cx("vx-glass-strong absolute inset-0 z-10 flex items-center gap-2 rounded-[26px] py-1.5 pl-2 pr-14", !locked && "pointer-events-none")} data-testid="voice-recording" data-state={state} data-kind={kind}>
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

/**
 * Video circle while recording: the round camera over the chat (the
 * composer below stays visible), the time ring and hints. Locked (hands
 * free): pause / go on, switch camera (the recording goes on), the camera's
 * zoom when it has one. Cancel and Send are in the composer.
 */
function CircleCapture({
  stream,
  elapsed,
  max,
  state,
  paused,
  dragX,
  facing,
  onFlip,
  onPause,
  onResume,
  zoom,
  zoomRange,
  onZoom,
  barHost,
  desktop,
}: {
  stream: MediaStream | null;
  elapsed: number;
  max: number;
  state: RecState;
  paused: boolean;
  dragX: number;
  facing: "user" | "environment";
  onFlip?: () => void;
  onPause: () => void;
  onResume: () => void;
  zoom: number;
  zoomRange: { min: number; max: number; step: number } | null;
  onZoom: (z: number) => void;
  barHost: HTMLElement | null;
  desktop: boolean;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
  }, [stream]);
  // The chat's area above the composer (the composer itself stays usable).
  const [area, setArea] = useState(() => areaAbove(barHost));
  useEffect(() => {
    const update = () => setArea(areaAbove(barHost));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [barHost]);
  const locked = state === "locked";
  // Step 2.11: phones zoom with two fingers on the circle (the camera's own zoom; the circle keeps its size,
  // the page never zooms). The slider stays only on computers (no pinch with a mouse).
  const face = useRef<HTMLDivElement>(null);
  const zoomNow = useRef(zoom);
  zoomNow.current = zoom;
  usePinch(face, {
    enabled: locked && !!zoomRange && !desktop,
    begin: () => zoomNow.current,
    change: (z) => zoomRange && onZoom(Math.max(zoomRange.min, Math.min(zoomRange.max, z))),
  });
  const size = Math.max(160, Math.min(area.width * 0.78, area.height - 150, 340));
  const r = size / 2 + 6;
  const c = 2 * Math.PI * r;
  return createPortal(
    <motion.div
      className={cx("fixed z-[280] flex flex-col items-center justify-center gap-5 bg-[rgba(12,12,20,0.72)] backdrop-blur-md", !locked && "pointer-events-none")}
      style={{ left: area.left, top: area.top, width: area.width, height: area.height }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-label={t("vibex.circle.recording")}
      data-testid="circle-recorder"
      data-state={state}
      data-paused={paused || undefined}
      data-facing={facing}
    >
      <div ref={face} className={cx("relative", locked && "pointer-events-auto touch-none")} style={{ width: size + 16, height: size + 16 }} data-testid="circle-capture-face">
        <svg className="absolute inset-0 -rotate-90" width={size + 16} height={size + 16} aria-hidden>
          <circle cx={(size + 16) / 2} cy={(size + 16) / 2} r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="4" />
          <circle cx={(size + 16) / 2} cy={(size + 16) / 2} r={r} fill="none" stroke="#8b7bff" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, elapsed / max))} />
        </svg>
        <video ref={video} autoPlay muted playsInline className={cx("absolute left-2 top-2 rounded-full bg-black object-cover", facing === "user" && "[transform:scaleX(-1)]")} style={{ width: size, height: size }} />
        {!stream && <Spinner className="absolute inset-0 m-auto text-white" />}
        {zoomRange && !desktop && zoom > zoomRange.min + 0.05 && (
          <span className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-0.5 text-[12.5px] font-semibold tabular-nums text-white" data-testid="circle-zoom-level">
            {zoom.toFixed(1)}×
          </span>
        )}
        {paused && (
          <span className="absolute inset-0 m-auto flex h-9 w-fit items-center rounded-full bg-black/55 px-4 text-[14px] font-medium text-white" data-testid="circle-paused-label">
            {t("vibex.circle.paused")}
          </span>
        )}
      </div>
      <span className="flex items-center gap-2 text-[15px] tabular-nums text-white" data-testid="circle-elapsed">
        <span className={cx("size-2.5 rounded-full", paused ? "bg-white/50" : "animate-pulse bg-danger")} aria-hidden />
        {formatDuration(elapsed)} / {formatDuration(max)}
      </span>
      {locked ? (
        <div className="flex flex-col items-center gap-4">
          {zoomRange && desktop && (
            <label className="flex w-[220px] items-center gap-3 text-[13px] tabular-nums text-white">
              <span className="sr-only">{t("vibex.circle.zoom")}</span>
              <input
                type="range"
                min={zoomRange.min}
                max={zoomRange.max}
                step={zoomRange.step}
                value={zoom}
                onChange={(e) => onZoom(Number(e.target.value))}
                className="h-1 flex-1 accent-[#8b7bff]"
                aria-label={t("vibex.circle.zoom")}
                data-testid="circle-zoom"
              />
              <span className="w-10 text-right">{zoom.toFixed(1)}×</span>
            </label>
          )}
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={paused ? onResume : onPause}
              aria-label={t(paused ? "vibex.circle.resume" : "vibex.circle.pause")}
              title={t(paused ? "vibex.circle.resume" : "vibex.circle.pause")}
              className="flex size-12 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/20"
              data-testid={paused ? "circle-resume" : "circle-pause"}
            >
              {paused ? <RiRecordCircleFill className="size-6 text-danger" /> : <RiPauseFill className="size-6" />}
            </button>
            {onFlip && (
              <button type="button" onClick={onFlip} aria-label={t("vibex.circle.flip")} title={t("vibex.circle.flip")} className="flex size-12 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/20" data-testid="circle-flip">
                <RiCameraSwitchLine className="size-6" />
              </button>
            )}
          </div>
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

/** The part of the chat above the composer (the whole window without one). */
function areaAbove(bar: HTMLElement | null) {
  const chat = bar?.closest<HTMLElement>('[data-testid="conversation"]')?.getBoundingClientRect();
  const row = bar?.getBoundingClientRect();
  if (!chat || !row) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  return { left: chat.left, top: chat.top, width: chat.width, height: Math.max(220, row.top - 8 - chat.top) };
}
