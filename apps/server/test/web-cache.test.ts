import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isSpaRoute, webCacheControl } from "../src/lib/web-cache.js";
import { createTestEnv, type TestEnv } from "./helpers.js";

describe("web cache rules (A1)", () => {
  it("caches hashed assets forever and revalidates the entry points", () => {
    expect(webCacheControl("/app/web/assets/index-Ab12.js")).toContain("immutable");
    expect(webCacheControl("/app/web/index.html")).toBe("no-cache");
    expect(webCacheControl("/app/web/version.json")).toBe("no-cache");
    expect(webCacheControl("/app/web/boot-guard.js")).toBe("no-cache");
    expect(webCacheControl("/app/web/manifest.webmanifest")).toBe("no-cache");
    expect(webCacheControl("/app/web/brand/favicon-32.png")).toBe("public, max-age=3600");
  });

  it("falls back to index.html only for page routes", () => {
    expect(isSpaRoute("/")).toBe(true);
    expect(isSpaRoute("/notes/abc?x=1")).toBe(true);
    expect(isSpaRoute("/assets/index-old.js")).toBe(false);
    expect(isSpaRoute("/assets/chunk")).toBe(false);
    expect(isSpaRoute("/brand/missing.png")).toBe(false);
    expect(isSpaRoute("/api/nope")).toBe(false);
  });
});

describe("serving the built client", () => {
  let env: TestEnv;
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "vx-web-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><div id=root></div>");
    writeFileSync(join(dir, "version.json"), '{"build":"b1"}');
    writeFileSync(join(dir, "assets", "index-Ab12.js"), "export {}");
    env = await createTestEnv({ WEB_DIST: dir });
  });
  afterAll(async () => {
    await env.app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("index.html and SPA routes must be revalidated", async () => {
    for (const url of ["/", "/index.html", "/some/route"]) {
      const res = await env.app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"], url).toContain("text/html");
      expect(res.headers["cache-control"], url).toBe("no-cache");
    }
  });

  it("hashed assets are immutable, version.json is not cached", async () => {
    const a = await env.app.inject({ method: "GET", url: "/assets/index-Ab12.js" });
    expect(a.statusCode).toBe(200);
    expect(a.headers["cache-control"]).toContain("immutable");
    const v = await env.app.inject({ method: "GET", url: "/version.json" });
    expect(v.headers["cache-control"]).toBe("no-cache");
  });

  it("a chunk from an older build is a 404, never index.html", async () => {
    const res = await env.app.inject({ method: "GET", url: "/assets/vibex-app-OLD.js" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).not.toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
