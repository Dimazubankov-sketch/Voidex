import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { addToStack, addWidget, joinWidgets, normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { apiAs, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Update 3 · B: the 2 × 2 clock is the analog face only; a widget (a stack, a carousel) really goes to
 * the next phone page with the finger: long press, hold at the side, keep holding it there, let go.
 * Real touch events (CDP), as on a phone, starting outside edit mode.
 */
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
const noIcons = (page: Page, l: WorkspaceLayout) => {
  const cells = isMobile(page) ? l.mobile.cells : l.desktop.cells;
  for (const k of Object.keys(cells)) delete cells[k];
  return l;
};

/** One finger: down, moves, holds, up (CDP touch). */
class Finger {
  constructor(
    private cdp: CDPSession,
    public x = 0,
    public y = 0,
  ) {}
  async down(x: number, y: number) {
    this.x = x;
    this.y = y;
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  }
  async move(x: number, y: number, steps = 12) {
    const fx = this.x;
    const fy = this.y;
    for (let i = 1; i <= steps; i++) {
      this.x = fx + ((x - fx) * i) / steps;
      this.y = fy + ((y - fy) * i) / steps;
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: this.x, y: this.y, id: 1 }] });
      await new Promise((r) => setTimeout(r, 16));
    }
  }
  /** Keeps the finger still for `ms` (tiny moves, as a real finger does). */
  async hold(ms: number) {
    const end = Date.now() + ms;
    let k = 0;
    while (Date.now() < end) {
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: this.x + (k++ % 2) * 0.5, y: this.y, id: 1 }] });
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  async up() {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
}

/** Long press on the widget (outside edit mode), carry it to the right side, hold, go on to the left and let go. */
async function carryToNextPage(page: Page, card: Locator, id: string) {
  const cdp = await page.context().newCDPSession(page);
  const f = new Finger(cdp);
  // Watch where the touch is kept while the card is replaced on the new page.
  await page.evaluate(() => {
    const ws = document.querySelector('[data-testid="workspace"]')!;
    (window as unknown as { __captured: number }).__captured = 0;
    ws.addEventListener("gotpointercapture", () => ((window as unknown as { __captured: number }).__captured += 1));
  });
  const b = (await card.boundingBox())!;
  const vw = page.viewportSize()!.width;
  await f.down(b.x + b.width / 2, b.y + 24);
  await f.hold(650); // the long press: the menu opens (the widget is picked up as soon as the finger moves)
  await f.move(b.x + b.width / 2 + 40, b.y + 40, 6);
  await expect(page.locator(`[data-widget="${id}"]`)).toHaveAttribute("data-dragging", "true");
  await f.move(vw - 6, b.y + 40);
  await f.hold(1300); // held at the side: the next page comes, the widget stays in the hand
  await expect(page.locator(`[data-testid='home-page-1'] [data-widget='${id}']`)).toBeVisible();
  await expect(page.locator(`[data-widget='${id}']`)).toHaveAttribute("data-dragging", "true");
  expect(await page.evaluate(() => (window as unknown as { __captured: number }).__captured)).toBeGreaterThan(0);
  // Still following the finger on the new page, then let go on the left.
  const before = (await page.locator(`[data-widget='${id}']`).boundingBox())!;
  await f.move(60, b.y + 120);
  const during = (await page.locator(`[data-widget='${id}']`).boundingBox())!;
  expect(Math.abs(during.x - before.x) + Math.abs(during.y - before.y)).toBeGreaterThan(30);
  await f.up();
  await expect.poll(async () => (await layoutOf(page)).widgets.find((w) => w.id === id)?.container).toBe("1");
  await expect(page.locator(`[data-widget='${id}']`)).not.toHaveAttribute("data-dragging", "true");
}

