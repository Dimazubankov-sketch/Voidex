import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, reloadUnlocked, signUpViaApi } from "./helpers";
import { notesApiCall, notesSaved, openNotesDoc, pngOf, seedNotes } from "./notes-helpers";

/** Stage D: notes — text and pictures in one flow (D1–D9). */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
let uploaded: string[] = [];

/** Pictures already on the server (so seeded notes can point at real media). */
async function media(page: Page, n: number) {
  uploaded = [];
  for (let i = 0; i < n; i++) {
    const id = await page.evaluate(async (b64) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const res = await fetch("/api/notes/media", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "image/png", Authorization: `Bearer ${accessToken}` }, body: bytes });
      return (await res.json()).url as string;
    }, pngOf(400 + i * 10, 300, [100 + i * 30, 90, 220]).toString("base64"));
    uploaded.push(id);
  }
  return uploaded;
}
const note = (blocks: Record<string, unknown>[]) => ({ kind: "note", format: "vertical", pages: [{ id: "p1", blocks }] });
const T = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id, kind: "text", text, ...extra });
const I = (id: string, src: string, extra: Record<string, unknown> = {}) => ({ id, kind: "image", text: "", src, width: 100, ratio: 4 / 3, ...extra });

async function open(page: Page, blocks: Record<string, unknown>[]) {
  const s = await seedNotes(page, "Фото", [{ name: "Смешанная", data: note(blocks) }]);
  await openApp(page, "notes");
  await openNotesDoc(page, "Фото", "Смешанная");
  return s.docs[0]!.id;
}
const cell = (page: Page, id: string) => page.locator(`[data-img-cell="${id}"]`);
async function choose(page: Page, id: string) {
  await cell(page, id).locator("img").click();
  await expect(page.getByTestId("notes-image-tools")).toHaveAttribute("data-image", id);
}
async function stored(page: Page, id: string) {
  return (await notesApiCall(page, "GET", `/api/notes/documents/${id}`)).body.data.pages[0].blocks as Record<string, unknown>[];
}
async function dragMouse(page: Page, from: Locator, to: { x: number; y: number }) {
  const b = (await from.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(b.x + b.width / 2 + ((to.x - b.x - b.width / 2) * i) / 14, b.y + b.height / 2 + ((to.y - b.y - b.height / 2) * i) / 14);
  await page.waitForTimeout(80);
  await page.mouse.up();
}

test("D1 / D4: a picture goes where the cursor was, at 100 %; «Масштаб» settles on 50 %; the tool is remembered", async ({ page }) => {
  await signUpViaApi(page, "Вставка", "Курсор");
  const doc = await open(page, [T("a", "Начало конец")]);
  const field = page.getByTestId("notes-block").first();
  await field.click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await page.getByTestId("notes-image-file").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: pngOf(400, 300) });
  const img = page.getByTestId("notes-image-block");
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute("data-size", "100");
  await notesSaved(page);
  let b = await stored(page, doc);
  expect(b.map((x) => x.kind)).toEqual(["text", "image", "text"]);
  expect([b[0]!.text, b[2]!.text]).toEqual(["Начало", " конец"]);
  // The panel: no 25/50/75/«Во всю», no alignment, no up / down; «Передвижение» chosen first.
  const tools = page.getByTestId("notes-image-tools");
  await expect(tools).toBeVisible();
  for (const gone of ["notes-image-w25", "notes-image-w50", "notes-image-w75", "notes-image-up", "notes-image-down", "notes-image-wrap"]) await expect(page.getByTestId(gone)).toHaveCount(0);
  await expect(page.getByTestId("notes-image-tool-move")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("notes-image-left")).toHaveCount(0); // nobody beside it
  // «Масштаб»: drag sideways to about half → 50 %.
  await page.getByTestId("notes-image-tool-scale").click();
  const frame = img.locator(".vn2-frame");
  const fb = (await frame.boundingBox())!;
  await page.mouse.move(fb.x + fb.width * 0.9, fb.y + fb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(fb.x + fb.width * (0.9 - 0.45 * (i / 10)), fb.y + fb.height / 2);
  await expect(page.getByTestId("notes-image-scale-badge")).toHaveText("50%");
  await page.mouse.up();
  await expect(img).toHaveAttribute("data-size", "50");
  await notesSaved(page);
  b = await stored(page, doc);
  expect(b.find((x) => x.kind === "image")).toMatchObject({ width: 50, tool: "scale" });
  // Remembered after the panel closes and after reopening the note.
  await reloadUnlocked(page);
  await openApp(page, "notes").catch(() => undefined);
  if (!(await page.getByTestId("notes-doc").isVisible().catch(() => false))) await openNotesDoc(page, "Фото", "Смешанная");
  await choose(page, (b.find((x) => x.kind === "image")!.id as string));
  await expect(page.getByTestId("notes-image-tool-scale")).toHaveAttribute("aria-checked", "true");
});

