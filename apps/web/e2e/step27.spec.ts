import { expect, test, type Browser, type Page } from "@playwright/test";
import { normalizeLayout, type AppId } from "@voidex/shared";
import { newPage, openApp, reloadUnlocked, settingsRoot, signUpViaApi } from "./helpers";

/**
 * Step 2.7: Files and Media as VOIDEX apps (no fake cloud), the shared Cloud
 * and share dialogs, «Откуда выбрать?» in Vibex, the system search style
 * with «Фон поиска», the phone gesture bar and Notification Center, Notes
 * page deletion, wallpapers only in Settings → Обои, the PC grid spacing.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDKgCQAA+QsC/fW6bEUAAAAASUVORK5CYII=", "base64");

async function api(page: Page, method: string, url: string, body?: unknown, raw?: { name: string; data: number[] }): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(
    async ({ method, url, body, raw }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const headers: Record<string, string> = { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}` };
      let payload: BodyInit | undefined;
      if (raw) {
        headers["Content-Type"] = "application/octet-stream";
        headers["X-File-Name"] = encodeURIComponent(raw.name);
        payload = new Uint8Array(raw.data);
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

/** Two people with a Vibex chat between them (each is in the other's share contacts). */
async function twoPeople(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Анна", "Файлова");
  const other = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(other, "Борис", "Медиев");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  expect((await api(other, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет" })).status).toBe(201);
  return { a, b, other, chat };
}

/** Opens an app even when another window covers its desktop icon (PC: from the dock). */
async function launch(page: Page, id: AppId) {
  if (isMobile(page)) await openApp(page, id as "vibex");
  else {
    await page.getByTestId(`dock-app-${id}`).click();
    await expect(page.locator(`[data-testid="window-${id}"][data-state="open"]`)).toBeVisible();
  }
}

async function openChat(page: Page) {
  await launch(page, "vibex");
  if (isMobile(page)) await page.getByTestId("vibex-tab-chats").or(page.getByRole("button", { name: "Сообщения" })).first().click();
  else await page.getByTestId("vibex-nav-chats").click();
  await page.getByTestId("chat-row").first().click();
  await expect(page.getByTestId("chat-input")).toBeVisible();
}

/** The phone gesture bar of the app in front: a mouse swipe (pointer events), like a finger. */
async function gestureBar(page: Page, dx: number, dy: number) {
  await page.waitForTimeout(600); // the window finishes opening (it grows out of its icon)
  const bar = page.locator('section[data-state="open"] [data-testid="home-indicator"]');
  const box = (await bar.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}

async function frontApp(page: Page) {
  return page.locator('section[data-state="open"]').getAttribute("data-testid");
}

// ---------------------------------------------------------------- Files

test("Files: preinstalled; its structure; an honest cloud state (no quota); a .txt from Vibex opens in Files and goes back out as a real attachment", async ({ page, browser }) => {
  const { a, other } = await twoPeople(page, browser);
  await expect(page.getByTestId("app-files")).toBeVisible();
  await expect(page.getByTestId("app-media")).toBeVisible();

  await openApp(page, "files");
  const app = page.getByTestId("files-app");
  await expect(app).toBeVisible();
  for (const label of ["Все", ".txt", ".prsn", "Скачанные", "Папки"]) await expect(app.getByRole("tab", { name: label })).toBeVisible();
  await expect(page.getByTestId("files-cloud-notice")).toContainText("Не сохранено в ViCloud");
  await expect(app.getByText(/из 5 ГБ|Облако · 5 ГБ|Добавить скачанные файлы|Доступ по ссылкам/)).toHaveCount(0);
  // One Cloud dialog for the system: the cloud is plainly not available.
  await page.getByTestId("files-cloud-link").click();
  await expect(page.getByTestId("cloud-dialog")).toBeVisible();
  await expect(page.getByTestId("cloud-dialog-status")).toHaveText("ViCloud пока не запущен");
  await expect(page.getByTestId("cloud-dialog-body")).toHaveAttribute("data-available", "false");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cloud-dialog")).toHaveCount(0);

  // B sends A a .txt in Vibex; A opens it in Files (FilesAdapter.receive).
  const up = await api(other, "POST", "/api/vibex/files?purpose=message", undefined, { name: "План.txt", data: [...Buffer.from("Привет из Vibex")] });
  expect(up.status).toBe(201);
  const chats = (await api(other, "GET", "/api/vibex/chats")).body;
  expect((await api(other, "POST", `/api/vibex/chats/${chats[0].id}/messages`, { text: "Держи", fileIds: [up.body.id] })).status).toBe(201);
  if (isMobile(page)) await gestureBar(page, 0, -260);
  await openChat(page);
  await page.getByTestId("vibex-file-open-files").last().click();
  await expect(page.locator('[data-testid="window-files"][data-state="open"]')).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Текст документа" })).toHaveValue("Привет из Vibex");

  // Share it from Files: the common dialog, a real .txt attachment to B in Vibex.
  await page.getByRole("button", { name: "Поделиться" }).last().click();
  const sheet = page.getByTestId("files-share-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Разрешить редактирование")).toHaveCount(0);
  await page.getByTestId("files-share-app-vibex").click();
  await page.getByTestId("files-share-search").fill("Борис");
  await page.getByTestId("files-share-contact").first().click();
  await page.getByTestId("files-share-send").click();
  await expect(sheet).toHaveCount(0);
  await expect
    .poll(async () => {
      const list = (await api(other, "GET", `/api/vibex/chats/${chats[0].id}/messages`)).body.items as { files: { filename: string }[]; senderId: string }[];
      return list.filter((m) => m.senderId === a.id).flatMap((m) => m.files.map((f) => f.filename));
    })
    .toContain("План.txt");
});

// ---------------------------------------------------------------- Media

test("Media: the honest cloud state; a photo added to an album is a session preview; sharing goes through the common dialog as a real image", async ({ page, browser }) => {
  const { other, chat } = await twoPeople(page, browser);
  await openApp(page, "media");
  const app = page.getByTestId("media-app");
  await expect(app.locator(".vm-app")).toBeVisible();
  await expect(page.getByTestId("media-cloud-notice")).toBeVisible();
  await expect(app.getByText("Облако · 5 ГБ")).toHaveCount(0);
  await expect(app.getByText(/Не в альбоме|Добавить$/)).toHaveCount(0);
  await app.locator(".vm-cloud-link").first().click();
  await expect(page.getByTestId("cloud-dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  // Albums are where files are added.
  await app.getByRole("button", { name: "Новый альбом" }).first().click();
  await page.getByPlaceholder("Название альбома").fill("Поездка");
  await page.getByPlaceholder("Название альбома").press("Enter");
  const uploadButton = page.getByRole("button", { name: /Загрузить файлы в альбом/ });
  if (!(await uploadButton.isVisible().catch(() => false))) {
    await page.waitForTimeout(800);
    if (!(await uploadButton.isVisible())) await app.locator(".vm-upload").first().click();
  }
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Загрузить файлы в альбом/ }).click();
  await (await chooser).setFiles({ name: "закат.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Готово" }).click();
  const card = app.locator(".vm-media-card").first();
  await expect(card).toBeVisible();
  expect(await card.locator("img").first().getAttribute("src")).toMatch(/^blob:/);

  // Viewer → Share → Vibex → B: a real PNG attachment.
  await card.click();
  await page.getByRole("button", { name: "Поделиться" }).first().click();
  await expect(page.getByTestId("media-share-sheet")).toBeVisible();
  await page.getByTestId("media-share-app-vibex").click();
  await page.getByTestId("media-share-contact").first().click();
  await page.getByTestId("media-share-send").click();
  await expect(page.getByTestId("media-share-sheet")).toHaveCount(0);
  await expect
    .poll(async () => ((await api(other, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items as { files: { mimeType: string }[] }[]).flatMap((m) => m.files.map((f) => f.mimeType)))
    .toContain("image/png");
});

// ---------------------------------------------------------------- Vibex attach

test("Vibex attach: «Откуда выбрать?» has three sources; VOIDEX sources fake nothing while the cloud is off; a device file reaches the other person live", async ({ page, browser }) => {
  const { other } = await twoPeople(page, browser);
  await openChat(page);
  await page.getByTestId("chat-attach").click();
  const sheet = page.getByTestId("attach-source");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-centered", "true");
  await expect(sheet.getByText("Откуда выбрать?")).toBeVisible();
  for (const id of ["files", "media", "device"]) await expect(page.getByTestId(`attach-source-${id}`)).toBeVisible();
  await page.getByTestId("attach-source-files").click();
  await expect(page.getByTestId("attach-source-empty")).toContainText("ViCloud пока не запущен");
  await expect(page.getByTestId("attach-source-file")).toHaveCount(0);
  await sheet.getByText("Откуда выбрать?").click();
  await page.getByTestId("attach-source-media").click();
  await expect(page.getByTestId("attach-source-empty")).toBeVisible();
  await expect(page.getByTestId("attach-source-item")).toHaveCount(0);
  await sheet.getByText("Откуда выбрать?").click();

  // The device: the real file picker, the usual rules.
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("attach-source-device").click();
  await (await chooser).setFiles({ name: "отчёт.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%test\n") });
  await expect(page.getByTestId("composer-files")).toBeVisible();
  await page.getByTestId("chat-input").fill("Отчёт");
  await page.getByTestId("chat-send").click();
  // B sees it without reloading (realtime).
  await openChat(other);
  await expect(other.getByTestId("vibex-file").filter({ hasText: "отчёт.pdf" })).toBeVisible();
  // An unsupported type is refused before upload.
  await page.getByTestId("chat-file").setInputFiles({ name: "run.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.getByText("Такой тип файла нельзя прикрепить.")).toBeVisible();
});

// ---------------------------------------------------------------- search

test("Search: one style everywhere; «Фон поиска» is saved with the account and readable in the dark theme", async ({ page }) => {
  await signUpViaApi(page, "Поиск", "Белый");
  await openApp(page, "settings");
  const field = page.getByTestId("settings-search-field");
  await expect(field).toHaveClass(/vx-search/);
  const look = () =>
    field.evaluate((el) => {
      const cs = getComputedStyle(el);
      const input = getComputedStyle(el.querySelector("input")!);
      return { bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius), blur: cs.backdropFilter, border: cs.borderTopWidth, color: input.color, font: parseFloat(input.fontSize) };
    });
  const before = await look();
  expect(before.radius).toBeGreaterThanOrEqual(18);
  expect(before.blur === "none" || before.blur === "").toBeTruthy();
  expect(before.border).toBe("1px");
  if (isMobile(page)) expect(before.font).toBeGreaterThanOrEqual(16);

  await settingsRoot(page);
  await page.getByTestId("settings-nav-personalization").or(page.getByTestId("settings-home-personalization")).first().click();
  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByTestId("personal-search-bg").getByText("Белый").click();
  await expect(page.locator("html")).toHaveAttribute("data-search", "white");
  const preview = page.getByTestId("personal-search-preview-field");
  // (polled: the field eases into its new colours)
  await expect.poll(() => preview.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await preview.evaluate((el) => getComputedStyle(el.querySelector("input")!).color)).toBe("rgb(23, 23, 27)");

  // Saved with the account: still white after a new app start.
  await page.waitForTimeout(800);
  await reloadUnlocked(page);
  await expect(page.locator("html")).toHaveAttribute("data-search", "white");
  // The system search field follows it too.
  const home = isMobile(page) ? null : page.getByTestId("dock-search");
  if (home) await expect.poll(() => home.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
});

// ---------------------------------------------------------------- phone shell

test("phone: the gesture bar switches between three open apps sideways; no system “…”", async ({ page }) => {
  test.skip(!isMobile(page), "phone gesture bar");
  await signUpViaApi(page, "Жест", "Свайпов");
  for (const id of ["notes", "files", "settings"] as const) {
    await openApp(page, id);
    await expect(page.locator('section[data-state="open"] [data-testid="window-menu"]')).toHaveCount(0);
    if (id !== "settings") {
      await gestureBar(page, 0, -260);
      await expect(page.locator('section[data-state="open"]')).toHaveCount(0);
    }
  }
  expect(await frontApp(page)).toBe("window-settings");
  // A short sideways move does nothing; past the threshold it switches.
  await gestureBar(page, 30, 0);
  expect(await frontApp(page)).toBe("window-settings");
  await gestureBar(page, 160, 0);
  await expect.poll(() => frontApp(page)).toBe("window-files");
  await gestureBar(page, 160, 0);
  await expect.poll(() => frontApp(page)).toBe("window-notes");
  await gestureBar(page, 160, 0); // nothing before the first
  expect(await frontApp(page)).toBe("window-notes");
  await gestureBar(page, -160, 0);
  await expect.poll(() => frontApp(page)).toBe("window-files");
  // Up still goes home; no browser history was written.
  await gestureBar(page, 0, -260);
  await expect(page.locator('section[data-state="open"]')).toHaveCount(0);
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(2);
});

test("phone: the Notification Center opens full screen only and closes with its button", async ({ page }) => {
  test.skip(!isMobile(page), "phone");
  await signUpViaApi(page, "Центр", "Уведомлений");
  for (let i = 0; i < 12; i++) expect((await api(page, "POST", "/api/notifications/dev/system-update", { title: `Новость ${i}`, body: "Текст" })).status).toBeLessThan(300);
  const cdp = await page.context().newCDPSession(page);
  const w = page.viewportSize()!.width;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: w / 2, y: 2 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: w / 2, y: 2 + 42 * i }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const nc = page.getByTestId("notification-center");
  await expect(nc).toBeVisible();
  await page.waitForTimeout(700);
  const box = (await nc.boundingBox())!;
  expect(box.y).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - page.viewportSize()!.height)).toBeLessThanOrEqual(2);
  // The list scrolls inside the panel, not the page.
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight)).toBeLessThanOrEqual(0);
  await page.getByTestId("notifications-close").click();
  await expect(nc).toHaveCount(0);
});

// ---------------------------------------------------------------- Notes

test("Notes: page 2 is deleted with its content after a confirmation; the first page is cleared, never deleted; Users opens centered on phones", async ({ page }) => {
  await signUpViaApi(page, "Нина", "Страницы");
  const project = (await api(page, "POST", "/api/notes/projects", { name: "Книга" })).body;
  const block = (text: string) => ({ id: crypto.randomUUID(), kind: "text", text });
  const doc = (await api(page, "POST", `/api/notes/projects/${project.id}/documents`, {
    name: "Главы",
    kind: "note",
    data: { kind: "note", format: "vertical", pages: [{ id: "p1", blocks: [block("Первая страница")] }, { id: "p2", blocks: [block("Вторая страница")] }] },
  })).body;
  expect(doc.id).toBeTruthy();
  await openApp(page, "notes");
  await page.getByTestId("notes-project-list").getByTestId("notes-card-name").getByText("Книга", { exact: true }).first().click();
  await page.getByTestId("notes-doc-list").getByTestId("notes-card-name").getByText("Главы", { exact: true }).first().click();
  await expect(page.getByTestId("notes-doc")).toBeVisible();
  const paper = page.getByTestId("notes-doc");
  await expect(paper.getByText("Вторая страница")).toHaveCount(1);
  // Go to page 2 and delete it.
  await page.getByTestId("notes-page-next").click();
  await expect(page.getByTestId("notes-page-indicator")).toHaveText(/2\s*\/\s*2/);
  await page.waitForTimeout(800); // the page finishes scrolling into place
  await expect(page.getByTestId("notes-page-indicator")).toHaveText(/2\s*\/\s*2/);
  await page.getByTestId("notes-page-add").click();
  await page.getByTestId("notes-menu-page-delete").click();
  await expect(page.getByText("Удалить эту страницу?")).toBeVisible();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect.poll(async () => JSON.stringify((await api(page, "GET", `/api/notes/documents/${doc.id}`)).body)).not.toContain("Вторая страница");
  // The only page left: the menu clears it.
  await page.getByTestId("notes-page-add").click();
  await expect(page.getByTestId("notes-menu-page-delete")).toHaveText(/Очистить страницу/);
  await page.getByTestId("notes-menu-page-delete").click();
  await page.getByRole("button", { name: "Очистить", exact: true }).click();
  await expect.poll(async () => {
    const d = (await api(page, "GET", `/api/notes/documents/${doc.id}`)).body;
    const body = d.data ?? d.document?.data;
    return [body.pages.length, JSON.stringify(body).includes("Первая страница")];
  }).toEqual([1, false]);
});

// ---------------------------------------------------------------- PC desktop

test("PC desktop: the system bar → first row space equals the last row → dock space, no overlap, no scroll", async ({ page }) => {
  test.skip(isMobile(page), "PC");
  await signUpViaApi(page, "Сетка", "Отступов");
  const ids = ((await api(page, "GET", "/api/apps")).body as { id: AppId }[]).map((x) => x.id);
  for (const [w, h] of [[1180, 820], [1440, 900], [1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const rows = Number(await page.getByTestId("desktop-grid").getAttribute("data-rows"));
    const layout = normalizeLayout(null, ids);
    layout.desktop.cells = { "app:media": { c: 0, r: rows - 1 } };
    expect((await api(page, "PATCH", "/api/preferences", { workspace: { layout } })).status).toBe(200);
    await reloadUnlocked(page);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="system-bar"]')!.getBoundingClientRect();
      const dock = document.querySelector('[data-testid="dock"]')!.getBoundingClientRect();
      const tile = (id: string) => document.querySelector(`[data-testid="app-${id}"] [data-tile]`)!.getBoundingClientRect();
      const label = (id: string) => [...document.querySelectorAll(`[data-testid="app-${id}"] *`)].filter((e) => e.children.length === 0 && e.textContent).map((e) => e.getBoundingClientRect().bottom);
      return { top: tile("mail").top - bar.bottom, bottom: dock.top - Math.max(...label("media")), scroll: document.scrollingElement!.scrollHeight - innerHeight };
    });
    expect(r.top, `${w}: top`).toBeGreaterThan(8);
    expect(r.bottom, `${w}: bottom`).toBeGreaterThan(8);
    expect(Math.abs(r.top - r.bottom), `${w}: ${JSON.stringify(r)}`).toBeLessThanOrEqual(12);
    expect(r.scroll).toBeLessThanOrEqual(0);
  }
});
