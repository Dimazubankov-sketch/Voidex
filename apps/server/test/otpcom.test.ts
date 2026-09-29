import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { phoneVerifications } from "../src/db/schema.js";
import { OtpComSmsProvider, OtpProviderError } from "../src/services/sms/index.js";
import { publicClientIp } from "../src/services/sms/otpcom.js";
import { CONSENTS, Device, STRONG_PASSWORD, TEST_DATABASE_URL, createTestEnv, signUp, uniquePhone, uniqueUsername, type TestEnv } from "./helpers.js";

/**
 * otp.com integration, tested against an in-memory fake of its REST API.
 * No real key and no network: the key below is a dummy that never leaves the test.
 */
const DUMMY_KEY = "otp_test_dummy_key_for_unit_tests_only_0000";

type Fault = { status: number; type?: string; message?: string; retryAfter?: number } | "timeout" | "network" | "garbage";

class FakeOtpCom {
  otps = new Map<string, { recipient: string; code: string; status: string; attempts: number }>();
  idem = new Map<string, unknown>();
  calls: { method: string; path: string; headers: Record<string, string>; body: any }[] = [];
  /** Faults returned by the next calls (FIFO), per endpoint. */
  faults: Record<string, Fault[]> = {};
  sends = 0;
  seq = 0;
  nextActionUrl: string | null = null;

  fault(op: "send" | "verify" | "status", ...f: Fault[]) {
    (this.faults[op] ??= []).push(...f);
  }

  lastCode(recipient: string) {
    return [...this.otps.values()].reverse().find((o) => o.recipient === recipient)?.code;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method: init?.method ?? "GET", path, headers, body });
    const json = (status: number, data: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...extra } });

    if (headers.authorization !== `Bearer ${DUMMY_KEY}`) {
      return json(401, { error: { type: "HTTPException", message: "Missing, invalid, or revoked API key." } });
    }
    const op = path === "/otp/send" ? "send" : path === "/otp/verify" ? "verify" : path.startsWith("/otp/") && init?.method !== "POST" ? "status" : "other";
    const f = this.faults[op]?.shift();
    if (f === "timeout") {
      // What AbortSignal.timeout produces; the request may still have reached otp.com.
      if (op === "send") this.handleSend(headers, body);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    if (f === "network") throw new TypeError("fetch failed");
    if (f === "garbage") return new Response("<html>bad gateway</html>", { status: 200 });
    if (f) {
      return json(f.status, { error: { type: f.type ?? "Error", message: f.message ?? "error" } }, f.retryAfter ? { "retry-after": String(f.retryAfter) } : {});
    }

    if (op === "send") return json(200, this.handleSend(headers, body));
    if (op === "verify") {
      const otp = this.otps.get(body.otp_id);
      if (!otp) return json(404, { error: { type: "HTTPException", message: "Not found" } });
      if (otp.status !== "pending") return json(200, { otp_id: body.otp_id, status: otp.status, matched: false });
      if (body.code === otp.code) {
        otp.status = "approved";
        return json(200, { otp_id: body.otp_id, status: "approved", matched: true });
      }
      otp.attempts += 1;
      if (otp.attempts >= 3) otp.status = "failed";
      return json(200, { otp_id: body.otp_id, status: otp.status, matched: false });
    }
    if (op === "status") {
      const otp = this.otps.get(path.slice("/otp/".length));
      if (!otp) return json(404, { error: { type: "HTTPException", message: "Not found" } });
      return json(200, { otp_id: path.slice(5), status: otp.status, masked_recipient: "+7****67" });
    }
    return json(404, { error: { type: "HTTPException", message: "Not found" } });
  };

  private handleSend(headers: Record<string, string>, body: any) {
    const key = headers["idempotency-key"];
    if (key && this.idem.has(key)) return this.idem.get(key);
    this.sends += 1;
    const otpId = `otp-${++this.seq}-${crypto.randomUUID()}`;
    const code = String(100000 + Math.floor(Math.random() * 900000));
    this.otps.set(otpId, { recipient: body.recipient, code, status: "pending", attempts: 0 });
    const res = { otp_id: otpId, status: "pending", channel: this.nextActionUrl ? "whatsapp" : "sms", masked_recipient: "+7****67", action_url: this.nextActionUrl };
    if (key) this.idem.set(key, res);
    return res;
  }
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

