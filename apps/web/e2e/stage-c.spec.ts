import { expect, test, type Page } from "@playwright/test";
import { openApp, signUpViaApi } from "./helpers";
import { notesApiCall, notesDocMenu, notesSaved, openNotesDoc, pngOf, seedNotes } from "./notes-helpers";

/** Stage C: presentations — a picture on the whole slide (C1) and the canvas format (C2), in compact menus (C3). */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
const empty = { kind: "presentation", format: "rect", slides: [{ id: "s1", transition: "none", layers: [] }] };

async function stored(page: Page, id: string) {
  return (await notesApiCall(page, "GET", `/api/notes/documents/${id}`)).body.data;
}
const box = async (page: Page) => {
  const slide = (await page.getByTestId("notes-pres-editor").getByTestId("notes-slide").last().boundingBox())!;
  const l = (await page.locator('[data-testid="notes-layer"][data-kind="image"]').boundingBox())!;
  return { slide, l };
};

test("C1 + C3: a 4:3 picture: fill the slide, fit whole, original proportions; its pixels and the canvas in its menu", async ({ page }) => {
  await signUpViaApi(page, "Фото", "Слайд");
  const s = await seedNotes(page, "Слайды", [{ name: "Доклад", kind: "presentation", data: empty }]);
  await openApp(page, "notes");
  await openNotesDoc(page, "Слайды", "Доклад");
  await page.getByTestId("notes-pres-image-file").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: pngOf(400, 300) });
  const layer = page.locator('[data-testid="notes-layer"][data-kind="image"]');
  await expect(layer).toHaveCount(1);
  // Added at its own proportions.
  let { l } = await box(page);
  expect(Math.abs(l.width / l.height - 4 / 3)).toBeLessThan(0.03);
  await layer.click({ force: true });
  await expect(layer).toHaveAttribute("data-selected", "true");
  await page.getByTestId("notes-image-menu").click();
  await expect(page.getByTestId("notes-image-info")).toContainText("400 × 300 px");
  await expect(page.getByTestId("notes-image-info")).toContainText("1920 × 1080 px");
  // No separate buttons for each action: everything is in this one menu.
  await expect(page.getByTestId("notes-menu-fit-original")).toHaveCount(0); // already at its proportions
  await page.getByTestId("notes-menu-fit-cover").click();
  ({ l } = await box(page));
  const { slide } = await box(page);
  expect(Math.abs(l.width - slide.width)).toBeLessThan(2);
  expect(Math.abs(l.height - slide.height)).toBeLessThan(2);
  await expect(layer.locator("img")).toHaveClass(/object-cover/);
  await notesSaved(page);
  let data = await stored(page, s.docs[0]!.id);
  expect(data.slides[0].layers[0]).toMatchObject({ fit: "cover", x: 0, y: 0, w: 100, h: 100, px: { w: 400, h: 300 } });
  // Fit whole: the whole picture, as high as the slide.
  await page.getByTestId("notes-image-menu").click();
  await page.getByTestId("notes-menu-fit-contain").click();
  ({ l } = await box(page));
  expect(Math.abs(l.height - slide.height)).toBeLessThan(2);
  expect(Math.abs(l.width / l.height - 4 / 3)).toBeLessThan(0.03);
  // Back from a fill to the original proportions.
  await page.getByTestId("notes-image-menu").click();
  await page.getByTestId("notes-menu-fit-cover").click();
  await page.getByTestId("notes-image-menu").click();
  await page.getByTestId("notes-menu-fit-original").click();
  ({ l } = await box(page));
  expect(Math.abs(l.width / l.height - 4 / 3)).toBeLessThan(0.03);
  await notesSaved(page);
  data = await stored(page, s.docs[0]!.id);
  expect(data.slides[0].layers[0].fit).toBeUndefined();
});

test("C2: 4:3, 9:16, a custom size and the canvas of a picture; content is not cut, the show uses the canvas", async ({ page }) => {
  await signUpViaApi(page, "Холст", "Формат");
  const s = await seedNotes(page, "Форматы", [{ name: "Холсты", kind: "presentation", data: empty }]);
  await openApp(page, "notes");
  await openNotesDoc(page, "Форматы", "Холсты");
  await page.getByTestId("notes-pres-image-file").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: pngOf(300, 400) });
  await expect(page.locator('[data-testid="notes-layer"][data-kind="image"]')).toHaveCount(1);
  const ratioOf = async () => {
    const b = (await page.getByTestId("notes-pres-editor").getByTestId("notes-slide").last().boundingBox())!;
    return b.width / b.height;
  };
  await notesDocMenu(page, "canvas-4x3");
  await expect.poll(ratioOf).toBeCloseTo(4 / 3, 1);
  await notesDocMenu(page, "canvas-9x16");
  await expect.poll(ratioOf).toBeCloseTo(9 / 16, 1);
  // The picture kept its own proportions through both changes.
  const l = (await page.locator('[data-testid="notes-layer"][data-kind="image"]').boundingBox())!;
  expect(Math.abs(l.width / l.height - 3 / 4)).toBeLessThan(0.04);
  // Custom size.
  await notesDocMenu(page, "canvas-custom");
  await page.getByTestId("notes-canvas-w").locator("input").or(page.getByTestId("notes-canvas-w")).first().fill("1000");
  await page.getByTestId("notes-canvas-h").locator("input").or(page.getByTestId("notes-canvas-h")).first().fill("500");
  await page.getByTestId("notes-canvas-apply").click();
  // 9:16 → 2:1: the tall picture has to get smaller to stay whole, so it asks first.
  await expect(page.getByTestId("notes-canvas-confirm")).toBeVisible();
  await expect(page.getByTestId("notes-canvas-confirm")).toContainText("Ничего не обрезается");
  await page.getByTestId("notes-canvas-confirm").getByTestId("confirm-action").click();
  await expect.poll(ratioOf).toBeCloseTo(2, 1);
  await notesSaved(page);
  expect((await stored(page, s.docs[0]!.id)).canvas).toEqual({ w: 1000, h: 500 });
  // The canvas of the picture (300 × 400): the picture fills it.
  await page.locator('[data-testid="notes-layer"][data-kind="image"]').click({ force: true });
  await page.getByTestId("notes-image-menu").click();
  await page.getByTestId("notes-menu-canvas-to-image").click();
  const confirm = page.getByTestId("notes-canvas-confirm");
  if (await confirm.isVisible().catch(() => false)) await confirm.getByTestId("confirm-action").click();
  await expect.poll(ratioOf).toBeCloseTo(3 / 4, 1);
  await notesSaved(page);
  const data = await stored(page, s.docs[0]!.id);
  expect(data.canvas).toEqual({ w: 300, h: 400 });
  expect(data.format).toBe("rect");
  expect(data.slides[0].layers[0]).toMatchObject({ fit: "cover", w: 100, h: 100 });
  // The show is in the same proportions.
  await page.getByTestId("notes-pres-play").click();
  const v = page.getByTestId("notes-pres-viewer").getByTestId("notes-slide");
  const vb = (await v.boundingBox())!;
  expect(Math.abs(vb.width / vb.height - 3 / 4)).toBeLessThan(0.03);
  await page.keyboard.press("Escape");
  if (isMobile(page)) return;
});
