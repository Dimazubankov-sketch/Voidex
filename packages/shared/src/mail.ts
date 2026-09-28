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

export function makeSnippet(body: string, max = 140): string {
  const s = body
    .split("\n")
    .filter((line) => !line.startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
