import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { net } from "./net";
import { openApp, signUpViaApi, unlock } from "../e2e/helpers";

/**
 * Update delivery on the release build: service worker, offline launch, automatic reload into a new build,
 * and the guarantees that make it safe (nothing typed, saved or sent is ever cut off; no reload loops).
 * The "new release" is simulated by changing /version.json in the served directory — exactly what a deploy does.
 */
const DIST = process.env.E2E_PROD_DIST!;
const VERSION_FILE = join(DIST, "version.json");
const ORIGINAL = readFileSync(VERSION_FILE, "utf8");

test.afterEach(async () => {
  writeFileSync(VERSION_FILE, ORIGINAL);
  await net("up");
});

const release = (build: string) => writeFileSync(VERSION_FILE, JSON.stringify({ build }));
/** What iOS does when a suspended page comes back: pageshow(persisted). The updater checks and may apply. */
const comeBack = (page: Page) => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
const marked = (page: Page) => page.evaluate(() => (window as unknown as { __marker?: number }).__marker === 1);

test.describe("service worker retirement and first paint", () => {
  test("/sw.js is a no-cache, self-removing worker that cleans the caches of the old caching worker", async ({ page }) => {
    const res = await page.request.get("/sw.js");
    expect(res.headers()["cache-control"]).toBe("no-cache");
    const body = await res.text();
    expect(body).toContain("unregister");
    expect(body).not.toContain("addEventListener(\"fetch\""); // never intercepts anything
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    // An old installation: a cache named like the old worker's and a registration of the worker script.
    await page.evaluate(async () => {
      await (await caches.open("vx-files-v1")).put("/x", new Response("x"));
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    });
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length === 0 && !(await caches.keys()).includes("vx-files-v1")), { timeout: 20_000 })
      .toBe(true);
  });

  test("pages retire a worker installed by an earlier visit (the app does this itself on start)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    await page.evaluate(async () => {
      await (await caches.open("vx-shell-v1")).put("/", new Response("old shell"));
    });
    expect(await page.evaluate(async () => (await caches.keys()).includes("vx-shell-v1"))).toBe(true); // precondition
    await page.reload();
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("vx-")).length), { timeout: 15_000 }).toBe(0);
  });

  // The regression of e94bf99: a render-blocking boot-guard.js and stylesheet. On a path where big files stall, the
  // page stayed empty. Nothing external may block the first paint now.
  test("with every external file stalled (guard, scripts, stylesheet) the page still paints and says what is going on", async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await net("up", { status: "hang", only: ["/assets/", "/boot-guard.js"] });
    await page.goto("/", { waitUntil: "commit" });
    await page.waitForFunction(() => performance.getEntriesByName("first-contentful-paint").length > 0 || !!document.getElementById("vx-splash")?.getBoundingClientRect().width, undefined, { timeout: 8_000 });
    await expect(page.locator("#vx-splash")).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(18, 18, 24)"); // the dark paint, not an empty canvas
    // after ~10 s the pure-CSS hint with the plain reload link appears (no script involved)
    await expect(page.locator("#vx-splash small")).toHaveCSS("opacity", /0\.[1-9]/, { timeout: 15_000 });
    await expect(page.locator("#vx-splash a")).toBeVisible();
    await ctx.close();
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

  test("unreachable server: an update check changes nothing and breaks nothing", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    await mark(page);
    release("e2e-build-5");
    await net("down");
    await comeBack(page);
    await page.waitForTimeout(1_500);
    expect(await marked(page)).toBe(true);
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
  });

  test("the signed-in session and the device's saved state survive the automatic update", async ({ page }) => {
    await signUpViaApi(page);
    await openApp(page, "notes");
    const keys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("vx.")).sort());
    // The layout is saved shortly after a change.
    await expect.poll(async () => (await keys()).some((k) => k.startsWith("vx.wm."))).toBe(true);
    const before = await keys();
    release("e2e-build-8");
    const reloaded = page.waitForEvent("load");
    await comeBack(page);
    await reloaded;
    // Same account, restored through the refresh cookie (a new start opens on the lock screen: unchanged behaviour).
    await unlock(page);
    await expect(page.getByTestId("workspace")).toBeVisible();
    expect(await keys()).toEqual(expect.arrayContaining(before));
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
