import { ErrorCode } from "@voidex/shared";
import { fail } from "../lib/errors.js";

/**
 * Translation of Vibex post text. The source language is detected (shared
 * `detectLanguage`, or by the provider when that is unsure); the target is the
 * reader's interface language. Providers are pluggable like SMS:
 *
 *   mymemory   MyMemory public API (no key; TRANSLATE_EMAIL raises the daily quota)
 *   disabled   no translation: the endpoint answers 503, the UI says so
 *
 * Only texts of posts the reader can see are ever sent (the API takes a post
 * id, not arbitrary text), and results are cached in memory.
 */
export interface Translator {
  readonly name: string;
  translate(text: string, source: string | null, target: string): Promise<string>;
}

export class DisabledTranslator implements Translator {
  readonly name = "disabled";
  async translate(): Promise<string> {
    throw fail(ErrorCode.ServiceUnavailable, "Translation is not available right now.", { status: 503 });
  }
}

export class MyMemoryTranslator implements Translator {
  readonly name = "mymemory";
  constructor(
    private readonly email?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async translate(text: string, source: string | null, target: string): Promise<string> {
    // MyMemory accepts up to ~500 bytes per request: translate paragraph chunks.
    const chunks = chunk(text, 450);
    const out: string[] = [];
    for (const c of chunks) {
      if (!c.trim()) {
        out.push(c);
        continue;
      }
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", c);
      url.searchParams.set("langpair", `${source ?? "Autodetect"}|${target}`);
      if (this.email) url.searchParams.set("de", this.email);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      } catch {
        throw fail(ErrorCode.ServiceUnavailable, "Translation is not available right now.", { status: 503 });
      }
      const data = (await res.json().catch(() => null)) as { responseStatus?: number | string; responseData?: { translatedText?: string } } | null;
      const t = data?.responseData?.translatedText;
      if (!res.ok || !t || Number(data?.responseStatus ?? 200) !== 200) {
        throw fail(ErrorCode.ServiceUnavailable, "Translation is not available right now.", { status: 503 });
      }
      out.push(t);
    }
    return out.join(" ");
  }
}

/** Splits text at line / sentence boundaries into pieces of at most `max` bytes. */
function chunk(text: string, max: number): string[] {
  const parts = text.split(/(?<=[.!?…\n])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    const next = cur ? `${cur} ${p}` : p;
    if (Buffer.byteLength(next) <= max) cur = next;
    else {
      if (cur) out.push(cur);
      // A single over-long piece is cut hard.
      let rest = p;
      while (Buffer.byteLength(rest) > max) {
        let cut = Math.min(rest.length, max);
        while (Buffer.byteLength(rest.slice(0, cut)) > max) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      cur = rest;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function createTranslator(provider: "mymemory" | "disabled", email?: string): Translator {
  return provider === "mymemory" ? new MyMemoryTranslator(email) : new DisabledTranslator();
}