test("D3 / D6: a tap beside a 50 % picture writes there; text stays beside it with a small gap and never over it; text and picture swap", async ({ page }) => {
  await signUpViaApi(page, "Текст", "Рядом");
  const [src] = await media(page, 1);
  const doc = await open(page, [T("a", "Сверху"), I("p", src!, { width: 50 }), T("z", "")]);
  await page.getByTestId("notes-row-free").click();
  await page.keyboard.type("Слова рядом с фотографией, которые переносятся по строкам, если их много.");
  const text = page.getByTestId("notes-text-cell");
  await expect(text).toHaveCount(1);
  const ib = (await cell(page, "p").boundingBox())!;
  const tb = (await text.boundingBox())!;
  expect(tb.x).toBeGreaterThanOrEqual(ib.x + ib.width + 6); // about one character between them
  expect(tb.x - (ib.x + ib.width)).toBeLessThan(24);
  expect(Math.abs(tb.y - ib.y)).toBeLessThan(12); // same line
  // The text above did not move.
  await notesSaved(page);
  let b = await stored(page, doc);
  const row = b.find((x) => x.id === "p")!.row;
  expect(row).toBeTruthy();
  expect(b.filter((x) => x.row === row).map((x) => x.kind)).toEqual(["image", "text"]);
  // Swap: the text goes left, the picture right; nothing lost.
  await choose(page, "p");
  await page.getByTestId("notes-image-swap-text").click();
  const ib2 = (await cell(page, "p").boundingBox())!;
  const tb2 = (await text.boundingBox())!;
  expect(ib2.x).toBeGreaterThan(tb2.x + tb2.width);
  await notesSaved(page);
  b = await stored(page, doc);
  expect(b.filter((x) => x.row === row).map((x) => x.kind)).toEqual(["text", "image"]);
  expect(JSON.stringify(b)).toContain("которые переносятся");
});

test("D5 / D8: two 50 % pictures in a row: arrows only where there is a neighbour, one format for both, cycling", async ({ page }) => {
  await signUpViaApi(page, "Ряд", "Фото");
  const [a, b2] = await media(page, 2);
  const doc = await open(page, [I("x", a!, { width: 50, row: "r1" }), I("y", b2!, { width: 50, row: "r1" }), T("t", "")]);
  await choose(page, "x");
  await expect(page.getByTestId("notes-image-left")).toHaveCount(0);
  await expect(page.getByTestId("notes-image-right")).toBeVisible();
  await page.getByTestId("notes-image-right").click();
  await notesSaved(page);
  expect((await stored(page, doc)).filter((x) => x.kind === "image").map((x) => x.id)).toEqual(["y", "x"]);
  // One format button, cycling square → portrait → landscape for the whole row.
  await expect(page.getByTestId("notes-image-format")).toHaveAttribute("data-shape", "square");
  await page.getByTestId("notes-image-format").click();
  await expect(cell(page, "x")).toHaveAttribute("data-shape", "portrait");
  await expect(cell(page, "y")).toHaveAttribute("data-shape", "portrait");
  await page.getByTestId("notes-image-format").click();
  await expect(cell(page, "y")).toHaveAttribute("data-shape", "landscape");
  // 50 %: the whole picture inside the frame (no crop); a frame is portrait/landscape as chosen.
  await expect(cell(page, "x").locator("img")).toHaveClass(/object-contain/);
  // Side by side, never overlapping, inside the sheet.
  const bx = (await cell(page, "x").boundingBox())!;
  const by = (await cell(page, "y").boundingBox())!;
  expect(by.x + by.width).toBeLessThanOrEqual(bx.x + 1);
  const sheet = (await page.getByTestId("notes-paper").first().boundingBox())!;
  expect(Math.max(bx.x + bx.width, by.x + by.width)).toBeLessThanOrEqual(sheet.x + sheet.width);
});

test("D7: carousel on / off, new pictures land in view, one step per arrow, all pictures kept when it is removed", async ({ page }) => {
  await signUpViaApi(page, "Карусель", "Фото");
  const [a, b, c] = await media(page, 3);
  const doc = await open(page, [I("x", a!, { width: 50, row: "r1" }), I("y", b!, { width: 50, row: "r1" }), I("z", c!, { width: 50 }), T("t", "")]);
  await choose(page, "x");
  await page.getByTestId("notes-image-carousel").click();
  const car = page.getByTestId("notes-carousel");
  await expect(car).toHaveAttribute("data-count", "2");
  // Drop the third one onto a carousel picture: it joins (D7 way 1).
  await choose(page, "z");
  const yb = (await cell(page, "y").boundingBox())!;
  await dragMouse(page, cell(page, "z").locator("img"), { x: yb.x + yb.width / 2, y: yb.y + yb.height / 2 });
  await expect(car).toHaveAttribute("data-count", "3");
  // A new picture while a carousel picture is chosen: it joins and is in view.
  await choose(page, "x");
  await page.getByTestId("notes-image-file").setInputFiles({ name: "n.png", mimeType: "image/png", buffer: pngOf(300, 300) });
  await expect(car).toHaveAttribute("data-count", "4");
  const fresh = car.locator("[data-img-cell]").nth(1);
  await expect(fresh).toBeInViewport();
  // Two at a time (50 %); the arrows / a swipe move one picture per step.
  if (!isMobile(page)) {
    await car.hover();
    await page.getByTestId("notes-carousel-next").click();
    await expect(car).toHaveAttribute("data-start", "1");
  }
  await notesSaved(page);
  const before = (await stored(page, doc)).filter((x) => x.kind === "image");
  expect(before).toHaveLength(4);
  expect(before.every((x) => x.carousel === true && x.width === 50)).toBe(true);
  // Remove: everything stays, the ones in view together, the rest in rows below / above, in order.
  await choose(page, before[0]!.id as string);
  await page.getByTestId("notes-image-carousel").click();
  await expect(car).toHaveCount(0);
  await notesSaved(page);
  const after = (await stored(page, doc)).filter((x) => x.kind === "image");
  expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id));
  expect(after.some((x) => x.carousel)).toBe(false);
});

