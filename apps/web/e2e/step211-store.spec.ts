import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs as api, newPage, signUpViaApi } from "./helpers";

/**
 * Step 2.11: Appex Store, native in VOIDEX (no iframe, the VOIDEX session).
 * The catalog is the App Registry (no Store, no Settings, no made-up apps),
 * real screenshots, real reviews (one per person, likes / dislikes, reports),
 * install / open / update / remove through the system, share, search, and
 * no dead buttons.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const SHOTS = process.env.STEP211_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${isMobile(page) ? "phone" : "pc"}.png` });
}
const CATALOG = ["calculator", "files", "mail", "media", "notes", "vibex"];

async function openStore(page: Page) {
  if (isMobile(page)) await page.getByTestId("app-store").click();
  else await page.getByTestId("dock-app-store").click();
  await expect(page.locator('[data-testid="window-store"][data-state="open"]')).toBeVisible();
  await expect(page.getByTestId("store-home")).toBeVisible();
}
async function toApp(page: Page, id: string) {
  await page.getByTestId("store-see-all").first().click();
  await page.locator(`[data-testid="store-row"][data-app="${id}"] [data-testid="store-row-open"]`).click();
  await expect(page.getByTestId("store-app-page")).toHaveAttribute("data-app", id);
}

test("catalog: every registry app (no Store, no Settings), the carousel, collections, search with history and results; no iframe", async ({ page }) => {
  await signUpViaApi(page, "Каталог", "Магазина");
  await openStore(page);
  await expect(page.locator('[data-testid="window-store"] iframe')).toHaveCount(0);
  await expect(page.getByTestId("store-title")).toHaveText("Приложения");
  await expect(page.getByTestId("store-hero-card")).toHaveCount(4);
  await shot(page, "store-home");
  await page.getByTestId("store-see-all").first().click();
  const ids = await page.getByTestId("store-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-app")).sort());
  expect(ids).toEqual(CATALOG);
  await page.getByTestId("store-back").click();
  // The carousel: a dot takes it to that story.
  await page.getByTestId("store-hero-dot").nth(2).click();
  await expect(page.getByTestId("store-hero")).toHaveAttribute("data-index", "2");
  // Search: typing suggests apps; Enter shows results with real screenshots; X back to the catalog.
  const field = page.getByTestId("store-search");
  await field.fill("почт");
  await expect(page.locator('[data-testid="store-suggestion"][data-app="mail"]')).toBeVisible();
  await field.press("Enter");
  await expect(page.locator('[data-testid="store-search-result"][data-app="mail"]')).toBeVisible();
  await expect(page.locator('[data-testid="store-search-result"] [data-testid="store-shot"] img').first()).toHaveJSProperty("complete", true);
  await page.getByTestId("store-search-close").click();
  await expect(page.getByTestId("store-home")).toBeVisible();
  await field.click();
  await expect(page.getByTestId("store-history-item").first()).toHaveText("почт");
  await page.getByTestId("store-history-clear").click();
  await expect(page.getByTestId("store-history-item")).toHaveCount(0);
});

test("an app's page: real screenshots (full screen, arrows on PC), description, what's new, developer page, share to Vibex", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Страница", "Приложения");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Друг", "Получатель");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body as { id: string };
  await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет" });
  void me;
  await openStore(page);
  await toApp(page, "notes");
  await expect(page.getByTestId("store-description")).toContainText("проекты");
  await expect(page.getByTestId("store-news")).toContainText("Версия");
  const shots = page.getByTestId("store-shot");
  await expect(shots).toHaveCount(2);
  const ok = await shots.locator("img").evaluateAll((imgs) => Promise.all(imgs.map((i) => (i as HTMLImageElement).decode().then(() => (i as HTMLImageElement).naturalWidth > 100))));
  expect(ok.every(Boolean)).toBe(true);
  await shot(page, "store-app");
  await shots.first().click();
  const viewer = page.getByTestId("store-viewer");
  await expect(viewer).toBeVisible();
  if (!isMobile(page)) {
    await page.getByTestId("store-viewer-next").click();
    await expect(viewer).toHaveAttribute("data-index", "1");
  }
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // The PC screenshots tab.
  await page.getByTestId("store-shots-pc").click();
  await expect(page.locator('[data-testid="store-shots"][data-kind="pc"] [data-testid="store-shot"]')).toHaveCount(1);
  // Developer: all its apps.
  await page.getByTestId("store-developer-link").click();
  await expect(page.getByTestId("store-developer")).toBeVisible();
  await page.getByTestId("store-back").click();
  // Share to Vibex: a real message.
  await page.getByTestId("store-share-open").click();
  await page.getByTestId("store-share-app-vibex").click();
  await page.getByTestId("store-share-contact").first().click();
  await page.getByTestId("store-share-send").click();
  await expect.poll(async () => {
    const chats = (await api(bp, "GET", "/api/vibex/chats")).body as { lastMessage: { text: string } | null }[];
    return chats.some((c) => c.lastMessage?.text.includes("Appex Store"));
  }).toBe(true);
  await bp.context().close();
});

async function reviewer(browser: Browser, mobile: boolean, first: string, last: string) {
  const p = await newPage(browser, mobile);
  const u = await signUpViaApi(p, first, last);
  return { p, u };
}

test("reviews: no made-up ones; write (stars required), the author from the account, edit; others like / dislike and report; delete", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Автор", "Отзывов");
  await openStore(page);
  await toApp(page, "calculator");
  // Only real reviews: no "example" anywhere.
  await expect(page.getByTestId("store-app-page")).not.toContainText("Пример");
  const total = async () => Number((await page.getByTestId("store-rating-total").innerText()).replace(/\D/g, "") || 0);
  await expect(page.getByTestId("store-rating-total")).toBeVisible();
  const before = await total();
  await page.getByTestId("store-write-review").click();
  const sheet = page.getByTestId("store-review-sheet");
  await expect(sheet.getByTestId("store-review-author")).toContainText("Отзывов Автор");
  await expect(sheet.getByTestId("store-review-send")).toBeDisabled();
  await sheet.locator('[data-testid="store-review-star"][data-star="4"]').click();
  await sheet.getByTestId("store-review-title").fill("Удобно");
  await sheet.getByTestId("store-review-text").fill("Считает быстро и показывает решение");
  await sheet.getByTestId("store-review-send").click();
  await expect(sheet).toHaveCount(0);
  const mine = page.locator('[data-testid="store-review"][data-mine="true"]');
  await expect(mine).toContainText("Удобно");
  await expect(mine).toContainText(`${me.username}@voidops`);
  await expect.poll(total).toBe(before + 1);
  // Edit: the same review, marked edited.
  await mine.getByTestId("store-review-edit").click();
  await sheet.locator('[data-testid="store-review-star"][data-star="5"]').click();
  await sheet.getByTestId("store-review-send").click();
  await expect(mine.getByTestId("store-review-edited")).toBeVisible();
  await shot(page, "store-reviews");

  // Someone else: like (and take back), dislike, report (reason + description).
  const { p: other } = await reviewer(browser, isMobile(page), "Читатель", "Отзывов");
  await openStore(other);
  await toApp(other, "calculator");
  const card = other.getByTestId("store-review").first();
  await card.getByTestId("store-review-like").click();
  await expect(card.getByTestId("store-review-like")).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByTestId("store-review-like")).toContainText("1");
  await card.getByTestId("store-review-dislike").click();
  await expect(card.getByTestId("store-review-dislike")).toContainText("1");
  await expect(card.getByTestId("store-review-like")).toContainText("0");
  await card.getByTestId("store-review-report").click();
  const report = other.getByTestId("store-report");
  await expect(report.getByTestId("store-report-send")).toBeDisabled();
  await report.locator('[data-testid="store-report-reason"][data-reason="offtopic"]').click();
  await expect(report.getByTestId("store-report-send")).toBeDisabled();
  await report.getByTestId("store-report-text").fill("Не о приложении");
  await report.getByTestId("store-report-send").click();
  await expect(card.getByTestId("store-review-report")).toHaveAttribute("data-reported", "true");
  await other.context().close();

  // All reviews page with sorting; delete mine.
  await page.getByTestId("store-all-reviews").click();
  await page.getByTestId("store-reviews-sort").selectOption("low");
  await expect(page.getByTestId("store-review").first()).toBeVisible();
  await page.locator('[data-testid="store-review"][data-mine="true"]').getByTestId("store-review-edit").click();
  await page.getByTestId("store-review-delete").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.locator('[data-testid="store-review"][data-mine="true"]')).toHaveCount(0);
});

test("remove from the desktop, get it back (honest progress), open; an older version offers «Обновить»", async ({ page }) => {
  await signUpViaApi(page, "Установка", "Приложений");
  await openStore(page);
  await toApp(page, "calculator");
  const get = page.locator('[data-testid="store-app-page"] [data-testid="store-get"]');
  await expect(get).toHaveAttribute("data-state", "open");
  await page.getByTestId("store-remove").click();
  await page.getByTestId("store-remove-confirm").getByTestId("confirm-action").click();
  await expect(get).toHaveAttribute("data-state", "get");
  await expect(get).toHaveText("Загрузить");
  await expect.poll(async () => ((await api(page, "GET", "/api/preferences")).body.workspace?.layout?.hidden ?? [])).toContain("calculator");
  // Get: a spinner while the app's code loads, then «Открыть»; the server recorded the version.
  await get.click();
  await expect(get).toHaveAttribute("data-state", "open", { timeout: 15_000 });
  await expect.poll(async () => ((await api(page, "GET", "/api/preferences")).body.workspace?.layout?.hidden ?? [])).not.toContain("calculator");
  await get.click();
  await expect(page.locator('[data-testid="window-calculator"][data-state="open"]')).toBeVisible();

  // An older version recorded (as after a VOIDEX release): «Обновить».
  await page.route("**/api/apps", async (route) => {
    const res = await route.fetch();
    const list = (await res.json()) as { id: string; version: string }[];
    await route.fulfill({ response: res, json: list.map((a) => (a.id === "notes" ? { ...a, version: "0.9.0" } : a)) });
  });
  await page.reload();
  await expect(page.getByTestId("lock-screen").or(page.getByTestId("workspace")).first()).toBeVisible();
  if (await page.getByTestId("lock-screen").count()) await page.keyboard.type("135790");
  await openStore(page);
  await toApp(page, "notes");
  const upd = page.locator('[data-testid="store-app-page"] [data-testid="store-get"]');
  await expect(upd).toHaveAttribute("data-state", "update");
  await page.unroute("**/api/apps");
  await upd.click();
  await expect(upd).toHaveAttribute("data-state", "open", { timeout: 15_000 });
});
