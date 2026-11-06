import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Update delivery on the release build: service worker, offline launch, automatic reload into a new build,
 * and the guarantees that make it safe (nothing typed, saved or sent is ever cut off; no reload loops).
 * The "new release" is simulated by changing /version.json in the served directory — exactly what a deploy does.
 */
const DIST = process.env.E2E_PROD_DIST!;
const VERSION_FILE = join(DIST, "version.json");
const ORIGINAL = readFileSync(VERSION_FILE, "utf8");

test.afterEach(() => writeFileSync(VERSION_FILE, ORIGINAL));

const release = (build: string) => writeFileSync(VERSION_FILE, JSON.stringify({ build }));
/** What iOS does when a suspended page comes back: pageshow(persisted). The updater checks and may apply. */
const comeBack = (page: Page) => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
const marked = (page: Page) => page.evaluate(() => (window as unknown as { __marker?: number }).__marker === 1);

async function workerReady(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("welcome-signin")).toBeVisible();
  // Registered a few seconds after load, then installed, activated and in control of this page.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 });
  await page.waitForFunction(
    async () => {
      const shell = await caches.open("vx-shell-v1").then((c) => c.match("/"));
      const keys = await caches.open("vx-files-v1").then((c) => c.keys());
      return !!shell && keys.some((k) => /\/assets\/index-.*\.js$/.test(k.url));
    },
    undefined,
    { timeout: 30_000 },
  );
}

test.describe("service worker", () => {
  test("sw.js is never cached, the worker takes control and stores the shell and the main files", async ({ page }) => {
    const res = await page.request.get("/sw.js");
    expect(res.headers()["cache-control"]).toBe("no-cache");
    const build = (JSON.parse(ORIGINAL) as { build: string }).build;
    expect(await res.text()).toContain(`var BUILD = "${build}"`); // the worker carries this release's id
    await workerReady(page);
  });

  test("a home-screen launch without any connection opens the app and explains, instead of a blank window", async ({ page, context, browserName }) => {
    test.skip(browserName === "webkit", "Playwright WebKit does not emulate offline for service-worker fetches; covered by the device checklist");
    await workerReady(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("boot-unavailable")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("boot-fallback")).toHaveCount(0);
    await context.setOffline(false);
    // The network is back: the app notices by itself and continues to the sign-in screens.
    await expect(page.getByTestId("welcome-signin")).toBeVisible({ timeout: 30_000 });
  });

  test("/?nosw removes the worker and its caches", async ({ page }) => {
    await workerReady(page);
    await page.goto("/?nosw");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length === 0 && (await caches.keys()).length === 0, undefined, { timeout: 15_000 });
  });
});

test.describe("automatic updates", () => {
  test("a new release is picked up and applied by itself — no button — exactly once", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    await mark(page);
    release("e2e-build-2");
    const reloaded = page.waitForEvent("load");
    await comeBack(page);
    await reloaded;
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    expect(await marked(page)).toBe(false); // a new page
    expect(await page.evaluate(() => sessionStorage.getItem("vx.reloadedFor"))).toBe("e2e-build-2");
    // The server here keeps serving the old bundle, so the page is still "behind": it must NOT reload again.
    await mark(page);
    await comeBack(page);
    await page.waitForTimeout(2_000);
    expect(await marked(page)).toBe(true);
    await expect(page.getByTestId("update-banner")).toHaveCount(0); // nothing for the person to press
  });

  test("half-typed text is never lost: the update waits, and goes once the field is empty/left", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("welcome-signin").click();
    await page.getByTestId("login-identifier").fill("half typed");
    await mark(page);
    release("e2e-build-3");
    await comeBack(page);
    await page.waitForTimeout(2_000);
    expect(await marked(page)).toBe(true);
    expect(await page.getByTestId("login-identifier").inputValue()).toBe("half typed");
    await page.getByTestId("login-identifier").fill(""); // the person clears it / finishes
    const reloaded = page.waitForEvent("load");
    await comeBack(page);
    await reloaded;
  });

  test("a request in flight (save / send / upload) holds the update until it ends", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("welcome-signin").click();
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    await page.route("**/api/auth/login", async (r) => {
      await gate;
      await r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "invalid_credentials", message: "no" } }) });
    });
    await page.getByTestId("login-identifier").fill("someone");
    await page.getByTestId("login-password").fill("Violet-Orbit-42");
    await page.keyboard.press("Enter");
    // Not typing any more (blur), only the in-flight request is left to block the update.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.getByTestId("login-identifier").fill("");
    await page.getByTestId("login-password").fill("");
    await mark(page);
    release("e2e-build-4");
    await comeBack(page);
    await page.waitForTimeout(2_000);
    expect(await marked(page)).toBe(true); // request still running: no reload
    finish();
    await page.waitForTimeout(500);
    const reloaded = page.waitForEvent("load");
    await comeBack(page);
    await reloaded;
  });

  test("offline: an update check that cannot reach the server changes nothing", async ({ page, context, browserName }) => {
    test.skip(browserName === "webkit", "offline emulation differs in Playwright WebKit");
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    await mark(page);
    release("e2e-build-5");
    await context.setOffline(true);
    await comeBack(page);
    await page.waitForTimeout(1_500);
    expect(await marked(page)).toBe(true);
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    await context.setOffline(false);
  });

  test("a broken version.json (HTML error page from a proxy) is ignored", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    writeFileSync(VERSION_FILE, "<html>502 Bad Gateway</html>");
    await mark(page);
    await comeBack(page);
    await page.waitForTimeout(1_500);
    expect(await marked(page)).toBe(true);
  });
});
