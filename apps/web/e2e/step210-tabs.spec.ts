import { expect, test, type Page } from "@playwright/test";
import { apiAs as api, newPage, openApp, signUpViaApi } from "./helpers";

/**
 * Step 2.10 — Vibex tabs: Главная | Поиск | Уведомления | Чаты | Профиль.
 * Search: a large field, a grid of real public photos / videos, accounts
 * (exact @username first) and posts. Notifications: the Vibex activity
 * (followers, likes, reposts, groups…), live badge, read on the server.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** A post with a picture, through the API. */
async function photoPost(page: Page, text: string) {
  return page.evaluate(
    async ({ text, b64 }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const h = { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}` };
      const f = await (
        await fetch("/api/vibex/files?purpose=post", {
          method: "POST",
          headers: { ...h, "Content-Type": "application/octet-stream", "X-File-Name": "kadr.png" },
          body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
        })
      ).json();
      return (await fetch("/api/vibex/posts", { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ text, mediaIds: [f.id] }) })).json();
    },
    { text, b64: PNG },
  );
}

async function launch(page: Page) {
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
}
const tab = (page: Page, key: string) => page.getByTestId(isMobile(page) ? `vibex-tab-${key}` : `vibex-nav-${key}`).last();

for (const width of [320, 390, 430]) {
  test(`bottom bar: Главная | Поиск | Уведомления | Чаты | Профиль, fits at ${width}px`, async ({ page }) => {
    test.skip(!isMobile(page), "phone tab bar");
    await page.setViewportSize({ width, height: 844 });
    await signUpViaApi(page, "Пять", "Вкладок");
    await openApp(page, "vibex");
    const bar = page.getByTestId("vibex-tabbar");
    await expect(bar.locator("button")).toHaveCount(5);
    await page.waitForTimeout(400);
    const keys = await bar.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(keys).toEqual(["vibex-tab-feed", "vibex-tab-people", "vibex-tab-activity", "vibex-tab-chats", "vibex-tab-me"]);
    // Every tab inside the screen, none overlapping.
    const boxes = await bar.locator("button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i]!.x).toBeGreaterThanOrEqual(0);
      expect(boxes[i]!.x + boxes[i]!.width).toBeLessThanOrEqual(width + 0.5);
      if (i) expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.width - 0.5);
    }
    // No label is cut into the next tab.
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByTestId("vibex-tab-people").click();
    await expect(page.getByTestId("search-screen")).toBeVisible();
    await page.getByTestId("vibex-tab-activity").click();
    await expect(page.getByTestId("activity-screen").or(page.getByText("Пока ничего нового"))).toBeVisible();
    await page.getByTestId("vibex-tab-me").click();
    await expect(page.getByTestId("vibex-tab-me")).toHaveAttribute("aria-current", "page");
  });
}

test("Search: the grid of real public photos; typing shows people only (@username first, follow state); cleared: the grid; a tap opens the person / the post", async ({ page, browser }) => {
  await signUpViaApi(page, "Ищущий", "Поисков");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Фотограф", "Снимков");
  const word = `закат${Date.now() % 100000}`;
  const post = await photoPost(bp, `Красивый ${word} #море`);
  await launch(page);
  await tab(page, "people").click();
  await expect(page.getByTestId("search-screen")).toBeVisible();
  // The grid: real posts with pictures (B's is among them).
  await expect(page.locator(`[data-testid="explore-tile"][data-post-id="${post.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="explore-tile"][data-post-id="${post.id}"] img`)).toBeVisible();
  // @username: B first.
  await page.getByTestId("people-search").fill(`@${b.username}`);
  await expect(page.getByTestId("person-row").first()).toHaveAttribute("data-person-id", b.id);
  // Step 2.11: only people while typing, with their follow button (no posts, no grid).
  await expect(page.getByTestId("search-posts")).toHaveCount(0);
  await expect(page.getByTestId("explore-grid")).toHaveCount(0);
  const row = page.getByTestId("person-row").first();
  await expect(row.getByTestId("person-follow")).toHaveText("Подписаться");
  await row.getByTestId("person-follow").click();
  await expect(row).toHaveAttribute("data-following", "true");
  await expect(row.getByTestId("person-follow")).toHaveText("Вы подписаны");
  await expect.poll(async () => (await api(page, "GET", `/api/vibex/search?q=${encodeURIComponent("@" + b.username)}`)).body.following).toContain(b.id);
  // Cleared: the grid again; a tile opens the post.
  await page.getByTestId("people-search").fill("");
  await expect(page.getByTestId("explore-grid")).toBeVisible();
  await page.locator(`[data-testid="explore-tile"][data-post-id="${post.id}"]`).click();
  await expect(page.getByText(`Красивый ${word}`).first()).toBeVisible();
  await bp.context().close();
});

test("Notifications: live badge, sections, follow back, read on the server; a tap opens the post", async ({ page, browser }) => {
  const a = await signUpViaApi(page, "Автор", "Активный");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Борис", "Читатель");
  const post = await photoPost(page, "Мой кадр дня");
  await launch(page);
  await expect(page.getByTestId("vibex-feed").or(page.getByTestId("vibex-app")).first()).toBeVisible();
  // B follows, likes, adds A to a group: the badge grows live (no reload, no polling).
  await api(bp, "POST", `/api/vibex/people/${a.id}/follow`);
  await api(bp, "POST", `/api/vibex/posts/${post.id}/like`);
  await api(bp, "POST", "/api/vibex/groups", { title: "Клуб кадров", memberIds: [a.id] });
  const badge = isMobile(page) ? page.getByTestId("vibex-activity-unread") : page.getByTestId("vibex-nav-activity").last();
  await expect(badge).toContainText("3");

  await tab(page, "activity").click();
  const screen = page.getByTestId("activity-screen");
  await expect(screen).toBeVisible();
  await expect(screen.getByTestId("activity-section").first()).toHaveAttribute("data-section", "today");
  await expect(screen.getByRole("heading", { name: "Актуальное" })).toBeVisible();
  const items = screen.getByTestId("activity-item");
  await expect(items).toHaveCount(3);
  await expect(items.filter({ hasText: "добавляет вас в группу «Клуб кадров»" })).toHaveCount(1);
  const like = items.filter({ hasText: "ставит «Нравится» вашей публикации" });
  await expect(like.getByTestId("activity-thumb")).toBeVisible();
  // Read on the server: the badge goes, the count is 0 for every device.
  await expect.poll(async () => (await api(page, "GET", "/api/vibex/activity/count")).body.unread).toBe(0);
  if (isMobile(page)) await expect(page.getByTestId("vibex-activity-unread")).toHaveCount(0);
  // Follow back: «Подписаться» → «Сообщение».
  const follow = items.filter({ hasText: "теперь читает вас" });
  await follow.getByTestId("activity-follow").click();
  await expect(follow.getByTestId("activity-message")).toBeVisible();
  expect((await api(page, "GET", `/api/vibex/people/${b.id}`)).body.followed).toBe(true);
  // A tap on the like: the post.
  await like.click();
  await expect(page.getByText("Мой кадр дня").first()).toBeVisible();
  await bp.context().close();
});
