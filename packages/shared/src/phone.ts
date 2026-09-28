import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js/max";

/**
 * Phone numbers & country codes — a separate entry point
 * (`@voidex/shared/phone`) because the numbering-plan metadata is large.
 * Clients load it only on screens that deal with phone numbers.
 */
export * from "./validation/phone.js";
export type { CountryCode };

/** All ISO-3166 alpha-2 regions that have a phone numbering plan. */
export const COUNTRY_CODES: readonly CountryCode[] = getCountries();

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === "string" && (COUNTRY_CODES as string[]).includes(value);
}

export function callingCode(country: CountryCode): string {
  return getCountryCallingCode(country);
}