test("D2: a picture is lifted with a shadow and dropped on its own line, beside another picture, or onto one", async ({ page }) => {
  test.skip(isMobile(page), "mouse drag (touch drag is the same pointer path)");
  await signUpViaApi(page, "Перенос", "Фото");
  const [a, b] = await media(page, 2);
  const doc = await open(page, [T("t1", "Первый абзац"), I("x", a!, { width: 25 }), T("t2", "Второй абзац"), I("y", b!, { width: 25 }), T("t3", "")]);
  await choose(page, "x");
  // Lifting: a ghost with a shadow, the place kept (faded) until the drop.
  const xb = (await cell(page, "x").boundingBox())!;
  await page.mouse.move(xb.x + xb.width / 2, xb.y + xb.height / 2);
  await page.mouse.down();
  await page.mouse.move(xb.x + xb.width / 2 + 30, xb.y + xb.height / 2 + 40, { steps: 4 });
  await expect(page.getByTestId("notes-drag-ghost")).toBeVisible();
  await expect(cell(page, "x")).toHaveClass(/vn2-cell-placeholder/);
  const yb = (await cell(page, "y").boundingBox())!;
  // Beside y (its right third).
  await page.mouse.move(yb.x + yb.width * 0.9, yb.y + yb.height / 2, { steps: 8 });
  await expect(page.getByTestId("notes-drop-mark")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("notes-drag-ghost")).toHaveCount(0);
  await notesSaved(page);
  let blocks = await stored(page, doc);
  const row = blocks.find((x) => x.id === "y")!.row;
  expect(row).toBeTruthy();
  expect(blocks.filter((x) => x.row === row).map((x) => x.id)).toEqual(["y", "x"]);
  // Back on its own line above the first paragraph.
  await choose(page, "x");
  const t1 = (await page.locator('[data-flow-item="t1"]').boundingBox())!;
  await dragMouse(page, cell(page, "x").locator("img"), { x: t1.x + 40, y: t1.y + 3 });
  await notesSaved(page);
  blocks = await stored(page, doc);
  expect(blocks[0]!.id).toBe("x");
  expect(blocks[0]!.row).toBeUndefined();
});

test("D8: a long press shows the whole picture; in «Передвижение» holding still is a preview, not a drag", async ({ page }) => {
  await signUpViaApi(page, "Просмотр", "Фото");
  const [a] = await media(page, 1);
  await open(page, [I("x", a!, { width: 25 }), T("t", "текст")]);
  // 25 %: the preview in its frame is cropped, the file is not.
  await expect(cell(page, "x").locator("img")).toHaveClass(/object-cover/);
  const b = (await cell(page, "x").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId("notes-image-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("notes-image-preview")).toHaveCount(0);
  await choose(page, "x");
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId("notes-image-preview")).toBeVisible();
  await expect(page.getByTestId("notes-drag-ghost")).toHaveCount(0);
});

test("older notes open in the new layout with nothing lost: a right picture with text around it becomes a row", async ({ page }) => {
  await signUpViaApi(page, "Старая", "Заметка");
  const [a] = await media(page, 1);
  await open(page, [T("h", "Заголовок"), I("x", a!, { width: 40, align: "right", wrap: true }), T("w1", "Обтекает слева"), T("w2", "И ещё строка"), T("after", "Ниже")]);
  const row = page.getByTestId("notes-flow-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("notes-text-cell")).toContainText("Обтекает слева");
  const tb = (await row.getByTestId("notes-text-cell").boundingBox())!;
  const ib = (await cell(page, "x").boundingBox())!;
  expect(ib.x).toBeGreaterThan(tb.x + tb.width); // the picture stays on the right
  await expect(cell(page, "x")).toHaveAttribute("data-size", "50");
  const values = await page.getByTestId("notes-block").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
  expect(values).toEqual(["Заголовок", "Обтекает слева", "И ещё строка", "Ниже"]);
});
