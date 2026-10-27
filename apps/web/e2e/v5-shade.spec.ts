import { expect, test, type Page } from "@playwright/test";
import { reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Update 5 · 6: the phone Notification Center follows the finger 1 : 1 while it is held (its lower edge stays
 * under the finger, never ahead of it); after release it opens or goes back by distance and speed.
 */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
const sheet = (page: Page) => page.locator('[data-testid="notification-layer"] [role="dialog"]');
const bottom = (page: Page) => sheet(page).evaluate((el) => el.getBoundingClientRect().bottom);

async function moveTo(page: Page, from: number, to: number, steps: number, wait = 16) {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(200, from + ((to - from) * i) / steps);
    if (wait) await page.waitForTimeout(wait);
  }
}

test("Update 5 · 6: the shade follows the finger 1 : 1 while held; slow short pulls go back, long or quick ones open", async ({ page }) => {
  test.skip(!isMobile(page), "phone gesture");
  await signUpViaApi(page, "Шторка", "Пальцем");
  await reloadUnlocked(page);
  await expect(page.getByTestId("app-mail")).toBeVisible();

  // Held: the lower edge is where the finger is, down and back up again (no running ahead).
  await page.mouse.move(200, 4);
  await page.mouse.down();
  await moveTo(page, 4, 300, 20);
  await page.waitForTimeout(120);
  expect(Math.abs((await bottom(page)) - 300)).toBeLessThan(6);
  await moveTo(page, 300, 180, 10);
  await page.waitForTimeout(120);
  expect(Math.abs((await bottom(page)) - 180)).toBeLessThan(6);
  // Released slowly, short: it goes back.
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect.poll(() => bottom(page)).toBeLessThan(2);
  await expect(page.getByTestId("notification-center")).toHaveCount(0);

  // Released slowly, past a third of the screen: it opens.
  await page.mouse.move(200, 4);
  await page.mouse.down();
  await moveTo(page, 4, 480, 24);
  await page.waitForTimeout(220);
  await page.mouse.up();
  await expect(page.getByTestId("notification-center")).toBeVisible();
  const h = page.viewportSize()!.height;
  await expect.poll(() => bottom(page)).toBeGreaterThan(h - 2);
  await page.getByTestId("notifications-close").click();
  await expect.poll(() => bottom(page)).toBeLessThan(2);

  // A quick short flick down opens as well.
  await page.mouse.move(200, 4);
  await page.mouse.down();
  await moveTo(page, 4, 170, 4, 8);
  await page.mouse.up();
  await expect(page.getByTestId("notification-center")).toBeVisible();
});
