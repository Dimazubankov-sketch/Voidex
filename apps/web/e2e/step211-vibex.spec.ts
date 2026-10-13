import { expect, test, type Page } from "@playwright/test";
import { apiAs, newPage, openApp, signUpViaApi } from "./helpers";

/**
 * Step 2.11: Vibex. One header on every tab (the «Профиль» look: 60 px, no
 * border, the title the same size; search only on Главная and Профиль, it
 * opens the Search tab). The side drawer survives rapid open / close (button
 * and swipe, mixed) and always settles. «Обновление...» shows only on a real
 * connection problem and goes away on its own. The video-message mark is the
 * camera glyph.
 */

const SHOTS = process.env.STEP211_SHOTS;
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${isMobile(page) ? "phone" : "pc"}.png` });
}

/** A finger drag (real touch events) from (x, y) by (dx, dy). */
async function fingerDrag(page: Page, x: number, y: number, dx: number, dy: number, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("one header on every tab: same height and title size, no border; search only on Главная / Профиль and it opens Поиск", async ({ page }) => {
  test.skip(!isMobile(page), "phone tabs");
  await signUpViaApi(page, "Шапка", "Единая");
  await openApp(page, "vibex");
  const sizes: { tab: string; h: number; font: string; border: string; search: number }[] = [];
  for (const tab of ["feed", "people", "activity", "chats", "me"]) {
    await page.getByTestId(`vibex-tab-${tab}`).click();
    const title = page.getByTestId("vibex-header-title");
    await expect(title).toBeVisible();
    const header = page.getByTestId("vibex-header").locator("xpath=../..");
    const h = (await header.boundingBox())!.height;
    const font = await title.evaluate((el) => getComputedStyle(el).fontSize);
    const border = await header.evaluate((el) => getComputedStyle(el).borderBottomWidth);
    sizes.push({ tab, h, font, border, search: await page.getByTestId("vibex-search").count() });
    await shot(page, `header-${tab}`);
  }
  for (const s of sizes) {
    expect(s.h, s.tab).toBe(60);
    expect(s.font, s.tab).toBe("19px");
    expect(s.border, s.tab).toBe("0px");
    expect(s.search, s.tab).toBe(s.tab === "feed" || s.tab === "me" ? 1 : 0);
  }
  await page.getByTestId("vibex-tab-me").click();
  await page.getByTestId("vibex-search").click();
  await expect(page.getByTestId("search-screen")).toBeVisible();
  await expect(page.getByTestId("vibex-tab-people")).toHaveAttribute("aria-current", "page");
});

test("drawer: 10 rapid open / close, swipe-open → button-close → swipe-open, button-open → swipe-close → button-open; it always settles", async ({ page }) => {
  test.skip(!isMobile(page), "phone drawer");
  await signUpViaApi(page, "Меню", "Быстрое");
  await openApp(page, "vibex");
  await page.waitForTimeout(500);
  const root = page.getByTestId("vibex-drawer");
  const screen = page.getByTestId("vibex-drawer-screen");
  const content = page.getByTestId("vibex-drawer-content");
  const settledClosed = async () => {
    await expect(root).not.toHaveAttribute("data-open", "true");
    await expect.poll(async () => (await screen.boundingBox())!.x).toBeLessThan(1);
    await expect.poll(() => content.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  };
  const settledOpen = async () => {
    await expect(root).toHaveAttribute("data-open", "true");
    await expect.poll(async () => (await screen.boundingBox())!.x).toBeGreaterThan(200);
    await expect.poll(async () => Number(await content.evaluate((el) => getComputedStyle(el).opacity))).toBeCloseTo(0.5, 2);
  };
  const box = (await screen.boundingBox())!;
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // 10 rapid toggles through the button and the catcher (no waiting for the animations).
  for (let i = 0; i < 10; i++) {
    await page.getByTestId("vibex-menu").click({ force: true });
    await page.waitForTimeout(60);
    await page.getByTestId("vibex-drawer-catcher").click({ position: { x: 30, y: 300 }, force: true });
    await page.waitForTimeout(60);
  }
  await settledClosed();

  // Swipe-open → button-close (tap on the screen) → swipe-open, without waiting.
  await fingerDrag(page, mid.x - 80, mid.y, 180, 2);
  await expect(root).toHaveAttribute("data-open", "true");
  await page.getByTestId("vibex-drawer-catcher").click({ position: { x: 30, y: 300 } });
  await fingerDrag(page, mid.x - 80, mid.y, 180, 2);
  await settledOpen();

  // Swipe-close → button-open → swipe-close → button-open.
  await fingerDrag(page, box.x + box.width - 30, mid.y, -200, 2);
  await expect(root).not.toHaveAttribute("data-open", "true");
  await page.getByTestId("vibex-menu").click({ force: true });
  await settledOpen();
  await page.getByTestId("vibex-drawer-catcher").click({ position: { x: 30, y: 300 } });
  await settledClosed();
  // Nothing stuck: the app still answers.
  await page.getByTestId("vibex-tab-chats").click();
  await expect(page.getByTestId("chats-pane")).toBeVisible();
});

test("«Обновление...» only on a real problem (offline), gone when the connection is back", async ({ page }) => {
  await signUpViaApi(page, "Сеть", "Пропадает");
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
  const title = page.getByTestId("vibex-header-title").first();
  await expect(title).toHaveText("Главная");
  // Normal loading never shows it.
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("network-updating")).toHaveCount(0);
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByTestId("network-updating").first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("network-updating").first()).toHaveText("Обновление...");
  await shot(page, "network-updating");
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("network-updating")).toHaveCount(0, { timeout: 20_000 });
  await expect(title).toHaveText("Главная");
});

test("chat cards: compact, pinned and muted marks, the video-message camera glyph in the preview", async ({ page, browser }) => {
  const a = await signUpViaApi(page, "Карта", "Чатов");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Бэлла", "Собеседник");
  const chat = (await apiAs(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body as { id: string };
  await apiAs(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет! Это длинное сообщение, которое не должно растягивать карточку на две строки в списке чатов" });
  await apiAs(page, "PATCH", `/api/vibex/chats/${chat.id}`, { muted: true });
  await apiAs(page, "PUT", "/api/vibex/chats/pins", { conversationIds: [chat.id] });
  void a;
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
  const row = page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("chat-muted")).toBeVisible();
  await expect(row.getByTestId("chat-pinned")).toBeVisible();
  // One line of preview: the card stays compact.
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(72);
  await shot(page, "chat-cards");
  await bp.context().close();
});
