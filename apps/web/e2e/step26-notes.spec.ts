import { expect, test, type Browser, type Page } from "@playwright/test";
import { newPage, openApp, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Step 2.6 — Voidex Notes: Projects → notes and presentations (no spaces),
 * the browser, the clean-paper editor, pages, pictures, sharing (copy or
 * access, roles, realtime revoke), .txt / .prsn cards in Vibex and Mail,
 * presentations, deep links, and the "thrown back to Projects" regression.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJklEQVR4nGNkYPj/n4EIwESMolGF1FfIwsDAwMDw/z8DIyMjIwMDAAF+BgRlb3ugAAAAAElFTkSuQmCC",
  "base64",
);

/** API call as the signed-in page (a fresh access token from the refresh cookie). */
async function api(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const res = await fetch(url, { method, headers: { "X-Voidex-Client": "web", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
}

const note = (...texts: string[]) => ({
  kind: "note",
  format: "vertical",
  pages: [{ id: "p1", blocks: texts.map((text, i) => ({ id: `b${i}`, kind: i === 0 ? "heading" : "text", text })) }],
});

async function seed(page: Page, project: string, docs: { name: string; kind?: "note" | "presentation"; data?: unknown }[] = []) {
  const p = (await api(page, "POST", "/api/notes/projects", { name: project })).body;
  const out: { id: string; revision: number }[] = [];
  for (const d of docs) out.push((await api(page, "POST", `/api/notes/projects/${p.id}/documents`, { kind: d.kind ?? "note", name: d.name, ...(d.data ? { data: d.data } : {}) })).body);
  return { project: p.id as string, docs: out };
}

const blocks = (page: Page) => page.getByTestId("notes-block");
const saved = (page: Page) => expect(page.getByTestId("notes-save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });

async function openProject(page: Page, name: string) {
  await page.getByTestId("notes-project-list").getByTestId("notes-card-name").getByText(name, { exact: true }).first().click();
  await expect(page.getByTestId("notes-project")).toBeVisible();
}
async function openDoc(page: Page, name: string) {
  await page.getByTestId("notes-doc-list").getByTestId("notes-card-name").getByText(name, { exact: true }).first().click();
  await expect(page.getByTestId("notes-doc")).toBeVisible();
}
async function docMenu(page: Page, item: string) {
  // PC: the window "…" (app actions + window actions); phones: the app's own "…" (Step 2.7).
  await page.getByTestId("notes-doc").getByTestId(/^(window-menu|notes-more)$/).click();
  await page.getByTestId(`notes-menu-${item}`).click();
}

async function twoPeople(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Анна", "Автор");
  const other = await newPage(browser, false);
  const b = await signUpViaApi(other, "Борис", "Читатель");
  // A chat between them, so each is in the other's share contacts.
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  expect((await api(other, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет" })).status).toBe(201);
  return { a, b, other, chat };
}

// ------------------------------------------------------------------ the browser

test("Projects: + creates a project with name and cover; grid / list and sort are remembered; search; rename, remove cover, delete with confirmation", async ({ page }) => {
  await signUpViaApi(page, "Нина", "Проекты");
  await openApp(page, "notes");
  const app = page.getByTestId("notes-app");
  await expect(app).toHaveAttribute("data-screen", "projects");
  // The logo sits in the header; there is no back button on the first screen.
  await expect(page.getByTestId("notes-logo")).toBeVisible();
  await expect(page.getByTestId("notes-back")).toHaveCount(0);
  // No Spaces, Prompter, backgrounds or HTML export anywhere.
  await expect(page.getByText(/Пространств|Суфлёр|Фон заметки|HTML/)).toHaveCount(0);

  // "+" next to the search at the bottom: name + cover.
  await page.getByTestId("notes-add").click();
  await page.getByTestId("notes-cover-name").fill("Альфа");
  await page.getByTestId("notes-cover-file").setInputFiles({ name: "c.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("notes-cover-remove")).toBeVisible();
  await page.getByTestId("notes-cover-save").click();
  await expect(app).toHaveAttribute("data-screen", "project");
  await expect(page.getByTestId("notes-project-name")).toHaveText("Альфа");
  // Back: Projects; the logo did not move.
  const logo = await page.getByTestId("notes-logo").boundingBox();
  await page.getByTestId("notes-back").click();
  await expect(app).toHaveAttribute("data-screen", "projects");
  const logo2 = await page.getByTestId("notes-logo").boundingBox();
  expect(Math.abs(logo!.x - logo2!.x)).toBeLessThan(1);
  await api(page, "POST", "/api/notes/projects", { name: "Бета" });
  await api(page, "POST", "/api/notes/projects", { name: "Гамма" });
  await reloadUnlocked(page);
  if (!(await page.getByTestId("notes-app").count())) await openApp(page, "notes");
  await expect(page.getByTestId("notes-project-list")).toBeVisible();

  // List view + sort by name, remembered on the server.
  await page.getByTestId("notes-app").getByTestId(/^(window-menu|notes-more)$/).click();
  await page.getByTestId("notes-menu-view-list").click();
  await expect(page.getByTestId("notes-project-list")).toHaveAttribute("data-view", "list");
  await page.getByTestId("notes-app").getByTestId(/^(window-menu|notes-more)$/).click();
  await page.getByTestId("notes-menu-sort-name").click();
  await expect.poll(async () => (await api(page, "GET", "/api/notes/prefs")).body).toMatchObject({ projectsView: "list", projectsSort: "name" });
  const names = () => page.getByTestId("notes-project-list").getByTestId("notes-card-name").allInnerTexts();
  await expect.poll(names).toEqual(["Альфа", "Бета", "Гамма"]);

  // Search filters (context: projects).
  await page.getByTestId("notes-search").fill("гам");
  await expect.poll(async () => (await names()).length).toBe(1);
  await page.getByTestId("notes-search").fill("");

  // Rename + remove the cover from the card menu.
  const alpha = (await api(page, "GET", "/api/notes/projects")).body.projects.find((p: { name: string }) => p.name === "Альфа");
  expect(alpha.cover).toMatch(/^\/api\/notes\/media\?id=/);
  await page.getByTestId(`notes-project-more-${alpha.id}`).click();
  await page.getByTestId("notes-menu-edit").click();
  await page.getByTestId("notes-cover-name").fill("Альфа 2");
  await page.getByTestId("notes-cover-remove").click();
  await page.getByTestId("notes-cover-save").click();
  await expect.poll(async () => (await api(page, "GET", `/api/notes/projects/${alpha.id}`)).body.project).toMatchObject({ name: "Альфа 2", cover: null });

  // Delete asks first; Cancel keeps it.
  await page.getByTestId(`notes-project-more-${alpha.id}`).click();
  await page.getByTestId("notes-menu-delete").click();
  await page.getByRole("button", { name: "Отмена" }).click();
  await expect(page.getByTestId(`notes-project-${alpha.id}`)).toBeVisible();
  await page.getByTestId(`notes-project-more-${alpha.id}`).click();
  await page.getByTestId("notes-menu-delete").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId(`notes-project-${alpha.id}`)).toHaveCount(0);
  expect((await api(page, "GET", `/api/notes/projects/${alpha.id}`)).status).toBe(404);
});

// ------------------------------------------------------------------ editor + regression

test("Regression: writing is never thrown back to Projects (saves, focus changes, server events, other documents changing)", async ({ page }) => {
  await signUpViaApi(page, "Вера", "Пишет");
  const s = await seed(page, "Работа", [{ name: "Черновик" }, { name: "Другая" }]);
  await openApp(page, "notes");
  await openProject(page, "Работа");
  await openDoc(page, "Черновик");
  const doc = page.getByTestId("notes-doc");
  await expect(doc).toHaveAttribute("data-doc", s.docs[0]!.id);
  await blocks(page).first().click();
  await page.keyboard.type("Первая строка");
  await saved(page);
  // Things that used to reload Notes and reset where it was:
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const other = s.docs[1]!;
  expect((await api(page, "PUT", `/api/notes/documents/${other.id}`, { data: note("Изменено где-то ещё"), revision: other.revision })).status).toBe(200);
  await api(page, "PUT", "/api/notes/prefs", { docsView: "list" });
  await api(page, "PATCH", `/api/notes/projects/${s.project}`, { name: "Работа 2" });
  await page.keyboard.type(" и дальше");
  await saved(page);
  await page.waitForTimeout(1500);
  await expect(doc).toHaveAttribute("data-doc", s.docs[0]!.id);
  await expect(page.getByTestId("notes-app")).toHaveAttribute("data-screen", "doc");
  await expect(blocks(page).first()).toHaveValue("Первая строка и дальше");
  // Back goes to the project (not Projects), then to Projects.
  await page.getByTestId("notes-back").click();
  await expect(page.getByTestId("notes-app")).toHaveAttribute("data-screen", "project");
  await page.getByTestId("notes-back").click();
  await expect(page.getByTestId("notes-app")).toHaveAttribute("data-screen", "projects");
  // Stored on the server.
  expect(JSON.stringify((await api(page, "GET", `/api/notes/documents/${s.docs[0]!.id}`)).body.data)).toContain("Первая строка и дальше");
});

test("Note editor: clean paper, Markdown-style blocks, unlimited sheet, square pages sideways, new page / split here, pictures", async ({ page }) => {
  await signUpViaApi(page, "Лев", "Лист");
  const s = await seed(page, "Тексты", [{ name: "Длинная" }]);
  await openApp(page, "notes");
  await openProject(page, "Тексты");
  await openDoc(page, "Длинная");
  await blocks(page).first().click();
  await page.keyboard.type("# Заголовок");
  await page.keyboard.press("Enter");
  for (let i = 1; i <= 30; i++) {
    await page.keyboard.type(`Абзац ${i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("- пункт");
  await expect(page.locator('[data-block][data-kind="heading"]')).toHaveCount(1);
  await expect(page.locator('[data-block][data-kind="bullet"]')).toHaveCount(1);
  // No page-break button; no grid or block frames.
  await expect(page.getByTestId("notes-page-break")).toHaveCount(0);
  const border = await blocks(page).nth(1).evaluate((el) => getComputedStyle(el).borderTopWidth + getComputedStyle(el.parentElement!).borderTopWidth);
  expect(border).toBe("0px0px");
  // Vertical with one page: one sheet that grows (no 1 / 1 over the text).
  await expect(page.getByTestId("notes-note-editor")).toHaveAttribute("data-pages", "1");
  await expect(page.getByTestId("notes-page-nav")).toHaveAttribute("data-compact", "true");

  // Square: pages sideways, the text flows on; ‹ › and the indicator.
  await docMenu(page, "format-square");
  await expect(page.getByTestId("notes-note-editor")).toHaveAttribute("data-format", "square");
  await expect(page.getByTestId("notes-page-indicator")).toHaveText(/^1 \/ ([2-9]|\d{2})$/);
  await page.getByTestId("notes-page-next").click();
  await expect(page.getByTestId("notes-page-indicator")).toHaveText(/^2 \//);
  await expect.poll(() => page.getByTestId("notes-paper-scroller").evaluate((e) => e.scrollLeft)).toBeGreaterThan(100);
  // The wheel turns square pages sideways.
  const scroller = page.getByTestId("notes-paper-scroller");
  const before = await scroller.evaluate((e) => e.scrollLeft);
  await scroller.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scroller.evaluate((e) => e.scrollLeft)).not.toBe(before);

  // Back to vertical: nothing lost.
  await docMenu(page, "format-vertical");
  await expect(blocks(page)).toHaveCount(32);

  // Split here: the focused paragraph starts page 2.
  await blocks(page).nth(5).click();
  await page.getByTestId("notes-page-add").click();
  await page.getByTestId("notes-menu-page-split").click();
  await expect(page.getByTestId("notes-note-editor")).toHaveAttribute("data-pages", "2");
  await expect(page.getByTestId("notes-page-indicator")).toHaveText(/\/ 2$/);
  // + New page.
  await page.getByTestId("notes-page-add").click();
  await page.getByTestId("notes-menu-page-new").click();
  await expect(page.getByTestId("notes-note-editor")).toHaveAttribute("data-pages", "3");

  // A picture: upload, half width, right, remove.
  await blocks(page).first().click();
  await page.getByTestId("notes-image-file").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: PNG });
  const img = page.getByTestId("notes-image-block");
  await expect(img).toHaveCount(1);
  await expect(img.getByTestId("notes-image")).toBeVisible();
  await page.getByTestId("notes-image-w50").click();
  await page.getByTestId("notes-image-right").click();
  await expect(img).toHaveAttribute("data-width", "50");
  await expect(img).toHaveAttribute("data-align", "right");
  await saved(page);
  const stored = JSON.stringify((await api(page, "GET", `/api/notes/documents/${s.docs[0]!.id}`)).body.data);
  expect(stored).toMatch(/"kind":"image","text":"","src":"\/api\/notes\/media\?id=[0-9a-f-]{36}","width":50,"align":"right"|"width":50/);
  expect((await api(page, "GET", `/api/notes/documents/${s.docs[0]!.id}`)).body.data.pages).toHaveLength(3);
  await page.getByTestId("notes-image-remove").click();
  await expect(img).toHaveCount(0);
  // Undo brings it back.
  await page.getByTestId("notes-undo").click();
  await expect(img).toHaveCount(1);
});

test("Two people editing the same note: no silent overwrite — the second save shows the conflict, either version can win", async ({ page, browser }) => {
  await signUpViaApi(page, "Кира", "Конфликт");
  const s = await seed(page, "Общий", [{ name: "Спорная", data: note("Заголовок", "Исходный текст") }]);
  await openApp(page, "notes");
  await openProject(page, "Общий");
  await openDoc(page, "Спорная");
  // The same account saves from "another device" first.
  const d = (await api(page, "GET", `/api/notes/documents/${s.docs[0]!.id}`)).body;
  // While I have unsaved typing: hold my save by typing right after theirs lands.
  await blocks(page).nth(1).click();
  await page.keyboard.press("End");
  expect((await api(page, "PUT", `/api/notes/documents/${d.id}`, { data: note("Заголовок", "Их версия"), revision: d.revision })).status).toBe(200);
  await page.keyboard.type(" + моя правка");
  await expect(page.getByTestId("notes-conflict")).toBeVisible({ timeout: 15_000 });
  expect(JSON.stringify((await api(page, "GET", `/api/notes/documents/${d.id}`)).body.data)).toContain("Их версия");
  await page.getByTestId("notes-conflict-mine").click();
  await expect(page.getByTestId("notes-conflict")).toHaveCount(0);
  await saved(page);
  expect(JSON.stringify((await api(page, "GET", `/api/notes/documents/${d.id}`)).body.data)).toContain("Исходный текст + моя правка");
  void browser;
});

// ------------------------------------------------------------------ sharing

test("Share a COPY in Vibex: a .txt card in the chat; the recipient adds their own independent copy", async ({ page, browser }) => {
  test.skip(isMobile(page), "two windows side by side: PC");
  const { other } = await twoPeople(page, browser);
  const s = await seed(page, "Идеи", [{ name: "План", data: note("План", "Секретный текст") }]);
  await openApp(page, "notes");
  await openProject(page, "Идеи");
  await openDoc(page, "План");
  await page.getByTestId("notes-doc-share").click();
  await expect(page.getByTestId("notes-share-file")).toHaveText("План.txt");
  await page.getByTestId("notes-share-app-vibex").click();
  await page.getByTestId("notes-share-contact").filter({ hasText: "Борис" }).click();
  await page.getByTestId("notes-share-send").click();
  await expect(page.getByTestId("notes-share-sheet")).toHaveCount(0);

  // B: the card in Vibex → Notes → add a copy.
  await openApp(other, "vibex");
  await other.getByTestId("vibex-nav-chats").click();
  await other.getByTestId("chat-row").first().click();
  const card = other.getByTestId("notes-card");
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("notes-card-title")).toHaveText("План.txt");
  await card.click();
  await expect(other.getByTestId("notes-share-landing")).toHaveAttribute("data-state", "copy");
  await other.getByTestId("notes-share-add").click();
  await expect(other.getByTestId("notes-doc")).toBeVisible();
  await expect(other.getByTestId("notes-doc")).toHaveAttribute("data-role", "owner");
  await expect(other.getByTestId("notes-block").nth(1)).toHaveValue("Секретный текст");
  // Independent: B's edit does not touch A's original.
  await other.getByTestId("notes-block").nth(1).click();
  await other.keyboard.type(" (B)");
  await expect(other.getByTestId("notes-save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
  expect(JSON.stringify((await api(page, "GET", `/api/notes/documents/${s.docs[0]!.id}`)).body.data)).not.toContain("(B)");
  // A copy never gives B the original.
  expect((await api(other, "GET", `/api/notes/documents/${s.docs[0]!.id}`)).status).toBe(404);
  await other.context().close();
});

test("Share with editing allowed: B edits the original live; Viewer makes B read-only; removing B closes it at once with Access restricted and the server refuses writes", async ({ page, browser }) => {
  test.skip(isMobile(page), "two windows side by side: PC");
  const { b, other } = await twoPeople(page, browser);
  const s = await seed(page, "Команда", [{ name: "Общая", data: note("Общая", "Начало") }]);
  const docId = s.docs[0]!.id;
  await openApp(page, "notes");
  await openProject(page, "Команда");
  await openDoc(page, "Общая");
  await page.getByTestId("notes-doc-share").click();
  await page.getByTestId("notes-share-edit").getByRole("switch").click();
  await page.getByTestId("notes-share-app-vibex").click();
  await page.getByTestId("notes-share-contact").filter({ hasText: "Борис" }).click();
  await page.getByTestId("notes-share-send").click();
  await expect(page.getByTestId("notes-share-sheet")).toHaveCount(0);

  // B opens the original from the card (no copy).
  await openApp(other, "vibex");
  await other.getByTestId("vibex-nav-chats").click();
  await other.getByTestId("chat-row").first().click();
  await other.getByTestId("notes-card").click();
  await expect(other.getByTestId("notes-share-landing")).toHaveAttribute("data-state", "access");
  await other.getByTestId("notes-share-open").click();
  const bDoc = other.getByTestId("notes-doc");
  await expect(bDoc).toHaveAttribute("data-doc", docId);
  await expect(bDoc).toHaveAttribute("data-role", "editor");
  await other.getByTestId("notes-block").nth(1).click();
  await other.keyboard.press("End");
  await other.keyboard.type(" — от Бориса");
  await expect(other.getByTestId("notes-save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
  // A sees it arrive (server event, no reload).
  await expect(page.getByTestId("notes-block").nth(1)).toHaveValue("Начало — от Бориса", { timeout: 15_000 });

  // Users: A makes B a Viewer → B's editor turns read-only.
  // PC: the window "…" (app actions + window actions); phones: the app's own "…" (Step 2.7).
  await page.getByTestId("notes-doc").getByTestId(/^(window-menu|notes-more)$/).click();
  await page.getByTestId("notes-menu-users").click();
  const row = page.locator(`[data-testid="notes-member"][data-user="${b.id}"]`);
  await expect(row).toHaveAttribute("data-role", "editor");
  await row.getByTestId("notes-member-viewer").click();
  await expect(row).toHaveAttribute("data-role", "viewer");
  await expect(bDoc).toHaveAttribute("data-role", "viewer", { timeout: 15_000 });
  await expect(other.getByTestId("notes-save-status")).toHaveAttribute("data-status", "readonly");
  await expect(other.getByTestId("notes-block").nth(1)).toHaveAttribute("readonly", "");
  const cur = (await api(other, "GET", `/api/notes/documents/${docId}`)).body;
  expect((await api(other, "PUT", `/api/notes/documents/${docId}`, { data: note("x"), revision: cur.revision })).status).toBe(403);

  // A removes B → B's editor closes now, with the explanation; the server refuses B.
  await row.getByTestId("notes-member-remove").click();
  await expect(row).toHaveCount(0);
  await expect(other.getByTestId("notes-access-closed")).toBeVisible({ timeout: 15_000 });
  await expect(other.getByTestId("notes-access-closed")).toContainText("Доступ ограничен");
  await expect(other.getByTestId("notes-access-closed")).toContainText("Владелец больше не предоставляет вам доступ");
  await expect(other.getByTestId("notes-doc")).toHaveCount(0);
  await other.getByTestId("notes-access-closed-ok").click();
  expect((await api(other, "GET", `/api/notes/documents/${docId}`)).status).toBe(404);
  expect((await api(other, "PUT", `/api/notes/documents/${docId}`, { data: note("x"), revision: cur.revision })).status).toBe(404);
  await other.context().close();
});

test("Share a project by VoidOps Mail: the letter carries a .txt card; deleting the original tells people with access and the card then says so", async ({ page, browser }) => {
  test.skip(isMobile(page), "two windows side by side: PC");
  const { b, other } = await twoPeople(page, browser);
  const s = await seed(page, "Отчёты", [{ name: "Q3" }, { name: "Слайды", kind: "presentation" }]);
  await openApp(page, "notes");
  await expect(page.getByTestId(`notes-project-${s.project}`)).toBeVisible();
  await page.getByTestId(`notes-project-more-${s.project}`).click();
  await page.getByTestId("notes-menu-share").click();
  await expect(page.getByTestId("notes-share-file")).toHaveText("Отчёты.txt");
  await page.getByTestId("notes-share-edit").getByRole("switch").click();
  await page.getByTestId("notes-share-app-mail").click();
  await page.getByTestId("notes-share-search").fill(b.address);
  // The contact is the person (shown by name from the chat), addressed by their VoidOps Mail address.
  await page.locator(`[data-testid="notes-share-contact"][title="${b.address.toLowerCase()}"]`).click();
  await page.getByTestId("notes-share-send").click();
  await expect(page.getByTestId("notes-share-sheet")).toHaveCount(0);

  await openApp(other, "mail");
  await other.getByTestId("thread-row").first().click();
  const card = other.getByTestId("message-notes-cards").getByTestId("notes-card");
  await expect(card).toHaveAttribute("data-kind", "project");
  await expect(card.getByTestId("notes-card-title")).toHaveText("Отчёты.txt");
  await card.click();
  await expect(other.getByTestId("notes-share-landing")).toHaveAttribute("data-state", "access");
  await other.getByTestId("notes-share-open").click();
  await expect(other.getByTestId("notes-project")).toHaveAttribute("data-project", s.project);
  // The presentation in it is a .prsn.
  await expect(other.getByTestId(`notes-doc-${s.docs[1]!.id}`)).toContainText("Слайды");

  // A deletes the project → B (who is in it) is told at once.
  expect((await api(page, "DELETE", `/api/notes/projects/${s.project}`)).status).toBe(200);
  await expect(other.getByTestId("notes-access-closed")).toBeVisible({ timeout: 15_000 });
  await expect(other.getByTestId("notes-access-closed")).toContainText("Отчёты");
  await other.getByTestId("notes-access-closed-ok").click();
  await expect(other.getByTestId("notes-app")).toHaveAttribute("data-screen", "projects");
  await other.context().close();
});

test("Deep links: #notes/doc/<id> opens my note; someone else's note (or a revoked link) says access is restricted", async ({ page, browser }) => {
  await signUpViaApi(page, "Дина", "Ссылка");
  const s = await seed(page, "Ссылки", [{ name: "Цель", data: note("Цель", "Текст по ссылке") }]);
  await page.evaluate((id) => (window.location.hash = `#notes/doc/${id}`), s.docs[0]!.id);
  await expect(page.getByTestId("notes-doc")).toHaveAttribute("data-doc", s.docs[0]!.id);
  await expect(page.getByTestId("notes-block").nth(1)).toHaveValue("Текст по ссылке");
  await page.evaluate((id) => (window.location.hash = `#notes/project/${id}`), s.project);
  await expect(page.getByTestId("notes-project")).toHaveAttribute("data-project", s.project);

  const other = await newPage(browser, isMobile(page));
  await signUpViaApi(other, "Чужой", "Человек");
  await other.evaluate((id) => (window.location.hash = `#notes/doc/${id}`), s.docs[0]!.id);
  await expect(other.getByTestId("notes-doc-denied")).toBeVisible();
  // A copy link that was revoked.
  const share = (await api(page, "POST", "/api/notes/shares", { resourceType: "document", resourceId: s.docs[0]!.id, mode: "copy" })).body;
  expect(share.token).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  expect((await api(page, "DELETE", `/api/notes/shares/${share.token}`)).status).toBe(200);
  await other.evaluate((t) => (window.location.hash = `#notes/share/${t}`), share.token);
  await expect(other.getByTestId("notes-share-landing")).toHaveAttribute("data-state", "denied");
  await other.context().close();
});

// ------------------------------------------------------------------ presentations

test("Presentations: slides, layers, transitions, 16:9 ↔ 1:1 with an overflow warning, fullscreen show with arrows; a note turns into a presentation and stays", async ({ page }) => {
  await signUpViaApi(page, "Пётр", "Слайд");
  const s = await seed(page, "Доклад", [{ name: "Тезисы", data: note("Введение", "Первый тезис", "Второй тезис") }]);
  await openApp(page, "notes");
  await openProject(page, "Доклад");
  await page.getByTestId("notes-add").click();
  await page.getByTestId("notes-menu-new-presentation").click();
  const ed = page.getByTestId("notes-pres-editor");
  await expect(ed).toHaveAttribute("data-slides", "1");
  await expect(ed).toHaveAttribute("data-format", "rect");
  // Type the title on the slide.
  const title = page.getByTestId("notes-layer").first();
  await title.click();
  await title.click();
  await page.getByTestId("notes-layer-input").fill("Доклад VOIDEX");
  await page.getByTestId("notes-pres-add-slide").click();
  await expect(ed).toHaveAttribute("data-slides", "2");
  // Sidebar (phones: open it).
  if (isMobile(page)) await page.getByTestId("notes-pres-panel").click();
  await page.getByTestId("notes-pres-tab-transitions").click();
  await page.getByTestId("notes-transition-slide").click();
  await expect(page.getByTestId("notes-transition-slide")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("notes-pres-tab-layers").click();
  await expect(page.getByTestId("notes-layer-row")).toHaveCount(2);
  await page.getByTestId("notes-layer-row").first().getByTestId("notes-layer-hide").click();
  await expect(page.locator('[data-testid="notes-layer"]')).toHaveCount(1);
  // A long text that fits 16:9 but not 1:1 → warning after switching.
  await page.getByTestId("notes-pres-add-text").click();
  await page.getByTestId("notes-layer-input").fill("Очень длинный текст слайда. ".repeat(14));
  // PC: the window "…" (app actions + window actions); phones: the app's own "…" (Step 2.7).
  await page.getByTestId("notes-doc").getByTestId(/^(window-menu|notes-more)$/).click();
  await page.getByTestId("notes-menu-format-square").click();
  await expect(ed).toHaveAttribute("data-format", "square");
  await expect(page.getByTestId("notes-slide-overflow")).toBeVisible();
  await expect(page.getByTestId("toast").filter({ hasText: "Формат изменён" })).toBeVisible();
  await expect(page.getByTestId("notes-save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });

  // The show: fullscreen viewer, arrows, Esc.
  await page.getByTestId("notes-pres-play").click();
  const viewer = page.getByTestId("notes-pres-viewer");
  await expect(viewer).toBeVisible();
  const startAt = Number(await viewer.getAttribute("data-index"));
  await page.keyboard.press("ArrowLeft");
  await expect(viewer).toHaveAttribute("data-index", String(Math.max(0, startAt - 1)));
  await page.keyboard.press("ArrowRight");
  await expect(viewer).toHaveAttribute("data-index", String(startAt === 0 ? 1 : startAt));
  await expect(page.getByTestId("notes-viewer-indicator")).toHaveText(/ \/ 2$/);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  // Note → Presentation: a new .prsn; the note is untouched.
  await page.getByTestId("notes-back").click();
  await page.getByTestId(`notes-doc-more-${s.docs[0]!.id}`).click();
  await page.getByTestId("notes-menu-to-presentation").click();
  await expect(page.getByTestId("notes-pres-editor")).toBeVisible();
  const docs = (await api(page, "GET", `/api/notes/projects/${s.project}`)).body.documents;
  expect(docs.filter((d: { kind: string }) => d.kind === "presentation")).toHaveLength(2);
  const converted = docs.find((d: { kind: string; name: string }) => d.kind === "presentation" && d.name === "Тезисы");
  const body = (await api(page, "GET", `/api/notes/documents/${converted.id}`)).body.data;
  expect(JSON.stringify(body)).toContain("Первый тезис");
  expect((await api(page, "GET", `/api/notes/documents/${s.docs[0]!.id}`)).body.kind).toBe("note");
});

// ------------------------------------------------------------------ desktop settings

test("Settings → Desktop: dock separators off by default and switchable; a second line for names only while names are shown", async ({ page }) => {
  await signUpViaApi(page, "Ада", "Док");
  if (!isMobile(page)) await expect(page.getByTestId("dock-separator")).toHaveCount(0);
  await expect(page.getByTestId("home-label").first()).toHaveAttribute("data-lines", "1");
  await openApp(page, "settings");
  await page.locator('[data-testid="settings-nav-desktop"]:visible').first().click();
  const two = page.getByTestId("label-two-lines");
  await two.getByRole("switch").click();
  await expect(two.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  if (!isMobile(page)) {
    await page.getByTestId("dock-separators-setting").getByRole("switch").click();
    await expect(page.getByTestId("dock-separator")).toHaveCount(1);
  }
  await expect(page.getByTestId("home-label").first()).toHaveAttribute("data-lines", "2");
  // Names off → the second-line switch is disabled.
  await page.getByTestId("show-labels").getByRole("switch").click();
  await expect(two.getByRole("switch")).toBeDisabled();
  await expect(two).toHaveAttribute("data-disabled", "true");
});
