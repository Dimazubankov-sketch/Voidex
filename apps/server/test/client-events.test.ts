import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scrubDetail, uaFamily } from "../src/lib/client-events.js";
import { createTestEnv, type TestEnv } from "./helpers.js";

describe("client events: scrubbing", () => {
  it("removes query strings, tokens, e-mails, phone numbers and control characters", () => {
    const out = scrubDetail(
      "Failed https://voidex.su/api/auth/refresh?token=abc123secret for ivan@voidops.ru +7 (999) 123-45-67 Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig\nnext",
    )!;
    expect(out).not.toMatch(/abc123secret|ivan@|999|eyJ|token=/);
    expect(out).toContain("/api/auth/refresh");
    expect(out).not.toContain("\n");
  });
  it("masks long random-looking strings and ids inside urls, and caps the length", () => {
    expect(scrubDetail("key AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA used")).toContain("[token]");
    expect(scrubDetail("see https://voidex.su/api/files/0f8fad5b-d9cb-469f-a165-70867728950e")).toContain(":id");
    expect(scrubDetail("x".repeat(500))!.length).toBeLessThanOrEqual(200);
    expect(scrubDetail(undefined)).toBeUndefined();
  });
  it("reports only a coarse browser family", () => {
    expect(uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe("iOS 17 Safari");
    expect(uaFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36")).toBe("Windows 10 Chrome");
    expect(uaFamily(undefined)).toBe("unknown");
  });
});

describe("POST /api/client-events", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });
  afterAll(async () => {
    await env.app.close();
  });
  const post = (payload: unknown, headers: Record<string, string> = { "x-voidex-client": "web" }) =>
    env.app.inject({ method: "POST", url: "/api/client-events", payload: payload as object, headers: { "x-test-client": crypto.randomUUID(), ...headers } });

  it("accepts a start-up failure report anonymously", async () => {
    const res = await post({ kind: "boot_failed", phase: "render", build: "abc123", online: true, standalone: true, sw: false, ms: 12000, attempt: 1, detail: "timeout" });
    expect(res.statusCode).toBe(204);
  });
  it("rejects unknown kinds, unknown shapes and requests without the CSRF header", async () => {
    expect((await post({ kind: "steal_cookies" })).statusCode).toBe(400);
    expect((await post({ kind: "boot_failed", phase: "has space and <script>" })).statusCode).toBe(400);
    expect((await post({ kind: "boot_failed" }, {})).statusCode).toBe(403);
  });
  it("is rate-limited", async () => {
    const client = crypto.randomUUID();
    let last = 0;
    for (let i = 0; i < 25; i++) {
      last = (await env.app.inject({ method: "POST", url: "/api/client-events", payload: { kind: "boot_slow" }, headers: { "x-voidex-client": "web", "x-test-client": client } })).statusCode;
    }
    expect(last).toBe(429);
  });
});
