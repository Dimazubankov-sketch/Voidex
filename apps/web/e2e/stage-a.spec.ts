import { expect, test, type Page } from "@playwright/test";
import { normalizeLayout } from "@voidex/shared";
import { addWidgetFromPicker, apiAs, openApp, reloadUnlocked, signUpViaApi } from "./helpers";

/** Stage A: stability — A2 desktop bounds, A3 bottom bars vs. side menus, A4 page zoom. */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

/** Phone: long press on free space → edit mode → brush → «Добавить виджет». */
async function openPhoneWidgets(page: Page) {
  const pg = (await page.getByTestId("home-page-0").boundingBox())!;
  await page.mouse.move(pg.x + 30, pg.y + pg.height - 30);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.getByTestId("home-appearance").click();
  await page.getByTestId("brush-widgets").click();
}

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, holdMs = 650) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
  await page.waitForTimeout(120);
  await page.mouse.up();
}

test("A2: apps dragged to the bottom edge of the phone stay on the visible page", async ({ page }) => {
  test.skip(!isMobile(page), "phone home screen");
  await signUpViaApi(page, "Граница", "Экрана");
  const host = page.getByTestId("home-page-0");
  const pg = (await host.boundingBox())!;
  // Edit mode (long press on free space), then drag icons one after another to the bottom of the page:
  // each drop used to add a row below the visible page and the next icon went there, out of reach.
  await page.mouse.move(pg.x + pg.width / 2, pg.y + pg.height - 30);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId("home")).toHaveAttribute("data-editing", "true");
  for (const id of ["notes", "mail", "vibex"]) {
    const b = (await page.getByTestId(`app-${id}`).boundingBox())!;
    await dragTo(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: pg.x + 40 + ["notes", "mail", "vibex"].indexOf(id) * 100, y: pg.y + pg.height - 4 }, 60);
    await page.waitForTimeout(450);
    const after = (await page.getByTestId(`app-${id}`).boundingBox())!;
    expect(after.y + after.height, id).toBeLessThanOrEqual(pg.y + pg.height + 1);
  }
  // Survives a reload, still on screen.
  await reloadUnlocked(page);
  const vp = page.viewportSize()!;
  for (const id of ["notes", "mail", "vibex"]) {
    const again = (await page.getByTestId(`app-${id}`).boundingBox())!;
    expect(again.y + again.height, id).toBeLessThanOrEqual(vp.height);
  }
});

test("A2: icons stored below the page by older builds are shown on it", async ({ page }) => {
  test.skip(!isMobile(page), "phone home screen");
  await signUpViaApi(page, "Старые", "Координаты");
  const apps = ((await apiAs(page, "GET", "/api/apps")).body as { id: string }[]).map((a) => a.id) as never[];
  const stored = (await apiAs(page, "GET", "/api/me")).body.preferences.workspace?.layout ?? null;
  const l = normalizeLayout(stored, apps);
  l.mobile.cells["app:notes"] = { c: 1, r: 40 };
  expect((await apiAs(page, "PATCH", "/api/preferences", { workspace: { layout: l } })).status).toBe(200);
  await reloadUnlocked(page);
  const pg = (await page.getByTestId("home-page-0").boundingBox())!;
  const b = (await page.getByTestId("app-notes").boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(pg.y + pg.height + 1);
});

test("A2: a widget dropped below the page snaps back whole into the page", async ({ page }) => {
  test.skip(!isMobile(page), "phone home screen");
  await signUpViaApi(page, "Виджет", "Граница");
  await openPhoneWidgets(page);
  await addWidgetFromPicker(page, "clock");
  const w = page.locator("[data-widget-cell]").first();
  await expect(w).toBeVisible();
  const box = (await w.boundingBox())!;
  const vp = page.viewportSize()!;
  await dragTo(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2, y: vp.height + 40 });
  await page.waitForTimeout(700);
  const pageBox = (await page.getByTestId("home-page-0").boundingBox())!;
  const after = (await page.locator("[data-widget-cell]").first().boundingBox())!;
  expect(after.y + after.height).toBeLessThanOrEqual(pageBox.y + pageBox.height + 1);
  const layout = (await apiAs(page, "GET", "/api/me")).body.preferences.workspace.layout;
  const id = layout.widgets[0].id;
  const maxRows = Number(await page.locator('[data-home-grid="mobile:0"]').getAttribute("data-max-rows"));
  expect(layout.mobile.cells[`widget:${id}`].r + 2).toBeLessThanOrEqual(maxRows);
});

/** A real touch swipe (pointerType "touch", implicit capture), which mouse events do not reproduce. */
async function touchSwipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

for (const app of ["clock", "vibex"] as const) {
  test(`A3: ${app}: a swipe along the bottom bar moves the tab, never the side menu; taps still work`, async ({ page }) => {
    test.skip(!isMobile(page), "phone tab bar");
    await signUpViaApi(page, "Нижняя", "Панель");
    await openApp(page, app);
    const nav = page.getByTestId(app === "clock" ? "clock-bottom-nav" : "vibex-tabbar");
    await expect(nav).toBeVisible();
    await page.waitForTimeout(500);
    const first = await nav.getAttribute("data-active");
    const b = (await nav.boundingBox())!;
    await touchSwipe(page, { x: b.x + 30, y: b.y + b.height / 2 }, { x: b.x + b.width - 30, y: b.y + b.height / 2 });
    await expect(nav).not.toHaveAttribute("data-active", first!);
    if (app === "vibex") await expect(page.getByTestId("vibex-drawer")).not.toHaveAttribute("data-open", /.*/);
    // And back with a swipe the other way.
    await touchSwipe(page, { x: b.x + b.width - 30, y: b.y + b.height / 2 }, { x: b.x + 30, y: b.y + b.height / 2 });
    await expect(nav).toHaveAttribute("data-active", first!);
    // A tap opens its tab.
    await nav.locator("button[role=tab]").nth(1).tap();
    await expect(nav).toHaveAttribute("data-active", (await nav.locator("button[role=tab]").nth(1).getAttribute("data-tab"))!);
    if (app === "vibex") {
      // The side menu still opens with a swipe on the screen above the bar.
      await nav.locator("button[role=tab]").first().tap();
      const vp = page.viewportSize()!;
      await touchSwipe(page, { x: 30, y: vp.height * 0.45 }, { x: vp.width * 0.8, y: vp.height * 0.45 });
      await expect(page.getByTestId("vibex-drawer")).toHaveAttribute("data-open", "true");
    }
  });
}
