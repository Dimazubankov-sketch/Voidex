import { ApiError } from "./api";
import type { MessageKey, TFunction } from "./i18n";

/** Human, localised message for any error thrown by the API client. */
export function errorMessage(t: TFunction, err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "network") return t("error.network");
    if (err.code === "account_locked") {
      const s = Number(err.details.retryAfterSeconds ?? 60);
      return t("error.account_locked", { minutes: Math.max(1, Math.ceil(s / 60)) });
    }
    const key = `error.${err.code}` as MessageKey;
    const msg = t(key);
    return msg === key ? err.message || t("error.generic") : msg;
  }
  return t("error.generic");
}

/** Localised per-field error text. */
export function fieldMessage(t: TFunction, code: string | undefined, field?: string): string | undefined {
  if (!code) return undefined;
  if (field && (field === "firstName" || field === "lastName") && code === "invalid") return t("field.name.invalid");
  const key = `field.${code}` as MessageKey;
  const msg = t(key);
  return msg === key ? t("field.invalid") : msg;
}
