import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs, newPage, openApp, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Step 2.13 — Notes: pictures side by side in a row (resize, reorder, back
 * to a line of their own), text flowing around a picture, the block style
 * selector (Обычный, Заголовок, Подзаголовок, Заголовок 2, Цитата). Books
 * (.book): a new document type on the Notes infrastructure with spreads,
 * pages added only by «+», ← / → navigation, text sizes, pictures, reading
 * mode, sharing (copy / editing) and Files.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJklEQVR4nGNkYPj/n4EIwESMolGF1FfIwsDAwMDw/z8DIyMjIwMDAAF+BgRlb3ugAAAAAElFTkSuQmCC", "base64");
const blocks = (page: Page) => page.getByTestId("notes-block");
const saved = (page: Page) => expect(page.getByTestId("notes-save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });

async function seed(page: Page, project: string, doc: { name: string; kind: "note" | "book" }) {
  const p = (await apiAs(page, "POST", "/api/notes/projects", { name: project })).body;
  const d = (await apiAs(page, "POST", `/api/notes/projects/${p.id}/documents`, { kind: doc.kind, name: doc.name })).body;
  return { project: p.id as string, doc: d.id as string };
}
async function openDoc(page: Page, project: string, name: string) {
  if (!(await page.locator('[data-testid="window-notes"][data-state="open"]').count())) await openApp(page, "notes");
  await page.getByTestId("notes-project-list").getByTestId("notes-card-name").getByText(project, { exact: true }).first().click();
  await page.getByTestId("notes-doc-list").getByTestId("notes-card-name").getByText(name, { exact: true }).first().click();
  await expect(page.getByTestId("notes-doc")).toBeVisible();
}
const box = async (page: Page, testId: string, n = 0) => (await page.getByTestId(testId).nth(n).boundingBox())!;

test("Notes: block styles from the toolbar selector, pictures side by side (reorder, back to own line), text around a picture; kept after reload", async ({ page }) => {
  await signUpViaApi(page, "Нина", "Картинки");
  const s = await seed(page, "Оформление", { name: "Статья", kind: "note" });
  await openDoc(page, "Оформление", "Статья");
  await blocks(page).first().click();
  await page.keyboard.type("Раздел второго уровня");
  // The selector names the current style and lists the five styles (and code).
  await expect(page.getByTestId("notes-tool-style")).toContainText("Обычный");
  await page.getByTestId("notes-tool-style").click();
  for (const k of ["text", "heading", "subheading", "heading2", "quote"]) await expect(page.getByTestId(`notes-menu-style-${k}`)).toBeVisible();
  await page.getByTestId("notes-menu-style-heading2").click();
  const head = page.locator('[data-block][data-kind="heading2"]').first();
  await expect(head).toHaveAttribute("role", "heading");
  await expect(head).toHaveAttribute("aria-level", "3");
  await expect(page.getByTestId("notes-tool-style")).toContainText("Заголовок 2");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Абзац");
  await page.getByTestId("notes-tool-style").click();
  await page.getByTestId("notes-menu-style-quote").click();
  await expect(page.locator('[data-block][data-kind="quote"]')).toHaveCount(1);

  // Two pictures at once, then side by side.
  await page.getByTestId("notes-image-file").setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: PNG },
    { name: "b.png", mimeType: "image/png", buffer: PNG },
  ]);
  const imgs = page.getByTestId("notes-image-block");
  await expect(imgs).toHaveCount(2);
  const [idA, idB] = await imgs.evaluateAll((els) => els.map((e) => e.getAttribute("data-block")!));
  await page.getByTestId("notes-image").nth(1).click();
  await expect(page.getByTestId("notes-image-tools")).toBeVisible();
  await page.getByTestId("notes-image-join").click();
  const row = page.getByTestId("notes-image-row");
  await expect(row).toHaveAttribute("data-count", "2");
  let a = await box(page, "notes-image-block", 0);
  let b = await box(page, "notes-image-block", 1);
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  // Resize one picture in the row: its share changes, the other keeps its own.
  await page.getByTestId("notes-image-w25").click();
  await expect(imgs.nth(1)).toHaveAttribute("data-width", "25");
  b = await box(page, "notes-image-block", 1);
  a = await box(page, "notes-image-block", 0);
  expect(b.width).toBeLessThan(a.width);
  // Reorder inside the row (the selected one moves left).
  await page.getByTestId("notes-image-up").click();
  await expect.poll(() => imgs.evaluateAll((els) => els.map((e) => e.getAttribute("data-block")))).toEqual([idB, idA]);
  await expect(row).toHaveCount(1);
  // Back to a line of its own: no row left.
  await page.getByTestId("notes-image-leave").click();
  await expect(row).toHaveCount(0);

  // Text around a picture: left, flowing; the words stand beside it, never under it.
  await page.getByTestId("notes-image").first().click();
  await page.getByTestId("notes-image-left").click();
  await page.getByTestId("notes-image-wrap").click();
  const wrapped = imgs.first();
  await expect(wrapped).toHaveAttribute("data-wrap", "true");
  const after = page.locator('[data-testid="notes-image-block"][data-wrap="true"] ~ [data-kind="text"]').first();
  await after.locator("textarea").click();
  await page.keyboard.type("Слова рядом с картинкой ");
  const pic = (await wrapped.locator("img").boundingBox())!;
  const text = (await after.boundingBox())!;
  expect(text.x).toBeGreaterThanOrEqual(pic.x + pic.width - 1);
  expect(text.y).toBeLessThan(pic.y + pic.height);
  await saved(page);

  // Stored in the document model; kept after a reload.
  const stored = (await apiAs(page, "GET", `/api/notes/documents/${s.doc}`)).body.data.pages[0].blocks;
  expect(stored.find((x: { kind: string }) => x.kind === "heading2")).toBeTruthy();
  expect(stored.find((x: { wrap?: boolean }) => x.wrap)).toMatchObject({ align: "left", wrap: true });
  await reloadUnlocked(page);
  await openDoc(page, "Оформление", "Статья");
  await expect(page.locator('[data-testid="notes-image-block"][data-wrap="true"]')).toHaveCount(1);
  await expect(page.locator('[data-block][data-kind="heading2"]')).toHaveCount(1);
});

