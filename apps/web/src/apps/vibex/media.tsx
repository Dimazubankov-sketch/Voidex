import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { RiArrowLeftSLine, RiArrowRightSLine, RiCloseLine, RiDownload2Line, RiFileLine, RiFileTextLine, RiFileZipLine, RiFilmLine, RiFolderOpenLine, RiMusic2Line, RiPlayFill, RiVolumeMuteFill, RiVolumeUpFill } from "@remixicon/react";
import { wrapIndex, type VibexFileDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useLanguage, useT } from "@/lib/i18n";
import { formatBytes } from "@/apps/mail/attachments";
import { Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { opensInFiles, openInFiles } from "@/os/share/open-in-files";
import { filesApi, saveFile, useFileUrl, useVibexMe } from "./data";

function FileIcon({ mime, className }: { mime: string; className?: string }) {
  if (mime.startsWith("video/")) return <RiFilmLine className={className} />;
  if (mime.startsWith("audio/")) return <RiMusic2Line className={className} />;
  if (/zip|rar|7z|gzip/.test(mime)) return <RiFileZipLine className={className} />;
  if (/pdf|text|word|document|sheet|presentation|rtf|markdown|csv/.test(mime)) return <RiFileTextLine className={className} />;
  return <RiFileLine className={className} />;
}

export function VibexImage({ file, className, onClick, fit = "cover" }: { file: VibexFileDto; className?: string; onClick?: () => void; fit?: "cover" | "contain" }) {
  const { data: src, isError } = useFileUrl(file.id);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("relative block overflow-hidden bg-surface-secondary", className)}
      aria-label={file.filename}
      data-testid="vibex-image"
    >
      {src ? (
        <img
          src={src}
          alt=""
          className={cx("size-full", fit === "contain" ? "object-contain" : "object-cover")}
          draggable={false}
          onLoad={(e) => noteRatio(file.id, e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight))}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-text-tertiary">{isError ? <RiFileLine className="size-6" /> : <Spinner />}</span>
      )}
    </button>
  );
}

/** Download chip for non-image files; .txt / .prsn also open in Files. */
export function FileChip({ file, tone = "default" }: { file: VibexFileDto; tone?: "default" | "mine" }) {
  const t = useT();
  const lang = useLanguage();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex w-full min-w-0 max-w-[280px] items-center gap-1">
      <button
        type="button"
        onClick={() => void run(() => saveFile(file))}
        className={cx(
          "pressable flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 text-left",
          tone === "mine" ? "bg-white/18 text-white" : "bg-surface-secondary",
        )}
        title={t("vibex.media.download")}
        data-testid="vibex-file"
      >
        <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-xl", tone === "mine" ? "bg-white/20" : "bg-surface text-text-secondary")}>
          {busy ? <Spinner size={16} /> : <FileIcon mime={file.mimeType} className="size-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{file.filename}</span>
          <span className={cx("block text-[12px]", tone === "mine" ? "text-white/75" : "text-text-tertiary")}>{formatBytes(file.size, lang)}</span>
        </span>
        <RiDownload2Line className={cx("size-4 shrink-0", tone === "mine" ? "text-white/80" : "text-text-tertiary")} />
      </button>
      {opensInFiles(file.filename) && (
        <button
          type="button"
          onClick={() => void run(async () => openInFiles(file.filename, await filesApi.blob(file.id)))}
          className={cx("pressable grid size-10 shrink-0 place-items-center rounded-2xl", tone === "mine" ? "bg-white/18 text-white" : "bg-surface-secondary text-text-secondary")}
          aria-label={t("files.openInFiles")}
          title={t("files.openInFiles")}
          data-testid="vibex-file-open-files"
        >
          <RiFolderOpenLine className="size-[18px]" />
        </button>
      )}
    </span>
  );
}

