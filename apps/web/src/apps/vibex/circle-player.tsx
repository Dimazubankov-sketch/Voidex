import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { RiCloseLine, RiPlayFill } from "@remixicon/react";
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
 * Step 2.9 video circle in a chat; Step 2.10: it opens in place.
 *
 * Collapsed: it loops by itself, muted and inline, but only while it is on
 * (or near) the screen; off screen it is paused and far ones are not even
 * loaded (metadata first). Tap: it grows right where it is (the chat stays
 * around it, nothing covers the screen) and plays from the start with sound.
 * When it ends, or with the X, it shrinks back.
 */
export function CircleBubble({ file, durationMs }: { file: VibexFileDto; durationMs: number | null }) {
  const t = useT();
  const autoplay = useVibexMe().data?.settings.media.autoplay ?? true;
  const [box, near] = useNearViewport<HTMLDivElement>();
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
    <div ref={box} className="relative shrink-0" data-gesture-owner="circle-seek">
      {open ? (
        <InlineCircle file={file} src={src ?? null} durationMs={durationMs} onClose={() => setOpen(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("vibex.circle.play")}
          className="relative block shrink-0 overflow-hidden rounded-full bg-black/80"
          style={{ width: size, height: size }}
          data-testid="circle-message"
          data-autoplay={near && autoplay ? "on" : "off"}
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
      )}
    </div>
  );
}

/**
 * The opened circle, in place: larger, with sound, the progress ring around
 * it (drag along it to seek), X at the top right of the ring, the speed
 * under it (1x → 1.5x → 2x, kept while Vibex is open). A tap on the video
 * plays / pauses; at the end it closes by itself.
 */
function InlineCircle({ file, src, durationMs, onClose }: { file: VibexFileDto; src: string | null; durationMs: number | null; onClose: () => void }) {
  const t = useT();
  const reduced = useReducedMotion();
  const speed = useVibex((s) => s.circleSpeed);
  const setSpeed = useVibex((s) => s.setCircleSpeed);
  const video = useRef<HTMLVideoElement>(null);
  const ring = useRef<SVGSVGElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const seeking = useRef(false);
  // As large as the chat allows (never wider than the message column).
  const [size, setSize] = useState(280);
  const pad = 22;
  const outer = size + pad * 2;
  const r = size / 2 + 10;
  const c = 2 * Math.PI * r;
  const length = () => {
    const v = video.current;
    return v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (durationMs ?? 0) / 1000;
  };

  useEffect(() => {
    const host = root.current?.closest<HTMLElement>('[data-testid="messages"]');
    const w = host?.clientWidth ?? window.innerWidth;
    setSize(Math.max(200, Math.min(w - 120, 320)));
    // The chat keeps its place; the opened circle is brought fully into view.
    window.setTimeout(() => root.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }), 60);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " " && document.activeElement?.closest?.('[data-testid="circle-expanded"]')) toggle();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.currentTime = 0;
    v.playbackRate = speed;
    void v.play().catch(() => undefined);
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
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

  return (
    <motion.div
      ref={root}
      className="relative flex flex-col items-center gap-2"
      initial={{ scale: reduced ? 1 : 0.7, opacity: reduced ? 1 : 0.6 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
      style={{ transformOrigin: "50% 50%" }}
      role="group"
      aria-label={t("vibex.circle.message")}
      data-testid="circle-expanded"
      data-file-id={file.id}
      data-playing={playing || undefined}
      data-speed={speed}
    >
      <div className="relative" style={{ width: outer, height: outer }}>
        {src ? (
          <video
            ref={video}
            src={src}
            playsInline
            preload="auto"
            className="absolute cursor-pointer rounded-full bg-black object-cover shadow-window"
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
              // Step 2.10: at the end it closes by itself.
              onClose();
            }}
            onTimeUpdate={(e) => {
              if (seeking.current) return;
              const d = length();
              if (d) setPos(Math.min(1, e.currentTarget.currentTime / d));
            }}
            data-testid="circle-expanded-video"
          />
        ) : (
          <Spinner className="absolute inset-0 m-auto text-text-tertiary" />
        )}
        {!playing && src && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur" data-testid="circle-paused">
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
          data-gesture-owner="circle-seek"
        >
          <circle cx={outer / 2} cy={outer / 2} r={r} fill="none" stroke="rgba(127,114,255,0.22)" strokeWidth="6" />
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
        {/* Step 2.10: X at the top RIGHT of the ring. */}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("vibex.circle.collapse")}
          className="absolute flex size-10 items-center justify-center rounded-full bg-surface text-text shadow-float"
          style={{ left: outer / 2 + r * Math.cos(Math.PI / 4) - 20, top: outer / 2 - r * Math.sin(Math.PI / 4) - 20 }}
          data-testid="circle-collapse"
        >
          <RiCloseLine className="size-5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSpeed(nextSpeed(speed))}
          aria-label={t("vibex.circle.speed", { speed: `${speed}x` })}
          className="flex h-9 min-w-[56px] items-center justify-center rounded-full bg-surface px-3 text-[14px] font-semibold tabular-nums text-text shadow-tile"
          data-testid="circle-speed"
        >
          {speed}x
        </button>
        <span className="rounded-full bg-black/45 px-3 py-1 text-[12.5px] tabular-nums text-white" data-testid="circle-time">
          {formatDuration(pos * length() * 1000)} / {formatDuration(length() * 1000)}
        </span>
      </div>
    </motion.div>
  );
}