async function twoPeople(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Анна", "Писатель");
  const other = await newPage(browser, false);
  const b = await signUpViaApi(other, "Борис", "Читатель");
  const chat = (await apiAs(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  expect((await apiAs(other, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет" })).status).toBe(201);
  return { a, b, other };
}

test("Book: create, write a heading and text, text size, a picture beside another, add a page and a spread, ← →, reload, reading mode and back", async ({ page }) => {
  await signUpViaApi(page, "Вера", "Книжная");
  await apiAs(page, "POST", "/api/notes/projects", { name: "Библиотека" });
  await openApp(page, "notes");
  await page.getByTestId("notes-project-list").getByTestId("notes-card-name").getByText("Библиотека", { exact: true }).click();
  // «+» offers Note, Presentation and Book.
  await page.getByTestId("notes-add").click();
  await expect(page.getByTestId("notes-menu-new-note")).toBeVisible();
  await expect(page.getByTestId("notes-menu-new-presentation")).toBeVisible();
  await page.getByTestId("notes-menu-new-book").click();
  const editor = page.getByTestId("notes-book-editor");
  await expect(editor).toBeVisible();
  await expect(page.getByTestId("notes-doc")).toHaveAttribute("data-kind", "book");
  // A new book opens on its first spread; on a phone one page is shown at a time.
  await expect(editor).toHaveAttribute("data-pages", "2");
  const per = (await editor.getAttribute("data-spread")) === "two" ? 2 : 1;
  await expect(page.getByTestId("book-page")).toHaveCount(per);
  await expect(page.getByTestId("book-page-number").first()).toHaveText("1");

  await blocks(page).first().click();
  await page.keyboard.type("Глава первая");
  await page.getByTestId("notes-tool-style").click();
  await page.getByTestId("notes-menu-style-heading").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Было раннее утро.");
  // Text sizes 12 … 32.
  await page.getByTestId("notes-tool-size").click();
  for (const n of [12, 14, 16, 18, 20, 24, 32]) await expect(page.getByTestId(`notes-menu-size-${n}`)).toBeVisible();
  await page.getByTestId("notes-menu-size-24").click();
  await expect(page.locator('[data-kind="text"][data-size="24"]')).toHaveCount(1);
  await page.getByTestId("notes-tool-bold").click();
  // Pictures: two, side by side.
  await page.getByTestId("notes-image-file").setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: PNG },
    { name: "b.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(page.getByTestId("notes-image-block")).toHaveCount(2);
  await page.getByTestId("notes-image").nth(1).click();
  await page.getByTestId("notes-image-join").click();
  await expect(page.getByTestId("notes-image-row")).toHaveAttribute("data-count", "2");
  // Text around a picture is the same as in notes.
  await page.getByTestId("notes-image-leave").click();
  await page.getByTestId("notes-image").first().click();
  await page.getByTestId("notes-image-right").click();
  await page.getByTestId("notes-image-wrap").click();
  await expect(page.locator('[data-testid="notes-image-block"][data-wrap="true"]')).toHaveCount(1);
  await blocks(page).first().click();

  // Pages only come from «+»: a page, then a spread.
  await page.getByTestId("notes-page-add").click();
  await page.getByTestId("notes-menu-page-new").click();
  await expect(editor).toHaveAttribute("data-pages", "3");
  await page.getByTestId("notes-page-add").click();
  await page.getByTestId("notes-menu-spread-new").click();
  await expect(editor).toHaveAttribute("data-pages", "5");
  await expect(page.getByTestId("notes-page-indicator")).toContainText("/ 5");
  // ← → turn pages (a spread at a time on wide screens).
  // The new spread is shown; go back to the start.
  await expect(editor).not.toHaveAttribute("data-first", "0");
  for (let i = 0; i < 4 && (await page.getByTestId("notes-page-prev").isEnabled()); i++) await page.getByTestId("notes-page-prev").click();
  await expect(editor).toHaveAttribute("data-first", "0");
  await expect(page.getByTestId("notes-page-prev")).toBeDisabled();
  await page.getByTestId("notes-page-next").click();
  await expect(editor).toHaveAttribute("data-first", String(per));
  await expect(page.getByTestId("book-page-number").first()).toHaveText(String(per + 1));
  // Only the shown pages are in the page (not the whole book).
  await expect(page.getByTestId("book-page")).toHaveCount(per);
  await page.getByTestId("notes-page-prev").click();
  await saved(page);

  // Reload: nothing lost.
  await reloadUnlocked(page);
  await openDoc(page, "Библиотека", "Новая книга");
  await expect(page.getByTestId("notes-book-editor")).toHaveAttribute("data-pages", "5");
  await expect(blocks(page).first()).toHaveValue("Глава первая");
  await expect(page.locator('[data-kind="text"][data-size="24"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="notes-image-block"][data-wrap="true"]')).toHaveCount(1);

  // Reading mode: no toolbar, no fields; real headings; arrows, keys, swipe; back to editing.
  await page.getByTestId("notes-book-read").click();
  const reader = page.getByTestId("book-reader");
  await expect(reader).toBeVisible();
  await expect(page.getByTestId("notes-toolbar")).toHaveCount(0);
  await expect(reader.locator("textarea")).toHaveCount(0);
  await expect(reader.getByRole("heading", { level: 2, name: "Глава первая" })).toBeVisible();
  await expect(reader.locator('[data-kind="text"]').first()).toHaveCSS("font-size", "24px");
  await expect(page.getByTestId("book-reader-indicator")).toContainText("/ 5");
  await page.getByTestId("book-reader-next").click();
  await expect(reader).toHaveAttribute("data-first", String(per));
  await page.keyboard.press("ArrowLeft");
  await expect(reader).toHaveAttribute("data-first", "0");
  await page.keyboard.press("ArrowRight");
  await expect(reader).toHaveAttribute("data-first", String(per));
  await page.keyboard.press("Home");
  await expect(reader).toHaveAttribute("data-first", "0");
  await page.getByTestId("book-reader-edit").click();
  await expect(reader).toHaveCount(0);
  await expect(page.getByTestId("notes-book-editor")).toBeVisible();
  await expect(page.getByTestId("notes-toolbar")).toBeVisible();
  // Edit → read → edit again works.
  await page.getByTestId("notes-book-read").click();
  await expect(page.getByTestId("book-reader")).toBeVisible();
  await page.getByTestId("book-reader-edit").click();
  await expect(page.getByTestId("notes-book-editor")).toBeVisible();

  // .txt / .prsn keep working beside books.
  await page.getByTestId("notes-back").click();
  await page.getByTestId("notes-add").click();
  await page.getByTestId("notes-menu-new-note").click();
  await expect(page.getByTestId("notes-note-editor")).toBeVisible();
});

test("Book (phone): swipe turns the pages in reading mode", async ({ page }) => {
  test.skip(!isMobile(page), "phone swipe");
  await signUpViaApi(page, "Свайп", "Страниц");
  await seed(page, "Чтение", { name: "Повесть", kind: "book" });
  await openDoc(page, "Чтение", "Повесть");
  await page.getByTestId("notes-book-read").click();
  const reader = page.getByTestId("book-reader");
  await expect(reader).toHaveAttribute("data-spread", "one");
  const st = (await page.getByTestId("book-reader-stage").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = st.y + st.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: st.x + st.width - 40, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: st.x + st.width - 40 - i * 25, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(reader).toHaveAttribute("data-first", "1");
  await expect(page.getByTestId("book-reader-indicator")).toHaveText("2 / 2");
});

test("Book sharing: a .book card; a copy for one person, editing for another; Files recognises .book", async ({ page, browser }) => {
  test.skip(isMobile(page), "two windows side by side: PC");
  const { other } = await twoPeople(page, browser);
  const s = await seed(page, "Рукописи", { name: "Роман", kind: "book" });
  await openDoc(page, "Рукописи", "Роман");
  await blocks(page).first().click();
  await page.keyboard.type("Первая строка романа");
  await saved(page);
  await page.getByTestId("notes-doc-share").click();
  await expect(page.getByTestId("notes-share-file")).toHaveText("Роман.book");
  await page.getByTestId("notes-share-edit").getByRole("switch").click();
  await page.getByTestId("notes-share-app-vibex").click();
  await page.getByTestId("notes-share-contact").filter({ hasText: "Борис" }).click();
  await page.getByTestId("notes-share-send").click();
  await expect(page.getByTestId("notes-share-sheet")).toHaveCount(0);

  // B: the card is a .book; it opens the original as an editor.
  await openApp(other, "vibex");
  await other.getByTestId("vibex-nav-chats").click();
  await other.getByTestId("chat-row").first().click();
  const card = other.getByTestId("notes-card");
  await expect(card).toHaveAttribute("data-kind", "book");
  await expect(card.getByTestId("notes-card-title")).toHaveText("Роман.book");
  await card.click();
  await expect(other.getByTestId("notes-share-landing")).toHaveAttribute("data-state", "access");
  await other.getByTestId("notes-share-open").click();
  await expect(other.getByTestId("notes-doc")).toHaveAttribute("data-role", "editor");
  await expect(other.getByTestId("notes-book-editor")).toBeVisible();
  await other.getByTestId("notes-block").first().click();
  await other.keyboard.press("End");
  await other.keyboard.type(", дописал Борис");
  await expect(other.getByTestId("notes-save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
  await expect(page.getByTestId("notes-block").first()).toHaveValue("Первая строка романа, дописал Борис", { timeout: 15_000 });

  // Files: the book saved as a file is recognised as .book (filter, preview, read-only pages).
  await page.getByTestId("notes-doc").getByTestId(/^(window-menu|notes-more)$/).click();
  await page.getByTestId("notes-menu-book-files").click();
  await expect(page.locator('[data-testid="window-files"][data-state="open"]')).toBeVisible();
  await expect(page.getByTestId("files-book")).toBeVisible();
  await expect(page.getByTestId("files-book")).toContainText("Первая строка романа, дописал Борис");
  await expect(page.getByTestId("files-book-indicator")).toHaveText("1 / 2");
  await page.keyboard.press("Escape");
  const chip = page.getByRole("tab", { name: ".book", exact: true });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByText("Роман.book").first()).toBeVisible();
  expect(s.doc).toBeTruthy();
  await other.context().close();
});
