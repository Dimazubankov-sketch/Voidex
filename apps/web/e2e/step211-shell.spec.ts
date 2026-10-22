import { expect, test, type Page } from "@playwright/test";
import { openApp, phoneHome, signUpViaApi } from "./helpers";

/**
 * Step 2.11: the phone gesture bar as in the reference video. The card
 * follows the finger and shrinks quickly at first; the home screen shows
 * through blurred; whatever comes next (home, the switcher, a neighbour)
 * continues from the very pose the finger left: no jump back to full size,
 * no teleport.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

async function bar(page: Page) {
  const box = (await page.locator('section[data-state="open"] [data-testid="home-indicator"]').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
const scaleOf = (page: Page, appId: string) =>
  page.locator(`[data-testid="window-${appId}"]`).evaluate((el) => {
    const m = getComputedStyle(el).transform;
    if (m === "none") return 1;
    const v = m.match(/matrix\(([^)]+)\)/)![1]!.split(",").map(Number);
    return v[0]!;
  });

test("the card shrinks quickly with the finger over a blurred home screen; a flick home continues from that pose (no jump back)", async ({ page }) => {
  test.skip(!isMobile(page), "phone gesture");
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpViaApi(page, "Видео", "Жест");
  await openApp(page, "notes");
  await page.waitForTimeout(800);
  const { x, y } = await bar(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  // A fifth of the screen up: already about 0.63 (it used to be 0.82).
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y - (844 * 0.2 * i) / 8);
  await page.waitForTimeout(100);
  const s = await scaleOf(page, "notes");
  expect(s).toBeGreaterThan(0.58);
  expect(s).toBeLessThan(0.7);
  await expect(page.getByTestId("gesture-backdrop")).toBeVisible();
  expect(await page.getByTestId("gesture-backdrop").evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("blur");
  // Record the card's scale every frame from the release on.
  await page.evaluate(() => {
    const w = window as unknown as { __scales: number[] };
    w.__scales = [];
    const el = document.querySelector('[data-testid="window-notes"]') as HTMLElement;
    const tick = () => {
      const m = getComputedStyle(el).transform;
      w.__scales.push(m === "none" ? 1 : Number(m.match(/matrix\(([^,]+)/)![1]));
      if (w.__scales.length < 40) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // A quick flick up from here: home.
  await page.mouse.move(x, y - 844 * 0.2 - 120);
  await page.mouse.move(x, y - 844 * 0.2 - 240);
  await page.mouse.up();
  await expect(page.locator('section[data-state="open"]')).toHaveCount(0);
  await page.waitForTimeout(700);
  const scales = await page.evaluate(() => (window as unknown as { __scales: number[] }).__scales);
  // Never back to full size on the way into the icon.
  expect(Math.max(...scales)).toBeLessThan(0.75);
  expect(scales.at(-1)!).toBeLessThan(0.3);
});

test("a sideways swipe: the neighbour comes in from where it was peeking (no jump from the screen edge)", async ({ page }) => {
  test.skip(!isMobile(page), "phone gesture");
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpViaApi(page, "Сосед", "Рядом");
  await openApp(page, "settings");
  await phoneHome(page);
  await openApp(page, "notes");
  await page.waitForTimeout(800);
  const { x, y } = await bar(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (150 * i) / 8, y);
  await page.evaluate(() => {
    const w = window as unknown as { __xs: number[] };
    w.__xs = [];
    const el = document.querySelector('[data-testid="window-settings"]') as HTMLElement;
    const tick = () => {
      const cs = getComputedStyle(el);
      const m = cs.transform;
      // Frames before the release show its hidden pose (by its icon, transparent): not part of the slide-in.
      if (Number(cs.opacity) > 0.5) w.__xs.push(m === "none" ? 0 : Number(m.match(/matrix\(([^)]+)\)/)![1]!.split(",")[4]));
      else w.__xs.push(0);
      if (w.__xs.length < 30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.up();
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  await page.waitForTimeout(600);
  const xs = await page.evaluate(() => (window as unknown as { __xs: number[] }).__xs.filter((v) => v !== 0));
  // It starts about where it peeked (150 - 390 - 16 ≈ -256), not at -390, and only moves right.
  expect(xs[0]!).toBeGreaterThan(-300);
  for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 1);
  await expect.poll(() => page.locator('[data-testid="window-settings"]').evaluate((el) => getComputedStyle(el).transform)).toBe("none");
});