/** A video from Vibex: shown from a blob URL (fetched with the access token). */
export function VibexVideoTile({ file, className, onClick, autoplay }: { file: VibexFileDto; className?: string; onClick?: () => void; autoplay?: boolean }) {
  const { data: src, isError } = useFileUrl(file.id);
  return (
    <button type="button" onClick={onClick} className={cx("relative block overflow-hidden bg-black/80", className)} aria-label={file.filename} data-testid="vibex-video">
      {src ? (
        <video src={src} className="size-full object-cover" muted playsInline loop autoPlay={autoplay} preload="metadata" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-white/70">{isError ? <RiFilmLine className="size-6" /> : <Spinner className="text-white" />}</span>
      )}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur">
          <RiPlayFill className="size-6" />
        </span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------- shapes (Update 3 · F1)

/**
 * Update 3 · F1 (SR5136): a picture or a video keeps its own shape in the feed: square (1:1), wide
 * (16:9) or tall like a phone screen (9:16). Tall ones are as high as the card allows (520 px) and as
 * wide as that height needs, so a feed of them stays calm. The frame crops a little at most; the file
 * itself is never changed, and the viewer shows it whole.
 *
 * The shape is learned from the file once it loads (the server keeps no sizes) and remembered for the
 * session, so a post never jumps twice.
 */
export type MediaShape = "square" | "wide" | "tall";
const ratios = new Map<string, number>();
const ratioListeners = new Set<() => void>();
export function noteRatio(id: string, r: number) {
  if (!Number.isFinite(r) || r <= 0 || Math.abs((ratios.get(id) ?? 0) - r) < 0.01) return;
  ratios.set(id, r);
  ratioListeners.forEach((f) => f());
}
export function shapeOf(r: number | undefined): MediaShape {
  if (r === undefined) return "square";
  return r >= 1.25 ? "wide" : r <= 0.8 ? "tall" : "square";
}
export function useShape(id: string | undefined): MediaShape {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    ratioListeners.add(f);
    return () => {
      ratioListeners.delete(f);
    };
  }, []);
  return shapeOf(id ? ratios.get(id) : undefined);
}
/** The frame of one media item of that shape (tall: 9:16 up to 520 px high, then narrower). */
const TALL_MAX_H = 520;
function frameStyle(shape: MediaShape, carousel = false): CSSProperties {
  if (shape === "wide") return { aspectRatio: "16 / 9", width: "100%" };
  // In a carousel every slide shares one frame: a tall one is 4:5 there (the slides stay full width).
  if (shape === "tall") return carousel ? { aspectRatio: "4 / 5", width: "100%", maxHeight: TALL_MAX_H } : { aspectRatio: "9 / 16", width: `min(100%, ${Math.round((TALL_MAX_H * 9) / 16)}px)` };
  return { aspectRatio: "1 / 1", width: "100%" };
}

// ------------------------------------------------------------- videos (Update 3 · F3)

/** F3: only one feed video has sound at a time. */
let soundOwner: HTMLVideoElement | null = null;
function takeSound(v: HTMLVideoElement) {
  if (soundOwner && soundOwner !== v) {
    soundOwner.muted = true;
    soundOwner.dispatchEvent(new Event("vx-muted"));
  }
  soundOwner = v;
}

