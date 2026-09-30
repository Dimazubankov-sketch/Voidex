import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { phoneVerifications } from "../src/db/schema.js";
import { SmsAeroError, SmsAeroProvider, createSmsProvider } from "../src/services/sms/index.js";
import { CONSENTS, Device, STRONG_PASSWORD, TEST_DATABASE_URL, createTestEnv, signUp, uniquePhone, uniqueUsername, type TestEnv } from "./helpers.js";

/**
 * SMS Aero, tested against an in-memory fake of its v2 API.
 * Dummy credentials only — no real key, no network, no real SMS.
 */
const EMAIL = "tests@example.invalid";
const DUMMY_KEY = "dummyAeroKeyForUnitTests0123456789";

type Fault = { status: number; body?: unknown; retryAfter?: number } | "timeout" | "network" | "garbage";

class FakeSmsAero {
  calls: { url: string; method: string; headers: Record<string, string>; body: any }[] = [];
  faults: Fault[] = [];
  /** Overrides the message status of the next successful send. */
  nextStatus: { status: number; extendStatus: string } | null = null;
  seq = 1000;

  lastText(number: string) {
    return [...this.calls].reverse().find((c) => c.body?.number === number)?.body.text as string | undefined;
  }
  lastCode(e164: string) {
    return this.lastText(e164.slice(1))?.match(/\d{6}/)?.[0];
  }

  fetch: typeof fetch = async (input, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ url: String(input), method: init?.method ?? "GET", headers, body });
    const json = (status: number, data: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...extra } });

    const expected = `Basic ${Buffer.from(`${EMAIL}:${DUMMY_KEY}`).toString("base64")}`;
    if (headers.authorization !== expected) return json(401, { success: false, data: null, message: "Unauthorized." });

    const f = this.faults.shift();
    if (f === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (f === "network") throw new TypeError("fetch failed");
    if (f === "garbage") return new Response("<html>502 Bad Gateway</html>", { status: 200 });
    if (f) return json(f.status, f.body ?? { success: false, data: null, message: "error" }, f.retryAfter ? { "retry-after": String(f.retryAfter) } : {});

    const st = this.nextStatus ?? { status: 0, extendStatus: "queue" };
    this.nextStatus = null;
    return json(200, {
      success: true,
      data: { id: ++this.seq, from: body.sign, number: body.number, text: body.text, ...st, channel: "FREE SIGN", cost: 3.49, dateCreate: 1, dateSend: 1 },
      message: null,
    });
  };
}

class MemoryLog {
  lines: string[] = [];
  info = (o: object, m: string) => void this.lines.push(`${m} ${JSON.stringify(o)}`);
  warn = (o: object, m: string) => void this.lines.push(`${m} ${JSON.stringify(o)}`);
  error = (o: object, m: string) => void this.lines.push(`${m} ${JSON.stringify(o)}`);
  get text() {
    return this.lines.join("\n");
  }
}

function provider(fake: FakeSmsAero, log = new MemoryLog(), apiKey = DUMMY_KEY) {
  return new SmsAeroProvider({ email: EMAIL, apiKey, sign: "SMS Aero", fetch: fake.fetch, log });
}

const PHONE = "+79161234567";
const TEXT = "482913 — ваш код подтверждения VOIDEX. Никому его не сообщайте.";

async function sendErr(p: SmsAeroProvider, to = PHONE) {
  return (await p.send(to, TEXT).catch((e) => e)) as SmsAeroError;
}

