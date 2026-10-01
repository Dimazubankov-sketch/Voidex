import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RiCloseLine, RiDownload2Line, RiFileLine, RiFileTextLine, RiFileZipLine, RiFilmLine, RiImageLine, RiMusic2Line } from "@remixicon/react";
import {
  MAIL_ATTACHMENT_MAX_BYTES,
  MAIL_ATTACHMENT_TYPES,
  MAIL_INLINE_IMAGE_TYPES,
  attachmentMimeType,
  type MailAttachmentDto,
} from "@voidex/shared";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useLanguage, useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";

/** `accept` for the file picker: exactly the types the server accepts. */
export const ATTACHMENT_ACCEPT = Object.keys(MAIL_ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export function formatBytes(n: number, lang: string) {
  const units = ["byte", "kilobyte", "megabyte"] as const;
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  // Unit names in the interface language (Б / KB / Ko / КБ…).
  return new Intl.NumberFormat(lang, { style: "unit", unit: units[u], unitDisplay: "short", maximumFractionDigits: u === 0 ? 0 : 1 }).format(v);
}

function FileIcon({ mime, className }: { mime: string; className?: string }) {
  if (mime.startsWith("image/")) return <RiImageLine className={className} />;
  if (mime.startsWith("video/")) return <RiFilmLine className={className} />;
  if (mime.startsWith("audio/")) return <RiMusic2Line className={className} />;
  if (/zip|rar|7z|gzip/.test(mime)) return <RiFileZipLine className={className} />;
  if (/pdf|text|word|document|sheet|presentation|rtf|markdown|csv/.test(mime)) return <RiFileTextLine className={className} />;
  return <RiFileLine className={className} />;
}

export const attachmentsApi = {
  upload: (draftId: string, file: File) =>
    api.post<MailAttachmentDto>(`/api/mail/drafts/${draftId}/attachments`, file, {
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
    }),
  remove: (draftId: string, id: string) => api.delete(`/api/mail/drafts/${draftId}/attachments/${id}`),
  blob: (id: string) => api.get<Blob>(`/api/mail/attachments/${id}`),
};

/** Client-side check (the server re-validates everything). Returns an error key or null. */
export function checkFile(file: File): "attachment_type_not_allowed" | "attachment_too_large" | null {
  if (!attachmentMimeType(file.name)) return "attachment_type_not_allowed";
  if (file.size > MAIL_ATTACHMENT_MAX_BYTES) return "attachment_too_large";
  return null;
}

async function saveFile(a: MailAttachmentDto) {
  const blob = await attachmentsApi.blob(a.id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = a.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export type PendingUpload = { key: string; filename: string; size: number };

/** Composer: files already on the draft + ones still uploading. */
export function ComposerAttachments({
  items,
  pending,
  onRemove,
}: {
  items: MailAttachmentDto[];
  pending: PendingUpload[];
  onRemove: (a: MailAttachmentDto) => void;
}) {
  const t = useT();
  const lang = useLanguage();
  if (!items.length && !pending.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-3" data-testid="composer-attachments">
      {items.map((a) => (
        <span key={a.id} className="flex h-10 max-w-full items-center gap-2 rounded-2xl bg-surface-secondary pl-3 pr-1 animate-pop" data-testid="composer-attachment">
          <FileIcon mime={a.mimeType} className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 truncate text-[13px] font-medium">{a.filename}</span>
          <span className="shrink-0 text-[12px] text-text-tertiary">{formatBytes(a.size, lang)}</span>
          <button
            type="button"
            onClick={() => onRemove(a)}
            className="flex size-8 shrink-0 items-center justify-center rounded-xl text-text-secondary hover:bg-surface-hover"
            aria-label={t("mail.attachmentRemove", { name: a.filename })}
            data-testid="composer-attachment-remove"
          >
            <RiCloseLine className="size-4" />
          </button>
        </span>
      ))}
      {pending.map((p) => (
        <span key={p.key} className="flex h-10 max-w-full items-center gap-2 rounded-2xl bg-surface-secondary px-3 text-text-secondary">
          <Spinner size={14} />
          <span className="min-w-0 truncate text-[13px]">{p.filename}</span>
          <span className="shrink-0 text-[12px] text-text-tertiary">{formatBytes(p.size, lang)}</span>
        </span>
      ))}
    </div>
  );
}

function ImagePreview({ a }: { a: MailAttachmentDto }) {
  const t = useT();
  const q = useQuery({
    queryKey: ["mail", "attachment", a.id],
    queryFn: async () => URL.createObjectURL(await attachmentsApi.blob(a.id)),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
  return (
    <button
      type="button"
      onClick={() => void saveFile(a).catch((e) => toast({ title: errorMessage(t, e), tone: "danger" }))}
      className="relative block overflow-hidden rounded-2xl border bg-surface-secondary"
      title={a.filename}
      data-testid="message-attachment-image"
    >
      {q.data ? (
        <img src={q.data} alt={a.filename} className="h-40 max-w-[260px] object-cover" loading="lazy" />
      ) : (
        <span className="flex h-40 w-40 items-center justify-center">
          <Spinner />
        </span>
      )}
    </button>
  );
}

/** Message view: image previews and file chips; everything downloads on tap. */
export function MessageAttachments({ items }: { items: MailAttachmentDto[] }) {
  const t = useT();
  const lang = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) return null;
  const images = items.filter((a) => MAIL_INLINE_IMAGE_TYPES.includes(a.mimeType));
  const files = items.filter((a) => !MAIL_INLINE_IMAGE_TYPES.includes(a.mimeType));
  const download = async (a: MailAttachmentDto) => {
    setBusy(a.id);
    try {
      await saveFile(a);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-4 space-y-2" data-testid="message-attachments">
      <div className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">
        {t("mail.attachmentsCount", { n: items.length })}
      </div>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <ImagePreview key={a.id} a={a} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => void download(a)}
              className={cx("flex h-12 max-w-full items-center gap-3 rounded-2xl border px-3 text-left hover:bg-surface-hover", busy === a.id && "opacity-70")}
              data-testid="message-attachment"
            >
              <FileIcon mime={a.mimeType} className="size-5 shrink-0 text-primary" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium">{a.filename}</span>
                <span className="text-[12px] text-text-tertiary">{formatBytes(a.size, lang)}</span>
              </span>
              {busy === a.id ? <Spinner size={14} /> : <RiDownload2Line className="size-4 shrink-0 text-text-secondary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
