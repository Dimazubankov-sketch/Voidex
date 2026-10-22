import { expect, test, type Locator, type Page } from "@playwright/test";
import { addToStack, addWidget, normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { apiAs, reloadUnlocked, signUpViaApi } from "./helpers";

/** Update 2, stage B: home-screen widgets and pages. */
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
const where = (page: Page, l: WorkspaceLayout, c: number, r: number, pg = 0) =>
  isMobile(page) ? { surface: "mobile" as const, page: pg, cell: { c, r } } : { surface: "desktop" as const, space: l.desktop.spaces[0]!.id, cell: { c, r } };
/** Icons out of the way: the page holds only what a test puts there. */
const noIcons = (page: Page, l: WorkspaceLayout) => {
  const cells = isMobile(page) ? l.mobile.cells : l.desktop.cells;
  for (const k of Object.keys(cells)) delete cells[k];
  return l;
};
async function longPress(page: Page, el: Locator, fx = 0.5, fy = 0.5) {
  const b = (await el.boundingBox())!;
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
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
async function swipeStack(page: Page, stack: Locator, dir: 1 | -1, reach = 0.5) {
  const b = (await stack.boundingBox())!;
  const x = b.x + b.width / 2;
  const y0 = b.y + b.height / 2 - (dir * b.height) / 4;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y0 + (dir * b.height * reach * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(350);
}

test("B1: on the phone a 2 × 2 widget lands at the left or right edge only (never in the middle)", async ({ page }) => {
  test.skip(!isMobile(page), "phone grid");
  await signUpViaApi(page, "Края", "Экрана");
  await saveLayout(page, (l) => addWidget(noIcons(page, l), "clock", where(page, l, 0, 2), "w_clock0001"));
  await editMode(page);
  const w = page.locator('[data-widget="w_clock0001"]');
  const grid = (await page.getByTestId("home-page-0").locator("[data-home-grid]").first().boundingBox())!;
  const b = (await w.boundingBox())!;
  // Drag it so its centre is just right of the middle: it snaps to the right edge.
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const to = { x: grid.x + grid.width / 2 + 12, y: from.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y);
  await page.mouse.up();
  await expect(page.locator('[data-widget-cell="w_clock0001"]')).toHaveAttribute("data-cell", /^2,/);
  await expect.poll(async () => (await layoutOf(page)).mobile.cells["widget:w_clock0001"]?.c).toBe(2);
});

test("B2: a stack goes round endlessly both ways, one step per swipe, no scrollbar; the one in view is kept", async ({ page }) => {
  await signUpViaApi(page, "Круговая", "Стопка");
  await saveLayout(page, (l) => {
    let n = addWidget(noIcons(page, l), "clock", where(page, l, 0, 0), "w_stack0001");
    n = addToStack(n, "w_stack0001", 0, "calculator", "w_item00002").layout!;
    n = addToStack(n, "w_stack0001", 0, "clock", "w_item00003").layout!;
    return { ...n, widgets: n.widgets.map((w) => ({ ...w, active: 0 })) };
  });
  const stack = page.getByTestId("widget-stack");
  await expect(stack).toHaveAttribute("data-count", "3");
  await expect(stack).toHaveAttribute("data-active", "0");
  // No scrollbar: nothing scrolls natively.
  const box = stack.locator("[data-widget-stack]");
  expect(await box.evaluate((el) => getComputedStyle(el).overflowY)).toBe("hidden");
  // Up: 0 → 1 → 2 → 0 (through the end).
  for (const want of ["1", "2", "0"]) {
    await swipeStack(page, stack, -1);
    await expect(stack).toHaveAttribute("data-active", want);
  }
  // Down from the first: the last one (0 → 2 → 1).
  await swipeStack(page, stack, 1);
  await expect(stack).toHaveAttribute("data-active", "2");
  await swipeStack(page, stack, 1);
  await expect(stack).toHaveAttribute("data-active", "1");
  // One gesture is one step, however long it is.
  await swipeStack(page, stack, -1, 1.6);
  await expect(stack).toHaveAttribute("data-active", "2");
  // The dots show while it moves, then hide.
  await expect(page.getByTestId("widget-stack-dots")).not.toHaveAttribute("data-visible", "true", { timeout: 4000 });
  // Kept after a reload.
  await expect.poll(async () => (await layoutOf(page)).widgets[0]!.active).toBe(2);
  await reloadUnlocked(page);
  await expect(page.getByTestId("widget-stack")).toHaveAttribute("data-active", "2");
});

test("B4: a widget dropped near another without the «+» never disappears; the «+» joins them, both stay visible", async ({ page }) => {
  await signUpViaApi(page, "Без", "Потерь");
  await saveLayout(page, (l) => addWidget(addWidget(noIcons(page, l), "clock", where(page, l, 0, 0), "w_clock0001"), "calculator", where(page, l, 0, 2), "w_calc00001"));
  await editMode(page);
  const clock = page.locator('[data-widget="w_clock0001"]');
  const calc = page.locator('[data-widget="w_calc00001"]');
  // Drop the calculator a little below the clock's edge (not on the «+», not on its middle).
  const cb = (await clock.boundingBox())!;
  const kb = (await calc.boundingBox())!;
  const from = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 };
  const to = { x: cb.x + cb.width / 2, y: cb.y + cb.height * 0.95 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14);
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(600);
  // Both are on screen, inside the page, and saved.
  for (const w of [clock, calc]) {
    await expect(w).toBeVisible();
    const b = (await w.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 900) + 1);
  }
  await expect.poll(async () => (await layoutOf(page)).widgets.length).toBe(2);
  // The «+» on the free side joins them into one carousel; both widgets show in it (nothing vanishes).
  await saveLayout(page, (l) => {
    const cells = isMobile(page) ? l.mobile.cells : l.desktop.cells;
    for (const k of Object.keys(cells)) delete cells[k];
    cells["widget:w_clock0001"] = { c: 0, r: 0 };
    cells["widget:w_calc00001"] = { c: 2, r: 0 };
    return l;
  });
  await editMode(page);
  const a = (await clock.boundingBox())!;
  const k = (await calc.boundingBox())!;
  const f = { x: k.x + k.width / 2, y: k.y + k.height / 2 };
  const t2 = { x: a.x + a.width + 4, y: a.y + a.height / 2 };
  await page.mouse.move(f.x, f.y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) await page.mouse.move(f.x + ((t2.x - f.x) * i) / 16, f.y + ((t2.y - f.y) * i) / 16);
  await expect(page.getByTestId("widget-carousel-plus")).toHaveAttribute("data-active", "true");
  await page.mouse.up();
  const car = page.getByTestId("widget-carousel");
  await expect(car).toBeVisible();
  await expect(car.getByTestId("clock-widget")).toBeVisible();
  await expect(car.getByTestId("calc-widget")).toBeVisible();
  await expect.poll(async () => (await layoutOf(page)).widgets.length).toBe(1);
});

test("B5: a widget held at the page edge goes to the next page and stays in the hand there", async ({ page }) => {
  test.skip(!isMobile(page), "phone pages");
  await signUpViaApi(page, "Перенос", "Виджета");
  await saveLayout(page, (l) => addWidget(noIcons(page, l), "clock", where(page, l, 0, 0), "w_clock0001"));
  await editMode(page);
  const w = page.locator('[data-widget="w_clock0001"]');
  const b = (await w.boundingBox())!;
  const vw = page.viewportSize()!.width;
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((vw - 8 - from.x) * i) / 12, from.y);
  await page.waitForTimeout(1100);
  // On page 2 now, and still being dragged.
  await expect(page.locator("[data-testid='home-page-1'] [data-widget='w_clock0001']")).toBeVisible();
  await expect(page.locator("[data-widget='w_clock0001']")).toHaveAttribute("data-dragging", "true");
  // Moved on and let go at the left: it lands there (left edge, B1).
  await page.mouse.move(40, from.y + 40, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await layoutOf(page)).widgets[0]!.container).toBe("1");
  await expect(page.locator('[data-widget-cell="w_clock0001"]')).toHaveAttribute("data-cell", /^0,/);
});

