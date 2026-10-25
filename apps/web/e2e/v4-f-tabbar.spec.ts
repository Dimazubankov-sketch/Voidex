import { expect, test, type Page } from "@playwright/test";
import { apiAs as api, openApp, signUpViaApi } from "./helpers";

/**
 * Update 4 · F (SR7854): the phone tab bar turns compact (narrower, lower, still showing the active tab)
 * while the content is scrolled down, and full again as soon as it is scrolled up; small jitters change
 * nothing; the bar's own swipe still belongs to the bar.
 */
const bar = (page: Page) => page.getByTestId("vibex-tabbar");
const width = async (page: Page) => (await bar(page).boundingBox())!.width;
async function scrollFeed(page: Page, dy: number, steps = 6) {
  const b = (await page.getByTestId("vibex-tabbar").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y - 200);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await page.waitForTimeout(30);
  }
}

test("F: the Vibex tab bar shrinks on scroll down, comes back on scroll up (not only at the top), ignores jitter; the active tab stays marked", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 700, "phone tab bar");
  await signUpViaApi(page, "Панель", "Вкладок");
  for (let i = 0; i < 14; i++) await api(page, "POST", "/api/vibex/posts", { text: `Пост номер ${i + 1}\nвторая строка\nтретья строка` });
  await openApp(page, "vibex");
  await expect(bar(page)).toBeVisible();
  await page.getByTestId("vibex-tab-me").last().click();
  await expect(page.getByTestId("post-card").first()).toBeVisible();
  await page.waitForTimeout(400);
  const full = await width(page);
  await expect(bar(page)).not.toHaveAttribute("data-compact", "true");
  // Jitter: a few px down and back: nothing changes.
  await scrollFeed(page, 60, 2);
  await expect(bar(page)).toHaveAttribute("data-compact", "true");
  await scrollFeed(page, -40, 2);
  await expect(bar(page)).not.toHaveAttribute("data-compact", "true");
  // Now small moves both ways (a finger's jitter): no change.
  for (const d of [12, -10, 14, -12, 10]) await scrollFeed(page, d, 1);
  await expect(bar(page)).not.toHaveAttribute("data-compact", "true");
  // A real scroll down: compact (narrower), the active tab still in its capsule.
  await scrollFeed(page, 600);
  await expect(bar(page)).toHaveAttribute("data-compact", "true");
  await expect.poll(() => width(page)).toBeLessThan(full * 0.85);
  await page.waitForTimeout(350);
  const cap = (await page.getByTestId("vibex-tabbar-capsule").boundingBox())!;
  const me = (await page.getByTestId("vibex-tab-me").last().boundingBox())!;
  expect(cap.x + cap.width / 2).toBeGreaterThan(me.x);
  expect(cap.x + cap.width / 2).toBeLessThan(me.x + me.width);
  // A short scroll up (far from the top): full again.
  await scrollFeed(page, -120, 3);
  await expect(bar(page)).not.toHaveAttribute("data-compact", "true");
  await expect.poll(() => width(page)).toBeGreaterThan(full - 2);
  // Compact again, then switching tabs brings the full bar back.
  await scrollFeed(page, 500);
  await expect(bar(page)).toHaveAttribute("data-compact", "true");
  await page.getByTestId("vibex-tab-feed").last().click();
  await expect(bar(page)).not.toHaveAttribute("data-compact", "true");
  // The bar still owns its sideways swipe (no side menu from it).
  await expect(page.getByTestId("vibex-tabbar-wrap")).toHaveAttribute("data-gesture-owner", "");
});

test("F: Clock uses the same bar (one component)", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 700, "phone tab bar");
  await signUpViaApi(page, "Часы", "Панель");
  await openApp(page, "clock");
  const nav = page.locator('section[data-testid="window-clock"] nav.vx-tabbar');
  await expect(nav).toBeVisible();
  expect(await nav.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain("max-width");
});
