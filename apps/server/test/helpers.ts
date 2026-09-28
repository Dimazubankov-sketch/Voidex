import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ConsoleSmsProvider } from "../src/services/sms/index.js";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://voidex:voidex@localhost:5432/voidex_test";

export interface TestEnv {
  app: FastifyInstance;
  sms: ConsoleSmsProvider;
  clock: { offsetMs: number; advance(ms: number): void };
}

export async function createTestEnv(): Promise<TestEnv> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    MAIL_DOMAIN: "voidex.app",
    SMS_PROVIDER: "console",
  } as NodeJS.ProcessEnv);
  const sms = new ConsoleSmsProvider(() => {});
  const clock = {
    offsetMs: 0,
    advance(ms: number) {
      this.offsetMs += ms;
    },
  };
  const app = await buildApp({ config, sms, now: () => new Date(Date.now() + clock.offsetMs) });
  await app.ready();
  return { app, sms, clock };
}

let seq = 0;
/** Unique, valid Russian mobile number per call. */
export function uniquePhone() {
  seq += 1;
  const n = (Date.now() % 1_000_000) * 10 + (seq % 10);
  return `+7916${String(n).padStart(7, "0").slice(-7)}`;
}
export function uniqueUsername(prefix = "user") {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

/**
 * A simulated device (browser): keeps its own cookies, like a real browser
 * keeps vx_rt / vx_did, and optionally a bearer token.
 */
export class Device {
  cookies: Record<string, string> = {};
  accessToken: string | null = null;
  readonly testClientId = crypto.randomUUID();
  constructor(
    private readonly app: FastifyInstance,
    readonly userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
  ) {}

  async request(method: string, url: string, body?: unknown, opts: { auth?: boolean; headers?: Record<string, string> } = {}) {
    const res = await this.app.inject({
      method: method as "GET",
      url,
      payload: body as object | undefined,
      headers: {
        "x-voidex-client": "web",
        "x-test-client": this.testClientId,
        "user-agent": this.userAgent,
        cookie: Object.entries(this.cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
        ...(opts.auth !== false && this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        ...opts.headers,
      },
    });
    for (const c of res.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      if (c.value === "" || (c.expires && c.expires.getTime() < Date.now())) delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    const json = safeJson(res);
    if (json && typeof json === "object" && "accessToken" in json) this.accessToken = (json as { accessToken: string }).accessToken;
    return { status: res.statusCode, body: json as any, raw: res };
  }
  get = (url: string, opts?: { auth?: boolean }) => this.request("GET", url, undefined, opts);
  post = (url: string, body?: unknown, opts?: { auth?: boolean; headers?: Record<string, string> }) => this.request("POST", url, body ?? {}, opts);
  put = (url: string, body?: unknown) => this.request("PUT", url, body ?? {});
  patch = (url: string, body?: unknown) => this.request("PATCH", url, body ?? {});
  delete = (url: string) => this.request("DELETE", url);
}

function safeJson(res: LightMyRequestResponse) {
  try {
    return res.json();
  } catch {
    return res.body;
  }
}

export const STRONG_PASSWORD = "Violet-Orbit-42";

export const CONSENTS = [
  { key: "terms", version: "2026-09-draft.1" },
  { key: "offer", version: "2026-09-draft.1" },
  { key: "privacy", version: "2026-09-draft.1" },
  { key: "data_processing", version: "2026-09-draft.1" },
];

/** Runs the real sign-up flow (SMS via dev provider) on the given device. */
export async function signUp(device: Device, overrides: Partial<{ username: string; phone: string; firstName: string; lastName: string; password: string }> = {}) {
  const phone = overrides.phone ?? uniquePhone();
  const username = overrides.username ?? uniqueUsername();
  const start = await device.post("/api/auth/phone/start", { phone });
  if (start.status !== 200) throw new Error(`phone/start failed: ${JSON.stringify(start.body)}`);
  const verify = await device.post("/api/auth/phone/verify", { verificationId: start.body.verificationId, code: start.body.devCode });
  if (verify.status !== 200) throw new Error(`phone/verify failed: ${JSON.stringify(verify.body)}`);
  const reg = await device.post("/api/auth/register", {
    firstName: overrides.firstName ?? "Anna",
    lastName: overrides.lastName ?? "Volkova",
    birthDate: "1995-04-12",
    country: "RU",
    language: "ru",
    phoneVerification: { id: start.body.verificationId, proof: verify.body.proof },
    username,
    password: overrides.password ?? STRONG_PASSWORD,
    consents: CONSENTS,
  });
  if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
  return { phone, username, address: `${username}@voidex.app`, user: reg.body.user, sessionId: reg.body.sessionId as string };
}
