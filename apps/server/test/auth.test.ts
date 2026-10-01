import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONSENTS, Device, STRONG_PASSWORD, createTestEnv, signUp, uniquePhone, uniqueUsername, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

async function verifiedPhone(device: Device, phone = uniquePhone()) {
  const start = await device.post("/api/auth/phone/start", { phone });
  expect(start.status).toBe(200);
  const verify = await device.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: start.body.devCode });
  expect(verify.status).toBe(200);
  return { phone, id: start.body.verificationId as string, proof: verify.body.proof as string };
}

function registration(v: { id: string; proof: string }, overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Ivan",
    lastName: "Petrov",
    birthDate: "1990-01-15",
    country: "RU",
    language: "ru",
    phoneVerification: { id: v.id, proof: v.proof },
    username: uniqueUsername("ivan"),
    password: STRONG_PASSWORD,
    consents: CONSENTS,
    ...overrides,
  };
}

describe("registration", () => {
  it("creates an account, mail address, session and preinstalled apps", async () => {
    const d = new Device(env.app);
    const { user, address } = await signUp(d);
    expect(user.mailAddress).toBe(address);
    expect(user.phoneVerifiedAt).toBeTruthy();
    expect(d.cookies.vx_rt).toBeTruthy();
    expect(d.cookies.vx_did).toBeTruthy();
    const me = await d.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.firstName).toBe("Anna");
    const apps = await d.get("/api/apps");
    expect(apps.body.map((a: { id: string }) => a.id).sort()).toEqual(["mail", "settings", "vibex"]);
  });

  it("rejects an already linked phone before sending SMS", async () => {
    const d = new Device(env.app);
    const { phone } = await signUp(d);
    const again = await new Device(env.app).post("/api/auth/phone/start", { phone });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("phone_taken");
  });

  it("rejects invalid phone numbers", async () => {
    const r = await new Device(env.app).post("/api/auth/phone/start", { phone: "+7 123" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("phone_invalid");
  });

  it("reports taken usernames with available suggestions", async () => {
    const d = new Device(env.app);
    const { username } = await signUp(d);
    const r = await d.get(`/api/auth/username/check?username=${username}&firstName=Anna&lastName=Volkova`);
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toBe("taken");
    expect(r.body.suggestions.length).toBeGreaterThan(0);
    const free = await d.get(`/api/auth/username/check?username=${uniqueUsername("free")}`);
    expect(free.body.available).toBe(true);
    const reserved = await d.get(`/api/auth/username/check?username=admin`);
    expect(reserved.body.reason).toBe("reserved");
  });

  it("rejects a duplicate username at registration", async () => {
    const d = new Device(env.app);
    const { username } = await signUp(d);
    const d2 = new Device(env.app);
    const v = await verifiedPhone(d2);
    const r = await d2.post("/api/auth/register", registration(v, { username }));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("username_taken");
  });

  it("validates dates of birth", async () => {
    const d = new Device(env.app);
    const v = await verifiedPhone(d);
    const bad = await d.post("/api/auth/register", registration(v, { birthDate: "2001-02-29" }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.birthDate).toBe("invalid");
    const young = await d.post("/api/auth/register", registration(v, { birthDate: "2020-01-01" }));
    expect(young.body.error.code).toBe("too_young");
    const future = await d.post("/api/auth/register", registration(v, { birthDate: "2099-01-01" }));
    expect(future.body.error.fields.birthDate).toBe("future");
  });

  it("rejects weak passwords", async () => {
    const d = new Device(env.app);
    const v = await verifiedPhone(d);
    const r = await d.post("/api/auth/register", registration(v, { password: "password123" }));
    expect(r.body.error.code).toBe("password_weak");
  });

  it("requires explicit consent to every required document", async () => {
    const d = new Device(env.app);
    const v = await verifiedPhone(d);
    const r = await d.post("/api/auth/register", registration(v, { consents: CONSENTS.slice(0, 2) }));
    expect(r.body.error.code).toBe("consent_required");
    const outdated = await d.post("/api/auth/register", registration(v, { consents: CONSENTS.map((c) => ({ ...c, version: "old" })) }));
    expect(outdated.body.error.code).toBe("consent_required");
  });

  it("refuses registration without a verified phone proof, and proofs are single-use", async () => {
    const d = new Device(env.app);
    const forged = await d.post("/api/auth/register", registration({ id: crypto.randomUUID(), proof: "x".repeat(43) }));
    expect(forged.body.error.code).toBe("phone_not_verified");
    const v = await verifiedPhone(d);
    expect((await d.post("/api/auth/register", registration(v))).status).toBe(201);
    const reuse = await new Device(env.app).post("/api/auth/register", registration(v));
    expect(reuse.body.error.code).toBe("phone_not_verified");
  });
});

describe("OTP", () => {
  it("rejects wrong codes, counts attempts and locks after 5", async () => {
    const d = new Device(env.app);
    const start = await d.post("/api/auth/phone/start", { phone: uniquePhone() });
    const wrong = start.body.devCode === "000000" ? "111111" : "000000";
    const r1 = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: wrong });
    expect(r1.body.error.code).toBe("code_invalid");
    expect(r1.body.error.details.attemptsLeft).toBe(4);
    for (let i = 0; i < 4; i++) await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: wrong });
    const locked = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: start.body.devCode });
    expect(locked.body.error.code).toBe("code_attempts_exceeded");
  });

  it("expires codes after 10 minutes", async () => {
    const d = new Device(env.app);
    const start = await d.post("/api/auth/phone/start", { phone: uniquePhone() });
    env.clock.advance(11 * 60_000);
    const r = await d.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: start.body.devCode });
    env.clock.advance(-11 * 60_000);
    expect(r.body.error.code).toBe("code_expired");
  });

  it("throttles resending to the same number", async () => {
    const d = new Device(env.app);
    const phone = uniquePhone();
    expect((await d.post("/api/auth/phone/start", { phone })).status).toBe(200);
    const again = await d.post("/api/auth/phone/start", { phone });
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe("code_resend_too_soon");
  });

  it("actually hands the code to the SMS provider", async () => {
    const d = new Device(env.app);
    const phone = uniquePhone();
    const start = await d.post("/api/auth/phone/start", { phone });
    const sent = env.sms.outbox.at(-1)!;
    expect(sent.to).toBe(phone);
    expect(sent.text).toContain(start.body.devCode);
  });
});

