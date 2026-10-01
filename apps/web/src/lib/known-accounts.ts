import type { MeDto } from "@voidex/shared";

/**
 * Accounts that signed in on this device — a convenience list for the account
 * switcher (like a browser's account chooser). It holds no tokens or secrets:
 * switching always signs in again through VOIDEX (password, and the second
 * factor on a device that isn't trusted for that account).
 */
export interface KnownAccount {
  id: string;
  name: string;
  address: string;
  avatarVersion: number;
}

const KEY = "vx.knownAccounts";

export function knownAccounts(): KnownAccount[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as KnownAccount[];
    return Array.isArray(list) ? list.filter((a) => a && typeof a.id === "string" && typeof a.address === "string") : [];
  } catch {
    return [];
  }
}

export function rememberAccount(me: MeDto) {
  try {
    const entry: KnownAccount = { id: me.id, name: `${me.firstName} ${me.lastName}`.trim(), address: me.mailAddress, avatarVersion: me.avatarVersion };
    const rest = knownAccounts().filter((a) => a.id !== me.id);
    localStorage.setItem(KEY, JSON.stringify([entry, ...rest].slice(0, 8)));
  } catch {
    /* storage unavailable */
  }
}

export function forgetAccount(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(knownAccounts().filter((a) => a.id !== id)));
  } catch {
    /* storage unavailable */
  }
}

/** After an account switch from an app, that app opens again for the new account. */
const REOPEN = "vx.reopenApp";
export function reopenAfterSwitch(appId: string) {
  try {
    sessionStorage.setItem(REOPEN, appId);
  } catch {
    /* ignore */
  }
}
export function takeReopenApp(): string | null {
  try {
    const v = sessionStorage.getItem(REOPEN);
    sessionStorage.removeItem(REOPEN);
    return v;
  } catch {
    return null;
  }
}
