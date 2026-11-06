import { expect, test, type Page } from "@playwright/test";
import { net } from "./net";

/**
 * Start-up resilience on the RELEASE build (boot guard, error boundary, "can't reach the server" screen,
 * hostile local storage). Each test names the failure it stands for.
 */

test.afterEach(() => net("up"));

const started = (page: Page) => page.evaluate(() => (window as unknown as { __vxBoot?: { ok?: boolean } }).__vxBoot?.ok === true);
const GUARD_PAGE = '<!doctype html><html><body><div id="root"><p id="partial">half-mounted UI</p></div><script src="/boot-guard.js"></script></body></html>';

async function guardPage(page: Page) {
  await page.route("**/__guard-test", (r) => r.fulfill({ contentType: "text/html", body: GUARD_PAGE }));
  await page.clock.install();
  await page.goto("/__guard-test");
}

test.describe("first start", () => {
  test("a new device starts, reports 'ready' and shows the welcome screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    expect(await started(page)).toBe(true);
    await expect(page.getByTestId("boot-fallback")).toHaveCount(0);
  });

  test("the release bundle runs on this engine without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("boot guard (regression: it used to stay silent when React had mounted something)", () => {
  test("covers a half-mounted page when the app never reports ready", async ({ page }) => {
    await guardPage(page);
    await expect(page.locator("#partial")).toBeVisible();
    await expect(page.getByTestId("boot-fallback")).toHaveCount(0);
    await page.clock.fastForward(13_000);
    await expect(page.getByTestId("boot-fallback")).toBeVisible(); // childElementCount > 0 no longer hides it
    await expect(page.getByTestId("boot-retry")).toBeVisible();
  });

  test("goes away by itself if the app does start late", async ({ page }) => {
    await guardPage(page);
    await page.clock.fastForward(13_000);
    await expect(page.getByTestId("boot-fallback")).toBeVisible();
    await page.evaluate(() => (window as unknown as { __vxBoot: { ready(): void } }).__vxBoot.ready());
    await expect(page.getByTestId("boot-fallback")).toHaveCount(0);
  });

  test("an unrecoverable app error shows it immediately", async ({ page }) => {
    await guardPage(page);
    await page.evaluate(() => (window as unknown as { __vxBoot: { fail(r: string): void } }).__vxBoot.fail("react"));
    await expect(page.getByTestId("boot-fallback")).toBeVisible();
    await expect(page.getByTestId("boot-fallback")).toContainText("react");
  });

  test("ready() before the deadline means it never appears", async ({ page }) => {
    await guardPage(page);
    await page.evaluate(() => (window as unknown as { __vxBoot: { ready(): void } }).__vxBoot.ready());
    await page.clock.fastForward(60_000);
    await expect(page.getByTestId("boot-fallback")).toHaveCount(0);
  });
});

for (const [name, handler] of [
  ["the main bundle cannot be downloaded", (r: import("@playwright/test").Route) => r.abort()],
  ["the main bundle is not valid JavaScript for this browser", (r: import("@playwright/test").Route) => r.fulfill({ contentType: "application/javascript", body: "export const broken = ;" })],
] as const) {
  test.describe(name, () => {
    test("shows the message, retries at most automatically-twice, then waits for a tap; a tap recovers", async ({ page }) => {
      let navigations = 0;
      page.on("framenavigated", (f) => {
        if (f === page.mainFrame()) navigations++;
      });
      await page.route(/\/assets\/index-[^/]+\.js$/, handler);
      await page.goto("/");
      await expect(page.getByTestId("boot-fallback")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("boot-retry")).toBeVisible();
      // No reload loop: after the bounded automatic attempts everything is quiet.
      const settled = navigations;
      await page.waitForTimeout(5_000);
      expect(navigations - settled).toBeLessThanOrEqual(1);
      expect(navigations).toBeLessThanOrEqual(4);
      // The network/server comes back; the person taps «Повторить».
      await page.unroute(/\/assets\/index-[^/]+\.js$/, handler);
      await page.getByTestId("boot-retry").click();
      await expect(page.getByTestId("welcome-signin")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("boot-fallback")).toHaveCount(0);
      expect(await page.evaluate(() => sessionStorage.getItem("vx.bootTries"))).toBeNull(); // counter cleared by 'ready'
    });
  });
}