describe("sign-in", () => {
  it("signs in immediately on a trusted device, by address, username or phone", async () => {
    const phoneDevice = new Device(env.app);
    const { address, username, phone } = await signUp(phoneDevice);
    for (const identifier of [address, username, phone]) {
      const r = await phoneDevice.post("/api/auth/login", { identifier, password: STRONG_PASSWORD });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("ok");
    }
  });

  it("rejects a wrong password with a generic message", async () => {
    const d = new Device(env.app);
    const { address } = await signUp(d);
    const r = await d.post("/api/auth/login", { identifier: address, password: "Wrong-Password-1" });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("invalid_credentials");
    const unknown = await d.post("/api/auth/login", { identifier: "nobody-here@voidops.ru", password: "Wrong-Password-1" });
    expect(unknown.body.error.code).toBe("invalid_credentials");
  });

  it("locks the account after repeated failures (brute-force protection)", async () => {
    const d = new Device(env.app);
    const { address } = await signUp(d);
    let last;
    for (let i = 0; i < 5; i++) last = await d.post("/api/auth/login", { identifier: address, password: `Wrong-Password-${i}` });
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe("account_locked");
    const correct = await d.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD });
    expect(correct.body.error.code).toBe("account_locked");
  });

  it("requires a second factor on a new device: SMS path", async () => {
    const phone = new Device(env.app);
    const { address, user } = await signUp(phone);
    const mac = new Device(env.app, MAC_UA);
    const login = await mac.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD });
    expect(login.body.status).toBe("challenge");
    const ch = login.body.challenge;
    expect(ch.methods).toEqual(["sms", "device"]);
    expect(ch.phoneMasked).toContain("•");

    // Completing before verification is refused.
    const early = await mac.post(`/api/auth/challenges/${ch.id}/complete`, { secret: ch.secret });
    expect(early.body.error.code).toBe("challenge_pending");

    const sms = await mac.post(`/api/auth/challenges/${ch.id}/sms`, { secret: ch.secret });
    const bad = await mac.post(`/api/auth/challenges/${ch.id}/verify-sms`, { secret: ch.secret, code: sms.body.devCode === "123456" ? "654321" : "123456" });
    expect(bad.body.error.code).toBe("code_invalid");
    const ok = await mac.post(`/api/auth/challenges/${ch.id}/verify-sms`, { secret: ch.secret, code: sms.body.devCode });
    expect(ok.status).toBe(200);
    const done = await mac.post(`/api/auth/challenges/${ch.id}/complete`, { secret: ch.secret });
    expect(done.status).toBe(200);
    expect(done.body.user.id).toBe(user.id);

    // Same account, same data on the second device.
    const meMac = await mac.get("/api/me");
    const mePhone = await phone.get("/api/me");
    expect(meMac.body).toEqual(mePhone.body);

    // The challenge cannot be replayed.
    const replay = await new Device(env.app).post(`/api/auth/challenges/${ch.id}/complete`, { secret: ch.secret });
    expect(replay.status).toBeGreaterThanOrEqual(400);

    // Next sign-in from the now-trusted Mac needs no challenge.
    const again = await mac.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD });
    expect(again.body.status).toBe("ok");
  });

  it("requires a second factor on a new device: approval from a trusted device", async () => {
    const phone = new Device(env.app);
    const { address } = await signUp(phone);
    const mac = new Device(env.app, MAC_UA);
    const { body } = await mac.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD });
    const ch = body.challenge;
    expect((await mac.post(`/api/auth/challenges/${ch.id}/device`, { secret: ch.secret })).status).toBe(200);

    const pending = await phone.get("/api/security/approvals");
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0].deviceName).toContain("Mac");

    // Wrong secret cannot read the challenge.
    const spy = await mac.post(`/api/auth/challenges/${ch.id}/status`, { secret: "y".repeat(43) });
    expect(spy.status).toBe(404);

    expect((await mac.post(`/api/auth/challenges/${ch.id}/status`, { secret: ch.secret })).body.status).toBe("pending");
    expect((await phone.post(`/api/security/approvals/${ch.id}`, { decision: "approve" })).status).toBe(200);
    expect((await mac.post(`/api/auth/challenges/${ch.id}/status`, { secret: ch.secret })).body.status).toBe("approved");
    const done = await mac.post(`/api/auth/challenges/${ch.id}/complete`, { secret: ch.secret });
    expect(done.status).toBe(200);
  });

  it("a denied approval cannot be completed", async () => {
    const phone = new Device(env.app);
    const { address } = await signUp(phone);
    const mac = new Device(env.app, MAC_UA);
    const ch = (await mac.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD })).body.challenge;
    await mac.post(`/api/auth/challenges/${ch.id}/device`, { secret: ch.secret });
    await phone.post(`/api/security/approvals/${ch.id}`, { decision: "deny" });
    const done = await mac.post(`/api/auth/challenges/${ch.id}/complete`, { secret: ch.secret });
    expect(done.body.error.code).toBe("challenge_denied");
  });

  it("another user cannot approve someone else's sign-in", async () => {
    const victimPhone = new Device(env.app);
    const { address } = await signUp(victimPhone);
    const attacker = new Device(env.app);
    await signUp(attacker);
    const mac = new Device(env.app, MAC_UA);
    const ch = (await mac.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD })).body.challenge;
    await mac.post(`/api/auth/challenges/${ch.id}/device`, { secret: ch.secret });
    expect((await attacker.get("/api/security/approvals")).body).toHaveLength(0);
    const r = await attacker.post(`/api/security/approvals/${ch.id}`, { decision: "approve" });
    expect(r.status).toBe(404);
    expect((await mac.post(`/api/auth/challenges/${ch.id}/status`, { secret: ch.secret })).body.status).toBe("pending");
  });
});

