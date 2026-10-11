import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RiCloseLine, RiPauseFill, RiPlayFill } from "@remixicon/react";
import type { VibexFileDto } from "@voidex/shared";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { useFileUrl, useVibexMe } from "./data";
import { takeOver } from "./media-bubbles";
import { formatDuration } from "./recorder";
import { useVibex } from "./store";

/** Speeds of the expanded circle; each tap moves to the next (1x → 1.5x → 2x → 1x). */
export const CIRCLE_SPEEDS = [1, 1.5, 2] as const;
export function nextSpeed(s: number): number {
  const i = CIRCLE_SPEEDS.indexOf(s as (typeof CIRCLE_SPEEDS)[number]);
  return CIRCLE_SPEEDS[(i + 1) % CIRCLE_SPEEDS.length]!;
}


/** Near the viewport (with a margin): only those circles load and play. */
function useNearViewport<T extends Element>(margin = "160px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(([e]) => setNear(!!e?.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, near] as const;
}

/**
 * Step 2.9 video circle in a chat.
 *
 * Collapsed: it loops by itself, muted and inline, but only while it is on
 * (or near) the screen; off screen it is paused and far ones are not even
 * loaded (metadata first). Tap: it grows and comes forward (see
 * ExpandedCircle) and plays from the start with sound.
 */
export function CircleBubble({ file, durationMs }: { file: VibexFileDto; durationMs: number | null }) {
  const t = useT();
  const autoplay = useVibexMe().data?.settings.media.autoplay ?? true;
  const [box, near] = useNearViewport<HTMLButtonElement>();
  const { data: src } = useFileUrl(near ? file.id : null);
  const video = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const size = 208;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (near && autoplay && !open) void v.play().catch(() => undefined);
    else v.pause();
  }, [near, autoplay, open, src]);

  return (
    <>
      <button
        ref={box}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("vibex.circle.play")}
        className="relative block shrink-0 overflow-hidden rounded-full bg-black/80"
        style={{ width: size, height: size }}
        data-testid="circle-message"
        data-autoplay={near && autoplay ? "on" : "off"}
        data-gesture-owner
      >
        {src ? (
          <video
            ref={video}
            src={src}
            muted
            loop
            playsInline
            autoPlay={near && autoplay}
            preload="metadata"
            className="size-full rounded-full object-cover"
            data-testid="circle-preview-video"
          />
        ) : (
          <span className="flex size-full items-center justify-center rounded-full">
            <Spinner className="text-white" />
          </span>
        )}
        {!autoplay && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur" data-testid="circle-play">
              <RiPlayFill className="size-7" />
            </span>
          </span>
        )}
        {durationMs !== null && (
          <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] tabular-nums text-white">{formatDuration(durationMs)}</span>
        )}
      </button>
      <ExpandedCircle file={file} src={src ?? null} durationMs={durationMs} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The expanded circle: larger, in front, with sound. Around it the progress
 * ring — drag along it to seek. X on the left of the ring collapses it; the
 * speed button under it cycles 1x → 1.5x → 2x (kept while Vibex is open,
 * back to 1x after it is closed). A tap on the video plays / pauses.
 */
