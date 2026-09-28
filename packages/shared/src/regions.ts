import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js/max";

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
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];
export const DEFAULT_LANGUAGE: LanguageCode = "en";

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGE_CODES as string[]).includes(value);
}

/** All ISO-3166 alpha-2 regions that have a phone numbering plan. */
export const COUNTRY_CODES: readonly CountryCode[] = getCountries();

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === "string" && (COUNTRY_CODES as string[]).includes(value);
}

export function callingCode(country: CountryCode): string {
  return getCountryCallingCode(country);
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
const RUSSIAN_SPEAKING = new Set(["RU", "BY", "KZ", "KG"]);

export function regionPolicy(country: CountryCode): RegionPolicy {
  return {
    country,
    defaultLanguage: RUSSIAN_SPEAKING.has(country) ? "ru" : "en",
    minimumAge: AGE_16.has(country) ? 16 : country === "RU" ? 14 : 13,
    features: { mail: true },
  };
}