describe("sessions", () => {
  it("restores a session from the refresh cookie and rotates it", async () => {
    const d = new Device(env.app);
    await signUp(d);
    const first = d.cookies.vx_rt;
    d.accessToken = null;
    const r = await d.post("/api/auth/refresh");
    expect(r.status).toBe(200);
    expect(r.body.user.firstName).toBe("Anna");
    expect(d.cookies.vx_rt).not.toBe(first);
  });

  it("detects refresh token reuse and revokes the session", async () => {
    const d = new Device(env.app);
    await signUp(d);
    const stolen = d.cookies.vx_rt!;
    await d.post("/api/auth/refresh");
    env.clock.advance(60_000);
    const thief = new Device(env.app);
    thief.cookies.vx_rt = stolen;
    const r = await thief.post("/api/auth/refresh");
    env.clock.advance(-60_000);
    expect(r.body.error.code).toBe("session_revoked");
    const legit = await d.post("/api/auth/refresh");
    expect(legit.body.error.code).toBe("session_revoked");
  });

  it("expires idle sessions", async () => {
    const d = new Device(env.app);
    await signUp(d);
    env.clock.advance(31 * 86_400_000);
    const r = await d.post("/api/auth/refresh");
    env.clock.advance(-31 * 86_400_000);
    expect(r.body.error.code).toBe("session_expired");
    expect(d.cookies.vx_rt).toBeUndefined();
  });

  it("rejects expired access tokens", async () => {
    const d = new Device(env.app);
    await signUp(d);
    env.clock.advance(16 * 60_000);
    const r = await d.get("/api/me");
    env.clock.advance(-16 * 60_000);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("session_expired");
  });

  it("logout revokes the session immediately", async () => {
    const d = new Device(env.app);
    await signUp(d);
    const token = d.accessToken;
    expect((await d.post("/api/auth/logout")).status).toBe(200);
    d.accessToken = token;
    const r = await d.get("/api/me");
    expect(r.body.error.code).toBe("session_revoked");
    expect((await d.post("/api/auth/refresh")).status).toBe(401);
  });

  it("lists devices and signs out a specific one or all", async () => {
    const phone = new Device(env.app);
    const { address } = await signUp(phone);
    const mac = new Device(env.app, MAC_UA);
    const ch = (await mac.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD })).body.challenge;
    const sms = await mac.post(`/api/auth/challenges/${ch.id}/sms`, { secret: ch.secret });
    await mac.post(`/api/auth/challenges/${ch.id}/verify-sms`, { secret: ch.secret, code: sms.body.devCode });
    await mac.post(`/api/auth/challenges/${ch.id}/complete`, { secret: ch.secret });

    const list = await phone.get("/api/security/sessions");
    expect(list.body).toHaveLength(2);
    const macSession = list.body.find((s: { current: boolean }) => !s.current);
    expect(macSession.deviceName).toContain("Mac");
    expect((await phone.delete(`/api/security/sessions/${macSession.id}`)).status).toBe(200);
    expect((await mac.get("/api/me")).body.error.code).toBe("session_revoked");

    // logout-all
    const pc = new Device(env.app);
    await signUp(pc);
    const r = await pc.post("/api/auth/logout-all");
    expect(r.body.revokedSessions).toBe(1);
    expect((await pc.get("/api/me")).status).toBe(401);
  });

  it("cannot revoke another user's session", async () => {
    const a = new Device(env.app);
    const b = new Device(env.app);
    await signUp(a);
    const { sessionId } = await signUp(b);
    expect((await a.delete(`/api/security/sessions/${sessionId}`)).status).toBe(404);
    expect((await b.get("/api/me")).status).toBe(200);
  });
});

