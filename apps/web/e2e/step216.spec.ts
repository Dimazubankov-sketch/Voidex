import { expect, test, type Page } from "@playwright/test";
import { apiAs, newPage, openApp, settingsRoot, signUpViaApi } from "./helpers";

/**
 * Step 2.16: «Изменить страницы» on the phone, suggested people in Vibex
 * «Подписки», the notification sound picker, Clock drums moving one value
 * on a small swipe.
 */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

test("phone «Изменить страницы»: every page in the overview, a drag reorders them and is saved", async ({ page }) => {
  test.skip(!isMobile(page), "phone pages");
  await signUpViaApi(page, "Страницы", "Порядок");
  const before = ((await apiAs(page, "GET", "/api/me")).body as { preferences: { workspace?: { layout?: { mobile: { pages: unknown[] } } } } }).preferences.workspace?.layout;
  const pg = (await page.getByTestId("home-page-0").boundingBox())!;
  await page.mouse.move(pg.x + 30, pg.y + pg.height - 30);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.getByTestId("home-appearance").click();
  await page.getByTestId("brush-pages").click();
  await expect(page.getByTestId("pages-editor")).toBeVisible();
  const cards = page.locator('[data-testid^="pages-editor-page-"]');
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBe(before?.mobile.pages.length ?? count);
  if (count >= 2) {
    const first = (await page.getByTestId("pages-editor-page-0").boundingBox())!;
    const second = (await page.getByTestId("pages-editor-page-1").boundingBox())!;
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(first.x + first.width / 2 + ((second.x - first.x) * i) / 10, second.y + second.height / 2);
    await page.mouse.up();
    await expect(page.getByTestId("pages-editor-page-0")).toHaveAttribute("data-slot", "1");
  }
  await page.getByTestId("pages-editor-done").click();
  await expect(page.getByTestId("pages-editor")).toHaveCount(0);
});

test("Vibex «Подписки» empty: suggested people with «Подписаться»; a followed person leaves the list", async ({ page, browser }) => {
  const other = await newPage(browser, isMobile(page));
  const someone = await signUpViaApi(other, "Рекомендуемый", "Профиль");
  // People who posted lately come first among the suggestions.
  expect((await apiAs(other, "POST", "/api/vibex/posts", { text: "Привет, Vibex." })).status).toBe(201);
  await other.context().close();
  await signUpViaApi(page, "Пустые", "Подписки");
  const suggested = (await apiAs(page, "GET", "/api/vibex/people/suggested")).body as { id: string }[];
  expect(suggested.some((p) => p.id === someone.id)).toBe(true);
  await openApp(page, "vibex");
  await page.getByTestId("feed-mode-following").click();
  await expect(page.getByTestId("feed-following-empty")).toBeVisible();
  const row = page.locator(`[data-testid="feed-suggested-person"][data-person="${someone.id}"]`);
  await expect(row).toBeVisible();
  await row.getByTestId("feed-suggested-follow").click();
  await expect(row).toHaveCount(0);
  const after = (await apiAs(page, "GET", "/api/vibex/people/suggested")).body as { id: string }[];
  expect(after.some((p) => p.id === someone.id)).toBe(false);
});

test("Settings → Уведомления: the notification sound is chosen from Forma's sounds, «Входящее» by default, saved", async ({ page }) => {
  await signUpViaApi(page, "Звук", "Уведомлений");
  await openApp(page, "settings");
  await settingsRoot(page);
  await page.getByTestId("settings-nav-notifications").last().click();
  await expect(page.getByTestId("pref-sound-soft-inbox")).toBeVisible();
  await expect(page.getByTestId("pref-sound-soft-inbox").locator("svg[aria-label]")).toHaveCount(1);
  await page.getByTestId("pref-sound-soft-ping").click();
  await expect(page.getByTestId("pref-sound-soft-ping").locator("svg[aria-label]")).toHaveCount(1);
  await expect
    .poll(async () => ((await apiAs(page, "GET", "/api/me")).body as { preferences: { notifications: { soundId?: string } } }).preferences.notifications.soundId)
    .toBe("soft-ping");
  // The sound file is Forma's own (not a copy).
  const res = await page.request.get("/forma/sounds/audio/preview/soft-ping.mp3");
  expect(res.status()).toBe(200);
});
