import { expect, test, type Page } from "@playwright/test";
import { PASSCODE, newPage, openApp, signUpViaApi } from "./helpers";

/**
 * Step 2.5 — Notes, Vibex additions, shell, Settings, two-step app removal.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

/** API call as the signed-in page (a fresh access token from the refresh cookie). */
async function api(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const res = await fetch(url, {
        method,
        headers: { "X-Voidex-Client": "web", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
}

async function closeWindow(page: Page, id: string) {
  await page.getByTestId(`window-${id}`).getByTestId("window-menu").first().click();
  await page.getByTestId("menu-close").click();
}

/** Edit mode on the home screen: long press on free space (phone), the desktop menu (PC). */
async function enterEdit(page: Page) {
  const home = page.getByTestId("home");
  if (isMobile(page)) {
    const box = (await page.getByTestId("home-page-0").boundingBox())!;
    const p = { x: box.x + box.width / 2, y: box.y + box.height - 80 };
    const cdp = await page.context().newCDPSession(page);
    await expect(async () => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
      await page.waitForTimeout(700);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(home).toHaveAttribute("data-editing", "true", { timeout: 1500 });
    }).toPass({ timeout: 15_000 });
  } else {
    const box = (await page.getByTestId("desktop-space").boundingBox())!;
    await page.mouse.click(box.x + box.width - 60, box.y + box.height - 60, { button: "right" });
    await page.getByTestId("menu-edit").click();
    await expect(home).toHaveAttribute("data-editing", "true");
  }
}

const badge = (page: Page, id: string) => page.getByTestId(`app-${id}`).getByTestId("home-remove-badge");

test("removing apps asks twice; Cancel / Esc / outside at any step keeps them; several apps at once", async ({ page }) => {
  await signUpViaApi(page, "Удаля", "Дважды");
  await enterEdit(page);

  // "−" only marks the app.
  await badge(page, "settings").click({ force: true });
  await expect(badge(page, "settings")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("app-settings")).toBeVisible();
  await page.getByTestId("remove-selection-delete").click();

  // Step 1 → "Удалить" → step 2; the app is still there.
  const dialog = page.getByTestId("remove-confirm");
  await expect(dialog).toHaveAttribute("data-step", "1");
  await expect(page.getByTestId("remove-confirm-app-settings")).toBeVisible();
  await page.getByTestId("remove-confirm-ok").click();
  await expect(dialog).toHaveAttribute("data-step", "2");
  await expect(page.getByTestId("remove-confirm-title")).toHaveText("Точно удалить выбранные приложения?");
  await expect(page.getByTestId("app-settings")).toBeVisible();
  await expect(page.getByTestId("remove-confirm-app-settings")).toBeVisible();

  // Cancel at step 2: nothing removed, the dialog is gone.
  await page.getByTestId("remove-confirm-cancel").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("app-settings")).toBeVisible();

  // Esc at step 1, tap outside at step 2: nothing removed.
  await page.getByTestId("remove-selection-delete").click();
  await expect(dialog).toHaveAttribute("data-step", "1");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("home")).toHaveAttribute("data-editing", "true");
  await page.getByTestId("remove-selection-delete").click();
  await page.getByTestId("remove-confirm-ok").click();
  await expect(dialog).toHaveAttribute("data-step", "2");
  await page.getByTestId("remove-confirm-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("app-settings")).toBeVisible();

  // A double click on step 1's "Удалить" doesn't fall through to step 2's.
  await page.getByTestId("remove-selection-delete").click();
  await page.getByTestId("remove-confirm-ok").dblclick();
  await expect(dialog).toHaveAttribute("data-step", "2");
  await page.waitForTimeout(300);
  await expect(page.getByTestId("app-settings")).toBeVisible();
  await page.getByTestId("remove-confirm-cancel").click();

  // Several apps: all icons on both steps; both confirmations remove them all.
  await badge(page, "vibex").click({ force: true });
  await badge(page, "calculator").click({ force: true });
  await expect(page.getByTestId("remove-selection-bar")).toContainText("3");
  await page.getByTestId("remove-selection-delete").click();
  for (const id of ["settings", "vibex", "calculator"]) await expect(page.getByTestId(`remove-confirm-app-${id}`)).toBeVisible();
  await page.getByTestId("remove-confirm-ok").click();
  await expect(dialog).toHaveAttribute("data-step", "2");
  for (const id of ["settings", "vibex", "calculator"]) {
    await expect(page.getByTestId(`remove-confirm-app-${id}`)).toBeVisible();
    await expect(page.getByTestId(`app-${id}`)).toBeVisible();
  }
  await page.getByTestId("remove-confirm-ok").click();
  await expect(dialog).toHaveCount(0);
  for (const id of ["settings", "vibex", "calculator"]) await expect(page.getByTestId(`app-${id}`)).toHaveCount(0);
  await expect(page.getByTestId("app-mail")).toBeVisible();
  await expect(page.getByTestId("remove-selection-bar")).toHaveCount(0);
});

test("Notes: a native app — continuous sheet with page breaks, paged view, images, saved to the account", async ({ page }) => {
  await signUpViaApi(page, "Нота", "Лист");
  await openApp(page, "notes");
  const app = page.getByTestId("notes-app");
  await expect(app.locator(".vn-app")).toBeVisible();
  // No iframe, one React tree.
  expect(await page.locator("iframe").count()).toBe(0);
  await app.getByText("Открыть пример").click();
  await expect(app.locator(".vn-stage.continuous")).toBeVisible();
  const pages = app.locator(".vn-note-page");
  const before = await pages.count();
  // Insert a break after the quote: one more page, nothing lost.
  await app.locator(".vn-quote .vn-editable").first().click();
  await app.getByRole("button", { name: "Разрыв страницы после блока" }).click();
  await expect(pages).toHaveCount(before + 1);
  const breaks = app.getByTestId("notes-page-break");
  await expect(breaks).toHaveCount(before);
  // Remove it again: the pages join, all text is still there.
  const text = await app.locator(".vn-stage").innerText();
  await breaks.first().getByRole("button", { name: "Убрать разрыв" }).click();
  await expect(pages).toHaveCount(before);
  for (const line of ["Место для следующей идеи", "Меньше инструментов"]) expect(text).toContain(line);
  await expect(app.locator(".vn-stage")).toContainText("Меньше инструментов");
  // Paged view: the same content as separate pages with labels.
  await app.getByTestId("notes-paged-toggle").click();
  await expect(app.locator(".vn-stage.continuous")).toHaveCount(0);
  await expect(app.locator(".vn-page-label").first()).toBeVisible();
  await app.getByTestId("notes-paged-toggle").click();
  await expect(app.locator(".vn-stage.continuous")).toBeVisible();
  // An image (PNG) uploaded into the note; it loads through the session.
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");
  await app.locator(".vn-heading .vn-editable").first().click();
  await app.locator('input[type=file][accept^="image/jpeg"]').first().setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: png });
  await expect(app.locator(".vn-image img")).toHaveAttribute("src", /^blob:/);
  await page.keyboard.press("Escape");
  await app.getByTestId("notes-image-size-8").click();
  // Saved on the server (revision grows) with the image path of the Notes API.
  await expect.poll(async () => (await api(page, "GET", "/api/notes")).body?.revision ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(async () => JSON.stringify((await api(page, "GET", "/api/notes")).body.data), { timeout: 15_000 }).toMatch(/\/api\/notes\/media\?id=[0-9a-f-]{36}/);
});

