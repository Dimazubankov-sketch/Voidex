import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

/** The page's Content-Security-Policy as the browser gets it with index.html (same Helmet policy on every response). */
async function policy(): Promise<Map<string, string[]>> {
  const res = await env.app.inject({ method: "GET", url: "/api/health" });
  const header = String(res.headers["content-security-policy"] ?? "");
  return new Map(
    header
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((p) => p[0])
      .map((p) => [p[0]!, p.slice(1)]),
  );
}

describe("Content-Security-Policy (Step 2.6: Vibex voice / circle playback)", () => {
  it("lets <audio> / <video> play blob: object URLs (voice messages, video circles)", async () => {
    const p = await policy();
    // Without media-src the browser falls back to default-src 'self' and refuses blob: media.
    expect(p.get("media-src")).toEqual(expect.arrayContaining(["'self'", "blob:"]));
  });

  it("lets the waveform read the same blob (connect-src) and keeps the rest strict", async () => {
    const p = await policy();
    expect(p.get("connect-src")).toEqual(expect.arrayContaining(["'self'", "blob:"]));
    expect(p.get("default-src")).toEqual(["'self'"]);
    expect(p.get("script-src")).not.toContain("'unsafe-inline'");
    expect(p.get("script-src")).not.toContain("'unsafe-eval'");
    expect(p.get("object-src")).toEqual(["'none'"]);
    expect(p.get("frame-ancestors")).toEqual(["'none'"]);
    for (const d of ["media-src", "connect-src", "img-src"]) expect(p.get(d)).not.toContain("*");
  });
});
