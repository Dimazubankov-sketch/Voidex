/**
 * VOIDEX Mail — shared vocabulary.
 *
 * Step 1 mail is INTERNAL: addresses live under the VOIDEX mail domain and
 * messages are delivered only between VOIDEX accounts. The `transport` field on
 * accounts/messages exists so an external (SMTP) transport can be added later
 * without reshaping the data.
 */
export const MAIL_FOLDERS = ["inbox", "sent", "drafts", "archive", "trash"] as const;
export type MailFolder = (typeof MAIL_FOLDERS)[number];

/** Folders plus virtual views. */
export const MAIL_VIEWS = [...MAIL_FOLDERS, "starred"] as const;
export type MailView = (typeof MAIL_VIEWS)[number];

export const MAIL_SUBJECT_MAX = 250;
export const MAIL_BODY_MAX = 100_000;
export const MAIL_RECIPIENTS_MAX = 50;

export type RecipientKind = "to" | "cc" | "bcc";

// ---- attachments ------------------------------------------------------------

export const MAIL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const MAIL_ATTACHMENTS_MAX = 10;
export const MAIL_ATTACHMENTS_TOTAL_MAX_BYTES = 25 * 1024 * 1024;
export const MAIL_ATTACHMENT_NAME_MAX = 180;

/**
 * Attachment types VOIDEX Mail accepts, by extension. The server derives the
 * stored MIME type from this table (never from what the client claims) and
 * verifies raster images by their magic bytes. Anything executable or
 * scriptable (exe, js, html, svg, …) is refused.
 */
export const MAIL_ATTACHMENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  gz: "application/gzip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  weba: "audio/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/** Previewable in the message (decoded by the browser as an image). */
export const MAIL_INLINE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function attachmentExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/** MIME type for an allowed file name, or null if the type is not accepted. */
export function attachmentMimeType(filename: string): string | null {
  return MAIL_ATTACHMENT_TYPES[attachmentExtension(filename)] ?? null;
}

/** Makes a user-supplied file name safe to store and to send back in headers. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (!clean) return "file";
  if (clean.length <= MAIL_ATTACHMENT_NAME_MAX) return clean;
  const ext = attachmentExtension(clean);
  const keep = MAIL_ATTACHMENT_NAME_MAX - (ext ? ext.length + 1 : 0);
  return ext ? `${clean.slice(0, keep)}.${ext}` : clean.slice(0, MAIL_ATTACHMENT_NAME_MAX);
}

export interface AddressParts {
  local: string;
  domain: string;
}

export function parseAddress(value: string, defaultDomain: string): AddressParts | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const at = v.lastIndexOf("@");
  if (at === -1) return { local: v, domain: defaultDomain };
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (!local || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return { local, domain };
}

export function subjectWithPrefix(subject: string, prefix: "Re" | "Fwd"): string {
  const s = subject.trim();
  const re = prefix === "Re" ? /^(re|ответ)\s*:/i : /^(fwd?|пересл\.?)\s*:/i;
  if (re.test(s)) return s;
  return `${prefix}: ${s}`.slice(0, MAIL_SUBJECT_MAX);
}

/** Index of the first line of quoted/forwarded content, or -1. */
export function quoteStartLine(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^-{5,}/.test(l)) return i;
    if (l.startsWith(">")) {
      // Include the "On …, X wrote:" header right above the quote.
      let j = i - 1;
      while (j >= 0 && !lines[j]!.trim()) j--;
      return j >= 0 && lines[j]!.trim().endsWith(":") ? j : i;
    }
  }
  return -1;
}

export function makeSnippet(body: string, max = 140): string {
  const lines = body.split("\n");
  const q = quoteStartLine(lines);
  let s = (q === -1 ? lines : lines.slice(0, q))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // A forward without a comment: preview the forwarded text itself.
  if (!s && q !== -1) {
    s = lines
      .slice(q)
      .filter((l) => !/^-{5,}/.test(l) && !/^[A-Za-zА-Яа-яЁё]+:\s/.test(l))
      .map((l) => l.replace(/^>\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
