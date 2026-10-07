import { expect, test, type Browser, type Page } from "@playwright/test";
import type { AppId } from "@voidex/shared";
import { newPage, openApp, phoneHome, reloadUnlocked, settingsRoot, signUpViaApi } from "./helpers";

/**
 * Step 2.8: ViCloud in Settings (no fake cloud, no payment), Settings → Apps
 * and Voidex Storage, «Вид приложений» for every app, Notes toolbar delete
 * and the "+" in the search, Calculator without History / help, Vibex
 * deletes leave nothing, the larger Vibex menu and the profile per the
 * reference, VoidOps Mail recipient search and links, and no page overflow.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

async function api(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const headers: Record<string, string> = { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
}

async function launch(page: Page, id: AppId) {
  if (isMobile(page)) await openApp(page, id as "vibex");
  else {
    await page.getByTestId(`dock-app-${id}`).click();
    await expect(page.locator(`[data-testid="window-${id}"][data-state="open"]`)).toBeVisible();
  }
}

/** A Settings section from its root (phone list or PC sidebar). */
async function section(page: Page, id: string) {
  await settingsRoot(page);
  await page.getByTestId(`settings-nav-${id}`).last().click();
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

async function twoPeople(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Анна", "Облакова");
  const other = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(other, "Борис", "Чатов");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  expect((await api(other, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет" })).status).toBe(201);
  return { a, b, other, chat };
}

test("ViCloud: a Settings section with its screens, true figures and no payment; Files leads there", async ({ page }) => {
  await signUpViaApi(page, "Вика", "Облачная");
  await launch(page, "settings");
  await page.getByTestId("settings-nav-vicloud").last().click();
  const root = page.getByTestId("settings-vicloud").last();
  await expect(root).toBeVisible();
  await expect(page.getByTestId("vicloud-usage-text").last()).toHaveText("Использовано 0 Б из 5 ГБ");
  await expect(page.getByTestId("vicloud-status").last()).toContainText("ViCloud пока не запущен");
  const screens = [
    ["storage", "settings-vicloud-storage"],
    ["sync", "settings-vicloud-sync"],
    ["backup", "settings-vicloud-backup"],
    ["privacy", "settings-vicloud-privacy"],
    ["plans", "settings-vicloud-plans"],
  ] as const;
  for (const [id, testId] of screens) {
    await page.getByTestId(`vicloud-open-${id}`).last().click();
    await expect(page.getByTestId(testId).last()).toBeVisible();
    if (id === "plans") {
      // Exactly 50 GB, 200 GB, 1 TB; choosing works, paying does not.
      await expect(page.getByTestId("vicloud-plan-list").last().getByRole("radio")).toHaveCount(3);
      for (const [p, label] of [["50", "50 ГБ"], ["200", "200 ГБ"], ["1tb", "1 ТБ"]] as const) await expect(page.getByTestId(`vicloud-plan-${p}`).last()).toContainText(label);
      await page.getByTestId("vicloud-plan-1tb").last().click();
      await expect(page.getByTestId("vicloud-plan-1tb").last()).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("vicloud-upgrade").last()).toBeDisabled();
      await expect(page.getByTestId("vicloud-payment-note").last()).toContainText("Оплата и подписка пока недоступны");
    }
    if (id === "backup") {
      // The choice is kept with the account.
      await page.getByTestId("vicloud-backup-cellular").last().getByRole("switch").click();
      await expect.poll(async () => (await api(page, "GET", "/api/me")).body.preferences.vicloud.backupCellular).toBe(true);
      await expect(page.getByTestId("vicloud-backup-now").last()).toBeDisabled();
    }
    if (isMobile(page)) await page.getByTestId("settings-back").last().click();
    else await page.getByTestId("settings-pc-back").click();
    await expect(root).toBeVisible();
  }
  await noHorizontalOverflow(page);

  // Files: the ViCloud dialog shows the space and opens Settings → ViCloud.
  if (isMobile(page)) await phoneHome(page);
  await launch(page, "files");
  await expect(page.getByTestId("files-cloud-notice")).toContainText("Не сохранено в ViCloud");
  await page.getByTestId("files-cloud-link").click();
  await expect(page.getByTestId("cloud-dialog-space")).toContainText("Свободно 5 ГБ");
  await page.getByTestId("cloud-dialog-open-vicloud").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  await expect(page.getByTestId("settings-vicloud").last()).toBeVisible();
});

test("Settings → Apps (alphabetical) with per-app settings, and Voidex Storage", async ({ page }) => {
  await signUpViaApi(page, "Яна", "Прилож");
  await launch(page, "settings");
  await page.getByTestId("settings-nav-apps").last().click();
  const rows = page.getByTestId("settings-apps").last().locator('[data-testid^="settings-app-"]');
  await expect(rows).toHaveCount(7);
  const names = await rows.allInnerTexts();
  const sorted = [...names].sort((x, y) => x.localeCompare(y, "ru"));
  expect(names).toEqual(sorted);
  expect(names[0]).toContain("Заметки");

  await page.getByTestId("settings-app-vibex").last().click();
  await expect(page.getByTestId("settings-app-page").last()).toHaveAttribute("data-app", "vibex");
  await expect(page.getByTestId("settings-app-name").last()).toHaveText("Vibex");
  // Notifications: saved per app with the account.
  await page.getByTestId("settings-app-notifications").last().getByRole("switch").click();
  await expect.poll(async () => (await api(page, "GET", "/api/me")).body.preferences.apps.vibex?.notifications).toBe(false);
  // Face ID / code-password: the account has one, so the switch works.
  await page.getByTestId("settings-app-lock").last().getByRole("switch").click();
  await expect.poll(async () => (await api(page, "GET", "/api/me")).body.preferences.apps.vibex?.lock).toBe(true);
  await expect(page.getByTestId("settings-app-offload").last()).toBeVisible();
  await page.getByTestId("settings-app-offload").last().click();
  await page.getByRole("button", { name: "Сгрузить" }).last().click();
  await expect(page.getByText("«Vibex» сгружено")).toBeVisible();

  await section(page, "storage");
  await expect(page.getByTestId("settings-storage").last()).toBeVisible();
  await expect(page.getByTestId("storage-used").last()).toContainText(/Используется .+ из |Браузер не сообщает объём/);
  await expect(page.getByTestId("settings-storage").last().locator('[data-testid^="storage-app-"]')).toHaveCount(7);
  await noHorizontalOverflow(page);
});

test("«Вид приложений»: one look for every app window, saved with the account", async ({ page }) => {
  await signUpViaApi(page, "Лена", "Видова");
  await expect(page.locator("html")).toHaveAttribute("data-app-look", "media");
  await launch(page, "settings");
  await section(page, "personalization");
  await expect(page.getByTestId("app-look").last().getByRole("radio")).toHaveCount(4);
  const bg = (id: AppId) => page.locator(`[data-testid="window-${id}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.getByTestId("app-look-notes").last().click();
  await expect(page.locator("html")).toHaveAttribute("data-app-look", "notes");
  await expect.poll(() => bg("settings")).toBe("rgb(236, 236, 237)");
  await page.getByTestId("app-look-mail").last().click();
  await expect.poll(() => bg("settings")).toBe("rgb(255, 255, 255)");
  await page.getByTestId("app-look-dark").last().click();
  await expect.poll(() => bg("settings")).toBe("rgb(18, 18, 24)");
  await expect.poll(async () => (await api(page, "GET", "/api/me")).body.preferences.workspace.layout?.appearance.appLook).toBe("dark");
  // Another app follows the same look: its text turns light.
  if (isMobile(page)) await phoneHome(page);
  await launch(page, "calculator");
  await expect.poll(() => bg("calculator")).toBe("rgb(18, 18, 24)");
  const text = await page.locator('[data-testid="window-calculator"]').evaluate((el) => getComputedStyle(el).getPropertyValue("--text").trim());
  expect(text).toBe("#ededf3");
});

test("Calculator: no History / help buttons; the mode switch slides", async ({ page }) => {
  await signUpViaApi(page, "Кира", "Счётова");
  await launch(page, "calculator");
  await expect(page.getByTestId("calc-history-open")).toHaveCount(0);
  await expect(page.getByTestId("calc-help-open")).toHaveCount(0);
  const pill = () => page.locator(".vxc .mode-switch").evaluate((el) => getComputedStyle(el, "::before").transform);
  expect(await pill()).toBe("none");
  await page.getByTestId("calc-mode-science").click();
  await expect.poll(pill).not.toBe("none");
  expect(await page.locator(".vxc .mode-switch").evaluate((el) => getComputedStyle(el, "::before").transitionDuration)).toBe("0.34s");
});

test("Notes: \"+\" inside the centred search field in its colours; delete page in the toolbar", async ({ page }) => {
  await signUpViaApi(page, "Ната", "Заметкина");
  await launch(page, "notes");
  const field = page.getByTestId("notes-search-field");
  const add = page.getByTestId("notes-add");
  await expect(field.getByTestId("notes-add")).toBeVisible();
  const [fb, ab] = [(await field.boundingBox())!, (await add.boundingBox())!];
  expect(ab.x + ab.width).toBeLessThanOrEqual(fb.x + fb.width);
  const vw = page.viewportSize()!.width;
  const win = (await page.locator('[data-testid="window-notes"]').boundingBox())!;
  expect(Math.abs(fb.x + fb.width / 2 - (win.x + win.width / 2))).toBeLessThan(4);
  expect(vw).toBeGreaterThan(0);
  const [fieldBg, addBg] = await Promise.all([field.evaluate((el) => getComputedStyle(el).backgroundColor), add.evaluate((el) => getComputedStyle(el).backgroundColor)]);
  expect(addBg).toBe(fieldBg);

  // A note with two pages: the toolbar deletes the page in one tap (asking first: it has text).
  const p = (await api(page, "POST", "/api/notes/projects", { name: "Проект 2.8" })).body;
  const data = { kind: "note", format: "square", pages: [{ id: "p1", blocks: [{ id: "b1", kind: "text", text: "Первая" }] }, { id: "p2", blocks: [{ id: "b2", kind: "text", text: "Вторая" }] }] };
  expect((await api(page, "POST", `/api/notes/projects/${p.id}/documents`, { kind: "note", name: "Две страницы", data })).status).toBe(201);
  await reloadUnlocked(page);
  if (!(await page.getByTestId("notes-app").count())) await launch(page, "notes");
  await page.getByTestId("notes-project-list").getByTestId("notes-card-name").getByText("Проект 2.8", { exact: true }).first().click();
  await page.getByTestId("notes-doc-list").getByTestId("notes-card-name").getByText("Две страницы", { exact: true }).first().click();
  await expect(page.getByTestId("notes-note-editor")).toHaveAttribute("data-pages", "2");
  // On the first page the toolbar clears it (the first page is never deleted).
  await expect(page.getByTestId("notes-tool-delete-page")).toHaveAttribute("aria-label", "Очистить страницу");
  // A wide PC window shows both square pages side by side (no page to scroll to): the page flow is checked on phones.
  if (!isMobile(page)) return;
  await page.getByTestId("notes-page-next").click();
  await expect(page.getByTestId("notes-page-indicator")).toHaveText(/^2 \//);
  await expect(page.getByTestId("notes-tool-delete-page")).toHaveAttribute("aria-label", "Удалить страницу");
  await page.getByTestId("notes-tool-delete-page").click();
  await page.getByRole("button", { name: "Удалить", exact: true }).last().click();
  await expect(page.getByTestId("notes-note-editor")).toHaveAttribute("data-pages", "1");
  // The first page is cleared, not deleted.
  await expect(page.getByTestId("notes-tool-delete-page")).toHaveAttribute("aria-label", "Очистить страницу");
});

test("Vibex: a deleted message leaves nothing; the larger side menu", async ({ page, browser }) => {
  const { other, chat } = await twoPeople(page, browser);
  const mine = (await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Исчезну без следа" })).body;
  expect((await api(page, "DELETE", `/api/vibex/messages/${mine.id}`)).status).toBe(200);
  await launch(other, "vibex");
  await other.getByTestId(isMobile(other) ? "vibex-tab-chats" : "vibex-nav-chats").click();
  await other.getByTestId("chat-row").first().click();
  await expect(other.getByTestId("messages")).toContainText("Привет");
  await expect(other.getByTestId("messages")).not.toContainText("Исчезну без следа");
  await expect(other.getByTestId("messages")).not.toContainText("Сообщение удалено");
  await expect(other.getByTestId("message")).toHaveCount(1);
  await other.context().close();

  await launch(page, "vibex");
  if (isMobile(page)) await page.getByTestId("vibex-menu").click();
  const row = page.getByTestId("vibex-nav-feed").last();
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(47);
  // Settings sits at the bottom of the menu.
  const menu = (await page.getByTestId("vibex-sidebar").last().boundingBox())!;
  const settings = (await page.getByTestId("vibex-nav-settings").last().boundingBox())!;
  expect(menu.y + menu.height - (settings.y + settings.height)).toBeLessThan(isMobile(page) ? 60 : 30);
});

test("Vibex profile per the reference; post cards unchanged", async ({ page }) => {
  await signUpViaApi(page, "Алан", "Хиррс");
  await api(page, "PATCH", "/api/vibex/profile", { city: "Moscow" });
  expect((await api(page, "POST", "/api/vibex/posts", { text: "hello" })).status).toBe(201);
  await launch(page, "vibex");
  if (isMobile(page)) await page.getByTestId("vibex-menu").click();
  await page.getByTestId("vibex-nav-me").last().click();
  const header = page.getByTestId("profile-header");
  await expect(header).toBeVisible();
  await expect(page.getByTestId("profile-cover-camera")).toBeVisible();
  await expect(page.getByTestId("profile-edit")).toBeVisible();
  await expect(page.getByTestId("profile-more")).toBeVisible();
  await expect(page.getByTestId("profile-city")).toContainText("Moscow");
  await expect(page.getByTestId("profile-stats")).toContainText("1запись");
  await expect(page.getByTestId("profile-stats")).toContainText("0подписчиков");
  await expect(page.getByTestId("profile-stats")).toContainText("0подписок");
  // The avatar crosses the cover's lower edge.
  const cover = (await page.getByTestId("profile-cover").boundingBox())!;
  const avatar = (await page.getByTestId("profile-avatar").boundingBox())!;
  expect(avatar.y).toBeLessThan(cover.y + cover.height);
  expect(avatar.y + avatar.height).toBeGreaterThan(cover.y + cover.height);
  // Edit and "…" do not overlap.
  const edit = (await page.getByTestId("profile-edit").boundingBox())!;
  const more = (await page.getByTestId("profile-more").boundingBox())!;
  expect(edit.x + edit.width).toBeLessThanOrEqual(more.x);
  // Tabs: Posts active (violet), then Reposts / Photo and video.
  await expect(page.getByTestId("profile-tab-posts")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("profile-tab-posts")).toHaveCSS("color", "rgb(108, 92, 255)");
  await expect(page.getByTestId("profile-composer")).toBeVisible();
  // The post below is the same post card as in the feed.
  await expect(page.getByTestId("post-card").first()).toContainText("hello");
  await page.getByTestId("profile-tab-media").click();
  await expect(page.getByTestId("profile-media")).toBeVisible();
  await noHorizontalOverflow(page);
  if (isMobile(page)) {
    await expect(page.getByText("Профиль", { exact: true })).toBeVisible();
    await expect(page.getByTestId("vibex-search")).toBeVisible();
  }
});

test("VoidOps Mail: recipient search finds Vibex chats; a link goes in as text", async ({ page, browser }) => {
  const { b, other } = await twoPeople(page, browser);
  await other.context().close();
  await launch(page, "mail");
  await page.getByTestId("compose").first().click();
  await page.getByTestId("composer-to").fill("Бор");
  const suggestion = page.getByTestId("recipient-suggestion").filter({ hasText: "Борис Чатов" });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page.getByTestId("recipient-chip")).toHaveAttribute("data-status", /ok|checking/);
  await expect(page.getByTestId("recipient-chip")).toContainText(/Борис|@voidops\.ru/);
  expect(b.address).toContain("@voidops.ru");

  await page.getByTestId("composer-body").fill("Смотри: ");
  await page.getByTestId("composer-link").click();
  await page.getByTestId("composer-link-input").fill("voidex.su/notes");
  await page.getByTestId("composer-link-insert").click();
  await expect(page.getByTestId("composer-body")).toHaveValue("Смотри: https://voidex.su/notes");
  // Nonsense is refused.
  await page.getByTestId("composer-link").click();
  await page.getByTestId("composer-link-input").fill("not a link");
  await page.getByTestId("composer-link-insert").click();
  await expect(page.getByTestId("composer-link-sheet")).toContainText("Проверьте адрес");
});
