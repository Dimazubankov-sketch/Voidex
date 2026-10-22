import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWidget, normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { apiAs, reloadUnlocked, signUpViaApi } from "./helpers";

/** Stage E: widget stacks (vertical) and horizontal carousels on the home screen. */
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
/** Two widgets side by side at the top: clock (left) and calculator (right). Phone: page 0; PC: first desktop. */
async function twoWidgets(page: Page) {
  await saveLayout(page, (l) => {
    const space = l.desktop.spaces[0]!.id;
    const where = (c: number) => (isMobile(page) ? { surface: "mobile" as const, page: 0, cell: { c, r: 0 } } : { surface: "desktop" as const, space, cell: { c, r: 0 } });
    // Icons go below the widgets.
    const cells = isMobile(page) ? l.mobile.cells : l.desktop.cells;
    for (const k of Object.keys(cells)) delete cells[k];
    return addWidget(addWidget(l, "clock", where(0), "w_clock0001"), "calculator", where(2), "w_calc00001");
  });
  await expect(page.locator('[data-widget="w_clock0001"]')).toBeVisible();
  await expect(page.locator('[data-widget="w_calc00001"]')).toBeVisible();
}
async function editMode(page: Page) {
  if ((await page.getByTestId("home").getAttribute("data-editing")) === "true") return;
  if (isMobile(page)) {
    const pg = (await page.getByTestId("home-page-0").boundingBox())!;
    await page.mouse.move(pg.x + pg.width / 2, pg.y + pg.height - 30);
  } else await page.mouse.move(1100, 600);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId("home")).toHaveAttribute("data-editing", "true");
}
async function dragWidget(page: Page, w: Locator, to: { x: number; y: number }) {
  const b = (await w.boundingBox())!;
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 16, from.y + ((to.y - from.y) * i) / 16);
  await page.waitForTimeout(150);
}
/** B2: one swipe on a stack (dir 1: down, the previous widget comes; -1: up, the next one). */
async function swipeStack(page: Page, stack: Locator, dir: 1 | -1) {
  const b = (await stack.boundingBox())!;
  const x = b.x + b.width / 2;
  const y0 = b.y + b.height / 2 - (dir * b.height) / 4;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y0 + (dir * b.height * 0.5 * i) / 6);
  await page.mouse.up();
}
async function longPressMenu(page: Page, w: Locator, dx = 0.5) {
  const b = (await w.boundingBox())!;
  // Near the top: a calculator's keys answer on their own (no menu from a held key, Update 2 · B6).
  await page.mouse.move(b.x + b.width * dx, b.y + Math.min(b.height * 0.3, 14));
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test("E1: a widget dropped on another makes a stack; vertical scroll, dots only while moving, remembered; menu: take out, add, delete", async ({ page }) => {
  await signUpViaApi(page, "Стопка", "Виджетов");
  await twoWidgets(page);
  await editMode(page);
  const clock = page.locator('[data-widget="w_clock0001"]');
  const cb = (await clock.boundingBox())!;
  await dragWidget(page, page.locator('[data-widget="w_calc00001"]'), { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 });
  await expect(page.getByTestId("widget-stack-target")).toBeVisible();
  await page.mouse.up();
  const stack = page.getByTestId("widget-stack");
  await expect(stack).toHaveAttribute("data-count", "2");
  await expect(stack).toHaveAttribute("data-active", "1"); // the dropped one is in view
  await expect.poll(async () => (await layoutOf(page)).widgets.length).toBe(1);
  await page.getByTestId("home-done").click().catch(() => page.keyboard.press("Escape"));
  await expect(page.getByTestId("home")).not.toHaveAttribute("data-editing", "true");
  // Swipe down to the clock: the dots show, then hide; the active widget is saved.
  await expect(page.getByTestId("widget-stack-dots")).not.toHaveAttribute("data-visible", "true");
  await swipeStack(page, page.getByTestId("widget-stack"), 1);
  await expect(page.getByTestId("widget-stack-dots")).toHaveAttribute("data-visible", "true");
  await expect(stack).toHaveAttribute("data-active", "0");
  await expect(page.getByTestId("widget-stack-dots")).not.toHaveAttribute("data-visible", "true", { timeout: 4000 });
  await expect.poll(async () => (await layoutOf(page)).widgets[0]!.active ?? 0).toBe(0);
  await reloadUnlocked(page);
  await expect(page.getByTestId("widget-stack")).toHaveAttribute("data-active", "0");
  // Long press: the stack's menu (no «Изменить рабочий стол» on widgets).
  await longPressMenu(page, page.getByTestId("widget-stack"));
  await expect(page.getByTestId("menu-stack-add")).toBeVisible();
  await expect(page.getByTestId("menu-stack-remove-item")).toHaveText("Удалить из стопки");
  await expect(page.getByTestId("menu-stack-delete")).toBeVisible();
  await expect(page.getByTestId("menu-edit")).toHaveCount(0);
  // «Удалить из стопки»: the clock (in view) is gone, not put on the desktop; the calculator stays alone.
  await page.getByTestId("menu-stack-remove-item").click();
  await expect(page.getByTestId("widget-stack")).toHaveCount(0);
  await expect.poll(async () => (await layoutOf(page)).widgets.map((w) => w.type).sort().join()).toBe("calculator");
  // Put a clock back on its own (from the catalogue) for the next steps.
  await saveLayout(page, (l) => {
    const space = l.desktop.spaces[0]!.id;
    const where = isMobile(page) ? { surface: "mobile" as const, page: 0, cell: { c: 2, r: 0 } } : { surface: "desktop" as const, space, cell: { c: 2, r: 0 } };
    return addWidget(l, "clock", where, "w_clock0002");
  });
  // Add on top of the calculator from its menu → a stack again.
  await longPressMenu(page, page.locator('[data-testid="widget-calculator"]'));
  await page.getByTestId("menu-stack-add").click();
  await page.getByTestId("widget-card-clock").click();
  await page.getByTestId("widget-add-clock").click();
  await expect(page.getByTestId("widgets-panel")).toHaveCount(0);
  await expect(page.getByTestId("widget-stack")).toHaveAttribute("data-count", "2");
  // «Удалить стопку» asks first; the lone clock stays.
  await longPressMenu(page, page.getByTestId("widget-stack"));
  await page.getByTestId("menu-stack-delete").click();
  await expect(page.getByTestId("widget-confirm")).toBeVisible();
  await page.getByTestId("widget-confirm").getByTestId("confirm-action").click();
  await expect(page.getByTestId("widget-stack")).toHaveCount(0);
  await expect.poll(async () => (await layoutOf(page)).widgets.map((w) => w.type).join()).toBe("clock");
});

test("E2 / E3: the «+» beside a widget makes a horizontal carousel; halves stay independent; «Убрать карусель» parts them in place", async ({ page }) => {
  await signUpViaApi(page, "Карусель", "Виджетов");
  await twoWidgets(page);
  await editMode(page);
  // Move the calculator away first (so the clock's right side is free), then onto the «+» on its right.
  const clock = page.locator('[data-widget="w_clock0001"]');
  const calc = page.locator('[data-widget="w_calc00001"]');
  const cb = (await clock.boundingBox())!;
  await dragWidget(page, calc, { x: cb.x + cb.width + 4, y: cb.y + cb.height / 2 });
  await expect(page.getByTestId("widget-carousel-plus")).toHaveAttribute("data-active", "true");
  await page.mouse.up();
  const car = page.getByTestId("widget-carousel");
  await expect(car).toBeVisible();
  await expect.poll(async () => (await layoutOf(page)).widgets.length).toBe(1);
  const l = await layoutOf(page);
  expect(l.widgets[0]!.items2?.map((x) => x.type)).toEqual(["calculator"]);
  // One wide block: twice as wide as high-ish, two halves.
  const box = (await car.boundingBox())!;
  expect(box.width).toBeGreaterThan(box.height * 1.4);
  await expect(car.locator("[data-widget-half]")).toHaveCount(2);
  // The right half becomes a stack of its own (from its menu); the left stays a single widget.
  await page.keyboard.press("Escape");
  await reloadUnlocked(page);
  await longPressMenu(page, page.getByTestId("widget-carousel"), 0.8);
  await page.getByTestId("menu-stack-add").click();
  await page.getByTestId("widget-card-clock").click();
  await page.getByTestId("widget-add-clock").click();
  await expect(page.getByTestId("widgets-panel")).toHaveCount(0);
  const rightStack = page.locator('[data-widget-half="1"] [data-testid="widget-stack"]');
  await expect(rightStack).toHaveAttribute("data-count", "2");
  await expect(page.locator('[data-widget-half="0"] [data-testid="widget-stack"]')).toHaveCount(0);
  // Its dots are on the right side.
  const dots = (await rightStack.getByTestId("widget-stack-dots").boundingBox())!;
  const half = (await page.locator('[data-widget-half="1"]').boundingBox())!;
  expect(dots.x).toBeGreaterThan(half.x + half.width / 2);
  // «Убрать карусель»: two blocks again, in their places.
  await longPressMenu(page, page.getByTestId("widget-carousel"), 0.2);
  await page.getByTestId("menu-carousel-split").click();
  await expect(page.getByTestId("widget-carousel")).toHaveCount(0);
  await expect.poll(async () => (await layoutOf(page)).widgets.length).toBe(2);
  const parts = (await layoutOf(page)).widgets;
  expect(parts.find((w) => w.items?.length === 2)).toBeTruthy(); // the right stack stayed a stack
});

test("E4: a carousel cannot go into a stack; ordinary app dragging still works next to widgets", async ({ page }) => {
  test.skip(!isMobile(page), "phone home");
  await signUpViaApi(page, "Защита", "Виджетов");
  await twoWidgets(page);
  await saveLayout(page, (l) => {
    const w = l.widgets;
    // A carousel (both) plus another clock below.
    return addWidget({ ...l, widgets: [{ ...w[0]!, items2: [{ id: w[1]!.id, type: "calculator" }] }] }, "clock", { surface: "mobile", page: 0, cell: { c: 0, r: 3 } }, "w_other0001");
  });
  await editMode(page);
  const other = page.locator('[data-widget="w_other0001"]');
  const ob = (await other.boundingBox())!;
  await dragWidget(page, page.getByTestId("widget-carousel").locator(".."), { x: ob.x + ob.width / 2, y: ob.y + ob.height / 2 });
  await expect(page.getByTestId("widget-stack-target")).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () => (await layoutOf(page)).widgets.length).toBe(2);
  // An app icon still moves to a cell as before.
  const icon = page.getByTestId("app-notes");
  const ib = (await icon.boundingBox())!;
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
  await page.mouse.down();
  await page.mouse.move(ib.x + ib.width / 2 + 90, ib.y + ib.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await layoutOf(page)).widgets.length).toBe(2);
});