function provider(fake: FakeOtpCom, log = new MemoryLog(), apiKey = DUMMY_KEY) {
  return new OtpComSmsProvider({ apiKey, fetch: fake.fetch, log, retryDelayMs: 0 });
}

const PHONE = "+79161234567";

// ---------------------------------------------------------------------------
describe("OtpComSmsProvider (mock HTTP)", () => {
  it("sends: POST /otp/send with Bearer key, E.164 recipient, end-user IP, locale and idempotency key — no channel", async () => {
    const fake = new FakeOtpCom();
    const log = new MemoryLog();
    const sent = await provider(fake, log).start({ to: PHONE, clientIp: "81.2.69.142", locale: "ru", idempotencyKey: "voidex:signup:abc" });
    expect(sent.ref).toMatch(/^otp-/);
    expect(sent.channel).toBe("sms");
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/otp/send");
    expect(call.headers.authorization).toBe(`Bearer ${DUMMY_KEY}`);
    expect(call.headers["idempotency-key"]).toBe("voidex:signup:abc");
    expect(call.body).toEqual({ recipient: PHONE, locale: "ru", client_ip: "81.2.69.142" });
    expect(call.body).not.toHaveProperty("channel");
    // Logs: masked number, no key, no code.
    expect(log.text).toContain("otp.com: code sent");
    expect(log.text).not.toContain(DUMMY_KEY);
    expect(log.text).not.toContain(PHONE);
    expect(log.text).not.toContain(fake.lastCode(PHONE)!);
  });

  it("normalises the client IP and omits unusable ones", async () => {
    expect(publicClientIp("::ffff:81.2.69.142")).toBe("81.2.69.142");
    expect(publicClientIp("2001:db8::1")).toBe("2001:db8::1");
    expect(publicClientIp("not-an-ip")).toBeUndefined();
    expect(publicClientIp(null)).toBeUndefined();
    const fake = new FakeOtpCom();
    await provider(fake).start({ to: PHONE, clientIp: "garbage", idempotencyKey: "k1" });
    expect(fake.calls[0]!.body).toEqual({ recipient: PHONE });
  });

  it("refuses a number that is not E.164 without calling otp.com", async () => {
    const fake = new FakeOtpCom();
    const err = await provider(fake).start({ to: "89161234567", clientIp: null, idempotencyKey: "k" }).catch((e) => e);
    expect(err).toBeInstanceOf(OtpProviderError);
    expect(err.kind).toBe("invalid_recipient");
    expect(fake.calls).toHaveLength(0);
  });

  it("verifies: matched=true + approved", async () => {
    const fake = new FakeOtpCom();
    const p = provider(fake);
    const { ref } = await p.start({ to: PHONE, clientIp: null, idempotencyKey: "k" });
    const r = await p.check(ref, fake.lastCode(PHONE)!);
    expect(r).toEqual({ matched: true, status: "approved" });
    expect(fake.calls[1]!.body).toEqual({ otp_id: ref, code: fake.lastCode(PHONE) });
  });

  it("wrong code: matched=false, pending; exhausted → failed", async () => {
    const fake = new FakeOtpCom();
    const p = provider(fake);
    const { ref } = await p.start({ to: PHONE, clientIp: null, idempotencyKey: "k" });
    expect(await p.check(ref, "000000")).toEqual({ matched: false, status: "pending" });
    await p.check(ref, "000001");
    expect(await p.check(ref, "000002")).toEqual({ matched: false, status: "failed" });
  });

  it("expired verification is reported as expired, unknown otp_id as not_found", async () => {
    const fake = new FakeOtpCom();
    const p = provider(fake);
    const { ref } = await p.start({ to: PHONE, clientIp: null, idempotencyKey: "k" });
    fake.otps.get(ref)!.status = "expired";
    expect(await p.check(ref, fake.lastCode(PHONE)!)).toEqual({ matched: false, status: "expired" });
    expect(await p.status(ref)).toBe("expired");
    const err = await p.check("otp-missing", "123456").catch((e) => e);
    expect(err.kind).toBe("not_found");
  });

  it("401 (invalid or revoked key) → unauthorized, never retried, key not logged", async () => {
    const fake = new FakeOtpCom();
    const log = new MemoryLog();
    const bad = "otp_live_wrong_key_value_123";
    const p = provider(fake, log, bad);
    const err = await p.start({ to: PHONE, clientIp: null, idempotencyKey: "k" }).catch((e) => e);
    expect(err.kind).toBe("unauthorized");
    expect(err.info.status).toBe(401);
    expect(fake.calls).toHaveLength(1);
    expect(log.text).not.toContain(bad);
    expect(String(err.message)).not.toContain(bad);
    expect(await p.probe()).toBe("unauthorized");
  });

  it("probe: a valid key sees 404 for an OTP that cannot exist → ok, and sends nothing", async () => {
    const fake = new FakeOtpCom();
    expect(await provider(fake).probe()).toBe("ok");
    expect(fake.sends).toBe(0);
  });

  it("429 → rate_limited with Retry-After", async () => {
    const fake = new FakeOtpCom();
    fake.fault("send", { status: 429, type: "RateLimitExceededError", message: "Too many requests for recipient +79161234567", retryAfter: 42 });
    const log = new MemoryLog();
    const err = await provider(fake, log).start({ to: PHONE, clientIp: null, idempotencyKey: "k" }).catch((e) => e);
    expect(err.kind).toBe("rate_limited");
    expect(err.info.retryAfterSeconds).toBe(42);
    expect(fake.calls).toHaveLength(1);
    // otp.com's message quoted the number: it is scrubbed before logging.
    expect(log.text).not.toContain(PHONE);
    expect(log.text).toContain("RateLimitExceededError");
  });

  it("maps 402 / 403 / 422 / 5xx", async () => {
    const cases: [Fault, string][] = [
      [{ status: 402, type: "InsufficientFundsError" }, "insufficient_funds"],
      [{ status: 403, type: "GeoBlockedError" }, "geo_blocked"],
      [{ status: 403, type: "IpReputationBlockedError" }, "ip_blocked"],
      [{ status: 422, type: "InvalidRecipientError" }, "invalid_recipient"],
      [{ status: 422, type: "ValidationError" }, "bad_request"],
    ];
    for (const [f, kind] of cases) {
      const fake = new FakeOtpCom();
      fake.fault("send", f);
      const err = await provider(fake).start({ to: PHONE, clientIp: null, idempotencyKey: "k" }).catch((e) => e);
      expect(err.kind, JSON.stringify(f)).toBe(kind);
      expect(fake.calls).toHaveLength(1);
    }
    const fake = new FakeOtpCom();
    fake.fault("send", { status: 503 }, { status: 502 });
    const err = await provider(fake).start({ to: PHONE, clientIp: null, idempotencyKey: "k" }).catch((e) => e);
    expect(err.kind).toBe("unavailable");
    expect(fake.calls).toHaveLength(2); // one retry, then give up
  });

  it("idempotency: a timeout is retried once with the SAME key and the user gets exactly one code", async () => {
    const fake = new FakeOtpCom();
    fake.fault("send", "timeout"); // otp.com did send, but the answer was lost
    const sent = await provider(fake).start({ to: PHONE, clientIp: "81.2.69.142", idempotencyKey: "voidex:signup:v1" });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.headers["idempotency-key"]).toBe("voidex:signup:v1");
    expect(fake.calls[1]!.headers["idempotency-key"]).toBe("voidex:signup:v1");
    expect(fake.sends).toBe(1);
    expect(fake.otps.has(sent.ref)).toBe(true);
  });

  it("timeout twice / network down → error, no third attempt", async () => {
    const fake = new FakeOtpCom();
    fake.fault("send", "timeout", "timeout");
    const err = await provider(fake).start({ to: PHONE, clientIp: null, idempotencyKey: "k" }).catch((e) => e);
    expect(err.kind).toBe("timeout");
    expect(fake.calls).toHaveLength(2);

    const down = new FakeOtpCom();
    down.fault("send", "network", "network");
    expect((await provider(down).start({ to: PHONE, clientIp: null, idempotencyKey: "k" }).catch((e) => e)).kind).toBe("network");
  });

  it("verify is never retried (a retry could burn an extra attempt)", async () => {
    const fake = new FakeOtpCom();
    const p = provider(fake);
    const { ref } = await p.start({ to: PHONE, clientIp: null, idempotencyKey: "k" });
    fake.fault("verify", "timeout");
    expect((await p.check(ref, "123456").catch((e) => e)).kind).toBe("timeout");
    expect(fake.calls.filter((c) => c.path === "/otp/verify")).toHaveLength(1);
  });

  it("malformed success response → unavailable", async () => {
    const fake = new FakeOtpCom();
    fake.fault("send", "garbage", "garbage");
    expect((await provider(fake).start({ to: PHONE, clientIp: null, idempotencyKey: "k" }).catch((e) => e)).kind).toBe("unavailable");
  });

  it("refuses a click-to-chat (WhatsApp link) routing instead of pretending a code was sent", async () => {
    const fake = new FakeOtpCom();
    fake.nextActionUrl = "https://wa.me/1?text=x";
    expect((await provider(fake).start({ to: PHONE, clientIp: null, idempotencyKey: "k" }).catch((e) => e)).kind).toBe("unsupported_channel");
  });
});

