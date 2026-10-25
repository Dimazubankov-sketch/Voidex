import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { addWidget, normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { apiAs, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Update 4 · B: a widget moved onto icons makes room for itself — the icons make way to the nearest
 * free cells, nothing disappears or overlaps, the layout is saved, and «Отменить» brings it all back.
 * Real touch (CDP), as on a phone.
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

class Finger {
  constructor(private cdp: CDPSession, public x = 0, public y = 0) {}
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

/** Pairs of icons / widgets of a home page that overlap (none once the grid has settled). */
async function overlapsOf(page: Page, pageIndex: number) {
  const boxes = await page.locator(`[data-testid="home-page-${pageIndex}"]`).evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('[data-testid^="app-"] [data-tile], [data-widget]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, id: el.closest("[data-testid]")?.getAttribute("data-testid") ?? el.dataset.widget };
    }),
  );
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 2 && iy > 2) out.push(`${a.id} × ${b.id}`);
    }
  return out;
}
const noOverlaps = (page: Page, pageIndex: number) => expect.poll(() => overlapsOf(page, pageIndex), { timeout: 4000 }).toEqual([]);

const appsOnPage = (l: WorkspaceLayout, p: number) => l.mobile.pages[p]!.map((i) => i.id).sort();

test("B2: phone — a widget dropped on the icons makes room: they make way, nothing is lost or overlaps; «Отменить» brings it back", async ({ page }) => {
  test.skip(!isMobile(page), "phone grid");
  await signUpViaApi(page, "Место", "Виджету");
  // The apps in the top rows, a clock widget lower on the same page.
  await saveLayout(page, (l) => addWidget(l, "clock", { surface: "mobile", page: 0, cell: { c: 0, r: 4 } }, "w_clock0001"));
  const before = await layoutOf(page);
  const apps = appsOnPage(before, 0);
  const card = page.locator('[data-widget="w_clock0001"]');
  const target = (await page.getByTestId("app-mail").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const f = new Finger(cdp);
  const b = (await card.boundingBox())!;
  await f.down(b.x + b.width / 2, b.y + 24);
  await f.hold(650);
  await f.move(b.x + b.width / 2 + 10, b.y + 10, 6);
  await expect(card).toHaveAttribute("data-dragging", "true");
  // Up over the first icons (the card's top-left over Mail).
  await f.move(target.x + b.width / 2, target.y + 24, 16);
  await f.up();
  await expect.poll(async () => (await layoutOf(page)).mobile.cells["widget:w_clock0001"]).toEqual({ c: 0, r: 0 });
  // The icons made way; all are still on the page and nothing overlaps.
  const after = await layoutOf(page);
  expect(appsOnPage(after, 0)).toEqual(apps);
  await expect(page.getByTestId("toast").filter({ hasText: "освободили место" })).toBeVisible();
  await page.waitForTimeout(500);
  await noOverlaps(page, 0);
  // Kept after a reload.
  await reloadUnlocked(page);
  await expect.poll(async () => (await layoutOf(page)).mobile.cells["widget:w_clock0001"]).toEqual({ c: 0, r: 0 });
  await noOverlaps(page, 0);
});

test("B2: phone — «Отменить» puts the widget and the icons back where they were", async ({ page }) => {
  test.skip(!isMobile(page), "phone grid");
  await signUpViaApi(page, "Отмена", "Места");
  await saveLayout(page, (l) => addWidget(l, "clock", { surface: "mobile", page: 0, cell: { c: 2, r: 4 } }, "w_clock0001"));
  const before = await layoutOf(page);
  const card = page.locator('[data-widget="w_clock0001"]');
  const target = (await page.getByTestId("app-mail").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const f = new Finger(cdp);
  const b = (await card.boundingBox())!;
  await f.down(b.x + b.width / 2, b.y + 24);
  await f.hold(650);
  await f.move(b.x + b.width / 2 - 10, b.y + 10, 6);
  await f.move(target.x + 30, target.y + 24, 16);
  await f.up();
  const t = page.getByTestId("toast").filter({ hasText: "освободили место" });
  await expect(t).toBeVisible();
  await t.getByRole("button", { name: "Отменить" }).click();
  await expect.poll(async () => (await layoutOf(page)).mobile.cells["widget:w_clock0001"]).toEqual(before.mobile.cells["widget:w_clock0001"]);
  const back = await layoutOf(page);
  for (const id of ["app:mail", "app:settings", "app:vibex", "app:calculator"]) expect(back.mobile.cells[id]).toEqual(before.mobile.cells[id]);
  await noOverlaps(page, 0);
});
