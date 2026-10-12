import { expect, test, type Page } from "@playwright/test";
import { openApp, phoneHome, signUpViaApi } from "./helpers";

/**
 * Step 2.10 — the phone gesture bar never moves the app's own layout: after any
 * gesture (to the switcher and back, a small drag that settles, a sideways
 * switch and back) the app sits at exactly the same x, with the same width.
 * A slow swipe glides into the switcher; a quick flick goes home.
 */

const PHONES = [320, 390, 430];

async function bar(page: Page) {
  const box = (await page.locator('section[data-state="open"] [data-testid="home-indicator"]').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, dx: number, dy: number, steps: number, wait: number) {
  const { x, y } = await bar(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
    if (wait) await page.waitForTimeout(wait);
  }
}

/** The app's layout box (the dragged layer and its first content block), once at rest. */
async function layout(page: Page, appId: string) {
  const app = page.locator(`[data-testid="window-${appId}"] [data-dragged-app]`).first();
  // At rest: no transform left on the app layer (the settle spring ends at exactly 0).
  await expect.poll(() => app.evaluate((el: HTMLElement) => [getComputedStyle(el).transform, getComputedStyle(el.closest("section")!).transform].join()), { timeout: 3000 }).toBe("none,none");
  return app.evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const first = (el.firstElementChild as HTMLElement | null)?.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), cx: Math.round(first?.x ?? 0), cw: Math.round(first?.width ?? 0), transform: getComputedStyle(el).transform };
  });
}

for (const width of PHONES) {
  test(`gesture bar keeps the app's horizontal position at ${width}px`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1000) > 700, "phone gesture");
    await page.setViewportSize({ width, height: 844 });
    await signUpViaApi(page, "Ровно", "Наместе");
    await openApp(page, "settings");
    await phoneHome(page);
    await openApp(page, "vibex");
    const base = await layout(page, "vibex");
    expect(base.x).toBe(0);
    expect(base.w).toBe(width);

    // 1. Diagonal drag up, released in the middle: the switcher; back from its card.
    await drag(page, 70, -200, 12, 16);
    await page.waitForTimeout(250);
    await page.mouse.up();
    await expect(page.getByTestId("app-switcher")).toBeVisible();
    await page.getByTestId("switcher-card-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
    expect(await layout(page, "vibex")).toEqual(base);

    // 2. A small drag sideways-up: the app settles back to the same place.
    await drag(page, 30, -30, 4, 16);
    await page.mouse.up();
    expect(await layout(page, "vibex")).toEqual(base);

    // 3. Sideways to the previous app and back to this one.
    await drag(page, 120, 0, 8, 16);
    await page.mouse.up();
    await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
    await page.waitForTimeout(450);
    await drag(page, -120, 0, 8, 16);
    await page.mouse.up();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
    expect(await layout(page, "vibex")).toEqual(base);

    // 4. A cancelled touch.
    await drag(page, 40, -120, 6, 16);
    await page.locator('section[data-state="open"] [data-testid="home-indicator"]').dispatchEvent("pointercancel");
    await page.mouse.up();
    expect(await layout(page, "vibex")).toEqual(base);
  });
}

test("gesture bar: a short smooth swipe glides into the switcher; a quick flick goes home", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, "phone gesture");
  await signUpViaApi(page, "Плавный", "Жест");
  await openApp(page, "notes");
  await page.waitForTimeout(500);
  // Short and smooth (≈ 600 px/s), released while moving: the switcher.
  await drag(page, 0, -140, 14, 16);
  await page.mouse.up();
  await expect(page.getByTestId("app-switcher")).toBeVisible();
  await page.getByTestId("switcher-card-notes").click();
  await expect(page.locator('[data-testid="window-notes"][data-state="open"]')).toBeVisible();
  await page.waitForTimeout(450);
  // A quick flick, still well short of the "dragged high" line (40 % of the screen): home.
  await drag(page, 0, -230, 2, 0);
  await page.mouse.up();
  await expect(page.locator('section[data-state="open"]')).toHaveCount(0);
  await expect(page.getByTestId("app-switcher")).toHaveCount(0);
});