// ---------------------------------------------------------------------------
describe("config: SMS_PROVIDER=otpcom", () => {
  const prod = { NODE_ENV: "production", AUTH_ACCESS_SECRET: "a".repeat(48), AUTH_TOKEN_PEPPER: "b".repeat(48), SMS_PROVIDER: "otpcom" };

  it("requires OTP_API_KEY", () => {
    expect(() => loadConfig(prod as NodeJS.ProcessEnv)).toThrow(/requires OTP_API_KEY/);
  });

  it("accepts only a live server key in production (sandbox keys accept a fixed code)", () => {
    const live = "otp_live_" + "x".repeat(32);
    expect(loadConfig({ ...prod, OTP_API_KEY: live } as NodeJS.ProcessEnv).sms.otpcom.apiKey).toBe(live);
    expect(() => loadConfig({ ...prod, OTP_API_KEY: DUMMY_KEY } as NodeJS.ProcessEnv)).toThrow(/live key/);
    expect(() => loadConfig({ ...prod, OTP_API_KEY: "otp_pk_live_abc" } as NodeJS.ProcessEnv)).toThrow(/server key/);
  });

  it("error messages never contain the key", () => {
    const secret = "otp_pk_live_NOTAREALKEY123";
    try {
      loadConfig({ ...prod, OTP_API_KEY: secret } as NodeJS.ProcessEnv);
    } catch (e) {
      expect(String(e)).not.toContain("NOTAREALKEY123");
    }
    try {
      loadConfig({ ...prod, OTP_API_KEY: "otp_test_NOTAREALKEY123" } as NodeJS.ProcessEnv);
    } catch (e) {
      expect(String(e)).not.toContain("NOTAREALKEY123");
    }
  });
});

