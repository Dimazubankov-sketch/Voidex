/**
 * Step 2.13: addresses in plain text (a letter's body), for the clients to show
 * as links. Only http(s) and www. addresses count; anything that doesn't parse
 * as a URL with a real host stays text. Pure: no HTML is ever produced here.
 */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
/** Characters that end a sentence rather than the address ("see https://x.ru."). */
const TRAILING = /[.,;:!?)\]}»"'’”]+$/;

export interface LinkPart {
  text: string;
  href?: string;
}

/** The text cut into plain parts and link parts (href only for a valid http(s) address with a host). */
export function linkParts(text: string): LinkPart[] {
  const out: LinkPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0];
    const start = m.index ?? 0;
    // Keep a closing bracket that belongs to the address: "(see https://a.ru/x_(y))".
    const trail = raw.match(TRAILING)?.[0] ?? "";
    if (trail) {
      let cut = trail.length;
      if (trail.startsWith(")") && (raw.match(/\(/g)?.length ?? 0) >= (raw.match(/\)/g)?.length ?? 0)) cut = trail.length - 1;
      raw = raw.slice(0, raw.length - cut);
    }
    const href = safeHref(raw);
    if (!href) continue;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** An http(s) URL for a matched address, or null if it isn't a usable one. */
export function safeHref(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // A host with a dot and a real label on each side ("http://x" or "http://.ru" is not an address).
    if (!/^[^.\s]+(\.[^.\s]+)+$/.test(u.hostname) && u.hostname !== "localhost") return null;
    return u.href;
  } catch {
    return null;
  }
}
