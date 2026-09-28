import { create } from "zustand";
import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode } from "@voidex/shared";
import { en, type MessageKey } from "./en";
import { ru } from "./ru";

/** Registered dictionaries. Adding a language = add a file + an entry here. */
const DICTIONARIES: Record<LanguageCode, Record<MessageKey, string>> = { en, ru };

export type { MessageKey };
export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string;

function detectLanguage(): LanguageCode {
  try {
    const saved = localStorage.getItem("vx.lang");
    if (isLanguageCode(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language.slice(0, 2).toLowerCase() : "";
  return isLanguageCode(nav) ? nav : DEFAULT_LANGUAGE;
}

interface I18nState {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
}

/**
 * Interface language. Before sign-in it comes from the device; after sign-in
 * the account's language (synced from the server) wins on every device.
 */
export const useI18n = create<I18nState>((set) => ({
  language: detectLanguage(),
  setLanguage: (language) => {
    try {
      localStorage.setItem("vx.lang", language);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = language;
    set({ language });
  },
}));

export function translate(language: LanguageCode, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = DICTIONARIES[language]?.[key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export function useT(): TFunction {
  const language = useI18n((s) => s.language);
  return (key, vars) => translate(language, key, vars);
}

export function t(key: MessageKey, vars?: Record<string, string | number>) {
  return translate(useI18n.getState().language, key, vars);
}

export function useLanguage() {
  return useI18n((s) => s.language);
}

const regionNames = new Map<string, Intl.DisplayNames>();
export function countryName(code: string, language: LanguageCode): string {
  let dn = regionNames.get(language);
  if (!dn) {
    dn = new Intl.DisplayNames([language], { type: "region" });
    regionNames.set(language, dn);
  }
  try {
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

export function flagEmoji(code: string): string {
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function formatDate(iso: string | Date, language: LanguageCode, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) {
  const d = typeof iso === "string" ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso) : iso;
  return new Intl.DateTimeFormat(language, { ...opts, ...(typeof iso === "string" && iso.length === 10 ? { timeZone: "UTC" } : {}) }).format(d);
}

/** Mail-list style: time today, "12 Mar" this year, full date otherwise. */
export function formatShortDate(iso: string, language: LanguageCode, now = new Date()) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(d);
  if (d.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }).format(d);
  return new Intl.DateTimeFormat(language, { day: "numeric", month: "short", year: "numeric" }).format(d);
}

export function formatRelative(iso: string, language: LanguageCode, now = Date.now()) {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return translate(language, "common.justNow");
  if (diff < 3_600_000) return translate(language, "common.minutesAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return translate(language, "common.hoursAgo", { n: Math.floor(diff / 3_600_000) });
  return formatDate(iso, language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function monthNames(language: LanguageCode): string[] {
  const f = new Intl.DateTimeFormat(language, { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, i) => {
    const s = f.format(new Date(Date.UTC(2000, i, 1)));
    return s.charAt(0).toUpperCase() + s.slice(1);
  });
}
