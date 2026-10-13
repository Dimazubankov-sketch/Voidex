import { useEffect, useRef, useState } from "react";
import { RiCloseLine, RiPlayFill } from "@remixicon/react";
import type { VibexFileDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { useFileUrl } from "./data";

/**
 * Step 2.11: photos and videos of a message as one Telegram-like mosaic. One
 * outer radius, 2 px gaps, no frames and never an empty cell:
 *   1      one picture in its own proportions (within limits)
 *   2      side by side, 50 / 50
 *   3      one large on the left, two stacked on the right
 *   4      2 × 2
 *   5      two on top, three below
 *   6+     three and three; the last cell shows "+N" for the rest
 * Videos show a play mark and their length. An item being uploaded is dimmed
 * with its progress ring and an X; cancelling it rebuilds the mosaic without
 * a hole. Pictures load only near the screen (IntersectionObserver).
 */

export interface MosaicItem {
  key: string;
  kind: "image" | "video";
  /** A sent file (loaded from the server)... */
  file?: VibexFileDto;
  /** ...or a local preview of a file still on this device. */
  localUrl?: string;
  /** 0..1 while uploading; undefined when done. */
  progress?: number;
  onCancel?: () => void;
  label?: string;
}

const MAX_CELLS = 6;

export function MediaMosaic({ items, onOpen, className, testId = "media-mosaic" }: { items: MosaicItem[]; onOpen?: (index: number) => void; className?: string; testId?: string }) {
  const n = items.length;
  const shown = items.slice(0, MAX_CELLS);
  const rest = n - MAX_CELLS;
  const [ratio, setRatio] = useState<number | null>(null);
  if (!n) return null;
  const layout = n === 1 ? "one" : n === 2 ? "two" : n === 3 ? "three" : n === 4 ? "four" : n === 5 ? "five" : "six";
  // Grid cells per layout (6 columns make 2 / 3 per row possible).
  const span = (i: number) => {
    switch (layout) {
      case "two":
        return "col-span-3";
      case "three":
        return i === 0 ? "col-span-4 row-span-2" : "col-span-2";
      case "four":
        return "col-span-3";
      case "five":
        return i < 2 ? "col-span-3" : "col-span-2";
      case "six":
        return "col-span-2";
      default:
        return "col-span-6";
    }
  };
  const box =
    layout === "one"
      ? undefined
      : layout === "two"
        ? "aspect-[2/1.15]"
        : layout === "three"
          ? "aspect-[1.15/1] grid-rows-2"
          : layout === "four"
            ? "aspect-square grid-rows-2"
            : layout === "five"
              ? "aspect-[1/0.92] grid-rows-[1.2fr_1fr]"
              : "aspect-[3/2] grid-rows-2";
  // One picture keeps its own proportions, between 3:4 (portrait) and 16:10 (landscape).
  const single = ratio ? Math.max(0.75, Math.min(1.6, ratio)) : 4 / 3;
  return (
    <div
      className={cx("grid w-[min(300px,100%)] grid-cols-6 gap-[2px] overflow-hidden rounded-[18px] bg-black/[0.04]", box, className)}
      style={layout === "one" ? { aspectRatio: String(single) } : undefined}
      data-testid={testId}
      data-layout={layout}
      data-count={n}
    >
      {shown.map((it, i) => (
        <Tile
          key={it.key}
          item={it}
          className={span(i)}
          more={i === MAX_CELLS - 1 && rest > 0 ? rest + 1 : 0}
          onOpen={onOpen ? () => onOpen(i) : undefined}
          onRatio={layout === "one" ? setRatio : undefined}
        />
      ))}
    </div>
  );
}

function Tile({ item, className, more, onOpen, onRatio }: { item: MosaicItem; className: string; more: number; onOpen?: () => void; onRatio?: (r: number) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(!!item.localUrl);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const { data: remote } = useFileUrl(near && item.file && !item.localUrl ? item.file.id : null);
  const src = item.localUrl ?? remote;
  const [duration, setDuration] = useState<number | null>(null);
  const uploading = item.progress !== undefined;
  return (
    <div ref={ref} className={cx("relative min-h-0 overflow-hidden bg-surface-secondary", className)} data-testid="mosaic-tile" data-kind={item.kind} data-uploading={uploading || undefined}>
      <button type="button" onClick={onOpen} disabled={uploading || !onOpen} className="absolute inset-0 block size-full" aria-label={item.label ?? item.file?.filename ?? ""}>
        {src &&
          (item.kind === "video" ? (
            <video
              src={src}
              muted
              playsInline
              preload="metadata"
              className="size-full object-cover"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (Number.isFinite(v.duration)) setDuration(v.duration);
                if (v.videoWidth && v.videoHeight) onRatio?.(v.videoWidth / v.videoHeight);
              }}
            />
          ) : (
            <img
              src={src}
              alt=""
              loading="lazy"
              draggable={false}
              className="size-full object-cover"
              onLoad={(e) => e.currentTarget.naturalHeight && onRatio?.(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
            />
          ))}
      </button>
      {item.kind === "video" && !uploading && (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-0.5 rounded-full bg-black/50 py-0.5 pl-1 pr-1.5 text-[11px] font-medium tabular-nums text-white backdrop-blur" data-testid="mosaic-duration">
          <RiPlayFill className="size-3.5" />
          {duration !== null ? formatDuration(duration) : ""}
        </span>
      )}
      {!uploading && item.onCancel && (
        // In the composer: a sent-to-server file can still be taken out.
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            item.onCancel?.();
          }}
          className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
          aria-label={t("common.remove")}
          data-testid="mosaic-remove"
        >
          <RiCloseLine className="size-4" />
        </button>
      )}
      {more > 0 && !uploading && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 text-[22px] font-semibold text-white" data-testid="mosaic-more">
          +{more}
        </span>
      )}
      {uploading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/40 text-white" data-testid="mosaic-uploading">
          <span className="relative flex size-12 items-center justify-center">
            <ProgressRing value={item.progress ?? 0} />
            {item.onCancel && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  item.onCancel?.();
                }}
                className="absolute inset-[6px] flex items-center justify-center rounded-full bg-black/35 transition hover:bg-black/55"
                aria-label={t("vibex.upload.cancel")}
                data-testid="mosaic-cancel"
              >
                <RiCloseLine className="size-5" />
              </button>
            )}
          </span>
          <span className="rounded-full bg-black/35 px-2 py-0.5 text-[11px] font-medium tabular-nums" data-testid="mosaic-progress">
            {t("vibex.upload.loading")} {Math.round((item.progress ?? 0) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

/** A thin ring that fills with the upload (0..1). */
export function ProgressRing({ value, size = 48, stroke = 3 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="white"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.02, Math.min(1, value)))}
        style={{ transition: "stroke-dashoffset 160ms linear" }}
      />
    </svg>
  );
}

function formatDuration(s: number) {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
