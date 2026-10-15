import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Step 2.13 — Vibex: the floating phone tab bar with one gliding capsule,
 * the feed «Публикации | Посты» (kept in the settings), the top bar that
 * hides on scroll down and returns on scroll up, no search in the Main
 * header, notifications as soft cards, the profile publications grid (equal
 * cells, white type marks, inside the profile width) and its viewer feed
 * with zoom.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(page: Page, method: string, url: string, body?: unknown, raw?: { name: string; base64: string }): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ({ method, url, body, raw }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const headers: Record<string, string> = { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}` };
      let payload: BodyInit | undefined;
      if (raw) {
        headers["Content-Type"] = "application/octet-stream";
        headers["X-File-Name"] = encodeURIComponent(raw.name);
        payload = Uint8Array.from(atob(raw.base64), (c) => c.charCodeAt(0));
      } else if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await fetch(url, { method, headers, body: payload });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body, raw },
  );
}

async function photo(page: Page) {
  return (await api(page, "POST", "/api/vibex/files?purpose=post", undefined, { name: "p.png", base64: PNG })).body.id as string;
}

async function launchVibex(page: Page) {
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
}

/** The capsule's box against the active tab's box (the capsule sits 4 px inside the tab). */
async function capsuleOn(page: Page, key: string) {
  const cap = (await page.getByTestId("vibex-tabbar-capsule").boundingBox())!;
  const tab = (await page.getByTestId(`vibex-tab-${key}`).boundingBox())!;
  return Math.abs(cap.x - (tab.x + 4)) < 2 && Math.abs(cap.x + cap.width - (tab.x + tab.width - 4)) < 2;
}

test("phone tab bar: a floating bar, 5 tabs at 320 px, one capsule that glides to the tapped tab and never disappears", async ({ page }) => {
  test.skip(!isMobile(page), "phone tab bar");
  await page.setViewportSize({ width: 320, height: 700 });
  await signUpViaApi(page, "Капсула", "Плывёт");
  await launchVibex(page);
  const bar = page.getByTestId("vibex-tabbar");
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("role", "tablist");
  // Floating: above the bottom edge, inside the screen sides, rounded.
  const b = (await bar.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(8);
  expect(b.x + b.width).toBeLessThanOrEqual(312);
  expect(700 - (b.y + b.height)).toBeGreaterThanOrEqual(4);
  const tabs = bar.getByRole("tab");
  await expect(tabs).toHaveCount(5);
  for (const tab of await tabs.all()) {
    const t = (await tab.boundingBox())!;
    expect(t.x).toBeGreaterThanOrEqual(b.x - 0.5);
    expect(t.x + t.width).toBeLessThanOrEqual(b.x + b.width + 0.5);
    expect(await tab.getAttribute("aria-label")).toBeTruthy();
  }
  await expect(page.getByTestId("vibex-tab-feed")).toHaveAttribute("aria-current", "page");
  // First render: the capsule is already on the active tab (no jump in from elsewhere).
  expect(await capsuleOn(page, "feed")).toBe(true);
  // The icons don't move when the capsule does.
  const before = await Promise.all(["feed", "people", "activity", "chats", "me"].map(async (k) => (await page.getByTestId(`vibex-tab-${k}`).boundingBox())!.x));
  await page.getByTestId("vibex-tab-activity").click();
  // Mid-way the capsule is still there (one element, gliding).
  await expect(page.getByTestId("vibex-tabbar-capsule")).toBeVisible();
  await expect.poll(() => capsuleOn(page, "activity")).toBe(true);
  await expect(page.getByTestId("vibex-tab-activity")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("vibex-tab-feed")).not.toHaveAttribute("aria-current", "page");
  await page.getByTestId("vibex-tab-me").click();
  await expect.poll(() => capsuleOn(page, "me")).toBe(true);
  const after = await Promise.all(["feed", "people", "activity", "chats", "me"].map(async (k) => (await page.getByTestId(`vibex-tab-${k}`).boundingBox())!.x));
  expect(after).toEqual(before);
  await expect(page.getByTestId("vibex-tabbar-capsule")).toHaveCount(1);
});

test("deep link at 320 px: a shared post opens in Vibex, the capsule sits on its tab, back keeps it there", async ({ page }) => {
  test.skip(!isMobile(page), "phone tab bar");
  await page.setViewportSize({ width: 320, height: 700 });
  await signUpViaApi(page, "Глубокая", "Ссылка");
  const post = (await api(page, "POST", "/api/vibex/posts", { text: "Пост по ссылке" })).body;
  await page.evaluate((id) => (window.location.hash = `#vibex/post/${id}`), post.id);
  await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  await expect(page.getByText("Пост по ссылке").first()).toBeVisible();
  const active = await page.getByTestId("vibex-tabbar").getAttribute("data-active");
  expect(active).toBeTruthy();
  expect(await capsuleOn(page, active!)).toBe(true);
  await page.goBack().catch(() => undefined);
  await expect.poll(async () => capsuleOn(page, (await page.getByTestId("vibex-tabbar").getAttribute("data-active"))!)).toBe(true);
});

