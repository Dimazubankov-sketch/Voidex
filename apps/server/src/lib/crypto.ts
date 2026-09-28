import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** 256-bit URL-safe random token (session refresh tokens, device secrets, challenge secrets). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Plain SHA-256 — fine for high-entropy random tokens. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Keyed hash for low-entropy secrets (6-digit OTP codes). Without the pepper,
 * a database leak would let anyone brute-force a code in microseconds.
 */
export function hmac(pepper: string, value: string): string {
  return createHmac("sha256", pepper).update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function otpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
