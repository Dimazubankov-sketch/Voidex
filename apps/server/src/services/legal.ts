import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LANGUAGE,
  LEGAL_DOCUMENTS,
  type LanguageCode,
  type LegalDocumentDto,
  type LegalDocumentKey,
} from "@voidex/shared";

function legalRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const c of [resolve(here, "../../legal"), resolve(here, "../legal")]) {
    if (existsSync(c)) return c;
  }
  throw new Error("Legal documents folder not found.");
}

/**
 * Serves the current version of each legal document from
 * legal/<key>/<version>.<lang>.md, falling back to English.
 */
export class LegalService {
  private readonly root = legalRoot();
  private readonly cache = new Map<string, LegalDocumentDto>();

  async get(key: LegalDocumentKey, language: LanguageCode): Promise<LegalDocumentDto> {
    const doc = LEGAL_DOCUMENTS.find((d) => d.key === key)!;
    const cacheKey = `${key}:${doc.version}:${language}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let lang = language;
    let path = resolve(this.root, key, `${doc.version}.${lang}.md`);
    if (!existsSync(path)) {
      lang = DEFAULT_LANGUAGE;
      path = resolve(this.root, key, `${doc.version}.${lang}.md`);
    }
    const raw = await readFile(path, "utf8");
    const title = /^#\s+(.+)$/m.exec(raw)?.[1]?.trim() ?? key;
    const dto: LegalDocumentDto = { key, version: doc.version, title, language: lang, content: raw, required: doc.required };
    this.cache.set(cacheKey, dto);
    return dto;
  }

  async list(language: LanguageCode) {
    return Promise.all(LEGAL_DOCUMENTS.map(async (d) => {
      const { content: _content, ...meta } = await this.get(d.key, language);
      return meta;
    }));
  }
}