test("feed: no search button in the Main header; «Публикации | Посты» switch is kept across reloads; publications are media first", async ({ page }) => {
  await signUpViaApi(page, "Лента", "Режимов");
  const caption = `Фото дня ${Date.now().toString(36)}`;
  await api(page, "POST", "/api/vibex/posts", { text: caption, mediaIds: [await photo(page)] });
  await api(page, "POST", "/api/vibex/posts", { text: "Просто текст" });
  await launchVibex(page);
  if (!isMobile(page)) await page.getByTestId("vibex-nav-feed").last().click();
  await expect(page.getByTestId("vibex-feed")).toBeVisible();
  // The Main header has no search button (search lives in its own tab).
  await expect(page.getByTestId("vibex-search").filter({ visible: true })).toHaveCount(0);
  const mode = page.getByTestId("feed-mode").filter({ visible: true }).first();
  await expect(mode).toHaveAttribute("data-mode", "posts");
  await expect(page.getByTestId("post-card").first()).toBeVisible();
  await mode.getByTestId("feed-mode-publications").click();
  await expect(mode).toHaveAttribute("data-mode", "publications");
  // Publications: only posts with media, media first, the caption under it, no card.
  const items = page.getByTestId("publication-item").filter({ hasText: caption });
  await expect(items).toHaveCount(1);
  await expect(page.getByTestId("publication-item").filter({ hasText: "Просто текст" })).toHaveCount(0);
  await expect(items.first().getByTestId("publication-media")).toBeVisible();
  await expect(items.first().getByTestId("publication-caption")).toContainText(caption);
  await expect(items.first().getByTestId("publication-like")).toBeVisible();
  // Kept in the person's settings.
  await expect.poll(async () => (await api(page, "GET", "/api/vibex/settings")).body.feed?.mode).toBe("publications");
  await reloadUnlocked(page);
  await launchVibex(page);
  if (!isMobile(page)) await page.getByTestId("vibex-nav-feed").last().click();
  await expect(page.getByTestId("feed-mode").filter({ visible: true }).first()).toHaveAttribute("data-mode", "publications");
  await page.getByTestId("feed-mode").filter({ visible: true }).first().getByTestId("feed-mode-posts").click();
  await expect(page.getByTestId("post-card").first()).toBeVisible();
});

test("phone feed: the top bar hides while scrolling down and comes back on scrolling up", async ({ page }) => {
  test.skip(!isMobile(page), "phone feed");
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpViaApi(page, "Шапка", "Прячется");
  for (let i = 0; i < 12; i++) await api(page, "POST", "/api/vibex/posts", { text: `Пост номер ${i}\n${"строка\n".repeat(4)}` });
  await launchVibex(page);
  const top = page.getByTestId("feed-top");
  await expect(top).toBeVisible();
  const visibleTop = async () => (await top.boundingBox())!.y;
  const y0 = await visibleTop();
  const scroller = page.getByTestId("vibex-scroll");
  await scroller.hover();
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(60);
  }
  await expect.poll(async () => (await visibleTop()) < y0 - 40).toBe(true);
  await expect.poll(() => top.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.6);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(60);
  }
  await expect.poll(async () => Math.abs((await visibleTop()) - y0) < 2).toBe(true);
  await expect.poll(() => top.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.95);
});