test("B6: calculator keys answer on their own: the widget does not grow, a held key opens no menu", async ({ page }) => {
  await signUpViaApi(page, "Мягкий", "Калькулятор");
  await saveLayout(page, (l) => addWidget(noIcons(page, l), "calculator", where(page, l, 0, 0), "w_calc00001"));
  const w = page.locator('[data-widget="w_calc00001"]');
  const glass = w.locator("[data-widget-press]");
  const k7 = w.getByTestId("calc-key-7");
  const b = (await k7.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  expect(await glass.getAttribute("data-pressed")).toBeNull();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.getByTestId("home-context-menu")).toHaveCount(0);
  await expect(page.getByTestId("home")).not.toHaveAttribute("data-editing", "true");
  // Input stays exact.
  for (const k of ["+", "8", "="]) await w.getByTestId(`calc-key-${k}`).click();
  await expect(w.getByTestId("calc-widget-display")).toHaveText("15");
});

test("B7: a removed widget shrinks away quickly; the layout changes once it is gone", async ({ page }) => {
  await signUpViaApi(page, "Удаление", "Плавное");
  await saveLayout(page, (l) => addWidget(noIcons(page, l), "clock", where(page, l, 0, 0), "w_clock0001"));
  const w = page.locator('[data-widget="w_clock0001"]');
  await longPress(page, w);
  // Watch the widget every frame until it is gone: it must fade on the way out (not just vanish).
  await page.evaluate(() => {
    const win = window as unknown as { __vxMinOpacity: number };
    win.__vxMinOpacity = 1;
    const tick = () => {
      const el = document.querySelector('[data-widget-cell="w_clock0001"]');
      if (!el) return;
      win.__vxMinOpacity = Math.min(win.__vxMinOpacity, Number(getComputedStyle(el).opacity));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  await page.getByTestId("menu-remove-widget").click();
  await expect(w).toHaveCount(0);
  expect(Date.now() - t0).toBeLessThan(1500);
  expect(await page.evaluate(() => (window as unknown as { __vxMinOpacity: number }).__vxMinOpacity)).toBeLessThan(1);
  await expect.poll(async () => (await layoutOf(page)).widgets.length).toBe(0);
});

test("B8: a quick short flick turns the page; a slow short drag does not", async ({ page }) => {
  test.skip(!isMobile(page), "phone pages");
  await signUpViaApi(page, "Быстрые", "Страницы");
  // A second page (kept by a widget on it).
  await saveLayout(page, (l) => addWidget({ ...l, mobile: { ...l.mobile, pages: [...l.mobile.pages, []] } }, "clock", { surface: "mobile", page: 1, cell: { c: 0, r: 0 } }, "w_clock0001"));
  const pg = (await page.getByTestId("home-page-0").boundingBox())!;
  const y = pg.y + pg.height / 2;
  const flick = (dx: number, ms: number) =>
    page.evaluate(
      ({ x0, y, dx, ms }) =>
        new Promise<void>((done) => {
          const target = document.elementFromPoint(x0, y)!;
          const fire = (type: string, x: number) => target.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: "touch", clientX: x, clientY: y, bubbles: true, button: 0, isPrimary: true }));
          fire("pointerdown", x0);
          const steps = Math.max(3, Math.round(ms / 16));
          let i = 0;
          const tick = () => {
            i++;
            fire("pointermove", x0 + (dx * i) / steps);
            if (i < steps) setTimeout(tick, 16);
            else {
              fire("pointerup", x0 + dx);
              done();
            }
          };
          setTimeout(tick, 16);
        }),
      { x0: pg.x + pg.width * 0.7, y, dx, ms },
    );
  // Slow and short: stays on the first page.
  await flick(-60, 900);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("page-dots").getByRole("tab").nth(0)).toHaveAttribute("aria-selected", "true");
  // Quick and short: the next page.
  await flick(-70, 90);
  await expect(page.getByTestId("page-dots").getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
});
