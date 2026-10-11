import { publicMailDomain } from "@voidex/shared";

/**
 * Step 2.9: VoidOps addresses are shown as `username@voidops`.
 *
 * Storage does not change: mail accounts, messages and recipients keep the
 * canonical `username@voidops.ru` (no rewrite of keys or history), and every
 * input accepts both spellings (see `parseAddress`). What leaves the API for
 * people to see is the public form — every string in a response that is
 * exactly a VoidOps address is presented as `username@voidops`. Text such as
 * a letter's body is left as written.
 */
export function addressPresenter(mailDomain: string) {
  const escaped = mailDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = new RegExp(`^([^\\s@<>"]+)@${escaped}$`, "i");
  const pub = publicMailDomain(mailDomain);
  const one = (s: string) => {
    const m = exact.exec(s);
    return m ? `${m[1]}@${pub}` : s;
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return v.length <= 254 ? one(v) : v;
    if (depth > 12 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const proto = Object.getPrototypeOf(v);
    // Only plain data (DTOs): dates, buffers, streams and class instances pass through untouched.
    if (proto !== Object.prototype && proto !== null) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x, depth + 1);
    return out;
  };
  return {
    /** One address: `x@voidops.ru` → `x@voidops`. */
    address: one,
    /** A response / event: every exact address inside it. */
    present: <T>(value: T): T => walk(value, 0) as T,
  };
}
