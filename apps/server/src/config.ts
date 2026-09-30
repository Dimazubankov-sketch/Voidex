import { randomBytes } from "node:crypto";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().default("postgres://voidex:voidex@localhost:5432/voidex"),

  /** HMAC key for access tokens (JWT HS256). ≥ 32 random bytes. */
  AUTH_ACCESS_SECRET: z.string().min(32).optional(),
  /** HMAC key used to hash OTP codes and one-time secrets at rest. */
  AUTH_TOKEN_PEPPER: z.string().min(32).optional(),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  SESSION_IDLE_DAYS: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(180),

  MAIL_DOMAIN: z.string().default("voidops.ru"),

  /**
   * console  — development only: codes are logged/shown, nothing is sent.
   * disabled — no SMS gateway yet: phone verification is refused (503), never faked.
   * otpcom   — otp.com hosted OTP (production default): it makes, sends and checks the code.
   * smsaero  — SMS Aero (Russia): delivers a code made and checked by VOIDEX.
   * twilio / smsru — real delivery of a code made by VOIDEX.
   */
  SMS_PROVIDER: z.enum(["console", "disabled", "otpcom", "smsaero", "twilio", "smsru"]).default("console"),
  /** otp.com server key (otp_live_… in production). Server-side only; never logged. */
  OTP_API_KEY: z.string().optional(),
  /** SMS Aero: account email (Basic-auth login), API key (password) and approved sender name. Server-side only. */
  SMS_AERO_EMAIL: z.string().optional(),
  SMS_AERO_API_KEY: z.string().optional(),
  SMS_AERO_SIGN: z.string().optional(),
  /** SMS Aero API v2 base URL (default https://gate.smsaero.org/v2; alternative https://gate.smsaero.net/v2). */
  SMS_AERO_API_BASE: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  SMSRU_API_ID: z.string().optional(),

  /** Set when running behind a reverse proxy so client IPs are correct. */
  TRUST_PROXY: bool.default(false),
  COOKIE_SECURE: bool.optional(),
  /** Extra origins allowed to call the API (native shells, e.g. capacitor://localhost). */
  ALLOWED_ORIGINS: z.string().default(""),
  /** Built web client to serve in production (apps/web/dist). */
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  /** Multiplies per-route IP rate limits. Development/e2e only (many fake users from one IP). */
  RATE_LIMIT_SCALE: z.coerce.number().min(1).max(1000).default(1),
  /** Git commit of the running build (set by the Docker image). */
  VOIDEX_VERSION: z.string().max(64).default("dev"),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === "production";

  if (production) {
    const missing: string[] = [];
    if (!e.AUTH_ACCESS_SECRET) missing.push("AUTH_ACCESS_SECRET");
    if (!e.AUTH_TOKEN_PEPPER) missing.push("AUTH_TOKEN_PEPPER");
    if (e.RATE_LIMIT_SCALE !== 1) throw new Error("RATE_LIMIT_SCALE must be 1 in production.");
    if (missing.length) throw new Error(`Missing required production secrets: ${missing.join(", ")}`);
    // Never pretend to send SMS in production.
    if (e.SMS_PROVIDER === "console") {
      throw new Error("SMS_PROVIDER=console is a development provider and cannot be used in production.");
    }
  }
  if (e.SMS_PROVIDER === "otpcom") {
    // Messages never quote the key itself.
    const key = e.OTP_API_KEY?.trim() ?? "";
    if (!key) throw new Error("SMS_PROVIDER=otpcom requires OTP_API_KEY.");
    if (!/^otp_(live|test)_\S+$/.test(key)) {
      throw new Error("OTP_API_KEY is not an otp.com server key (expected otp_live_… or otp_test_…; publishable otp_pk_ keys cannot be used).");
    }
    // A sandbox key accepts the fixed code 123456 — that would be a fake OTP.
    if (production && !key.startsWith("otp_live_")) {
      throw new Error("OTP_API_KEY must be a live key (otp_live_…) in production; sandbox keys accept a fixed code.");
    }
  }
  if (e.SMS_PROVIDER === "smsaero") {
    // Messages name the missing variables, never their values.
    const missing = [
      !e.SMS_AERO_API_KEY?.trim() && "SMS_AERO_API_KEY",
      !e.SMS_AERO_EMAIL?.trim() && "SMS_AERO_EMAIL",
    ].filter(Boolean);
    if (missing.length) throw new Error(`SMS_PROVIDER=smsaero requires ${missing.join(" and ")}.`);
    const base = e.SMS_AERO_API_BASE?.trim();
    if (base && !/^https:\/\/[a-z0-9.-]+(:\d+)?\/v2\/?$/i.test(base)) {
      throw new Error("SMS_AERO_API_BASE must be an https URL ending in /v2, e.g. https://gate.smsaero.org/v2.");
    }
    if (!/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(e.SMS_AERO_EMAIL!.trim())) {
      throw new Error("SMS_AERO_EMAIL must be the SMS Aero account email (the Basic-auth login).");
    }
  }
  if (e.SMS_PROVIDER === "twilio" && !(e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_FROM)) {
    throw new Error("SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.");
  }
  if (e.SMS_PROVIDER === "smsru" && !e.SMSRU_API_ID) {
    throw new Error("SMS_PROVIDER=smsru requires SMSRU_API_ID.");
  }

  return {
    env: e.NODE_ENV,
    production,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    // Development falls back to per-process random secrets: restarting the
    // server invalidates access tokens (clients silently refresh) and pending codes.
    accessSecret: e.AUTH_ACCESS_SECRET ?? randomBytes(48).toString("base64url"),
    tokenPepper: e.AUTH_TOKEN_PEPPER ?? randomBytes(48).toString("base64url"),
    accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
    sessionIdleMs: e.SESSION_IDLE_DAYS * 86_400_000,
    sessionAbsoluteMs: e.SESSION_ABSOLUTE_DAYS * 86_400_000,
    mailDomain: e.MAIL_DOMAIN.toLowerCase(),
    sms: {
      provider: e.SMS_PROVIDER,
      twilio: { accountSid: e.TWILIO_ACCOUNT_SID, authToken: e.TWILIO_AUTH_TOKEN, from: e.TWILIO_FROM },
      smsru: { apiId: e.SMSRU_API_ID },
      otpcom: { apiKey: e.OTP_API_KEY?.trim() },
      smsaero: { email: e.SMS_AERO_EMAIL?.trim(), apiKey: e.SMS_AERO_API_KEY?.trim(), sign: e.SMS_AERO_SIGN?.trim() || "SMS Aero", baseUrl: e.SMS_AERO_API_BASE?.trim() || undefined },
    },
    trustProxy: e.TRUST_PROXY,
    cookieSecure: e.COOKIE_SECURE ?? production,
    allowedOrigins: e.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    webDist: e.WEB_DIST,
    logLevel: e.LOG_LEVEL,
    rateLimitScale: e.RATE_LIMIT_SCALE,
    revision: e.VOIDEX_VERSION,
  };
}
