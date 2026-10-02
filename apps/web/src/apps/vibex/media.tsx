import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { RiArrowLeftSLine, RiArrowRightSLine, RiCloseLine, RiDownload2Line, RiFileLine, RiFileTextLine, RiFileZipLine, RiFilmLine, RiMusic2Line, RiPlayFill } from "@remixicon/react";
import type { VibexFileDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useLanguage, useT } from "@/lib/i18n";
import { formatBytes } from "@/apps/mail/attachments";
import { Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { saveFile, useFileUrl, useVibexMe } from "./data";

function FileIcon({ mime, className }: { mime: string; className?: string }) {
  if (mime.startsWith("video/")) return <RiFilmLine className={className} />;
  if (mime.startsWith("audio/")) return <RiMusic2Line className={className} />;
  if (/zip|rar|7z|gzip/.test(mime)) return <RiFileZipLine className={className} />;
  if (/pdf|text|word|document|sheet|presentation|rtf|markdown|csv/.test(mime)) return <RiFileTextLine className={className} />;
  return <RiFileLine className={className} />;
}

export function VibexImage({ file, className, onClick }: { file: VibexFileDto; className?: string; onClick?: () => void }) {
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
        <img src={src} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-text-tertiary">{isError ? <RiFileLine className="size-6" /> : <Spinner />}</span>
      )}
    </button>
  );
}

/** Download chip for non-image files. */
export function FileChip({ file, tone = "default" }: { file: VibexFileDto; tone?: "default" | "mine" }) {
  const t = useT();
  const lang = useLanguage();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        setBusy(true);
        try {
          await saveFile(file);
        } catch (e) {
          toast({ title: errorMessage(t, e), tone: "danger" });
        } finally {
          setBusy(false);
        }
      }}
      className={cx(
        "pressable flex w-full min-w-0 max-w-[280px] items-center gap-3 rounded-2xl px-3 py-2 text-left",
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

/** 1–10 pictures / videos: one large, or a tidy grid. Click opens the viewer. */
export function MediaGrid({ media, className }: { media: VibexFileDto[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const autoplay = useVibexMe().data?.settings.media.autoplay ?? true;
  const items = media.filter((m) => m.kind === "image" || m.kind === "video");
  if (!items.length) return null;
  const n = items.length;
  return (
    <>
      <div
        className={cx("grid gap-1 overflow-hidden rounded-2xl", n === 1 ? "grid-cols-1" : n === 2 || n === 4 ? "grid-cols-2" : "grid-cols-3", className)}
        data-testid="vibex-media"
      >
        {items.map((m, i) => {
          const cls = cx(n === 1 ? "aspect-[4/3] max-h-[420px] w-full" : "aspect-square w-full", n === 3 && i === 0 && "col-span-3 aspect-[16/9]");
          return m.kind === "video" ? (
            <VibexVideoTile key={m.id} file={m} onClick={() => setOpen(i)} className={cls} autoplay={autoplay} />
          ) : (
            <VibexImage key={m.id} file={m} onClick={() => setOpen(i)} className={cls} />
          );
        })}
      </div>
      <Lightbox files={items} index={open} onIndex={setOpen} />
    </>
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