describe("recovery", () => {
  it("resets the password via SMS and signs out other devices", async () => {
    const phone = new Device(env.app);
    const { address } = await signUp(phone);
    const pc = new Device(env.app, MAC_UA);
    const ch = (await pc.post("/api/auth/recovery/start", { identifier: address })).body;
    const sms = await pc.post(`/api/auth/challenges/${ch.id}/sms`, { secret: ch.secret });
    expect((await pc.post(`/api/auth/challenges/${ch.id}/verify-sms`, { secret: ch.secret, code: sms.body.devCode })).status).toBe(200);
    const weak = await pc.post("/api/auth/recovery/reset", { challengeId: ch.id, secret: ch.secret, newPassword: "short" });
    expect(weak.body.error.code).toBe("password_weak");
    const reset = await pc.post("/api/auth/recovery/reset", { challengeId: ch.id, secret: ch.secret, newPassword: "New-Violet-Orbit-7" });
    expect(reset.status).toBe(200);
    expect((await phone.get("/api/me")).body.error.code).toBe("session_revoked");
    expect((await pc.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD })).status).toBe(401);
    expect((await pc.post("/api/auth/login", { identifier: address, password: "New-Violet-Orbit-7" })).body.status).toBe("ok");
  });

  it("reports unknown accounts", async () => {
    const r = await new Device(env.app).post("/api/auth/recovery/start", { identifier: "ghost-user@voidops.ru" });
    expect(r.body.error.code).toBe("account_not_found");
  });

  it("cannot reset without verification", async () => {
    const phone = new Device(env.app);
    const { address } = await signUp(phone);
    const pc = new Device(env.app);
    const ch = (await pc.post("/api/auth/recovery/start", { identifier: address })).body;
    const r = await pc.post("/api/auth/recovery/reset", { challengeId: ch.id, secret: ch.secret, newPassword: "New-Violet-Orbit-7" });
    expect(r.body.error.code).toBe("challenge_pending");
  });
});

