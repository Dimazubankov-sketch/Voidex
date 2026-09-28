import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export interface ParsedPhone {
  /** E.164, e.g. +79161234567 — the only form ever stored. */
  e164: string;
  country: CountryCode | undefined;
  /** Human readable international form, e.g. +7 916 123-45-67 */
  international: string;
}

/**
 * Parses a phone number typed by a user. Returns null unless the number is a
 * valid number that can receive SMS (mobile, or ambiguous fixed/mobile).
 */
export function parsePhone(input: string, defaultCountry?: CountryCode): ParsedPhone | null {
  const cleaned = input.trim();
  if (!cleaned || cleaned.length > 32) return null;
  const phone = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!phone || !phone.isValid()) return null;
  const type = phone.getType();
  if (type && type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE" && type !== "PERSONAL_NUMBER") {
    return null;
  }
  return {
    e164: phone.number,
    country: phone.country,
    international: phone.formatInternational(),
  };
}

export function formatPhone(e164: string): string {
  const phone = parsePhoneNumberFromString(e164);
  return phone ? phone.formatInternational() : e164;
}

/** +7 916 ***-**-67 style mask for showing a phone to a not-yet-authenticated user. */
export function maskPhone(e164: string): string {
  const formatted = formatPhone(e164);
  const digits = formatted.replace(/\D/g, "");
  if (digits.length < 6) return formatted;
  let seen = 0;
  const total = digits.length;
  const ccLen = (parsePhoneNumberFromString(e164)?.countryCallingCode ?? "").length;
  return formatted.replace(/\d/g, (d) => {
    seen += 1;
    if (seen <= ccLen + 1 || seen > total - 2) return d;
    return "•";
  });
}