function formatClock(s: number) {
  if (!Number.isFinite(s) || s <= 0) return "";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/**
 * F3: a video in a post. Its own shape (no stretched frames). With autoplay on it plays muted while most
 * of it is on screen and pauses when it scrolls away; otherwise a clear play button. The sound button
 * turns this one's sound on (any other feed video goes quiet); a tap opens it large with sound.
 * The controls fade in; the remaining time shows in the corner.
 */
export function PostVideo({ file, onOpen, autoplay, style, className }: { file: VibexFileDto; onOpen?: () => void; autoplay: boolean; style?: CSSProperties; className?: string }) {
  const t = useT();
  const { data: src, isError } = useFileUrl(file.id);
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [left, setLeft] = useState("");
  useEffect(() => {
    const el = box.current;
    const v = video.current;
    if (!el || !v || !src) return;
    if (!autoplay) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        if (e.intersectionRatio >= 0.6) void v.play().catch(() => undefined);
        else v.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src, autoplay]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const quiet = () => setMuted(true);
    v.addEventListener("vx-muted", quiet);
    return () => {
      v.removeEventListener("vx-muted", quiet);
      if (soundOwner === v) soundOwner = null;
    };
  }, [src]);
  return (
    <div ref={box} className={cx("group relative overflow-hidden bg-black", className)} style={style} data-testid="vibex-video" data-playing={playing || undefined} data-shape={shapeOf(ratios.get(file.id))}>
      {src ? (
        <video
          ref={video}
          src={src}
          className="size-full object-cover"
          muted={muted}
          playsInline
          loop
          preload="metadata"
          onLoadedMetadata={(e) => {
            noteRatio(file.id, e.currentTarget.videoWidth / Math.max(1, e.currentTarget.videoHeight));
            setLeft(formatClock(e.currentTarget.duration));
          }}
          onTimeUpdate={(e) => setLeft(formatClock(e.currentTarget.duration - e.currentTarget.currentTime))}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          data-testid="vibex-video-el"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-white/70">{isError ? <RiFilmLine className="size-6" /> : <Spinner className="text-white" />}</span>
      )}
      {/* A tap anywhere opens it large (with sound and full controls). */}
      <button type="button" onClick={onOpen} className="absolute inset-0" aria-label={file.filename} data-testid="vibex-video-open" />
      <AnimatePresence>
        {!playing && (
          <motion.span
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.08 }}
            transition={{ duration: 0.18 }}
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur" data-testid="vibex-video-play">
              <RiPlayFill className="ml-0.5 size-8" />
            </span>
          </motion.span>
        )}
      </AnimatePresence>
      {left && <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[12px] font-medium tabular-nums text-white">{left}</span>}
      {src && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const v = video.current;
            if (!v) return;
            const next = !muted;
            if (!next) takeSound(v);
            v.muted = next;
            setMuted(next);
            if (v.paused) void v.play().catch(() => undefined);
          }}
          aria-label={muted ? t("vibex.media.soundOn") : t("vibex.media.soundOff")}
          aria-pressed={!muted}
          className="absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/50 text-white transition-opacity"
          data-testid="vibex-video-sound"
        >
          {muted ? <RiVolumeMuteFill className="size-[18px]" /> : <RiVolumeUpFill className="size-[18px]" />}
        </button>
      )}
    </div>
  );
}

/**
 * A post's pictures / videos. One: in its own shape (F1). Several (F2): a carousel — 1 → 2 → 3 → 1 …
 * and back — swiped with a finger or dragged with the mouse (arrows on hover, ← → keys). All slides
 * share the first one's frame, so nothing jumps while going through them. Only three slides exist in
 * the page at any time. A tap opens the viewer (the whole file) on that item.
 */
