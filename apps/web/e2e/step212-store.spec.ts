import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { apiAs as api, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Step 2.12: Appex Store. One soft search field (X clears, real filtering by
 * name, category, developer), an app's page with Back and Share only, the
 * platform's own screenshots, «Ещё для вашего пространства», version history,
 * the account (updates, auto-update, update notifications, my reviews), the
 * update center and install states that survive a reload, share links.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const DB = process.env.DATABASE_URL ?? "postgres://voidex:voidex@localhost:5432/voidex";
const CATALOG = ["calculator", "files", "mail", "media", "notes", "vibex"];

/** As after a VOIDEX release: this account still has an older version of the app recorded. */
function olderVersion(userId: string, appId: string) {
  execSync(`psql "${DB}" -qc "update installed_apps set version = '0.9.0', notified_version = null where user_id = '${userId}' and app_id = '${appId}'"`);
}

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

test("search: a soft field without a frame, X while focused clears it; name, category and developer filter for real; an honest empty state", async ({ page }) => {
  await signUpViaApi(page, "Поиск", "Магазина");
  await openStore(page);
  const box = page.getByTestId("store-search-field");
  const field = page.getByTestId("store-search");
  // No frame, a grey pill.
  const look = await box.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { border: cs.borderTopWidth, radius: parseFloat(cs.borderTopLeftRadius), h: el.getBoundingClientRect().height, bg: cs.backgroundColor };
  });
  expect(look.border).toBe("0px");
  expect(look.radius).toBeGreaterThanOrEqual(look.h / 2 - 1);
  expect(look.bg).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.getByTestId("store-search-clear")).toHaveCount(0);
  await field.click();
  await expect(page.getByTestId("store-search-clear")).toBeVisible();

  const results = page.getByTestId("store-search-results");
  const found = async () => (await page.getByTestId("store-search-result").evaluateAll((els) => els.map((e) => e.getAttribute("data-app")))).sort();
  await field.fill("калькул");
  await expect(results).toHaveAttribute("data-count", "1");
  expect(await found()).toEqual(["calculator"]);
  // The developer: every app of the catalog (no Store, no Settings).
  await field.fill("VOIDEX");
  await expect(results).toHaveAttribute("data-count", String(CATALOG.length));
  expect(await found()).toEqual(CATALOG);
  // Nothing: an honest empty state.
  await field.fill("щщщщщ");
  await expect(results).toHaveAttribute("data-count", "0");
  await expect(results).toContainText("Ничего не найдено");
  // X clears the text; the catalog is back.
  await page.getByTestId("store-search-clear").click();
  await expect(field).toHaveValue("");
  await expect(page.getByTestId("store-search-results")).toHaveCount(0);
  await expect(page.getByTestId("store-hero")).toBeVisible();
});

test("an app's page: Back and Share only, no remove, the platform's own screenshots, more for your space, version history", async ({ page }) => {
  await signUpViaApi(page, "Страница", "Двенадцать");
  await openStore(page);
  await toApp(page, "notes");
  const win = page.locator('[data-testid="window-store"]');
  await expect(page.getByTestId("store-back")).toBeVisible();
  await expect(page.getByTestId("store-share-open")).toBeVisible();
  await expect(win.getByText("Удалить с рабочего стола")).toHaveCount(0);
  await expect(win.getByText("Телефон", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("store-title")).toHaveCount(0);

  // Screenshots: only the platform's own, at least three, loaded.
  const kind = isMobile(page) ? "phone" : "desktop";
  const strip = page.getByTestId("store-app-page").getByTestId("store-shots");
  await expect(strip).toHaveAttribute("data-kind", kind);
  const shots = strip.locator('[data-testid="store-shot"] img');
  expect(await shots.count()).toBeGreaterThanOrEqual(3);
  for (const src of await shots.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).getAttribute("src")))) expect(src).toContain(`notes-${kind}-`);
  await expect(shots.first()).toHaveJSProperty("complete", true);
  expect(await shots.first().evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // «Ещё для вашего пространства»: the other catalog apps, a tap opens one.
  const more = page.getByTestId("store-more");
  await expect(more).toContainText("Ещё для вашего пространства");
  const ids = (await more.getByTestId("store-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-app")))).sort();
  expect(ids).toEqual(CATALOG.filter((x) => x !== "notes"));
  await expect(more.locator('[data-testid="store-get"]').first()).toBeVisible();
  await more.locator('[data-testid="store-row"][data-app="mail"] [data-testid="store-row-open"]').click();
  await expect(page.getByTestId("store-app-page")).toHaveAttribute("data-app", "mail");

  // Version history: a page of its own, the current version marked.
  await page.getByTestId("store-versions-open").click();
  await expect(page.getByTestId("store-versions")).toHaveAttribute("data-app", "mail");
  await expect(page.getByTestId("store-release")).toHaveCount(1);
  await expect(page.getByTestId("store-release-current")).toContainText("Текущая версия");
  await expect(page.getByTestId("store-release")).toContainText("1.0.0");
  await page.getByTestId("store-back").click();
  await expect(page.getByTestId("store-app-page")).toHaveAttribute("data-app", "mail");
});