test("Notes: closing with unsaved changes asks; a save from another device shows the conflict choice", async ({ page }) => {
  test.skip(isMobile(page), "window menu on PC");
  await signUpViaApi(page, "Нота", "Конфликт");
  await openApp(page, "notes");
  const app = page.getByTestId("notes-app");
  await app.getByText("Открыть пример").click();
  await expect.poll(async () => (await api(page, "GET", "/api/notes")).body?.revision ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  // Another device saves a newer version.
  const server = (await api(page, "GET", "/api/notes")).body;
  const theirs = structuredClone(server.data);
  theirs.projects[0].name = "Версия с другого устройства";
  expect((await api(page, "PUT", "/api/notes", { data: theirs, revision: server.revision })).status).toBe(200);
  // Editing here now meets the newer revision: nothing is overwritten, the choice is offered.
  await page.waitForTimeout(500);
  await app.locator(".vn-heading .vn-editable").first().click();
  await page.keyboard.type(" (здесь)");
  await expect(page.getByTestId("notes-conflict")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("notes-conflict-both").click();
  await expect(page.getByTestId("notes-conflict")).toHaveCount(0);
  await expect.poll(async () => JSON.stringify((await api(page, "GET", "/api/notes")).body.data), { timeout: 15_000 }).toContain("Версия с другого устройства");
  expect(JSON.stringify((await api(page, "GET", "/api/notes")).body.data)).toContain("(копия с этого устройства)");

  // Unsaved text + close: the shell asks; Cancel keeps the window, "Save and close" saves.
  await app.locator(".vn-heading .vn-editable").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await closeWindow(page, "notes");
  await expect(page.getByTestId("close-guard")).toBeVisible();
  await page.getByTestId("close-guard-cancel").click();
  await expect(page.locator('[data-testid="window-notes"][data-state="open"]')).toBeVisible();
  await app.locator(".vn-heading .vn-editable").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("?");
  await closeWindow(page, "notes");
  await page.getByTestId("close-guard-save").click();
  await expect(page.getByTestId("window-notes")).toHaveCount(0);
  await expect.poll(async () => JSON.stringify((await api(page, "GET", "/api/notes")).body.data)).toContain("!?");
});

test("PC passcode: keyboard only — focus, wrong code keeps focus, Backspace, retry; phones keep the keypad", async ({ page }) => {
  await signUpViaApi(page, "Клава", "Код");
  if (isMobile(page)) {
    await openApp(page, "settings");
    await page.getByTestId("settings-nav-lock").click();
    await page.getByTestId("settings-lock-now").click();
    await expect(page.getByTestId("passcode-pad")).toHaveAttribute("data-variant", "keypad");
    for (const d of PASSCODE) await page.getByTestId(`key-${d}`).click();
    await expect(page.getByTestId("lock-screen")).toHaveCount(0);
    return;
  }
  await page.getByTestId("lock-now").click();
  const pad = page.getByTestId("passcode-pad");
  await expect(pad).toHaveAttribute("data-variant", "keyboard");
  await expect(page.getByTestId("key-1")).toHaveCount(0);
  await expect(page.getByTestId("passcode-input")).toBeFocused();
  await page.keyboard.type("111111");
  await expect(page.getByTestId("passcode-error")).not.toBeEmpty();
  await expect(page.getByTestId("passcode-input")).toBeFocused();
  await expect(page.getByTestId("passcode-dots")).toHaveAttribute("data-filled", "0");
  await page.keyboard.type(PASSCODE.slice(0, 4) + "0");
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("passcode-dots")).toHaveAttribute("data-filled", "4");
  await page.keyboard.type(PASSCODE.slice(4));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("lock-screen")).toHaveCount(0);
});

