import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { ErrorCode, type VerificationStartedDto } from "@voidex/shared";
import { phoneVerifications, type verificationPurposes } from "../db/schema.js";
import { hmac, otpCode, randomToken, safeEqualHex } from "../lib/crypto.js";
import { fail } from "../lib/errors.js";
import { SmsDeliveryError } from "./sms/index.js";
import type { Ctx } from "./context.js";
import type { Tx } from "../db/client.js";

export type VerificationPurpose = (typeof verificationPurposes)[number];

const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;
const MAX_PER_HOUR = 8;
/** A verified phone proof must be used (e.g. account created) within this window. */
const PROOF_TTL_MS = 30 * 60_000;

const SMS_TEXT: Record<string, (code: string) => string> = {
  en: (c) => `${c} is your VOIDEX verification code. Never share it with anyone.`,
  ru: (c) => `${c} — ваш код подтверждения VOIDEX. Никому его не сообщайте.`,
};

/** Phone verification: generate → deliver via SmsProvider → verify → (optional) proof. */
export class VerificationService {
  constructor(private readonly ctx: Ctx) {}

  private codeHash(id: string, code: string) {
    // Binding the id into the MAC makes a hash useless for any other verification.
    return hmac(this.ctx.config.tokenPepper, `otp:${id}:${code}`);
  }

  async start(input: {
    purpose: VerificationPurpose;
    phone: string;
    userId?: string | null;
    ip: string | null;
    language?: string;
  }): Promise<VerificationStartedDto> {
    const { db } = this.ctx;
    const now = this.ctx.now();

    const recent = await db
      .select({ createdAt: phoneVerifications.createdAt, purpose: phoneVerifications.purpose })
      .from(phoneVerifications)
      .where(and(eq(phoneVerifications.phone, input.phone), gt(phoneVerifications.createdAt, new Date(now.getTime() - 3_600_000))))
      .orderBy(desc(phoneVerifications.createdAt));

    const last = recent.find((r) => r.purpose === input.purpose);
    if (last && now.getTime() - last.createdAt.getTime() < RESEND_AFTER_MS) {
      const retryAfterSeconds = Math.ceil((RESEND_AFTER_MS - (now.getTime() - last.createdAt.getTime())) / 1000);
      throw fail(ErrorCode.CodeResendTooSoon, "Please wait before requesting another code.", {
        details: { retryAfterSeconds },
      });
    }
    if (recent.length >= MAX_PER_HOUR) {
      throw fail(ErrorCode.RateLimited, "Too many codes requested for this number. Try again later.", {
        details: { retryAfterSeconds: 3600 },
      });
    }

    const code = otpCode();
    const id = crypto.randomUUID();
    await db.insert(phoneVerifications).values({
      id,
      purpose: input.purpose,
      phone: input.phone,
      userId: input.userId ?? null,
      codeHash: this.codeHash(id, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      ipAddress: input.ip,
      createdAt: now,
    });

    const text = (SMS_TEXT[input.language ?? "en"] ?? SMS_TEXT.en!)(code);
    try {
      await this.ctx.sms.send(input.phone, text);
    } catch (err) {
      await db.delete(phoneVerifications).where(eq(phoneVerifications.id, id));
      if (err instanceof SmsDeliveryError) {
        throw fail(ErrorCode.SmsSendFailed, "We couldn't send an SMS to this number. Please try again later.");
      }
      throw err;
    }

    return {
      verificationId: id,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      resendAfterSeconds: RESEND_AFTER_MS / 1000,
      ...(this.ctx.sms.isDevelopment && !this.ctx.config.production ? { devCode: code } : {}),
    };
  }

  /**
   * Checks a code. Wrong codes burn an attempt; after `maxAttempts` the
   * verification is dead and a new code must be requested.
   */
  async verify(input: { id: string; code: string; purpose: VerificationPurpose; userId?: string | null }) {
    const { db } = this.ctx;
    const now = this.ctx.now();
    const row = await db.query.phoneVerifications.findFirst({ where: eq(phoneVerifications.id, input.id) });

    if (!row || row.purpose !== input.purpose || (input.userId !== undefined && row.userId !== input.userId)) {
      throw fail(ErrorCode.CodeInvalid, "Incorrect verification code.");
    }
    if (row.verifiedAt || row.consumedAt) {
      throw fail(ErrorCode.CodeExpired, "This code has already been used. Request a new one.");
    }
    if (row.expiresAt <= now) throw fail(ErrorCode.CodeExpired, "This code has expired. Request a new one.");
    if (row.attempts >= row.maxAttempts) {
      throw fail(ErrorCode.CodeAttemptsExceeded, "Too many incorrect attempts. Request a new code.");
    }

    if (!safeEqualHex(this.codeHash(row.id, input.code), row.codeHash)) {
      const [updated] = await db
        .update(phoneVerifications)
        .set({ attempts: sql`${phoneVerifications.attempts} + 1` })
        .where(eq(phoneVerifications.id, row.id))
        .returning({ attempts: phoneVerifications.attempts });
      const attemptsLeft = Math.max(0, row.maxAttempts - (updated?.attempts ?? row.maxAttempts));
      if (attemptsLeft === 0) {
        throw fail(ErrorCode.CodeAttemptsExceeded, "Too many incorrect attempts. Request a new code.");
      }
      throw fail(ErrorCode.CodeInvalid, "Incorrect verification code.", { details: { attemptsLeft } });
    }

    const proof = randomToken();
    // Conditional update: two parallel correct submissions cannot both win.
    const [won] = await db
      .update(phoneVerifications)
      .set({ verifiedAt: now, proofHash: this.codeHash(row.id, `proof:${proof}`) })
      .where(and(eq(phoneVerifications.id, row.id), isNull(phoneVerifications.verifiedAt)))
      .returning({ id: phoneVerifications.id });
    if (!won) throw fail(ErrorCode.CodeExpired, "This code has already been used. Request a new one.");

    return { phone: row.phone, proof };
  }

  /** Redeems a proof of a verified phone exactly once (used by registration). */
  async consumeProof(input: { id: string; proof: string; purpose: VerificationPurpose }, db: Tx = this.ctx.db): Promise<string> {
    const now = this.ctx.now();
    const row = await db.query.phoneVerifications.findFirst({ where: eq(phoneVerifications.id, input.id) });
    if (
      !row ||
      row.purpose !== input.purpose ||
      !row.verifiedAt ||
      !row.proofHash ||
      row.consumedAt ||
      now.getTime() - row.verifiedAt.getTime() > PROOF_TTL_MS ||
      !safeEqualHex(this.codeHash(row.id, `proof:${input.proof}`), row.proofHash)
    ) {
      throw fail(ErrorCode.PhoneNotVerified, "Phone number verification is missing or has expired. Please verify your number again.");
    }
    const [won] = await db
      .update(phoneVerifications)
      .set({ consumedAt: now })
      .where(and(eq(phoneVerifications.id, row.id), isNull(phoneVerifications.consumedAt)))
      .returning({ id: phoneVerifications.id });
    if (!won) throw fail(ErrorCode.PhoneNotVerified, "Phone number verification has already been used.");
    return row.phone;
  }
}