test("share: the phone's share sheet with a link to the app; on a computer a menu (copy, Vibex); the link opens the app's page", async ({ page, context }) => {
  await signUpViaApi(page, "Ссылка", "Магазина");
  await page.evaluate(() => {
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: async (d: unknown) => void w.__shared.push(d) });
  });
  await openStore(page);
  await toApp(page, "calculator");
  await page.getByTestId("store-share-open").click();
  if (isMobile(page)) {
    const shared = (await page.evaluate(() => (window as unknown as { __shared: { url: string }[] }).__shared)) ?? [];
    expect(shared).toHaveLength(1);
    expect(shared[0]!.url).toMatch(/#store\/app\/calculator$/);
  } else {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await expect(page.getByTestId("store-share-menu")).toBeVisible();
    await expect(page.getByTestId("menu-store-send-vibex")).toBeVisible();
    await page.getByTestId("menu-store-copy-link").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#store\/app\/calculator$/);
  }
  // The deep link: the Store opens on that app's page.
  await page.getByTestId("store-back").click();
  await page.evaluate(() => (window.location.hash = "#store/app/media"));
  await expect(page.getByTestId("store-app-page")).toHaveAttribute("data-app", "media");
});

test("account and update center: avatar, name, address, counts; an update waits with auto-update off, installs, persists across a reload; toggles persist", async ({ page }) => {
  const me = await signUpViaApi(page, "Аккаунт", "Апдейтов");
  expect((await api(page, "PATCH", "/api/preferences", { store: { autoUpdate: false } })).status).toBe(200);
  olderVersion(me.id, "notes");
  await reloadUnlocked(page);
  await openStore(page);
  await expect(page.getByTestId("store-account-badge")).toHaveText("1");
  await page.getByTestId("store-account-open").click();
  const account = page.getByTestId("store-account");
  await expect(account).toBeVisible();
  await expect(page.getByTestId("store-account-name")).toHaveText("Аккаунт Апдейтов");
  await expect(page.getByTestId("store-account-address")).toContainText("@");
  await expect(page.locator('[data-testid="store-pref-auto"] [role="switch"]')).toHaveAttribute("aria-checked", "false");
  await expect(page.locator('[data-testid="store-pref-notify"] [role="switch"]')).toHaveAttribute("aria-checked", "true");

  // The update center: the installed version and the new one.
  await page.getByTestId("store-account-updates").click();
  const row = page.locator('[data-testid="store-update-row"][data-app="notes"]');
  await expect(row.getByTestId("store-update-versions")).toHaveText("0.9.0 → 1.0.0");
  await expect(row.getByTestId("store-get")).toHaveAttribute("data-state", "update");
  await expect(row.getByTestId("store-get")).toHaveText("Обновить");
  // The state is the account's: still «update» after a reload.
  await reloadUnlocked(page);
  await openStore(page);
  await page.getByTestId("store-account-open").click();
  await page.getByTestId("store-account-updates").click();
  await page.locator('[data-testid="store-update-row"][data-app="notes"] [data-testid="store-get"]').click();
  await expect(page.getByTestId("store-updates-none")).toHaveText("Все приложения обновлены");
  await expect(page.locator('[data-testid="store-recent-row"][data-app="notes"]')).toBeVisible();
  await expect(page.locator('[data-testid="store-recent-row"][data-app="notes"] [data-testid="store-get"]')).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("store-account-badge")).toHaveCount(0);
  const notes = ((await api(page, "GET", "/api/apps")).body as { id: string; version: string; updatedAt: string | null }[]).find((a) => a.id === "notes")!;
  expect(notes.version).toBe("1.0.0");
  expect(notes.updatedAt).not.toBeNull();

  // The toggles are the account's.
  await page.getByTestId("store-back").click();
  await page.locator('[data-testid="store-pref-notify"] [role="switch"]').click();
  await page.locator('[data-testid="store-pref-auto"] [role="switch"]').click();
  await expect
    .poll(async () => ((await api(page, "GET", "/api/me")).body as { preferences: { store: unknown } }).preferences.store)
    .toEqual({ autoUpdate: true, updateNotifications: false });
  await reloadUnlocked(page);
  await openStore(page);
  await page.getByTestId("store-account-open").click();
  await expect(page.locator('[data-testid="store-pref-auto"] [role="switch"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-testid="store-pref-notify"] [role="switch"]')).toHaveAttribute("aria-checked", "false");
});

test("an app's own auto-update choice; my ratings and reviews (empty, then mine, a tap opens the app)", async ({ page }) => {
  await signUpViaApi(page, "Мои", "Отзывы");
  await openStore(page);
  await toApp(page, "vibex");
  const own = page.locator('[data-testid="store-app-auto"] [role="switch"]');
  await expect(own).toHaveAttribute("aria-checked", "true");
  await own.click();
  await expect(own).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(async () => ((await api(page, "GET", "/api/apps")).body as { id: string; autoUpdate: boolean | null }[]).find((a) => a.id === "vibex")!.autoUpdate)
    .toBe(false);

  await page.getByTestId("store-back").click();
  await page.getByTestId("store-back").click();
  await page.getByTestId("store-account-open").click();
  await page.getByTestId("store-account-reviews").click();
  await expect(page.getByTestId("store-my-reviews")).toContainText("Отзывов пока нет");
  await expect(page.getByTestId("store-my-review")).toHaveCount(0);
  expect((await api(page, "PUT", "/api/store/apps/files/review", { rating: 4, title: "Удобно", text: "Всё под рукой" })).status).toBe(200);
  await page.getByTestId("store-back").click();
  await page.getByTestId("store-account-reviews").click();
  const mine = page.locator('[data-testid="store-my-review"][data-app="files"]');
  await expect(mine).toContainText("Удобно. Всё под рукой");
  await mine.click();
  await expect(page.getByTestId("store-app-page")).toHaveAttribute("data-app", "files");
});