test("B1: the 2 × 2 clock shows the analog face only; 4 × 2 keeps the city, the time and the date", async ({ page }) => {
  await signUpViaApi(page, "Только", "Циферблат");
  await saveLayout(page, (l) => addWidget(noIcons(page, l), "clock", where(page, l, 0, 0), "w_clock0001"));
  const w = page.getByTestId("clock-widget");
  await expect(w).toHaveAttribute("data-size", "s");
  await expect(w.locator("svg")).toHaveCount(1);
  await expect(w.getByTestId("clock-widget-city")).toHaveCount(0);
  expect((await w.innerText()).trim()).toBe("");
  // The hands still run and the face fills the tile.
  await expect(w.getByTestId("clock-widget-second")).toBeVisible();
  // Update 4 · C: the card picture (with its ring) fills the tile; the live dial sits inside the ring.
  const art = (await w.locator(".vx-clock-art img").boundingBox())!;
  const face = (await w.locator("svg").boundingBox())!;
  const tile = (await w.boundingBox())!;
  expect(art.width).toBeGreaterThanOrEqual(tile.width - 1);
  expect(face.width).toBeGreaterThan(tile.width * 0.6);
  // The selected city is still spoken (aria-label) and drives the hands.
  await expect(w).toHaveAttribute("aria-label", /.+/);
  // 4 × 2: city, time, date.
  await saveLayout(page, (l) => ({ ...l, widgets: l.widgets.map((x) => ({ ...x, size: "w" as const })) }));
  const wide = page.getByTestId("clock-widget");
  await expect(wide).toHaveAttribute("data-size", "w");
  await expect(wide.getByTestId("clock-widget-city")).toBeVisible();
});

test("B2: phone — a widget is carried to the next page with the finger (long press, hold at the side, let go) and saved there", async ({ page }) => {
  test.skip(!isMobile(page), "phone pages");
  await signUpViaApi(page, "Перенос", "Пальцем");
  await saveLayout(page, (l) => addWidget(noIcons(page, l), "clock", where(page, l, 0, 0), "w_clock0001"));
  await carryToNextPage(page, page.locator('[data-widget="w_clock0001"]'), "w_clock0001");
  // Kept after a reload.
  await reloadUnlocked(page);
  await expect.poll(async () => (await layoutOf(page)).widgets[0]!.container).toBe("1");
});

test("B2: phone — a stack goes to the next page the same way", async ({ page }) => {
  test.skip(!isMobile(page), "phone pages");
  await signUpViaApi(page, "Стопка", "Переносом");
  await saveLayout(page, (l) => {
    let n = addWidget(noIcons(page, l), "clock", where(page, l, 0, 0), "w_stack0001");
    n = addToStack(n, "w_stack0001", 0, "calculator", "w_item00002").layout!;
    return n;
  });
  await carryToNextPage(page, page.getByTestId("widget-stack"), "w_stack0001");
});

test("B2: phone — a carousel goes to the next page the same way", async ({ page }) => {
  test.skip(!isMobile(page), "phone pages");
  await signUpViaApi(page, "Карусель", "Переносом");
  await saveLayout(page, (l) => {
    let n = addWidget(noIcons(page, l), "clock", where(page, l, 0, 0), "w_carou0001");
    n = addWidget(n, "calculator", where(page, l, 2, 0), "w_carou0002");
    return joinWidgets(n, "w_carou0002", "w_carou0001", "right").layout ?? n;
  });
  await expect(page.getByTestId("widget-carousel")).toBeVisible();
  await carryToNextPage(page, page.getByTestId("widget-carousel"), "w_carou0001");
});

test("B2: phone — a drag that is cancelled puts the widget back where it was; nothing disappears", async ({ page }) => {
  test.skip(!isMobile(page), "phone pages");
  await signUpViaApi(page, "Отмена", "Переноса");
  await saveLayout(page, (l) => addWidget(noIcons(page, l), "clock", where(page, l, 2, 0), "w_clock0001"));
  const card = page.locator('[data-widget="w_clock0001"]');
  const cdp = await page.context().newCDPSession(page);
  const f = new Finger(cdp);
  const b = (await card.boundingBox())!;
  await f.down(b.x + b.width / 2, b.y + 24);
  await f.hold(650);
  await f.move(b.x + b.width / 2 - 60, b.y + 160);
  await expect(card).toHaveAttribute("data-dragging", "true");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(card).not.toHaveAttribute("data-dragging", "true");
  await expect.poll(async () => Math.abs((await card.boundingBox())!.x - b.x) + Math.abs((await card.boundingBox())!.y - b.y)).toBeLessThan(3);
  const l = await layoutOf(page);
  expect(l.widgets).toHaveLength(1);
  expect(l.widgets[0]!.container).toBe("0");
});
