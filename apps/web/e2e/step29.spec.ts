import { expect, test, type Page } from "@playwright/test";
import { openApp, phoneHome, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Step 2.9 — shell: desktop logo size, the phone gesture bar that moves the
 * app with the finger, real previews in the app switcher, and the system side
 * drawer (the screen slides over the menu; never dimmed).
 */

const SHOTS = process.env.STEP29_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

/** Drags the open app's gesture bar by (dx, dy) in small steps; returns once the finger is down and moved (not released). */
async function dragBar(page: Page, dx: number, dy: number, steps = 12) {
  const box = (await page.locator('section[data-state="open"] [data-testid="home-indicator"]').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  return { x: x + dx, y: y + dy };
}

test("desktop logo size: only the logo inside the white tile changes; saved with the account", async ({ page }) => {
  await signUpViaApi(page, "Логотип", "Размеров");
  const tile = page.getByTestId("app-mail").locator("[data-glyph-box]").first();
  await expect(tile).toHaveAttribute("data-glyph-box", "52%");
  // Layout size (not the on-screen box: hover / press scale the tile slightly).
  const tileSize = () => page.getByTestId("app-mail").locator("[data-system-ui]").first().evaluate((e: HTMLElement) => ({ width: e.offsetWidth, height: e.offsetHeight }));
  const tileBox = await tileSize();
  const cellWidth = () => page.getByTestId("app-mail").evaluate((e: HTMLElement) => e.offsetWidth);
  const cell = await cellWidth();
  await openApp(page, "settings");
  await page.getByTestId("settings-nav-desktop").last().click();
  await expect(page.getByTestId("glyph-scale-setting")).toBeVisible();
  await page.getByTestId("glyph-scale-l").click();
  await expect(page.getByTestId("glyph-scale-setting").locator("[data-glyph-box]")).toHaveAttribute("data-glyph-box", "64%");
  if (isMobile(page)) await phoneHome(page);
  else await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await expect(page.getByTestId("app-mail").locator("[data-glyph-box]").first()).toHaveAttribute("data-glyph-box", "64%");
  // The white tile and the cell keep their size.
  expect(await tileSize()).toEqual(tileBox);
  expect(await cellWidth()).toBe(cell);
  // Saved with the account: a new start keeps it.
  await reloadUnlocked(page);
  await expect(page.getByTestId("app-mail").locator("[data-glyph-box]").first()).toHaveAttribute("data-glyph-box", "64%");
  await shot(page, `glyph-${isMobile(page) ? "phone" : "pc"}`);
});

test("phone gesture bar: the app follows the finger, shrinks into a card with its neighbours; release in the middle opens the switcher with real previews", async ({ page }) => {
  test.skip(!isMobile(page), "phone gesture");
  await signUpViaApi(page, "Жест", "Пальцем");
  await openApp(page, "settings");
  await expect(page.getByTestId("settings-nav-desktop").last()).toBeVisible();
  await phoneHome(page);
  await openApp(page, "notes");
  await page.waitForTimeout(600);

  // A small drag: the window moves with the finger, the bar has not decided anything yet.
  const win = page.locator('[data-testid="window-notes"] > div').first();
  const before = (await win.boundingBox())!;
  await dragBar(page, 0, -160);
  const during = (await win.boundingBox())!;
  expect(during.y + during.height).toBeLessThan(before.y + before.height - 60);
  expect(during.width).toBeLessThan(before.width);
  // The other open app is shown beside it, with its last screen.
  await expect(page.getByTestId("gesture-peek")).toBeVisible();
  await expect(page.getByTestId("gesture-peek-settings").locator("[data-snapshot]")).toHaveAttribute("data-snapshot", "live");
  await shot(page, "gesture-drag");
  await page.mouse.up();

  // Released in the middle: the app switcher, cards with the real screens (not a placeholder).
  await expect(page.getByTestId("app-switcher")).toBeVisible();
  await expect(page.getByTestId("switcher-card-settings").locator("[data-snapshot]")).toHaveAttribute("data-snapshot", "live");
  await expect(page.getByTestId("switcher-card-notes").locator("[data-snapshot]")).toHaveAttribute("data-snapshot", "live");
  // The preview is the app's own screen (its text is there), and it can't be used.
  await expect(page.getByTestId("switcher-card-settings")).toContainText(/Настройки|Рабочий стол/);
  await shot(page, "switcher-previews");
  // A closed app leaves the switcher (and its picture).
  await page.getByTestId("switcher-card-settings").locator("..").getByRole("button", { name: /Закрыть|Close/ }).first().click();
  await expect(page.getByTestId("switcher-card-settings")).toHaveCount(0);
  await page.getByTestId("switcher-card-notes").click();
  await expect(page.locator('[data-testid="window-notes"][data-state="open"]')).toBeVisible();

  // A tiny drag: the app settles back where it was.
  await dragBar(page, 0, -25, 4);
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="window-notes"][data-state="open"]')).toBeVisible();
  await expect(page.getByTestId("app-switcher")).toHaveCount(0);
  const settled = (await win.boundingBox())!;
  expect(Math.abs(settled.y - before.y)).toBeLessThan(2);

  // Far up: home.
  await dragBar(page, 0, -520, 14);
  await page.mouse.up();
  await expect(page.locator('section[data-state="open"]')).toHaveCount(0);
});

test("phone gesture bar: a sideways swipe moves the app with the finger and switches to the neighbour; pointercancel puts it back", async ({ page }) => {
  test.skip(!isMobile(page), "phone gesture");
  await signUpViaApi(page, "Свайп", "Вбок");
  await openApp(page, "settings");
  await phoneHome(page);
  await openApp(page, "notes");
  await page.waitForTimeout(600);
  const win = page.locator('[data-testid="window-notes"] > div').first();
  const x0 = (await win.boundingBox())!.x;
  await dragBar(page, 120, 0, 8);
  expect((await win.boundingBox())!.x).toBeGreaterThan(x0 + 80);
  await page.mouse.up();
  // Right: the app opened before (Settings) slides in.
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  await expect(page.locator('[data-testid="window-notes"][data-state="open"]')).toHaveCount(0);
  await page.waitForTimeout(500);
  // A cancelled touch leaves the app exactly where it was.
  const s = page.locator('[data-testid="window-settings"] > div').first();
  const sx = (await s.boundingBox())!.x;
  await page.locator('section[data-state="open"] [data-testid="home-indicator"]').dispatchEvent("pointercancel");
  await page.waitForTimeout(400);
  expect(Math.abs((await s.boundingBox())!.x - sx)).toBeLessThan(2);
});

test("side drawer: the screen slides right over the menu, not dimmed or blurred; tap on the screen closes", async ({ page }) => {
  test.skip(!isMobile(page), "phone drawer");
  await signUpViaApi(page, "Меню", "Сбоку");
  await openApp(page, "vibex");
  await page.getByTestId("vibex-menu").click();
  const root = page.getByTestId("vibex-drawer");
  await expect(root).toHaveAttribute("data-open", "true");
  await page.waitForTimeout(700);
  const screen = page.getByTestId("vibex-drawer-screen");
  const box = (await screen.boundingBox())!;
  expect(box.x).toBeGreaterThan(200);
  // No dimming or blur over the screen.
  const look = await screen.evaluate((el) => {
    const catcher = el.querySelector<HTMLElement>('[data-testid="vibex-drawer-catcher"]')!;
    const c = getComputedStyle(catcher);
    return { bg: c.backgroundColor, filter: getComputedStyle(el).filter, backdrop: c.backdropFilter, radius: getComputedStyle(el).borderTopLeftRadius };
  });
  expect(look.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(look.filter).toBe("none");
  expect(look.backdrop === "none" || look.backdrop === "").toBe(true);
  expect(parseFloat(look.radius)).toBeGreaterThan(10);
  await expect(page.getByTestId("vibex-drawer-menu").getByTestId("vibex-nav-feed")).toBeVisible();
  await shot(page, "drawer-vibex");
  await page.getByTestId("vibex-drawer-catcher").click({ position: { x: 60, y: 300 } });
  await expect(root).not.toHaveAttribute("data-open", "true");
  await page.waitForTimeout(600);
  expect((await screen.boundingBox())!.x).toBeLessThan(2);

  // Mail uses the same drawer.
  await phoneHome(page);
  await openApp(page, "mail");
  await page.getByTestId("mail-drawer").click();
  await expect(page.getByTestId("mail-drawer-root")).toHaveAttribute("data-open", "true");
  await page.waitForTimeout(700);
  expect((await page.getByTestId("mail-drawer-root-screen").boundingBox())!.x).toBeGreaterThan(200);
  await expect(page.getByTestId("mail-drawer-panel")).toBeVisible();
  await shot(page, "drawer-mail");
});
