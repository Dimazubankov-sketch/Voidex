import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { RiCloseLine, RiPlayFill } from "@remixicon/react";
import type { VibexFileDto } from "@voidex/shared";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { useFileUrl, useVibexMe } from "./data";
import { takeOver, type PlaybackMeta } from "./media-bubbles";
import { claimPlayback, pausedPlayback, releasePlayback } from "./playback";
import { usePinch } from "./pinch";
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
 *
 * Step 2.12: the circle is a circle in every frame. Its box never changes
 * size while it moves: it is laid out at its final size, square (aspect 1),
 * clipped by `clip-path: circle(50%)` and a 50% radius, and only `transform`
 * (scale, translate) animates from where the small circle was. Nothing
 * animates width / height / border-radius; the video inside fills it with
 * object-fit: cover and has its own transform (the zoom).
 */
export function CircleBubble({ file, durationMs, playback }: { file: VibexFileDto; durationMs: number | null; playback?: PlaybackMeta }) {
  const t = useT();
  const autoplay = useVibexMe().data?.settings.media.autoplay ?? true;
  const [box, near] = useNearViewport<HTMLDivElement>();
  const { data: src } = useFileUrl(near ? file.id : null);
  const video = useRef<HTMLVideoElement>(null);
  const small = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<DOMRect | null>(null);
  const size = SMALL;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (near && autoplay && !open) void v.play().catch(() => undefined);
    else v.pause();
  }, [near, autoplay, open, src]);

  return (
    <div ref={box} className="relative shrink-0" data-gesture-owner="circle-seek">
      {open ? (
        <InlineCircle file={file} src={src ?? null} durationMs={durationMs} from={open} onClose={() => setOpen(null)} playback={playback} />
      ) : (
        <button
          ref={small}
          type="button"
          onClick={() => setOpen(small.current?.getBoundingClientRect() ?? new DOMRect())}
          aria-label={t("vibex.circle.play")}
          className="relative block aspect-square shrink-0 overflow-hidden rounded-full bg-black/80 [clip-path:circle(50%_at_50%_50%)] [isolation:isolate]"
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
              className="absolute inset-0 size-full rounded-full object-cover"
              data-testid="circle-preview-video"
            />
          ) : (
            <span className="flex size-full items-center justify-center">
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

/** The small circle in the chat (px). */
const SMALL = 208;
const GROW = { type: "spring", stiffness: 380, damping: 36, mass: 0.9 } as const;

/**
 * The opened circle, in place: larger, with sound, the progress ring around
 * it (drag along it to seek), X at the top right of the ring, the speed
 * under it (1x → 1.5x → 2x, kept while Vibex is open). A tap on the video
 * plays / pauses; at the end it closes by itself.
 */
function InlineCircle({ file, src, durationMs, from, onClose, playback }: { file: VibexFileDto; src: string | null; durationMs: number | null; from: DOMRect; onClose: () => void; playback?: PlaybackMeta }) {
  const t = useT();
  /** Update 2 · C8: the playing element, released when this view goes. */
  const played0 = useRef<HTMLMediaElement | null>(null);
  useEffect(
    () => () => {
      if (played0.current) releasePlayback(played0.current);
    },
    [],
  );
  const reduced = useReducedMotion();
  // Step 2.12: the move from the small circle: transform only (see CircleBubble).
  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const chrome = useMotionValue(0);
  const height = useMotionValue<number | "auto">(SMALL);
  const start = useRef({ scale: 1, x: 0, y: 0 });
  const closing = useRef(false);
  const speed = useVibex((s) => s.circleSpeed);
  const setSpeed = useVibex((s) => s.setCircleSpeed);
  const video = useRef<HTMLVideoElement>(null);
  const ring = useRef<SVGSVGElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const seeking = useRef(false);
  // Step 2.11: the knob shows while the ring is dragged (Telegram-like).
  const [dragging, setDragging] = useState(false);
  // Step 2.11: two fingers zoom the picture inside the circle (the circle keeps its size), never below 1x.
  const face = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const pinching = useRef(false);
  usePinch(face, {
    enabled: true,
    begin: () => {
      pinching.current = true;
      return zoomRef.current;
    },
    change: (z) => setZoom(Math.max(1, Math.min(4, z))),
    end: () => {
      pinching.current = false;
    },
  });
  // As large as the chat allows (never wider than the message column); known before the first frame.
  const [size, setSize] = useState(() => Math.max(200, Math.min(window.innerWidth - 120, 320)));
  const pad = 22;
  const outer = size + pad * 2;
  // Step 2.11: the seek ring lies inside the circle's edge, thin and grey.
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const length = () => {
    const v = video.current;
    return v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (durationMs ?? 0) / 1000;
  };

  // Before the first frame at the final size: start exactly where the small circle was, then grow.
  const sized = useRef(false);
  useLayoutEffect(() => {
    if (sized.current || !face.current || !root.current) return;
    const host = root.current.closest<HTMLElement>('[data-testid="messages"]');
    const fit = Math.max(200, Math.min((host?.clientWidth ?? window.innerWidth) - 120, 320));
    if (fit !== size) return setSize(fit); // laid out again at that size, still before the first frame
    sized.current = true;
    const b = face.current.getBoundingClientRect();
    const from0 = { scale: SMALL / size, x: from.left + from.width / 2 - (b.left + b.width / 2), y: from.top + from.height / 2 - (b.top + b.height / 2) };
    start.current = from0;
    const full = root.current.scrollHeight;
    if (reduced || !from.width) {
      height.set("auto");
      chrome.set(1);
      return;
    }
    scale.set(from0.scale);
    x.set(from0.x);
    y.set(from0.y);
    height.set(SMALL);
    void animate(scale, 1, GROW);
    void animate(x, 0, GROW);
    void animate(y, 0, GROW);
    void animate(height as unknown as ReturnType<typeof useMotionValue<number>>, full, { ...GROW, onComplete: () => height.set("auto") });
    void animate(chrome, 1, { duration: 0.18, delay: 0.12 });
  });
  /** Shrinks back into the small circle, then closes (one close, however many taps). */
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    video.current?.pause();
    if (reduced || !from.width) return onClose();
    const s0 = start.current;
    height.set(root.current?.scrollHeight ?? SMALL);
    void animate(chrome, 0, { duration: 0.1 });
    void animate(scale, s0.scale, GROW);
    void animate(x, s0.x, GROW);
    void animate(y, s0.y, GROW);
    void animate(height as unknown as ReturnType<typeof useMotionValue<number>>, SMALL, { ...GROW, onComplete: onClose });
  };
  useEffect(() => {
    // The chat keeps its place; the opened circle is brought fully into view.
    window.setTimeout(() => root.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }), 60);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
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

  const knob = { x: outer / 2 + r * Math.sin(pos * 2 * Math.PI), y: outer / 2 - r * Math.cos(pos * 2 * Math.PI) };
  return (
    <motion.div
      ref={root}
      className="relative flex flex-col items-center gap-2"
      style={{ height }}
      role="group"
      aria-label={t("vibex.circle.message")}
      data-testid="circle-expanded"
      data-file-id={file.id}
      data-playing={playing || undefined}
      data-speed={speed}
    >
      <div className="relative" style={{ width: outer, height: outer }}>
        <motion.div
          ref={face}
          className="absolute aspect-square touch-none overflow-hidden rounded-full bg-black shadow-window [clip-path:circle(50%_at_50%_50%)] [isolation:isolate]"
          style={{ left: pad, top: pad, width: size, height: size, scale, x, y, originX: 0.5, originY: 0.5 }}
          data-testid="circle-face"
          data-zoom={zoom.toFixed(2)}
        >
        {src ? (
          <video
            ref={video}
            src={src}
            playsInline
            preload="auto"
            className="absolute inset-0 size-full cursor-pointer object-cover"
            style={{ transform: zoom > 1 ? `scale(${zoom})` : undefined }}
            onClick={toggle}
            onPlay={(e) => {
              takeOver(e.currentTarget);
              played0.current = e.currentTarget;
              if (playback) claimPlayback({ ...playback, kind: "circle", el: e.currentTarget });
              setPlaying(true);
            }}
            onPause={(e) => {
              setPlaying(false);
              pausedPlayback(e.currentTarget);
            }}
            onEnded={(e) => {
              releasePlayback(e.currentTarget);
              setPlaying(false);
              setPos(1);
              // Step 2.10: at the end it closes by itself; Step 2.12: not while the picture is being zoomed (it stops at the end).
              if (!pinching.current && zoomRef.current <= 1) close();
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
        </motion.div>
        {!playing && src && (
          <motion.span className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ opacity: chrome }}>
            <span className="flex size-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur" data-testid="circle-paused">
              <RiPlayFill className="size-8" />
            </span>
          </motion.span>
        )}
        {/* The progress ring: drag along it to seek. */}
        <motion.svg
          style={{ opacity: chrome }}
          ref={ring}
          className="pointer-events-none absolute inset-0 touch-none rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
          <circle cx={outer / 2} cy={outer / 2} r={r} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="3" data-testid="circle-ring-track-line" />
          <circle
            cx={outer / 2}
            cy={outer / 2}
            r={r}
            fill="none"
            stroke="rgba(236,236,242,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pos)}
            transform={`rotate(-90 ${outer / 2} ${outer / 2})`}
            data-testid="circle-ring-progress"
          />
          {/* The knob: only while seeking. */}
          <circle
            cx={knob.x}
            cy={knob.y}
            r={dragging ? 8 : 0}
            fill="#ffffff"
            style={{ transition: "r 140ms ease", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))" }}
            data-testid="circle-knob"
            data-visible={dragging || undefined}
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
              try {
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
              } catch {
                /* gone */
              }
              seeking.current = true;
              setDragging(true);
              seekAt(e);
            }}
            onPointerMove={(e) => seeking.current && seekAt(e)}
            onPointerUp={() => ((seeking.current = false), setDragging(false))}
            onPointerCancel={() => ((seeking.current = false), setDragging(false))}
            data-testid="circle-ring-track"
          />
        </motion.svg>
        {/* Step 2.10: X at the top RIGHT of the ring. */}
        <motion.button
          type="button"
          onClick={close}
          aria-label={t("vibex.circle.collapse")}
          className="absolute flex size-10 items-center justify-center rounded-full bg-surface text-text shadow-float"
          style={{ left: outer / 2 + (size / 2 + 6) * Math.cos(Math.PI / 4) - 20, top: outer / 2 - (size / 2 + 6) * Math.sin(Math.PI / 4) - 20, opacity: chrome }}
          data-testid="circle-collapse"
        >
          <RiCloseLine className="size-5" />
        </motion.button>
      </div>
      <motion.div className="flex items-center gap-2" style={{ opacity: chrome }}>
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
      </motion.div>
    </motion.div>
  );
}
