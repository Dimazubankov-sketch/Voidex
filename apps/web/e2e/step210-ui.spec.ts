import { expect, test, type Page } from "@playwright/test";
import { openApp, signUpViaApi } from "./helpers";

/**
 * Step 2.10 — Mail: the folders drawer follows a swipe from the left edge
 * (small move puts it back, no dimming); the search is the round button that
 * grows into the field in place. Vibex: «Главная» truly centred; «История»
 * has no search button.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

async function edgeDrag(page: Page, dx: number, release = true) {
  const app = (await page.locator('section[data-state="open"] [data-window-content]').boundingBox())!;
  const x = app.x + 6;
  const y = app.y + app.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x + (dx * i) / 10, y + i * 0.5);
    await page.waitForTimeout(24);
  }
  if (release) await page.mouse.up();
}

test("Mail: an edge swipe pulls the folders drawer out with the finger; a small one puts it back", async ({ page }) => {
  test.skip(!isMobile(page), "phone gesture");
  await signUpViaApi(page, "Почта", "Свайпом");
  await openApp(page, "mail");
  await page.waitForTimeout(500);
  const root = page.getByTestId("mail-drawer-root");
  const screen = page.getByTestId("mail-drawer-root-screen");

  // Mid-drag: the screen follows the finger, nothing is dimmed or blurred.
  await edgeDrag(page, 120, false);
  const mid = (await screen.boundingBox())!;
  expect(mid.x).toBeGreaterThan(80);
  expect(mid.x).toBeLessThan(160);
  expect(await screen.evaluate((el) => getComputedStyle(el).filter)).toBe("none");
  await page.mouse.up();
  await expect(root).toHaveAttribute("data-open", "true");
  await page.waitForTimeout(600);
  await expect(page.getByTestId("folder-sent")).toBeVisible();
  // Swipe left on the screen closes it.
  await page.getByTestId("mail-drawer-root-catcher").click({ position: { x: 40, y: 300 } });
  await expect(root).not.toHaveAttribute("data-open", "true");
  await page.waitForTimeout(600);
  expect((await screen.boundingBox())!.x).toBeLessThan(2);

  // A small move: back to its place, the drawer stays closed.
  await edgeDrag(page, 40);
  await page.waitForTimeout(500);
  await expect(root).not.toHaveAttribute("data-open", "true");
  expect((await screen.boundingBox())!.x).toBeLessThan(2);
});

test("Mail: the search button grows into the field in place; X clears and folds it back", async ({ page }) => {
  test.skip(!isMobile(page), "phone header");
  await signUpViaApi(page, "Почта", "Поиском");
  await openApp(page, "mail");
  const bar = page.getByTestId("mail-search-bar");
  const closed = (await bar.boundingBox())!;
  expect(Math.round(closed.width)).toBe(40);
  await page.getByTestId("mail-search-bar-open").click();
  await expect(bar).toHaveAttribute("data-open", "true");
  await page.waitForTimeout(450);
  const open = (await bar.boundingBox())!;
  // Grew to the left, the right edge stayed.
  expect(open.width).toBeGreaterThan(closed.width * 3);
  expect(Math.abs(open.x + open.width - (closed.x + closed.width))).toBeLessThan(2);
  await expect(page.getByTestId("mail-search-bar-input")).toBeFocused();
  await page.getByTestId("mail-search-bar-input").fill("нет-такого-письма");
  await expect(page.getByText("Ничего не найдено")).toBeVisible();
  await page.getByTestId("mail-search-bar-close").click();
  await expect(bar).not.toHaveAttribute("data-open", "true");
  await expect(page.getByText("Ничего не найдено")).toHaveCount(0);
  await page.waitForTimeout(450);
  expect(Math.round((await bar.boundingBox())!.width)).toBe(40);
});

for (const width of [320, 390, 430]) {
  test(`Vibex: «Главная» is centred on the header at ${width}px; «История» has no search button`, async ({ page }) => {
    test.skip(!isMobile(page), "phone header");
    await page.setViewportSize({ width, height: 844 });
    await signUpViaApi(page, "Центр", "Заголовка");
    await openApp(page, "vibex");
    const title = page.getByTestId("vibex-header-title");
    await expect(title).toHaveText("Главная");
    await page.waitForTimeout(500);
    const t = (await title.boundingBox())!;
    const header = (await page.locator('section[data-state="open"] [data-window-content]').boundingBox())!;
    expect(Math.abs(t.x + t.width / 2 - (header.x + header.width / 2))).toBeLessThan(1.5);
    // The search still grows over the title.
    await page.getByTestId("vibex-feed-search-open").click();
    await expect(page.getByTestId("vibex-feed-search")).toHaveAttribute("data-open", "true");
    await page.getByTestId("vibex-feed-search-close").click();

    await page.getByTestId("vibex-menu").click();
    await page.getByTestId("vibex-nav-history").last().click();
    await expect(page.getByTestId("history-screen")).toBeVisible();
    await expect(title).toHaveText("История");
    await expect(page.getByTestId("vibex-search")).toHaveCount(0);
  });
}
