import { expect, test, type Page } from "@playwright/test";
import { addWidget, normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { handAngles } from "@voidex/clock";
import { apiAs, reloadUnlocked, signUpViaApi } from "./helpers";

/** Update 4 · C: the new Clock widget (12 marks, 3 hands, real time), the Calculator widget, the Notes widget in 3 sizes. */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
async function layoutOf(page: Page): Promise<WorkspaceLayout> {
  return ((await apiAs(page, "GET", "/api/me")).body as { preferences: { workspace: { layout: WorkspaceLayout } } }).preferences.workspace.layout;
}
async function saveLayout(page: Page, edit: (l: WorkspaceLayout) => WorkspaceLayout) {
  const apps = ((await apiAs(page, "GET", "/api/apps")).body as { id: string }[]).map((a) => a.id) as never[];
  const l = edit(normalizeLayout((await layoutOf(page)) ?? null, apps));
  expect((await apiAs(page, "PATCH", "/api/preferences", { workspace: { layout: l } })).status).toBe(200);
  await reloadUnlocked(page);
}
const where = (page: Page, l: WorkspaceLayout, c: number, r: number) =>
  isMobile(page) ? { surface: "mobile" as const, page: 0, cell: { c, r } } : { surface: "desktop" as const, space: l.desktop.spaces[0]!.id, cell: { c, r } };
const uid = () => crypto.randomUUID();
const noteBody = (text: string) => ({ kind: "note", format: "vertical", pages: [{ id: uid(), blocks: [{ id: uid(), kind: "text", text }] }] });

test("C1: the Clock widget is the new logo: 12 hour marks, hour / minute / second hands at the real time; 4 × 2 adds the city, time and date", async ({ page }) => {
  await signUpViaApi(page, "Новые", "Часы");
  await saveLayout(page, (l) => addWidget(l, "clock", where(page, l, 0, 2), "w_clock0001"));
  const w = page.getByTestId("clock-widget");
  await expect(w).toHaveAttribute("data-size", "s");
  await expect(w.getByTestId("clock-mark")).toHaveCount(12);
  for (const hand of ["hour", "minute", "second"]) await expect(w.getByTestId(`clock-widget-${hand}`)).toHaveCount(1);
  await expect(w.getByTestId("clock-widget-city")).toHaveCount(0);
  // The hands show the time of the shown zone.
  const zone = (await w.getAttribute("data-zone"))!;
  await expect.poll(async () => Number(await w.getByTestId("clock-widget-minute").getAttribute("data-angle"))).toBeGreaterThanOrEqual(0);
  const minute = Number(await w.getByTestId("clock-widget-minute").getAttribute("data-angle"));
  const want = handAngles(zone, Date.now()).minute;
  expect(Math.min(Math.abs(minute - want), 360 - Math.abs(minute - want))).toBeLessThan(3);
  // And they move.
  const s0 = await w.getByTestId("clock-widget-second").getAttribute("data-angle");
  await expect.poll(() => w.getByTestId("clock-widget-second").getAttribute("data-angle"), { timeout: 4000 }).not.toBe(s0);
  // 4 × 2: the city, the digital time and the date on the left, the dial on the right.
  await saveLayout(page, (l) => ({ ...l, widgets: l.widgets.map((x) => ({ ...x, size: "w" as const })) }));
  const wide = page.getByTestId("clock-widget");
  await expect(wide).toHaveAttribute("data-size", "w");
  await expect(wide.getByTestId("clock-widget-city")).toBeVisible();
  await expect(wide.getByTestId("clock-widget-time")).toHaveText(/^\d{1,2}:\d{2}$/);
  const city = (await wide.getByTestId("clock-widget-city").boundingBox())!;
  const face = (await wide.getByTestId("clock-face").boundingBox())!;
  expect(face.x).toBeGreaterThan(city.x + city.width - 4);
});

test("C2: the Calculator widget still calculates, in the new logo's colours", async ({ page }) => {
  await signUpViaApi(page, "Новый", "Калькулятор");
  await saveLayout(page, (l) => addWidget(l, "calculator", where(page, l, 0, 2), "w_calc00001"));
  const w = page.getByTestId("calc-widget");
  for (const k of ["7", "×", "6", "="]) await w.getByTestId(`calc-key-${k}`).click();
  await expect(w.getByTestId("calc-widget-display")).toHaveText("42");
  await expect(w.getByTestId("calc-key-=")).toHaveClass(/vx-calc-eq/);
  await expect(w.getByTestId("calc-key-×")).toHaveClass(/vx-calc-op/);
});

test("C3: the Notes widget shows the real latest note in 2 × 2 / 4 × 2 / 4 × 4, opens it, follows changes, hides content when Notes is locked", async ({ page }) => {
  await signUpViaApi(page, "Виджет", "Заметок");
  const project = (await apiAs(page, "POST", "/api/notes/projects", { name: "Дом" })).body as { id: string };
  const doc = (await apiAs(page, "POST", `/api/notes/projects/${project.id}/documents`, { kind: "note", name: "Список покупок" })).body as { id: string; revision: number };
  const saved = await apiAs(page, "PUT", `/api/notes/documents/${doc.id}`, { data: noteBody("Молоко, хлеб и яблоки"), revision: doc.revision });
  expect(saved.status).toBe(200);
  await saveLayout(page, (l) => addWidget(l, "notes", where(page, l, 0, 2), "w_notes0001"));
  const w = page.getByTestId("notes-widget");
  await expect(w).toHaveAttribute("data-size", "s");
  await expect(w.getByTestId("notes-widget-title")).toHaveText("Список покупок");
  await expect(w.getByTestId("notes-widget-text")).toContainText("Молоко");
  // 4 × 2: name, lines, when it changed.
  await saveLayout(page, (l) => ({ ...l, widgets: l.widgets.map((x) => ({ ...x, size: "w" as const })) }));
  await expect(page.getByTestId("notes-widget")).toHaveAttribute("data-size", "w");
  await expect(page.getByTestId("notes-widget-date")).toBeVisible();
  // 4 × 4: the longer text and «+» for a new note.
  await saveLayout(page, (l) => ({ ...l, widgets: l.widgets.map((x) => ({ ...x, size: "l" as const })) }));
  const big = page.getByTestId("notes-widget");
  await expect(big).toHaveAttribute("data-size", "l");
  await expect(big.getByTestId("notes-widget-new")).toBeVisible();
  const box = (await big.boundingBox())!;
  const tile = (await page.locator('[data-testid="app-mail"] [data-tile]').first().boundingBox())!;
  expect(box.height).toBeGreaterThan(tile.height * 3);
  // A change in Notes reaches the widget.
  await apiAs(page, "PUT", `/api/notes/documents/${doc.id}`, { data: noteBody("Молоко, хлеб, яблоки и сыр"), revision: saved.body.revision });
  await reloadUnlocked(page);
  await expect(page.getByTestId("notes-widget-text")).toContainText("сыр");
  // A tap opens that note in Notes.
  await page.getByTestId("notes-widget-title").click();
  await expect(page.locator('section[data-testid="window-notes"]')).toBeVisible();
  await expect(page.locator('section[data-testid="window-notes"]').getByText("Молоко, хлеб, яблоки и сыр").first()).toBeVisible();
  // Notes locked with the code: the widget says so and shows nothing of the note.
  expect((await apiAs(page, "PATCH", "/api/preferences", { apps: { notes: { lock: true } } })).status).toBe(200);
  await reloadUnlocked(page);
  const locked = page.getByTestId("notes-widget");
  await expect(locked).toHaveAttribute("data-locked", "true");
  await expect(locked.getByTestId("notes-widget-locked")).toBeVisible();
  await expect(locked).not.toContainText("Список покупок");
  await expect(locked).not.toContainText("Молоко");
});