export function MediaGrid({ media, className }: { media: VibexFileDto[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const autoplay = useVibexMe().data?.settings.media.autoplay ?? true;
  const items = media.filter((m) => m.kind === "image" || m.kind === "video");
  const shape = useShape(items[0]?.id);
  if (!items.length) return null;
  const one = items[0]!;
  return (
    <>
      {items.length === 1 ? (
        <div className={cx("overflow-hidden rounded-2xl", className)} style={frameStyle(shape)} data-testid="vibex-media" data-shape={shape}>
          {one.kind === "video" ? (
            <PostVideo file={one} onOpen={() => setOpen(0)} className="size-full" autoplay={autoplay} />
          ) : (
            <VibexImage file={one} onClick={() => setOpen(0)} className="size-full" />
          )}
        </div>
      ) : (
        <MediaCarousel items={items} onOpen={setOpen} autoplay={autoplay} className={className} shape={shape} />
      )}
      <Lightbox files={items} index={open} onIndex={setOpen} />
    </>
  );
}

const SLIDE_EASE = [0.22, 1, 0.36, 1] as const;

function MediaCarousel({ items, onOpen, autoplay, className, shape }: { items: VibexFileDto[]; onOpen: (i: number) => void; autoplay: boolean; className?: string; shape: MediaShape }) {
  const t = useT();
  const n = items.length;
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const busy = useRef(false);
  const dragged = useRef(false);
  // The counter shows while going through the photos, then fades (the dots stay).
  const [counter, setCounter] = useState(false);
  const counterTimer = useRef<number | undefined>(undefined);
  const flashCounter = () => {
    setCounter(true);
    window.clearTimeout(counterTimer.current);
    counterTimer.current = window.setTimeout(() => setCounter(false), 1400);
  };
  useEffect(() => () => window.clearTimeout(counterTimer.current), []);
  const width = () => box.current?.clientWidth ?? 1;
  /** Slides one step (−1 back, +1 forward) and wraps the index; the three slides are re-used. */
  const step = (dir: -1 | 1) => {
    if (busy.current) return;
    busy.current = true;
    flashCounter();
    void animate(x, -dir * width(), { duration: 0.3, ease: SLIDE_EASE }).then(() => {
      setIndex((i) => wrapIndex(i + dir, n));
      x.set(0);
      busy.current = false;
    });
  };
  const slide = (offset: -1 | 0 | 1) => {
    const f = items[wrapIndex(index + offset, n)]!;
    const open = () => !dragged.current && onOpen(wrapIndex(index + offset, n));
    return (
      <div key={`${offset}:${f.id}`} className="absolute inset-0" style={{ left: `${offset * 100}%` }} aria-hidden={offset !== 0} data-slide={offset}>
        {f.kind === "video" ? <PostVideo file={f} className="size-full" autoplay={offset === 0 && autoplay} onOpen={open} /> : <VibexImage file={f} className="size-full" onClick={open} />}
      </div>
    );
  };
  return (
    <div
      ref={box}
      className={cx("group relative touch-pan-y select-none overflow-hidden rounded-2xl bg-surface-secondary", className)}
      style={frameStyle(shape, true)}
      role="region"
      aria-roledescription="carousel"
      aria-label={t("vibex.media.carousel", { n })}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        else if (e.key === "ArrowLeft") step(-1);
        else return;
        e.preventDefault();
      }}
      data-testid="vibex-media"
      data-carousel
      data-gesture-owner
      data-index={index}
      data-shape={shape}
    >
      <motion.div
        className="absolute inset-0"
        style={{ x }}
        onPanStart={() => {
          dragged.current = true;
          flashCounter();
        }}
        onPan={(_, info) => {
          if (!busy.current) x.set(info.offset.x);
        }}
        onPanEnd={(_, info) => {
          window.setTimeout(() => (dragged.current = false), 0);
          if (busy.current) return;
          const w = width();
          if (info.offset.x < -w * 0.18 || info.velocity.x < -450) step(1);
          else if (info.offset.x > w * 0.18 || info.velocity.x > 450) step(-1);
          else void animate(x, 0, { duration: 0.24, ease: SLIDE_EASE });
        }}
      >
        {slide(-1)}
        {slide(0)}
        {slide(1)}
      </motion.div>
      <span
        className={cx("pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-black/45 px-2 py-0.5 text-[12px] font-medium tabular-nums text-white transition-opacity duration-300", counter ? "opacity-100" : "opacity-0")}
        data-testid="carousel-counter"
      >
        {index + 1} / {n}
      </span>
      <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5" aria-hidden data-testid="carousel-dots">
        {items.map((m, i) => (
          <span key={m.id} className={cx("h-1.5 rounded-full transition-all duration-300", i === index ? "w-3.5 bg-white" : "w-1.5 bg-white/55")} />
        ))}
      </div>
      {(["prev", "next"] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => step(k === "next" ? 1 : -1)}
          aria-label={t(k === "next" ? "vibex.media.next" : "vibex.media.previous")}
          className={cx(
            "absolute top-1/2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:flex",
            k === "next" ? "right-2.5" : "left-2.5",
          )}
          data-testid={`carousel-${k}`}
        >
          {k === "next" ? <RiArrowRightSLine className="size-6" /> : <RiArrowLeftSLine className="size-6" />}
        </button>
      ))}
    </div>
  );
}