function ExpandedCircle({ file, src, durationMs, open, onClose }: { file: VibexFileDto; src: string | null; durationMs: number | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const reduced = useReducedMotion();
  const speed = useVibex((s) => s.circleSpeed);
  const setSpeed = useVibex((s) => s.setCircleSpeed);
  const video = useRef<HTMLVideoElement>(null);
  const ring = useRef<SVGSVGElement>(null);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const seeking = useRef(false);
  const size = Math.min(typeof window === "undefined" ? 320 : window.innerWidth * 0.82, 360);
  const pad = 22;
  const outer = size + pad * 2;
  const r = size / 2 + 10;
  const c = 2 * Math.PI * r;
  const length = () => {
    const v = video.current;
    return v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (durationMs ?? 0) / 1000;
  };

  useEffect(() => {
    if (!open) return;
    const v = video.current;
    if (v) {
      v.currentTime = 0;
      v.playbackRate = speed;
      void v.play().catch(() => undefined);
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " ") toggle();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.ended) v.currentTime = 0;
      void v.play();
    } else v.pause();
  };
  /** Pointer on the ring → position by its angle (12 o'clock = start, clockwise). */
  const seekAt = (e: React.PointerEvent) => {
    const el = ring.current;
    const v = video.current;
    if (!el || !v) return;
    const b = el.getBoundingClientRect();
    const a = Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
    const f = (((a + Math.PI / 2) / (2 * Math.PI)) % 1 + 1) % 1;
    const d = length();
    if (d) v.currentTime = f * d;
    setPos(f);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[260] flex flex-col items-center justify-center gap-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-label={t("vibex.circle.message")}
          data-testid="circle-expanded"
          data-playing={playing || undefined}
          data-speed={speed}
        >
          <button type="button" className="absolute inset-0 bg-black/35 backdrop-blur-[3px]" aria-label={t("vibex.circle.collapse")} onClick={onClose} />
          <motion.div className="relative" style={{ width: outer, height: outer }} initial={{ scale: reduced ? 1 : 0.55 }} animate={{ scale: 1 }} exit={{ scale: reduced ? 1 : 0.6 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            {src ? (
              <video
                ref={video}
                src={src}
                playsInline
                preload="auto"
                className="absolute rounded-full bg-black object-cover shadow-window"
                style={{ left: pad, top: pad, width: size, height: size }}
                onClick={toggle}
                onPlay={(e) => {
                  takeOver(e.currentTarget);
                  setPlaying(true);
                }}
                onPause={() => setPlaying(false)}
                onEnded={() => {
                  setPlaying(false);
                  setPos(1);
                }}
                onTimeUpdate={(e) => {
                  if (seeking.current) return;
                  const d = length();
                  if (d) setPos(Math.min(1, e.currentTarget.currentTime / d));
                }}
                data-testid="circle-expanded-video"
              />
            ) : (
              <Spinner className="absolute inset-0 m-auto text-white" />
            )}
            {!playing && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur">
                  <RiPlayFill className="size-8" />
                </span>
              </span>
            )}
            {/* The progress ring: drag along it to seek. */}
            <svg
              ref={ring}
              className="pointer-events-none absolute inset-0 touch-none"
              width={outer}
              height={outer}
              role="slider"
              tabIndex={0}
              aria-label={t("vibex.voice.position")}
              aria-valuemin={0}
              aria-valuemax={Math.round(length())}
              aria-valuenow={Math.round(pos * length())}
              aria-valuetext={formatDuration(pos * length() * 1000)}
              onKeyDown={(e) => {
                const v = video.current;
                if (!v) return;
                if (e.key === "ArrowRight") v.currentTime = Math.min(length(), v.currentTime + 3);
                else if (e.key === "ArrowLeft") v.currentTime = Math.max(0, v.currentTime - 3);
                else return;
                e.preventDefault();
              }}
              data-testid="circle-ring"
              data-gesture-owner
            >
              <circle cx={outer / 2} cy={outer / 2} r={r} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="6" />
              <circle
                cx={outer / 2}
                cy={outer / 2}
                r={r}
                fill="none"
                stroke="#8b7bff"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={c * (1 - pos)}
                transform={`rotate(-90 ${outer / 2} ${outer / 2})`}
              />
              {/* A wide invisible band over the ring takes the pointer. */}
              <circle
                cx={outer / 2}
                cy={outer / 2}
                r={r}
                fill="none"
                stroke="transparent"
                strokeWidth="28"
                className="cursor-pointer"
                style={{ pointerEvents: "stroke" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.currentTarget as Element).setPointerCapture(e.pointerId);
                  seeking.current = true;
                  seekAt(e);
                }}
                onPointerMove={(e) => seeking.current && seekAt(e)}
                onPointerUp={() => (seeking.current = false)}
                onPointerCancel={() => (seeking.current = false)}
                data-testid="circle-ring-track"
              />
            </svg>
            {/* X on the left of the ring. */}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("vibex.circle.collapse")}
              className="absolute flex size-11 items-center justify-center rounded-full bg-surface text-text shadow-float"
              style={{ left: outer / 2 - r * Math.cos(Math.PI / 5) - 22, top: outer / 2 - r * Math.sin(Math.PI / 5) - 22 }}
              data-testid="circle-collapse"
            >
              <RiCloseLine className="size-6" />
            </button>
          </motion.div>
          <div className="relative flex items-center gap-3">
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? t("vibex.voice.pause") : t("vibex.circle.play")}
              className="flex size-11 items-center justify-center rounded-full bg-surface text-text shadow-float"
              data-testid="circle-toggle"
            >
              {playing ? <RiPauseFill className="size-6" /> : <RiPlayFill className="size-6" />}
            </button>
            <button
              type="button"
              onClick={() => setSpeed(nextSpeed(speed))}
              aria-label={t("vibex.circle.speed", { speed: `${speed}x` })}
              className="flex h-11 min-w-[64px] items-center justify-center rounded-full bg-surface px-4 text-[15px] font-semibold tabular-nums text-text shadow-float"
              data-testid="circle-speed"
            >
              {speed}x
            </button>
            <span className="rounded-full bg-black/45 px-3 py-1 text-[13px] tabular-nums text-white" data-testid="circle-time">
              {formatDuration(pos * length() * 1000)} / {formatDuration(length() * 1000)}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