test("Vibex: delete my message (others can't), placeholder for both; action row counts and views", async ({ page, browser }) => {
  const a = await signUpViaApi(page, "Аня", "Удаляет");
  const other = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(other, "Боря", "Видит");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  expect((await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Секретное сообщение" })).status).toBe(201);
  expect((await api(other, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Ответ Бори" })).status).toBe(201);
  await openApp(page, "vibex");
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").click();
  await page.getByTestId("chat-row").first().click();
  const mine = page.getByTestId("message").filter({ hasText: "Секретное сообщение" });
  await expect(mine).toBeVisible();
  // Their message has no delete action; mine does.
  await expect(page.getByTestId("message").filter({ hasText: "Ответ Бори" }).getByTestId("message-delete")).toHaveCount(0);
  if (isMobile(page)) {
    const box = (await mine.locator("p").boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 10, y: box.y + 5 }] });
    await page.waitForTimeout(600);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.getByTestId("message-actions").getByTestId("menu-delete").click();
  } else {
    await mine.hover();
    await mine.getByTestId("message-delete").click();
  }
  await page.getByRole("button", { name: "Удалить" }).last().click();
  await expect(page.getByTestId("message-deleted")).toBeVisible();
  await expect(page.getByTestId("messages")).not.toContainText("Секретное сообщение");
  // The other side sees the placeholder too.
  const list = (await api(other, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items;
  expect(list.find((m: { deleted?: boolean }) => m.deleted)).toBeTruthy();

  // Posts: icon + number buttons (0 shown), views apart.
  const postText = `Пост Бори ${Date.now().toString(36)}`;
  expect((await api(other, "POST", "/api/vibex/posts", { text: postText })).status).toBe(201);
  if (isMobile(page)) {
    await page.getByTestId("chat-back").click();
    await page.getByTestId("vibex-tab-feed").click();
  } else await page.getByTestId("vibex-nav-feed").click();
  const card = page.getByTestId("post-card").filter({ hasText: postText });
  await expect(card).toBeVisible({ timeout: 15_000 });
  for (const id of ["post-like", "post-comment", "post-share"]) await expect(card.getByTestId(`${id}-count`)).toHaveText("0");
  await expect(card.getByTestId("post-share")).toHaveAttribute("aria-label", /Поделиться/);
  await expect(card.getByTestId("share-glyph")).toBeVisible();
  // A real view: counted once on the server (the author doesn't count).
  await expect.poll(async () => (await api(other, "GET", "/api/vibex/feed")).body.items.find((p: { text: string }) => p.text === postText)?.views, { timeout: 15_000 }).toBe(1);
  void a;
});

test("Settings opens on its home; search opens the exact section; theme, dock glass, wallpaper sync", async ({ page }) => {
  await signUpViaApi(page, "Поиск", "Настроек");
  await openApp(page, "settings");
  if (!isMobile(page)) await expect(page.getByTestId("settings-home")).toBeVisible();
  await page.getByTestId("settings-search").fill("face id");
  await page.getByTestId("settings-result-lock").first().click();
  await expect(page.getByTestId("settings-lock")).toBeVisible();
  if (isMobile(page)) await page.getByTestId("settings-back").click();
  await page.getByTestId("settings-search").fill("тема");
  await page.getByTestId("settings-result-personalization").first().click();
  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  if (!isMobile(page)) {
    await page.getByTestId("personal-dock-off").click();
    await expect(page.getByTestId("dock")).not.toHaveAttribute("data-glass-shell", "true");
    await expect(page.getByTestId("dock")).toHaveAttribute("data-shelf", "true");
    await page.getByTestId("personal-dock-glass").click();
    await expect(page.getByTestId("dock")).toHaveAttribute("data-glass-shell", "true");
  }
  await page.getByTestId("theme-light").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  // Wallpapers: tabs, carousel, apply; sync off keeps them on this device only.
  if (isMobile(page)) await page.getByTestId("settings-back").click();
  await page.getByTestId("settings-search").fill("обои");
  await page.getByTestId("settings-result-wallpapers").first().click();
  await page.getByTestId("wallpapers-tab-home").click();
  await page.getByTestId("wallpapers-option-wave-gray").click();
  await page.getByTestId("wallpapers-apply").click();
  await expect.poll(async () => (await api(page, "GET", "/api/me")).body.preferences.workspace.layout.appearance.wallpaper).toEqual({ kind: "preset", id: "wave-gray" });
  await page.getByTestId("wallpapers-sync").getByRole("switch").click();
  await expect.poll(async () => (await api(page, "GET", "/api/me")).body.preferences.workspace.layout.appearance.syncWallpapers).toBe(false);
  await page.getByTestId("wallpapers-option-wave-light").click();
  await page.getByTestId("wallpapers-apply").click();
  // The account keeps the grey wave; this device shows the light one.
  await page.waitForTimeout(800);
  expect((await api(page, "GET", "/api/me")).body.preferences.workspace.layout.appearance.wallpaper).toEqual({ kind: "preset", id: "wave-gray" });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("vx.wallpapers.device") ?? "{}").wallpaper)).toEqual({ kind: "preset", id: "wave-light" });
});

test("icons: unread badge only with unread items; Mail is 'Почта VoidOps'; phone fields don't zoom", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Бейдж", "Тест");
  await expect(page.getByTestId("app-mail")).toContainText("Почта VoidOps");
  await expect(page.locator('[data-testid^="app-badge-"]')).toHaveCount(0);
  const other = await newPage(browser, isMobile(page));
  await signUpViaApi(other, "Отправитель", "Письма");
  const draft = (await api(other, "POST", "/api/mail/drafts", { to: [me.address], subject: "Привет", body: "Письмо" })).body;
  expect((await api(other, "POST", `/api/mail/drafts/${draft.id}/send`, {})).status).toBe(200);
  await expect(page.getByTestId("app-badge-mail")).toHaveText("1", { timeout: 15_000 });
  await expect(page.getByTestId("app-badge-vibex")).toHaveCount(0);
  if (isMobile(page)) {
    await openApp(page, "settings");
    const size = await page.getByTestId("settings-search").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    // No zoom hacks in the viewport.
    const vp = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(vp).not.toMatch(/user-scalable|maximum-scale/);
  }
});

