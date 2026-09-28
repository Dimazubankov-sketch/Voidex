import type { CountryCode } from "libphonenumber-js/max";
import { regionPolicy } from "../regions.js";

export const NAME_MAX = 50;

/** Letters (any script), spaces, apostrophes, hyphens and dots. */
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .\-]*$/u;

export type NameError = "required" | "too_long" | "invalid";

export function normalizeName(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function validateName(raw: string): NameError | null {
  const value = normalizeName(raw);
  if (!value) return "required";
  if (value.length > NAME_MAX) return "too_long";
  if (!NAME_RE.test(value)) return "invalid";
  return null;
}

export type BirthDateError = "required" | "invalid" | "future" | "too_old" | "too_young";

export interface BirthDateParts {
  day: number;
  month: number; // 1-12
  year: number;
}

/** ISO `YYYY-MM-DD` for a date that is known to be valid. */
export function toIsoDate({ day, month, year }: BirthDateParts): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseIsoDate(iso: string): BirthDateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function isRealCalendarDate({ day, month, year }: BirthDateParts): boolean {
  if (![day, month, year].every(Number.isInteger)) return false;
  if (month < 1 || month > 12 || day < 1 || year < 1) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Full years between `birth` and `today` (both calendar dates). */
export function ageOn(birth: BirthDateParts, today: BirthDateParts): number {
  let age = today.year - birth.year;
  if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) age -= 1;
  return age;
}

export function todayParts(now = new Date()): BirthDateParts {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

export const MAX_AGE = 120;

/**
 * Validates a date of birth. When `country` is given the regional minimum age
 * is enforced as well.
 */
export function validateBirthDate(
  parts: Partial<BirthDateParts>,
  country?: CountryCode | null,
  now = new Date(),
): BirthDateError | null {
  if (parts.day == null || parts.month == null || parts.year == null) return "required";
  const p = parts as BirthDateParts;
  if (!isRealCalendarDate(p)) return "invalid";
  const today = todayParts(now);
  const age = ageOn(p, today);
  if (toIsoDate(p) > toIsoDate(today)) return "future";
  if (age > MAX_AGE) return "too_old";
  if (country && age < regionPolicy(country).minimumAge) return "too_young";
  return null;
}