test.describe("a code-split chunk that fails to load", () => {
  for (const failure of ["404", "reset"] as const) {
    test(`(${failure}) shows the error screen, not a blank page, and recovers once the chunk is reachable again`, async ({ page, context, browserName }) => {
      // The failure is made by the network layer (not by the browser-side interception), as it happens on a phone.
      await net("up", { block: "/assets/auth-root-", status: failure });
      await page.goto("/");
      await expect(page.getByTestId("root-crashed")).toBeVisible({ timeout: 20_000 });
      await net("up");
      if (browserName === "webkit") {
        // Playwright's WebKit: the tab that saw the module fail keeps refusing that URL (reload, new URL and waiting
        // do not help; the server is not even asked). Closing and reopening the app (a new tab) recovers. Whether iOS
        // Safari behaves like this is unknown; the visible error screen above is what is guaranteed everywhere.
        const fresh = await context.newPage();
        await fresh.goto("/");
        await expect(fresh.getByTestId("welcome-signin")).toBeVisible({ timeout: 20_000 });
      } else {
        await page.getByTestId("root-crashed").getByRole("button").first().click();
        await expect(page.getByTestId("welcome-signin")).toBeVisible({ timeout: 20_000 });
      }
    });
  }
});

test.describe("the server cannot be reached while the app starts", () => {
  test("network failure: «Нет связи», NOT the sign-in form; recovers when the network returns", async ({ page }) => {
    const handler = (r: import("@playwright/test").Route) => r.abort("connectionfailed");
    await page.route("**/api/auth/refresh", handler);
    await page.goto("/");
    await expect(page.getByTestId("boot-unavailable")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("welcome-signin")).toHaveCount(0);
    await page.unroute("**/api/auth/refresh", handler);
    await page.getByTestId("boot-unavailable-retry").click();
    await expect(page.getByTestId("welcome-signin")).toBeVisible({ timeout: 20_000 });
  });

  test("HTTP 503: the same screen, and it retries by itself", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/auth/refresh", (r) => {
      calls++;
      return calls < 3 ? r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "internal_error", message: "down" } }) }) : r.continue();
    });
    await page.goto("/");
    await expect(page.getByTestId("boot-unavailable")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("boot-unavailable-retry").click(); // second failure
    await expect(page.getByTestId("boot-unavailable")).toBeVisible();
    await page.getByTestId("boot-unavailable-retry").click(); // server is back
    await expect(page.getByTestId("welcome-signin")).toBeVisible({ timeout: 20_000 });
  });

  test("a connection that never answers ends in the same screen instead of an endless splash", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    await page.route("**/api/auth/refresh", () => {
      /* never answered: the client's own 15 s limit must end the wait */
    });
    await page.reload();
    await expect(page.getByTestId("boot-unavailable")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId("boot-fallback")).toHaveCount(0); // the app is alive: the guard stays out of it
  });
});

test.describe("damaged or blocked local storage", () => {
  test("garbage in the app's own keys does not stop the shell", async ({ page }) => {
    await page.addInitScript(() => {
      const junk: Record<string, string> = {
        "vx.theme": "💥",
        "vx.lang": "zz",
        "vx.knownAccounts": "{not json",
        "vx.wallpapers.device": "[[[",
        "vx.pageZoom": "NaN",
        "vx.clock.tab": "\u0000",
        "vx.vibex.played": '{"a":',
        "vx.hadSession": "maybe",
        "vx.wm.someone": "}{",
      };
      for (const [k, v] of Object.entries(junk)) localStorage.setItem(k, v);
    });
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
  });

  test("storage that throws on every access (private mode / blocked) does not stop the shell", async ({ page }) => {
    await page.addInitScript(() => {
      const deny = () => {
        throw new DOMException("denied", "SecurityError");
      };
      Storage.prototype.getItem = deny;
      Storage.prototype.setItem = deny;
      Storage.prototype.removeItem = deny;
    });
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    expect(await started(page)).toBe(true);
  });
});