test("phone Notification Center: handle down = full screen, up = back; swipe a card to delete it", async ({ page }) => {
  test.skip(!isMobile(page), "phone");
  await signUpViaApi(page, "Свайп", "Уведомлений");
  for (const title of ["Первое", "Второе"]) expect((await api(page, "POST", "/api/notifications/dev/system-update", { title, body: "Текст" })).status).toBeLessThan(300);
  const cdp = await page.context().newCDPSession(page);
  const drag = async (from: { x: number; y: number }, dx: number, dy: number) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (dx * i) / 10, y: from.y + (dy * i) / 10 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  // Pull down from the very top edge to open.
  const w = page.viewportSize()!.width;
  await drag({ x: w / 2, y: 2 }, 0, 420);
  const nc = page.getByTestId("notification-center");
  await expect(nc).toBeVisible();
  await expect(page.getByTestId("notification")).toHaveCount(2);
  const handle = page.getByTestId("notification-handle");
  await page.waitForTimeout(700); // the sheet finishes sliding in
  let h = (await handle.boundingBox())!;
  await drag({ x: h.x + h.width / 2, y: h.y + h.height / 2 }, 0, 200);
  await expect(nc).toHaveAttribute("data-full", "true");
  await page.waitForTimeout(500);
  h = (await handle.boundingBox())!;
  await drag({ x: h.x + h.width / 2, y: h.y + h.height / 2 }, 0, -200);
  await expect(nc).not.toHaveAttribute("data-full", "true");
  await page.waitForTimeout(500);
  // Swipe the first card sideways: deleted on the server.
  const card = (await page.getByTestId("notification").first().boundingBox())!;
  await drag({ x: card.x + 40, y: card.y + card.height / 2 }, 240, 0);
  await expect(page.getByTestId("notification")).toHaveCount(1);
  await expect.poll(async () => (await api(page, "GET", "/api/notifications")).body.items.length).toBe(1);
});
