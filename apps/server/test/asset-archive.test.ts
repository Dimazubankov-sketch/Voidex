import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveAssets, archivedAsset } from "../src/lib/asset-archive.js";
import { createTestEnv, type TestEnv } from "./helpers.js";

function makeDist(root: string, build: string, assets: Record<string, string>) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), `<!doctype html><div id=root></div><!-- ${build} -->`);
  writeFileSync(join(root, "version.json"), JSON.stringify({ build }));
  writeFileSync(join(root, "sw.js"), `// worker ${build}`);
  for (const [name, body] of Object.entries(assets)) writeFileSync(join(root, "assets", name), body);
}

describe("asset archive (previous releases' chunks)", () => {
  const base = mkdtempSync(join(tmpdir(), "vx-arch-"));
  const dist = join(base, "dist");
  const archive = join(base, "archive");
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("keeps the newest N releases and drops files only older releases used", () => {
    for (let i = 1; i <= 4; i++) {
      makeDist(dist, `r${i}`, { "shared-AAAA.js": "export const shared = 1", [`page-${i}.js`]: `export default ${i}`, [`page-${i}.js.map`]: "{}" });
      archiveAssets({ distDir: dist, archiveDir: archive, build: `r${i}`, keep: 3, now: 1000 + i });
    }
    const files = readdirSync(join(archive, "files")).sort();
    expect(files).toEqual(["page-2.js", "page-3.js", "page-4.js", "shared-AAAA.js"]); // r1 dropped, maps never archived
    expect(readdirSync(join(archive, "releases")).sort()).toEqual(["r2.json", "r3.json", "r4.json"]);
  });

  it("re-running the same release changes nothing and never drops the current build", () => {
    const r = archiveAssets({ distDir: dist, archiveDir: archive, build: "r4", keep: 1, now: 1004 });
    expect(r.added).toBe(0);
    expect(existsSync(join(archive, "files", "page-4.js"))).toBe(true);
  });

  it("only resolves plain file names under /assets/", () => {
    expect(archivedAsset(archive, "/assets/page-4.js")).toBe("page-4.js");
    expect(archivedAsset(archive, "/assets/page-4.js?x=1")).toBe("page-4.js");
    expect(archivedAsset(archive, "/assets/../releases/r4.json")).toBeNull();
    expect(archivedAsset(archive, "/assets/%2e%2e/releases/r4.json")).toBeNull();
    expect(archivedAsset(archive, "/assets/sub/page-4.js")).toBeNull();
    expect(archivedAsset(archive, "/assets/missing.js")).toBeNull();
    expect(archivedAsset(archive, "/index.html")).toBeNull();
  });
});

describe("a new deployment still serves the previous release's chunks", () => {
  const base = mkdtempSync(join(tmpdir(), "vx-deploy-"));
  const dist = join(base, "dist");
  const archive = join(base, "archive");
  let v1: TestEnv;
  let v2: TestEnv;
  beforeAll(async () => {
    makeDist(dist, "build1", { "index-OLD1.js": "export {}", "notes-OLD1.js": "export default 1" });
    v1 = await createTestEnv({ WEB_DIST: dist, ASSET_ARCHIVE_DIR: archive, VOIDEX_VERSION: "build1" });
    await v1.app.close();
    // The "next image": the old notes chunk is gone, a new one exists.
    makeDist(dist, "build2", { "index-NEW2.js": "export {}", "notes-NEW2.js": "export default 2" });
    v2 = await createTestEnv({ WEB_DIST: dist, ASSET_ARCHIVE_DIR: archive, VOIDEX_VERSION: "build2" });
  });
  afterAll(async () => {
    await v2.app.close();
    rmSync(base, { recursive: true, force: true });
  });

  it("old chunk: 200, immutable, JavaScript; unknown chunk: real 404", async () => {
    const old = await v2.app.inject({ method: "GET", url: "/assets/notes-OLD1.js" });
    expect(old.statusCode).toBe(200);
    expect(old.headers["cache-control"]).toContain("immutable");
    expect(old.headers["content-type"]).toContain("javascript");
    expect(old.body).toBe("export default 1");
    const nope = await v2.app.inject({ method: "GET", url: "/assets/notes-NEVER.js" });
    expect(nope.statusCode).toBe(404);
    expect(nope.headers["content-type"]).not.toContain("text/html");
  });

  it("current files and entry points are unaffected; the archive is not browsable", async () => {
    expect((await v2.app.inject({ method: "GET", url: "/assets/notes-NEW2.js" })).statusCode).toBe(200);
    expect((await v2.app.inject({ method: "GET", url: "/version.json" })).body).toContain("build2");
    expect((await v2.app.inject({ method: "GET", url: "/assets/../archive/releases/build1.json" })).statusCode).not.toBe(200);
    expect((await v2.app.inject({ method: "GET", url: "/releases/build1.json" })).body).not.toContain("files");
  });

  it("serves sw.js with no-cache", async () => {
    const res = await v2.app.inject({ method: "GET", url: "/sw.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });
});