// ---------------------------------------------------------------------------
describe("SmsAeroProvider (mock HTTP)", () => {
  it("sends: POST /v2/sms/send, Basic auth email:key, JSON number/sign/text", async () => {
    const fake = new FakeSmsAero();
    const log = new MemoryLog();
    await provider(fake, log).send(PHONE, TEXT);
    expect(fake.calls).toHaveLength(1);
    const c = fake.calls[0]!;
    expect(c.url).toBe("https://gate.smsaero.ru/v2/sms/send");
    expect(c.method).toBe("POST");
    expect(c.headers["content-type"]).toBe("application/json");
    expect(c.headers.authorization).toBe(`Basic ${Buffer.from(`${EMAIL}:${DUMMY_KEY}`).toString("base64")}`);
    expect(c.body).toEqual({ number: "79161234567", sign: "SMS Aero", text: TEXT });
    expect(log.text).toContain("SMS Aero: message accepted");
    expect(log.text).toContain('"messageId":1001');
  });

  it("+7 numbers go out as 11 digits starting with 7 (no plus, no 8)", async () => {
    const fake = new FakeSmsAero();
    await provider(fake).send("+79509011421", TEXT);
    expect(fake.calls[0]!.body.number).toBe("79509011421");
    expect(fake.calls[0]!.body.number).toMatch(/^7\d{10}$/);
  });

  it("refuses a non-E.164 number without calling the API", async () => {
    const fake = new FakeSmsAero();
    for (const bad of ["89161234567", "79161234567", "+7 916 123-45-67", ""]) {
      expect((await sendErr(provider(fake), bad)).kind).toBe("invalid_number");
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("wrong API key / 401 → unauthorized", async () => {
    const fake = new FakeSmsAero();
    const err = await sendErr(provider(fake, new MemoryLog(), "wrongKeyValue0000000000000000000"));
    expect(err).toBeInstanceOf(SmsAeroError);
    expect(err.kind).toBe("unauthorized");
    expect(err.info.status).toBe(401);
  });

  it("429 → rate_limited with Retry-After", async () => {
    const fake = new FakeSmsAero();
    fake.faults.push({ status: 429, retryAfter: 30, body: { success: false, message: "Too many requests" } });
    const err = await sendErr(provider(fake));
    expect(err.kind).toBe("rate_limited");
    expect(err.info.retryAfterSeconds).toBe(30);
  });

  it("5xx → unavailable, and is NOT retried (no idempotency on SMS Aero: a retry could send a 2nd code)", async () => {
    const fake = new FakeSmsAero();
    fake.faults.push({ status: 503 });
    expect((await sendErr(provider(fake))).kind).toBe("unavailable");
    expect(fake.calls).toHaveLength(1);
  });

  it("timeout → timeout, single attempt; network failure → network", async () => {
    const fake = new FakeSmsAero();
    fake.faults.push("timeout");
    expect((await sendErr(provider(fake))).kind).toBe("timeout");
    expect(fake.calls).toHaveLength(1);
    fake.faults.push("network");
    expect((await sendErr(provider(fake))).kind).toBe("network");
  });

  it("malformed answers are never treated as sent", async () => {
    const cases: [Fault, string][] = [
      ["garbage", "bad_response"],
      [{ status: 200, body: { success: false, data: null, message: "Something failed" } }, "rejected"],
      [{ status: 200, body: { success: true, data: null, message: null } }, "bad_response"],
      [{ status: 200, body: { success: true, data: { from: "x" }, message: null } }, "bad_response"],
      [{ status: 200, body: { result: "no credits" } }, "no_money"],
    ];
    for (const [f, kind] of cases) {
      const fake = new FakeSmsAero();
      fake.faults.push(f);
      expect((await sendErr(provider(fake))).kind, JSON.stringify(f)).toBe(kind);
    }
  });

  it("documented error codes: 402 no money, 404 invalid ip, 400 number incorrect / sign incorrect", async () => {
    const cases: [Fault, string][] = [
      [{ status: 402, body: { success: false, data: null, message: "Not enough money" } }, "no_money"],
      [{ status: 404, body: { success: false, data: null, message: "Invalid ip-address" } }, "ip_not_allowed"],
      [{ status: 400, body: { success: false, data: { number: ["incorrect"] }, message: "Validation error." } }, "invalid_number"],
      [{ status: 400, body: { success: false, data: { sign: ["incorrect"] }, message: "Validation error." } }, "validation"],
    ];
    for (const [f, kind] of cases) {
      const fake = new FakeSmsAero();
      fake.faults.push(f);
      const err = await sendErr(provider(fake));
      expect(err.kind, JSON.stringify(f)).toBe(kind);
    }
  });

  it("a message rejected or undelivered at send time is a failure; moderation is accepted with a warning", async () => {
    const fake = new FakeSmsAero();
    fake.nextStatus = { status: 6, extendStatus: "reject" };
    expect((await sendErr(provider(fake))).kind).toBe("rejected");
    fake.nextStatus = { status: 2, extendStatus: "undelivered" };
    expect((await sendErr(provider(fake))).kind).toBe("rejected");
    const log = new MemoryLog();
    fake.nextStatus = { status: 8, extendStatus: "moderation" };
    await provider(fake, log).send(PHONE, TEXT);
    expect(log.text).toContain("moderation");
  });

  it("logs never contain the API key, email, the code / text or the full number", async () => {
    const log = new MemoryLog();
    const fake = new FakeSmsAero();
    await provider(fake, log).send(PHONE, TEXT);
    fake.faults.push({ status: 400, body: { success: false, data: { number: ["incorrect 79161234567"] }, message: "Validation error for 79161234567" } });
    await sendErr(provider(fake, log));
    fake.faults.push({ status: 500 }, "timeout");
    await sendErr(provider(fake, log));
    await sendErr(provider(fake, log));
    await sendErr(provider(fake, log, "anotherWrongKey00000000000000000"));
    const t = log.text;
    for (const secret of [DUMMY_KEY, "anotherWrongKey", EMAIL, Buffer.from(`${EMAIL}:${DUMMY_KEY}`).toString("base64"), "482913", "79161234567", "ваш код"]) {
      expect(t, secret).not.toContain(secret);
    }
    expect(t).toContain("+7 9•• ••• •• 67");
  });
});

// ---------------------------------------------------------------------------
describe("config: SMS_PROVIDER=smsaero", () => {
  const base = { NODE_ENV: "test", SMS_PROVIDER: "smsaero" };
  const prod = { NODE_ENV: "production", AUTH_ACCESS_SECRET: "a".repeat(48), AUTH_TOKEN_PEPPER: "b".repeat(48), SMS_PROVIDER: "smsaero" };

  it("requires SMS_AERO_API_KEY (and the account email) — error names the variable, never a value", () => {
    expect(() => loadConfig({ ...base, SMS_AERO_EMAIL: EMAIL } as NodeJS.ProcessEnv)).toThrow(/requires SMS_AERO_API_KEY/);
    expect(() => loadConfig({ ...base, SMS_AERO_API_KEY: DUMMY_KEY } as NodeJS.ProcessEnv)).toThrow(/requires SMS_AERO_EMAIL/);
    try {
      loadConfig({ ...base, SMS_AERO_API_KEY: DUMMY_KEY, SMS_AERO_EMAIL: "not-an-email" } as NodeJS.ProcessEnv);
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain(DUMMY_KEY);
      expect(String(e)).not.toContain("not-an-email");
    }
  });

  it("production without the key refuses to start", () => {
    expect(() => loadConfig({ ...prod, SMS_AERO_EMAIL: EMAIL } as NodeJS.ProcessEnv)).toThrow(/SMS_AERO_API_KEY/);
    expect(() => loadConfig({ ...prod, SMS_AERO_EMAIL: EMAIL, SMS_AERO_API_KEY: "   " } as NodeJS.ProcessEnv)).toThrow(/SMS_AERO_API_KEY/);
  });

  it("production with key + email builds a real SmsAeroProvider (not dev, not disabled); sign defaults to SMS Aero", () => {
    const config = loadConfig({ ...prod, SMS_AERO_EMAIL: EMAIL, SMS_AERO_API_KEY: DUMMY_KEY } as NodeJS.ProcessEnv);
    expect(config.sms.smsaero.sign).toBe("SMS Aero");
    const sms = createSmsProvider(config);
    expect(sms).toBeInstanceOf(SmsAeroProvider);
    expect(sms.isDevelopment).toBe(false);
    expect(sms.enabled).toBe(true);
    expect(sms.hosted).toBeUndefined();
  });

  it("existing SMS_PROVIDER values keep working", () => {
    expect(loadConfig({ NODE_ENV: "test", SMS_PROVIDER: "console" } as NodeJS.ProcessEnv).sms.provider).toBe("console");
    expect(loadConfig({ NODE_ENV: "test", SMS_PROVIDER: "disabled" } as NodeJS.ProcessEnv).sms.provider).toBe("disabled");
    expect(loadConfig({ NODE_ENV: "test", SMS_PROVIDER: "otpcom", OTP_API_KEY: "otp_test_x" } as NodeJS.ProcessEnv).sms.provider).toBe("otpcom");
  });
});

// ---------------------------------------------------------------------------
describe("VOIDEX flows through SMS Aero (code made and checked by VOIDEX)", () => {
  let env: TestEnv;
  let app: FastifyInstance;
  const fake = new FakeSmsAero();
  const log = new MemoryLog();

  beforeAll(async () => {
    env = await createTestEnv();
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: TEST_DATABASE_URL, SMS_PROVIDER: "smsaero", SMS_AERO_EMAIL: EMAIL, SMS_AERO_API_KEY: DUMMY_KEY } as NodeJS.ProcessEnv);
    app = await buildApp({ config, sms: new SmsAeroProvider({ email: EMAIL, apiKey: DUMMY_KEY, sign: "SMS Aero", fetch: fake.fetch, log }) });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await env.app.close();
  });
  beforeEach(() => {
    fake.calls = [];
    fake.faults = [];
  });

  const device = () => new Device(app);

  it("signup: SMS Aero carries a VOIDEX code; VOIDEX stores only its HMAC and checks it; registration completes", async () => {
    const d = device();
    const phone = uniquePhone();
    const start = await d.post("/api/auth/phone/start", { phone }, { headers: { "accept-language": "ru" } });
    expect(start.status).toBe(200);
    expect(start.body.devCode).toBeUndefined();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.body.number).toBe(phone.slice(1));
    expect(fake.calls[0]!.body.text).toMatch(/^\d{6} — ваш код подтверждения VOIDEX/);
    const code = fake.lastCode(phone)!;

    const row = await app.ctx.db.query.phoneVerifications.findFirst({ where: eq(phoneVerifications.id, start.body.verificationId) });
    expect(row?.provider).toBe("smsaero");
    expect(row?.providerRef).toBeNull();
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.codeHash).not.toContain(code);

    const wrong = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: code === "000000" ? "111111" : "000000" });
    expect(wrong.body.error.code).toBe("code_invalid");
    expect(fake.calls).toHaveLength(1); // verification never calls SMS Aero

    const ok = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code });
    expect(ok.status).toBe(200);
    const reg = await d.post("/api/auth/register", {
      firstName: "Anna",
      lastName: "Volkova",
      birthDate: "1995-04-12",
      country: "RU",
      language: "ru",
      phoneVerification: { id: start.body.verificationId, proof: ok.body.proof },
      username: uniqueUsername(),
      password: STRONG_PASSWORD,
      consents: CONSENTS,
    });
    expect(reg.status).toBe(201);
    expect(reg.body.user.mailAddress).toMatch(/@voidops\.ru$/);
  });

  it("VerificationService limits still apply: a second code within 60 s never reaches SMS Aero", async () => {
    const d = device();
    const phone = uniquePhone();
    expect((await d.post("/api/auth/phone/start", { phone })).status).toBe(200);
    const again = await d.post("/api/auth/phone/start", { phone });
    expect(again.body.error.code).toBe("code_resend_too_soon");
    expect(fake.calls).toHaveLength(1);
  });

  it("SMS Aero errors → sms_send_failed / rate_limited / phone_invalid; nothing is stored as sent", async () => {
    for (const [f, status, code] of [
      [{ status: 401 }, 502, "sms_send_failed"],
      [{ status: 503 }, 502, "sms_send_failed"],
      ["timeout", 502, "sms_send_failed"],
      [{ status: 402, body: { success: false, message: "Not enough money" } }, 502, "sms_send_failed"],
      [{ status: 429, retryAfter: 20 }, 429, "rate_limited"],
      [{ status: 400, body: { success: false, data: { number: ["incorrect"] }, message: "Validation error." } }, 400, "phone_invalid"],
    ] as [Fault, number, string][]) {
      fake.faults = [f];
      const phone = uniquePhone();
      const r = await device().post("/api/auth/phone/start", { phone });
      expect(r.status, JSON.stringify(f)).toBe(status);
      expect(r.body.error.code).toBe(code);
      expect(r.body.verificationId).toBeUndefined();
      expect(await app.ctx.db.query.phoneVerifications.findFirst({ where: eq(phoneVerifications.phone, phone) })).toBeUndefined();
    }
  });

  it("new-device sign-in and password recovery send their codes through SMS Aero", async () => {
    const { address, phone } = await signUp(new Device(env.app));
    const mac = new Device(app, "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/130.0 Safari/537.36");
    const login = await mac.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD });
    expect(login.body.challenge.methods).toContain("sms");
    const { id, secret } = login.body.challenge;
    expect((await mac.post(`/api/auth/challenges/${id}/sms`, { secret })).status).toBe(200);
    expect((await mac.post(`/api/auth/challenges/${id}/verify-sms`, { secret, code: fake.lastCode(phone) })).status).toBe(200);
    expect((await mac.post(`/api/auth/challenges/${id}/complete`, { secret })).status).toBe(200);

    const rec = (await device().post("/api/auth/recovery/start", { identifier: address })).body;
    // Same number, different purpose: the per-purpose cooldown lets it through.
    const sms = await device().post(`/api/auth/challenges/${rec.id}/sms`, { secret: rec.secret });
    expect(sms.status).toBe(200);
    expect(fake.calls.at(-1)!.body.number).toBe(phone.slice(1));
  });

  it("server logs from these flows contain no key, email, code or full number", () => {
    const t = log.text;
    expect(t).not.toContain(DUMMY_KEY);
    expect(t).not.toContain(EMAIL);
    expect(t).not.toMatch(/\b7\d{10}\b/);
    for (const c of fake.calls) {
      const code = c.body?.text?.match(/\d{6}/)?.[0];
      if (code) expect(t).not.toContain(code);
    }
  });
});
