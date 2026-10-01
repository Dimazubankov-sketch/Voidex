import type { LanguageCode } from "./regions.js";

/**
 * Detects the language of a short text (a post) among the VOIDEX interface
 * languages — no source-language picker anywhere. Used by the client to decide
 * whether "Translate" makes sense at all (not when the post is already in the
 * interface language) and by the server to tell the translation provider the
 * source language.
 *
 * Script first (Cyrillic, kana, Hangul, Han), then for Latin text a vote of
 * frequent function words and language-specific letters. Returns null when
 * the text has no letters or no clear winner.
 */

const STOPWORDS: Partial<Record<LanguageCode, string[]>> = {
  en: ["the", "and", "is", "are", "you", "of", "to", "in", "it", "that", "this", "with", "for", "was", "have", "on", "my", "be", "not", "what", "just", "i", "we", "so", "today"],
  de: ["der", "die", "das", "und", "ist", "nicht", "ich", "du", "ein", "eine", "mit", "auf", "für", "sie", "wir", "es", "zu", "den", "von", "heute", "auch", "sehr"],
  es: ["el", "la", "los", "las", "y", "es", "que", "de", "en", "un", "una", "por", "con", "para", "muy", "pero", "hoy", "yo", "mi", "está", "son"],
  fr: ["le", "la", "les", "et", "est", "que", "de", "des", "en", "un", "une", "pour", "avec", "je", "tu", "nous", "pas", "très", "aujourd'hui", "c'est", "du", "mon"],
  pt: ["o", "a", "os", "as", "e", "é", "que", "de", "em", "um", "uma", "para", "com", "não", "muito", "hoje", "eu", "você", "está", "do", "da"],
  tr: ["ve", "bir", "bu", "çok", "için", "ile", "ben", "sen", "de", "da", "mi", "ne", "değil", "bugün", "var", "yok", "gibi", "ama"],
};

const LETTERS: Partial<Record<LanguageCode, RegExp>> = {
  de: /[äöüß]/g,
  es: /[ñ¿¡]/g,
  fr: /[èêëàâîïôûùœç]/g,
  pt: /[ãõâêôç]/g,
  tr: /[ğışİç]/g,
};

export function detectLanguage(text: string): LanguageCode | null {
  const s = text.normalize("NFC");
  const count = (re: RegExp) => (s.match(re) ?? []).length;
  const cyr = count(/[Ѐ-ӿ]/g);
  const kana = count(/[぀-ヿ]/g);
  const hangul = count(/[가-힯ᄀ-ᇿ]/g);
  const han = count(/[一-鿿]/g);
  const latin = count(/[A-Za-zÀ-ÖØ-öø-ÿĞğİıŞş]/g);
  const total = cyr + kana + hangul + han + latin;
  if (!total) return null;
  if (kana > 0 && kana + han >= total * 0.3) return "ja";
  if (hangul >= total * 0.3) return "ko";
  if (han >= total * 0.3) return "zh";
  if (cyr >= total * 0.5) return "ru";
  if (latin < total * 0.5) return null;

  const words = s.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const scores = new Map<LanguageCode, number>();
  for (const [lang, list] of Object.entries(STOPWORDS) as [LanguageCode, string[]][]) {
    const set = new Set(list);
    let n = words.filter((w) => set.has(w)).length;
    const re = LETTERS[lang];
    if (re) n += count(new RegExp(re.source, "gi")) * 0.6;
    scores.set(lang, n);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[1] === 0) return null;
  if (second && best[1] === second[1]) return null;
  return best[0];
}
