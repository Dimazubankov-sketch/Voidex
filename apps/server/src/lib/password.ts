import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt (memory-hard, built into Node — no native
 * addons to break on deploy). The encoded string carries its own parameters
 * so they can be raised later and old hashes upgraded on next sign-in:
 *
 *   scrypt$v1$N=32768,r=8,p=1$<salt b64url>$<hash b64url>
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LEN = 64;
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, { ...PARAMS, maxmem: MAXMEM });
  return `scrypt$v1$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 5 || parts[0] !== "scrypt") return false;
  const params = Object.fromEntries(parts[2]!.split(",").map((kv) => kv.split("=").map((x, i) => (i ? Number(x) : x))));
  const salt = Buffer.from(parts[3]!, "base64url");
  const expected = Buffer.from(parts[4]!, "base64url");
  const N = Number(params.N);
  const r = Number(params.r);
  const p = Number(params.p);
  const key = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function needsRehash(encoded: string): boolean {
  return !encoded.startsWith(`scrypt$v1$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$`);
}

/** A real hash of a random password: verifying against it costs the same as a real account. */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString("hex"));
  return dummy;
}
