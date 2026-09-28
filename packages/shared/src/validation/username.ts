export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/**
 * Mail usernames: lowercase latin letters, digits, dots, underscores and
 * hyphens. Must start with a letter, end with a letter or digit, and never
 * contain two separators in a row.
 */
const USERNAME_RE = /^[a-z](?:[a-z0-9]|[._-](?=[a-z0-9]))*$/;

/** Names that must never belong to a user (system, abuse, impersonation). */
export const RESERVED_USERNAMES = new Set([
  "abuse", "account", "accounts", "admin", "administrator", "api", "app", "apps", "billing",
  "bot", "contact", "daemon", "dev", "help", "hostmaster", "info", "mail", "mailer-daemon",
  "market", "moderator", "no-reply", "noc", "noreply", "official", "owner", "postmaster",
  "privacy", "root", "security", "settings", "staff", "support", "system", "team", "test",
  "voidex", "voidops", "webmaster", "www", "legal", "notifications", "service", "store",
]);

export type UsernameError = "required" | "too_short" | "too_long" | "invalid" | "reserved";

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(raw: string): UsernameError | null {
  const value = normalizeUsername(raw);
  if (!value) return "required";
  if (value.length < USERNAME_MIN) return "too_short";
  if (value.length > USERNAME_MAX) return "too_long";
  if (!USERNAME_RE.test(value)) return "invalid";
  if (RESERVED_USERNAMES.has(value) || value.startsWith("voidex") || value.startsWith("voidops")) return "reserved";
  return null;
}

/** Transliterates a (possibly Cyrillic) name into a username-safe fragment. */
export function slugifyForUsername(input: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return input
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Candidate usernames for a person, most natural first. Not checked for availability. */
export function usernameCandidates(base: string, firstName: string, lastName: string, seed = Date.now()): string[] {
  const f = slugifyForUsername(firstName);
  const l = slugifyForUsername(lastName);
  const b = normalizeUsername(base).replace(/[^a-z0-9._-]/g, "");
  const out = new Set<string>();
  const add = (v: string) => {
    if (!validateUsername(v)) out.add(v);
  };
  if (f && l) {
    add(`${f}.${l}`);
    add(`${f}${l}`);
    add(`${f[0]}.${l}`);
    add(`${l}.${f}`);
  }
  let n = seed;
  const rnd = () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n;
  };
  for (const root of [b, f && l ? `${f}.${l}` : "", f].filter(Boolean)) {
    add(`${root}${new Date().getFullYear() % 100}`);
    for (let i = 0; i < 3; i++) add(`${root}${(rnd() % 900) + 100}`);
  }
  return [...out].filter((v) => v !== b);
}