describe("account & settings", () => {
  it("updates allowed profile fields and syncs them", async () => {
    const d = new Device(env.app);
    await signUp(d);
    const r = await d.patch("/api/account/profile", { firstName: "Мария", language: "en", country: "DE" });
    expect(r.status).toBe(200);
    expect(r.body.firstName).toBe("Мария");
    expect(r.body.country).toBe("DE");
    const bad = await d.patch("/api/account/profile", { firstName: "123" });
    expect(bad.body.error.fields.firstName).toBe("invalid");
  });

  it("changes password only with the current password", async () => {
    const d = new Device(env.app);
    const { address } = await signUp(d);
    const wrong = await d.post("/api/account/password", { currentPassword: "Nope-nope-123", newPassword: "Another-Strong-9" });
    expect(wrong.body.error.code).toBe("wrong_password");
    const ok = await d.post("/api/account/password", { currentPassword: STRONG_PASSWORD, newPassword: "Another-Strong-9", signOutOtherDevices: true });
    expect(ok.status).toBe(200);
    expect((await d.get("/api/me")).status).toBe(200);
    expect((await d.post("/api/auth/login", { identifier: address, password: "Another-Strong-9" })).body.status).toBe("ok");
  });

  it("changes phone with password + OTP to the new number", async () => {
    const d = new Device(env.app);
    await signUp(d);
    const newPhone = uniquePhone();
    const noPass = await d.post("/api/account/phone/start", { password: "Bad-Password-1", phone: newPhone });
    expect(noPass.body.error.code).toBe("wrong_password");
    const start = await d.post("/api/account/phone/start", { password: STRONG_PASSWORD, phone: newPhone });
    expect(start.status).toBe(200);
    const done = await d.post("/api/account/phone/confirm", { verificationId: start.body.verificationId, code: start.body.devCode });
    expect(done.body.phone).toBe(newPhone);
  });

  it("stores synced preferences", async () => {
    const d = new Device(env.app);
    await signUp(d);
    const r = await d.patch("/api/preferences", { notifications: { sound: true } });
    expect(r.body.notifications.sound).toBe(true);
    expect(r.body.notifications.newMailBanner).toBe(true);
  });

  it("lists consents and exports data", async () => {
    const d = new Device(env.app);
    await signUp(d);
    const c = await d.get("/api/account/consents");
    expect(c.body).toHaveLength(4);
    expect(c.body.every((x: { current: boolean }) => x.current)).toBe(true);
    const exp = await d.get("/api/account/export");
    expect(exp.body.account.firstName).toBe("Anna");
  });

  it("serves legal documents in the requested language", async () => {
    const r = await new Device(env.app).get("/api/legal/privacy?lang=ru");
    expect(r.body.language).toBe("ru");
    expect(r.body.title).toContain("Политика");
  });
});

describe("request protection", () => {
  it("blocks mutating requests without the client header (CSRF)", async () => {
    const r = await env.app.inject({ method: "POST", url: "/api/auth/refresh", headers: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("csrf_failed");
  });

  it("blocks foreign origins", async () => {
    const r = await env.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { "x-voidex-client": "web", origin: "https://evil.example" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("rate-limits sign-in attempts per client", async () => {
    const d = new Device(env.app);
    let last;
    for (let i = 0; i < 11; i++) last = await d.post("/api/auth/login", { identifier: `ghost${i}@voidops.ru`, password: "Whatever-123" });
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe("rate_limited");
  });

  it("requires authentication on protected endpoints", async () => {
    for (const url of ["/api/me", "/api/mail/threads", "/api/security/sessions", "/api/apps"]) {
      const r = await env.app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(401);
    }
  });
});
