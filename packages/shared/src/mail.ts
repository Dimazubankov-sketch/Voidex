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