/** Step 2.9: a post's Files attachments (download / open in Files), under its media. */
export function PostFiles({ media, className }: { media: VibexFileDto[]; className?: string }) {
  const files = media.filter((m) => m.kind === "file" || m.kind === "audio");
  if (!files.length) return null;
  return (
    <div className={cx("flex flex-col gap-1.5", className)} data-testid="post-files">
      {files.map((f) => (
        <FileChip key={f.id} file={f} />
      ))}
    </div>
  );
}

/**
 * The media viewer: pictures and videos of one post or of a profile gallery.
 *   phone  swipe left / right between items, tap outside to close
 *   PC     arrow buttons and keyboard ← →, Esc closes
 * No author caption over the picture — the context (post, profile) is known.
 */
export function Lightbox({ files, index, onIndex }: { files: VibexFileDto[]; index: number | null; onIndex: (i: number | null) => void }) {
  const t = useT();
  const file = index === null ? null : files[index];
  const { data: src } = useFileUrl(file?.id ?? null);
  const autoplay = useVibexMe().data?.settings.media.autoplay ?? true;
  const go = (d: number) => index !== null && onIndex(Math.max(0, Math.min(files.length - 1, index + d)));

  useEffect(() => {
    if (index === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "Escape") onIndex(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  return createPortal(
    <AnimatePresence>
      {file && (
        <motion.div
          className="fixed inset-0 z-[260] flex items-center justify-center bg-[rgba(10,10,18,0.9)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => onIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t("vibex.media.viewer")}
          data-testid="vibex-lightbox"
          data-index={index}
        >
          <motion.div
            key={file.id}
            className="flex max-h-[88dvh] max-w-[94vw] touch-pan-y items-center justify-center"
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            drag={files.length > 1 ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.6}
            onDragEnd={(_, info) => {
              if (info.offset.x < -80 || info.velocity.x < -500) go(1);
              else if (info.offset.x > 80 || info.velocity.x > 500) go(-1);
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid="vibex-lightbox-item"
          >
            {!src ? (
              <Spinner className="text-white" />
            ) : file.kind === "video" ? (
              <video src={src} className="max-h-[88dvh] max-w-[94vw] rounded-xl shadow-window" controls playsInline autoPlay={autoplay} data-testid="vibex-lightbox-video" />
            ) : (
              <img src={src} alt="" className="pointer-events-none max-h-[88dvh] max-w-[94vw] rounded-xl object-contain shadow-window" draggable={false} />
            )}
          </motion.div>
          <div className="absolute right-3 top-[max(var(--safe-top),12px)] flex gap-2">
            <button
              className="pressable flex size-10 items-center justify-center rounded-full bg-white/12 text-white"
              aria-label={t("vibex.media.download")}
              onClick={(e) => {
                e.stopPropagation();
                void saveFile(file);
              }}
            >
              <RiDownload2Line className="size-5" />
            </button>
            <button className="pressable flex size-10 items-center justify-center rounded-full bg-white/12 text-white" aria-label={t("common.close")} onClick={() => onIndex(null)} data-testid="vibex-lightbox-close">
              <RiCloseLine className="size-6" />
            </button>
          </div>
          {files.length > 1 && (
            <>
              <span className="absolute bottom-[max(var(--safe-bottom),16px)] rounded-full bg-white/12 px-3 py-1 text-[13px] text-white/85">
                {index! + 1} / {files.length}
              </span>
              <button
                className="pressable absolute left-3 hidden size-11 items-center justify-center rounded-full bg-white/12 text-white disabled:opacity-30 sm:flex"
                aria-label={t("vibex.media.previous")}
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  go(-1);
                }}
                data-testid="vibex-lightbox-prev"
              >
                <RiArrowLeftSLine className="size-7" />
              </button>
              <button
                className="pressable absolute right-3 hidden size-11 items-center justify-center rounded-full bg-white/12 text-white disabled:opacity-30 sm:flex"
                aria-label={t("vibex.media.next")}
                disabled={index === files.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  go(1);
                }}
                data-testid="vibex-lightbox-next"
              >
                <RiArrowRightSLine className="size-7" />
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
