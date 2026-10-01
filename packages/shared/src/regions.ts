import type { CountryCode } from "libphonenumber-js/max";

/**
 * Languages the VOIDEX interface ships with. Adding a language means:
 *   1. add it here,
 *   2. add a dictionary in apps/web/src/lib/i18n/locales,
 *   3. (optionally) add legal document translations on the server.
 * Everything else (selectors, validation, persistence) picks it up.
 */
export type { CountryCode };

export const LANGUAGES = [
  { code: "en", nativeName: "English" },
  { code: "ru", nativeName: "Русский" },
  { code: "es", nativeName: "Español" },
  { code: "de", nativeName: "Deutsch" },
  { code: "fr", nativeName: "Français" },
  { code: "pt", nativeName: "Português" },
  { code: "zh", nativeName: "中文（简体）" },
  { code: "ja", nativeName: "日本語" },
  { code: "ko", nativeName: "한국어" },
  { code: "tr", nativeName: "Türkçe" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];
export const DEFAULT_LANGUAGE: LanguageCode = "en";

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGE_CODES as string[]).includes(value);
}

/**
 * Regional policy. This is the single place where a country influences what
 * VOIDEX does: default language, minimum age, and feature availability.
 * Future apps (Market, payments, …) read their flags from here.
 */
export interface RegionPolicy {
  country: CountryCode;
  defaultLanguage: LanguageCode;
  /** Minimum age to open a VOIDEX account on one's own. */
  minimumAge: number;
  /** Feature flags per region. Only features that exist today are listed. */
  features: {
    mail: boolean;
  };
}

// Countries where the digital age of consent is 16 (GDPR art. 8 default).
// Individual EU states may lower this; refine per legal review.
const AGE_16 = new Set(["DE", "NL", "IE", "LU", "HU", "SK", "RO", "HR", "LT", "PL"]);
/** Default interface language by country (anything else: English). */
const COUNTRY_LANGUAGE: Partial<Record<string, LanguageCode>> = {
  ...Object.fromEntries(["RU", "BY", "KZ", "KG"].map((c) => [c, "ru"])),
  ...Object.fromEntries(["ES", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR"].map((c) => [c, "es"])),
  ...Object.fromEntries(["DE", "AT", "LI"].map((c) => [c, "de"])),
  ...Object.fromEntries(["FR", "MC", "LU"].map((c) => [c, "fr"])),
  ...Object.fromEntries(["PT", "BR", "AO", "MZ"].map((c) => [c, "pt"])),
  ...Object.fromEntries(["CN", "TW", "HK", "MO", "SG"].map((c) => [c, "zh"])),
  JP: "ja",
  KR: "ko",
  TR: "tr",
};

export function regionPolicy(country: CountryCode): RegionPolicy {
  return {
    country,
    defaultLanguage: COUNTRY_LANGUAGE[country] ?? "en",
    minimumAge: AGE_16.has(country) ? 16 : country === "RU" ? 14 : 13,
    features: { mail: true },
  };
}
