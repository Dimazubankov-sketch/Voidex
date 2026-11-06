/**
 * Start-up / update diagnostics sent by the web client (boot guard, error boundary, update flow).
 * The point is to learn *that* and *where* a device failed to start — never *who* it was. Everything a client
 * sends is untrusted: only whitelisted fields are kept, free text is scrubbed of anything that looks like a
 * token, address or number sequence, and nothing is written to the database (the server log only).
 */
import { z } from "zod";

export const CLIENT_EVENT_KINDS = [
  "boot_failed",
  "boot_slow",
  "root_crashed",
  "chunk_failed",
  "api_unreachable",
  "update_found",
  "update_applied",
  "update_deferred",
  "sw_error",
  "storage_reset",
] as const;

const token = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);

export const clientEventSchema = z.object({
  kind: z.enum(CLIENT_EVENT_KINDS),
  phase: token.optional(),
  build: token.optional(),
  online: z.boolean().optional(),
  standalone: z.boolean().optional(),
  sw: z.boolean().optional(),
  ms: z.number().int().min(0).max(3_600_000).optional(),
  attempt: z.number().int().min(0).max(20).optional(),
  detail: z.string().max(400).optional(),
});
export type ClientEvent = z.infer<typeof clientEventSchema>;

/** Removes what must never reach a log: query strings, tokens, e-mails, long digit/hex runs, control characters. */
export function scrubDetail(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const s = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/https?:\/\/[^\s"')]+/gi, (u) => {
      try {
        return new URL(u).pathname.replace(/[0-9a-f-]{16,}/gi, ":id");
      } catch {
        return "[url]";
      }
    })
    .replace(/\b(bearer|basic)\s+\S+/gi, "$1 [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[token]")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, 200) || undefined;
}

/** Coarse browser/OS family from the User-Agent — enough to see "iOS Safari" vs "Chrome desktop". */
export function uaFamily(ua: string | undefined): string {
  if (!ua) return "unknown";
  const ios = /iPhone|iPad|iPod/.test(ua);
  const os = ios ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "other";
  const browser = /YaBrowser/.test(ua) ? "Yandex" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : ios ? "WebView/PWA" : "other";
  const m = /(?:OS|Android|Windows NT|Mac OS X) (\d+)/.exec(ua);
  return `${os}${m ? " " + m[1] : ""} ${browser}`;
}
