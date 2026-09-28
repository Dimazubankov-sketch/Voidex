export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** A short list of the most common passwords (and their obvious shapes). */
const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "qwerty", "qwerty123",
  "qwertyuiop", "1234567890", "123456789", "12345678", "1q2w3e4r5t", "1qaz2wsx3edc",
  "iloveyou", "admin12345", "welcome123", "letmein123", "abc1234567", "zaq12wsxcde",
  "qwertyuiop1", "asdfghjkl1", "voidex1234", "voidex12345", "11111111111", "0000000000",
]);

export interface PasswordCheck {
  length: boolean;
  letter: boolean;
  digitOrSymbol: boolean;
  notCommon: boolean;
  notPersonal: boolean;
}

export interface PasswordContext {
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export function checkPassword(password: string, ctx: PasswordContext = {}): PasswordCheck {
  const lower = password.toLowerCase();
  const personal = [ctx.username, ctx.firstName, ctx.lastName]
    .map((v) => (v ?? "").toLowerCase().trim())
    .filter((v) => v.length >= 3);
  const phoneDigits = (ctx.phone ?? "").replace(/\D/g, "");
  return {
    length: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
    letter: /\p{L}/u.test(password),
    digitOrSymbol: /[^\p{L}\s]/u.test(password),
    notCommon: !COMMON.has(lower) && !/^(.)\1+$/.test(password),
    notPersonal:
      !personal.some((p) => lower.includes(p)) &&
      !(phoneDigits.length >= 6 && password.includes(phoneDigits.slice(-6))),
  };
}

export function isPasswordAcceptable(password: string, ctx?: PasswordContext): boolean {
  return Object.values(checkPassword(password, ctx)).every(Boolean);
}

/** 0 (weak) … 4 (very strong). Used for the meter, not for acceptance. */
export function passwordScore(password: string, ctx?: PasswordContext): 0 | 1 | 2 | 3 | 4 {
  if (!isPasswordAcceptable(password, ctx)) return password.length >= 6 ? 1 : 0;
  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/\d/.test(password)) classes++;
  if (/[^A-Za-z0-9]/.test(password)) classes++;
  if (password.length >= 16 && classes >= 3) return 4;
  if (password.length >= 12 && classes >= 3) return 3;
  return 2;
}
