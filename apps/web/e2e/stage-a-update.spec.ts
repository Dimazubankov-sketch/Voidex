import { cpSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openApp, signUpViaApi } from "./helpers";

/**
 * A1 — a deployment lands while VOIDEX is open. Runs only against the production server serving a build
 * from E2E_WEB_DIST (the dev server has no versions): `WEB_DIST=<dir> node apps/server/dist/index.js`.
 * The test swaps that directory for a "next build" in which the Notes chunk has a new name, exactly what a
 * real deployment does to the previous build's files.
 */
const DIST = process.env.E2E_WEB_DIST;
test.skip(!DIST, "needs E2E_WEB_DIST (production build served by the API server)");

function deployNextBuild(dir: string, build: string) {
  const assets = join(dir, "assets");
  const chunk = readdirSync(assets).find((f) => /^notes-app-.*\.js$/.test(f))!;
  const renamed = chunk.replace(/-([^-]+)\.js$/, `-${build}.js`);
  renameSync(join(assets, chunk), join(assets, renamed));
  rmSync(join(assets, `${chunk}.map`), { force: true });
  for (const f of readdirSync(assets).filter((x) => x.endsWith(".js"))) {
    const p = join(assets, f);
    const s = readFileSync(p, "utf8");
    if (s.includes(chunk)) writeFileSync(p, s.split(chunk).join(renamed));
  }
  writeFileSync(join(dir, "version.json"), JSON.stringify({ build }));
}

test.describe("A1 updates", () => {
  test.beforeAll(() => {
    if (!DIST) return;
    // Keep a pristine copy so every run (and both projects) start from the same build.
    cpSync(DIST, `${DIST}.orig`, { recursive: true, force: true, errorOnExist: false });
  });
  test.afterEach(() => {
    if (!DIST) return;
    rmSync(DIST, { recursive: true, force: true });
    cpSync(`${DIST}.orig`, DIST, { recursive: true });
  });

  test("a normal reload gets the newest index.html; the banner offers the update", async ({ page }) => {
    await signUpViaApi(page);
    const res = await page.request.get("/");
    expect(res.headers()["cache-control"]).toBe("no-cache");
    deployNextBuild(DIST!, `next${Date.now().toString(36)}`);
    // Coming back to the tab asks the server which build it serves.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expect(page.getByTestId("update-banner")).toBeVisible();
  });

  test("an app whose chunk is gone reloads into the new build instead of a blank screen", async ({ page }) => {
    await signUpViaApi(page);
    const build = `next${Date.now().toString(36)}`;
    deployNextBuild(DIST!, build);
    const reloaded = page.waitForEvent("framenavigated");
    await openApp(page, "notes").catch(() => undefined);
    await reloaded;
    // After the reload the new build runs: the lock screen (code-password) or the workspace, never empty.
    await expect(page.getByTestId("lock-screen").or(page.getByTestId("workspace")).first()).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("vx.reloadedFor"))).toBe(build);
  });

  test("a missing chunk is a 404, not index.html", async ({ page }) => {
    const res = await page.request.get("/assets/vibex-app-OLDBUILD.js");
    expect(res.status()).toBe(404);
  });
});
