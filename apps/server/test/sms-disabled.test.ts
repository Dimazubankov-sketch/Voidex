import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { DisabledSmsProvider } from "../src/services/sms/index.js";
import { Device, STRONG_PASSWORD, TEST_DATABASE_URL, createTestEnv, signUp, uniquePhone, type TestEnv } from "./helpers.js";
import type { FastifyInstance } from "fastify";

/**
 * Production before an SMS gateway is connected: SMS_PROVIDER=disabled.
 * Nothing may pretend to send a code, and no code may ever be issued.
 */
let env: TestEnv;
let disabled: FastifyInstance;

beforeAll(async () => {
  env = await createTestEnv(); // used only to create an existing account
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: TEST_DATABASE_URL, SMS_PROVIDER: "disabled" } as NodeJS.ProcessEnv);
  disabled = await buildApp({ config, sms: new DisabledSmsProvider() });
  await disabled.ready();
});
afterAll(async () => {
  await disabled.close();
  await env.app.close();
});

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

describe("SMS_PROVIDER=disabled", () => {
  it("is accepted in production (console is not)", () => {
    const base = { NODE_ENV: "production", AUTH_ACCESS_SECRET: "a".repeat(48), AUTH_TOKEN_PEPPER: "b".repeat(48) };
    expect(loadConfig({ ...base, SMS_PROVIDER: "disabled" } as NodeJS.ProcessEnv).sms.provider).toBe("disabled");
    expect(() => loadConfig({ ...base, SMS_PROVIDER: "console" } as NodeJS.ProcessEnv)).toThrow(/console/);
  });

  it("reports SMS as unavailable", async () => {
    const info = await new Device(disabled).get("/api/system/info");
    expect(info.body.smsAvailable).toBe(false);
    expect(info.body.smsDevMode).toBe(false);
  });

  it("refuses phone verification with 503 and issues no code", async () => {
    const r = await new Device(disabled).post("/api/auth/phone/start", { phone: uniquePhone() });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("sms_not_configured");
    expect(r.body.devCode).toBeUndefined();
    expect(r.body.verificationId).toBeUndefined();
  });

  it("does not offer SMS for new-device sign-in or recovery", async () => {
    const phone = new Device(env.app);
    const { address } = await signUp(phone);

    const mac = new Device(disabled, MAC_UA);
    const login = await mac.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD });
    expect(login.body.status).toBe("challenge");
    expect(login.body.challenge.methods).toEqual(["device"]);
    const sms = await mac.post(`/api/auth/challenges/${login.body.challenge.id}/sms`, { secret: login.body.challenge.secret });
    expect(sms.status).toBe(503);

    const rec = await mac.post("/api/auth/recovery/start", { identifier: address });
    expect(rec.body.methods).not.toContain("sms");
  });

  it("existing sessions keep working (trusted device approval still possible)", async () => {
    const phone = new Device(env.app);
    const { address } = await signUp(phone);
    const mac = new Device(disabled, MAC_UA);
    const ch = (await mac.post("/api/auth/login", { identifier: address, password: STRONG_PASSWORD })).body.challenge;
    expect((await mac.post(`/api/auth/challenges/${ch.id}/device`, { secret: ch.secret })).status).toBe(200);
    expect((await phone.post(`/api/security/approvals/${ch.id}`, { decision: "approve" })).status).toBe(200);
    expect((await mac.post(`/api/auth/challenges/${ch.id}/complete`, { secret: ch.secret })).status).toBe(200);
  });
});