// ---------------------------------------------------------------------------
describe("VOIDEX auth flows through otp.com", () => {
  let env: TestEnv;
  let app: FastifyInstance;
  const fake = new FakeOtpCom();

  beforeAll(async () => {
    env = await createTestEnv(); // for creating an existing account
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      SMS_PROVIDER: "otpcom",
      OTP_API_KEY: DUMMY_KEY,
      TRUST_PROXY: "true",
    } as NodeJS.ProcessEnv);
    app = await buildApp({ config, sms: new OtpComSmsProvider({ apiKey: DUMMY_KEY, fetch: fake.fetch, retryDelayMs: 0 }) });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await env.app.close();
  });
  beforeEach(() => {
    fake.calls = [];
    fake.faults = {};
  });

  const USER_IP = "81.2.69.142";
  const device = () => new Device(app);
  const fromUser = { headers: { "x-forwarded-for": USER_IP } };

  async function row(id: string) {
    return app.ctx.db.query.phoneVerifications.findFirst({ where: eq(phoneVerifications.id, id) });
  }

  it("reports otp.com as the available SMS provider and exposes no key", async () => {
    const info = await device().get("/api/system/info");
    expect(info.body.smsProvider).toBe("otpcom");
    expect(info.body.smsAvailable).toBe(true);
    expect(info.body.smsDevMode).toBe(false);
    expect(JSON.stringify(info.body)).not.toContain(DUMMY_KEY);
  });

  it("signup: SMS via otp.com, otp_id stored (no code), real end-user IP, then registration", async () => {
    const d = device();
    const phone = uniquePhone();
    const start = await d.post("/api/auth/phone/start", { phone }, fromUser);
    expect(start.status).toBe(200);
    expect(start.body.devCode).toBeUndefined();
    expect(JSON.stringify(start.body)).not.toContain(DUMMY_KEY);

    const send = fake.calls.find((c) => c.path === "/otp/send")!;
    expect(send.body.recipient).toBe(phone);
    expect(send.body.client_ip).toBe(USER_IP);
    expect(send.headers["idempotency-key"]).toBe(`voidex:signup:${start.body.verificationId}`);

    const stored = await row(start.body.verificationId);
    expect(stored?.provider).toBe("otpcom");
    expect(stored?.providerRef).toMatch(/^otp-/);
    expect(stored?.codeHash).toBeNull();

    const wrong = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: "000000" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("code_invalid");
    expect(wrong.body.error.details.attemptsLeft).toBe(4);

    const ok = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: fake.lastCode(phone) });
    expect(ok.status).toBe(200);
    expect(ok.body.phone).toBe(phone);
    const verifyCall = fake.calls.filter((c) => c.path === "/otp/verify").at(-1)!;
    expect(verifyCall.body.otp_id).toBe(stored?.providerRef);

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

  it("the same code cannot be used twice", async () => {
    const d = device();
    const phone = uniquePhone();
    const start = await d.post("/api/auth/phone/start", { phone }, fromUser);
    const code = fake.lastCode(phone);
    expect((await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code })).status).toBe(200);
    const again = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code });
    expect(again.body.error.code).toBe("code_expired");
  });

  it("expired OTP at otp.com → code_expired", async () => {
    const d = device();
    const phone = uniquePhone();
    const start = await d.post("/api/auth/phone/start", { phone }, fromUser);
    const stored = await row(start.body.verificationId);
    fake.otps.get(stored!.providerRef!)!.status = "expired";
    const r = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: fake.lastCode(phone) });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe("code_expired");
  });

  it("too many wrong codes at otp.com (failed) → code_attempts_exceeded, even the right code is refused", async () => {
    const d = device();
    const phone = uniquePhone();
    const start = await d.post("/api/auth/phone/start", { phone }, fromUser);
    const id = start.body.verificationId;
    await d.post("/api/auth/phone/verify", { verificationId: id, code: "000000" });
    await d.post("/api/auth/phone/verify", { verificationId: id, code: "000001" });
    const third = await d.post("/api/auth/phone/verify", { verificationId: id, code: "000002" });
    expect(third.body.error.code).toBe("code_attempts_exceeded");
    const right = await d.post("/api/auth/phone/verify", { verificationId: id, code: fake.lastCode(phone) });
    expect(right.body.error.code).toBe("code_attempts_exceeded");
  });

  it("resend = a fresh otp.com send with a new idempotency key (after the cooldown)", async () => {
    const d = device();
    const phone = uniquePhone();
    const first = await d.post("/api/auth/phone/start", { phone }, fromUser);
    const tooSoon = await d.post("/api/auth/phone/start", { phone }, fromUser);
    expect(tooSoon.body.error.code).toBe("code_resend_too_soon");
    await app.ctx.db
      .update(phoneVerifications)
      .set({ createdAt: new Date(Date.now() - 61_000) })
      .where(eq(phoneVerifications.id, first.body.verificationId));
    const second = await d.post("/api/auth/phone/start", { phone }, fromUser);
    expect(second.status).toBe(200);
    const keys = fake.calls.filter((c) => c.path === "/otp/send").map((c) => c.headers["idempotency-key"]);
    expect(keys).toEqual([`voidex:signup:${first.body.verificationId}`, `voidex:signup:${second.body.verificationId}`]);
  });

  it("otp.com down / key rejected / no balance → sms_send_failed, nothing stored, no fallback", async () => {
    for (const f of [{ status: 503 }, { status: 401 }, { status: 402, type: "InsufficientFundsError" }] as Fault[]) {
      fake.faults = {};
      fake.fault("send", f, f);
      const phone = uniquePhone();
      const r = await device().post("/api/auth/phone/start", { phone }, fromUser);
      expect(r.status, JSON.stringify(f)).toBe(502);
      expect(r.body.error.code).toBe("sms_send_failed");
      expect(r.body.verificationId).toBeUndefined();
      expect(await app.ctx.db.query.phoneVerifications.findFirst({ where: eq(phoneVerifications.phone, phone) })).toBeUndefined();
    }
  });

  it("otp.com rate limit → 429 rate_limited; VPN/proxy IP → sms_network_blocked; blocked country → sms_country_unsupported", async () => {
    fake.fault("send", { status: 429, type: "RateLimitExceededError", retryAfter: 30 });
    const a = await device().post("/api/auth/phone/start", { phone: uniquePhone() }, fromUser);
    expect(a.status).toBe(429);
    expect(a.body.error.code).toBe("rate_limited");
    expect(a.body.error.details.retryAfterSeconds).toBe(30);

    fake.fault("send", { status: 403, type: "IpReputationBlockedError" });
    const b = await device().post("/api/auth/phone/start", { phone: uniquePhone() }, fromUser);
    expect(b.body.error.code).toBe("sms_network_blocked");

    fake.fault("send", { status: 403, type: "GeoBlockedError" });
    const c = await device().post("/api/auth/phone/start", { phone: uniquePhone() }, fromUser);
    expect(c.body.error.code).toBe("sms_country_unsupported");
  });

  it("timeout on send: retried with the same key, exactly one SMS", async () => {
    const before = fake.sends;
    fake.fault("send", "timeout");
    const phone = uniquePhone();
    const r = await device().post("/api/auth/phone/start", { phone }, fromUser);
    expect(r.status).toBe(200);
    expect(fake.sends - before).toBe(1);
    const keys = fake.calls.filter((c) => c.path === "/otp/send").map((c) => c.headers["idempotency-key"]);
    expect(new Set(keys).size).toBe(1);
  });

  it("otp.com unavailable during verify → 503, no attempt burned; the code still works afterwards", async () => {
    const d = device();
    const phone = uniquePhone();
    const start = await d.post("/api/auth/phone/start", { phone }, fromUser);
    fake.fault("verify", { status: 500 });
    const down = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: fake.lastCode(phone) });
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe("service_unavailable");
    expect((await row(start.body.verificationId))?.attempts).toBe(0);
    const ok = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: fake.lastCode(phone) });
    expect(ok.status).toBe(200);
  });

  it("new-device sign-in: SMS challenge goes through otp.com with the user's IP", async () => {
    const { address, phone } = await signUp(new Device(env.app));
    const mac = new Device(app, "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/130.0 Safari/537.36");
    const login = await mac.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD }, fromUser);
    expect(login.body.status).toBe("challenge");
    expect(login.body.challenge.methods).toContain("sms");
    const { id, secret } = login.body.challenge;
    const sms = await mac.post(`/api/auth/challenges/${id}/sms`, { secret }, fromUser);
    expect(sms.status).toBe(200);
    const send = fake.calls.find((c) => c.path === "/otp/send")!;
    expect(send.body.recipient).toBe(phone);
    expect(send.body.client_ip).toBe(USER_IP);
    expect(send.headers["idempotency-key"]).toBe(`voidex:login:${sms.body.verificationId}`);
    expect((await mac.post(`/api/auth/challenges/${id}/verify-sms`, { secret, code: "000000" })).body.error.code).toBe("code_invalid");
    expect((await mac.post(`/api/auth/challenges/${id}/verify-sms`, { secret, code: fake.lastCode(phone) })).status).toBe(200);
    const done = await mac.post(`/api/auth/challenges/${id}/complete`, { secret });
    expect(done.status).toBe(200);
    expect(done.body.accessToken).toBeTruthy();
  });

  it("password recovery by SMS goes through otp.com", async () => {
    const { address, phone } = await signUp(new Device(env.app));
    const d = device();
    const rec = await d.post("/api/auth/recovery/start", { identifier: address }, fromUser);
    const { id, secret } = rec.body;
    const sms = await d.post(`/api/auth/challenges/${id}/sms`, { secret }, fromUser);
    expect(sms.status).toBe(200);
    expect(fake.calls.find((c) => c.path === "/otp/send")!.headers["idempotency-key"]).toBe(`voidex:recovery:${sms.body.verificationId}`);
    expect((await d.post(`/api/auth/challenges/${id}/verify-sms`, { secret, code: fake.lastCode(phone) })).status).toBe(200);
  });
});
