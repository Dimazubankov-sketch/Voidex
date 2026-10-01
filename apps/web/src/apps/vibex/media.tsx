import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { RiArrowLeftSLine, RiArrowRightSLine, RiCloseLine, RiDownload2Line, RiFileLine, RiFileTextLine, RiFileZipLine, RiFilmLine, RiMusic2Line } from "@remixicon/react";
import type { VibexFileDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useLanguage, useT } from "@/lib/i18n";
import { formatBytes } from "@/apps/mail/attachments";
import { Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { saveFile, useFileUrl } from "./data";

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

/** 1–10 pictures: one large, or a tidy grid. Click opens the viewer. */
export function MediaGrid({ media, className }: { media: VibexFileDto[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const images = media.filter((m) => m.kind === "image");
  if (!images.length) return null;
  const n = images.length;
  return (
    <>
      <div
        className={cx("grid gap-1 overflow-hidden rounded-2xl", n === 1 ? "grid-cols-1" : n === 2 || n === 4 ? "grid-cols-2" : "grid-cols-3", className)}
        data-testid="vibex-media"
      >
        {images.map((m, i) => (
          <VibexImage
            key={m.id}
            file={m}
            onClick={() => setOpen(i)}
            className={cx(n === 1 ? "aspect-[4/3] max-h-[420px] w-full" : "aspect-square w-full", n === 3 && i === 0 && "col-span-3 aspect-[16/9]")}
          />
        ))}
      </div>
      <Lightbox files={images} index={open} onIndex={setOpen} />
    </>
  );
}

export function Lightbox({ files, index, onIndex }: { files: VibexFileDto[]; index: number | null; onIndex: (i: number | null) => void }) {
  const t = useT();
  const file = index === null ? null : files[index];
  const { data: src } = useFileUrl(file?.id ?? null);
  return createPortal(
    <AnimatePresence>
      {file && (
        <motion.div
          className="fixed inset-0 z-[260] flex items-center justify-center bg-[rgba(10,10,18,0.86)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => onIndex(null)}
          data-testid="vibex-lightbox"
        >
          {src ? (
            <motion.img
              key={file.id}
              src={src}
              alt=""
              className="max-h-[88dvh] max-w-[94vw] rounded-xl object-contain shadow-window"
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            />
          ) : (
            <Spinner className="text-white" />
          )}
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
            <button className="pressable flex size-10 items-center justify-center rounded-full bg-white/12 text-white" aria-label={t("common.close")} onClick={() => onIndex(null)}>
              <RiCloseLine className="size-6" />
            </button>
          </div>
          {files.length > 1 && (
            <>
              <button
                className="pressable absolute left-3 flex size-11 items-center justify-center rounded-full bg-white/12 text-white disabled:opacity-30"
                aria-label={t("common.back")}
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onIndex(Math.max(0, index! - 1));
                }}
              >
                <RiArrowLeftSLine className="size-7" />
              </button>
              <button
                className="pressable absolute right-3 flex size-11 items-center justify-center rounded-full bg-white/12 text-white disabled:opacity-30"
                aria-label={t("common.next")}
                disabled={index === files.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onIndex(Math.min(files.length - 1, index! + 1));
                }}
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