test("notifications are soft cards with the unread mark; days stay grouped", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Карточки", "Уведомлений");
  const other = await browser.newContext({ ...(isMobile(page) ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : {}) }).then((c) => c.newPage());
  await signUpViaApi(other, "Подписчик", "Новый");
  expect((await api(other, "POST", `/api/vibex/people/${me.id}/follow`)).status).toBeLessThan(300);
  await launchVibex(page);
  await page.getByTestId(isMobile(page) ? "vibex-tab-activity" : "vibex-nav-activity").last().click();
  const item = page.getByTestId("activity-item").first();
  await expect(item).toBeVisible();
  await expect(page.getByTestId("activity-section").first()).toBeVisible();
  const style = await item.evaluate((el) => ({ radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), bg: getComputedStyle(el).backgroundColor }));
  expect(style.radius).toBeGreaterThanOrEqual(14);
  expect(style.bg).not.toBe("rgba(0, 0, 0, 0)");
  await other.context().close();
});

test("profile publications: equal cells, hairline gaps, white type marks, inside the profile width; a tap opens the viewer feed; zoom resets", async ({ page }) => {
  await signUpViaApi(page, "Сетка", "Публикаций");
  const a = await photo(page);
  const b = await photo(page);
  await api(page, "POST", "/api/vibex/posts", { text: "Карусель", mediaIds: [a, b] });
  await api(page, "POST", "/api/vibex/posts", { text: "Одно фото", mediaIds: [await photo(page)] });
  await api(page, "POST", "/api/vibex/posts", { text: "Ещё фото", mediaIds: [await photo(page)] });
  await launchVibex(page);
  await page.getByTestId(isMobile(page) ? "vibex-tab-me" : "vibex-nav-me").last().click();
  const grid = page.getByTestId("profile-media-grid");
  await expect(grid).toBeVisible();
  const tiles = page.getByTestId("publication-tile");
  await expect(tiles).toHaveCount(3);
  const boxes = await Promise.all((await tiles.all()).map((t) => t.boundingBox()));
  // Equal cells.
  for (const bx of boxes) {
    expect(Math.abs(bx!.width - boxes[0]!.width)).toBeLessThan(1.5);
    expect(Math.abs(bx!.height - boxes[0]!.height)).toBeLessThan(1.5);
  }
  // Almost no gap between neighbours.
  expect(boxes[1]!.x - (boxes[0]!.x + boxes[0]!.width)).toBeLessThanOrEqual(3);
  // Inside the profile content width, never touching the screen edges.
  const g = (await grid.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(g.x).toBeGreaterThanOrEqual(8);
  if (isMobile(page)) expect(vw - (g.x + g.width)).toBeGreaterThanOrEqual(8);
  // White type marks: album for the carousel, photo for single pictures.
  const marks = page.getByTestId("publication-mark");
  await expect(marks).toHaveCount(3);
  expect(await marks.evaluateAll((els) => els.map((e) => e.getAttribute("data-mark")).sort())).toEqual(["album", "photo", "photo"]);
  for (const m of await marks.all()) expect(await m.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");

  // The viewer: a feed of the publications, starting at the tapped one.
  await tiles.nth(1).click();
  const viewer = page.getByTestId("publication-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId("publication-item")).toHaveCount(3);
  // It starts at the tapped publication (its top at the top of the feed).
  await expect.poll(async () => {
    const item = (await viewer.getByTestId("publication-item").nth(1).boundingBox())!;
    const v = (await viewer.boundingBox())!;
    return item.y - v.y;
  }).toBeLessThan(90);
  const img = viewer.getByTestId("publication-item").nth(1).getByTestId("publication-image").first();
  await expect(img).toHaveAttribute("data-zoom", "1.00");
  await img.dblclick();
  await expect.poll(async () => Number(await img.getAttribute("data-zoom"))).toBeGreaterThan(1.5);
  await img.dblclick();
  await expect(img).toHaveAttribute("data-zoom", "1.00");
  await img.dblclick();
  await expect.poll(async () => Number(await img.getAttribute("data-zoom"))).toBeGreaterThan(1.5);
  // Back: the grid, where it was; reopening starts at fit again.
  await viewer.getByTestId("publication-viewer-back").click();
  await expect(viewer).toHaveCount(0);
  await expect(grid).toBeVisible();
  await tiles.nth(1).click();
  await expect(page.getByTestId("publication-viewer").getByTestId("publication-item").nth(1).getByTestId("publication-image").first()).toHaveAttribute("data-zoom", "1.00");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("publication-viewer")).toHaveCount(0);
});
