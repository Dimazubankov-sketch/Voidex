import { expect, test, type Page } from "@playwright/test";
import { addWidget, normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { apiAs, openApp, reloadUnlocked, signUpViaApi } from "./helpers";

/** Update 2, stage A: the world clock's selected city (A1) and the Clock widget's two sizes (A2). */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const clock = (page: Page) => page.getByTestId("clock-app");

async function layoutOf(page: Page): Promise<WorkspaceLayout> {
  return ((await apiAs(page, "GET", "/api/me")).body as { preferences: { workspace: { layout: WorkspaceLayout } } }).preferences.workspace.layout;
}
async function clockWidgetOnHome(page: Page) {
  const apps = ((await apiAs(page, "GET", "/api/apps")).body as { id: string }[]).map((a) => a.id) as never[];
  const l = normalizeLayout((await layoutOf(page)) ?? null, apps);
  const space = l.desktop.spaces[0]!.id;
  const where = isMobile(page) ? { surface: "mobile" as const, page: 0, cell: { c: 0, r: 0 } } : { surface: "desktop" as const, space, cell: { c: 0, r: 0 } };
  expect((await apiAs(page, "PATCH", "/api/preferences", { workspace: { layout: addWidget(l, "clock", where, "w_clock0001") } })).status).toBe(200);
  await reloadUnlocked(page);
  await expect(page.locator('[data-widget="w_clock0001"]')).toBeVisible();
}
const angle = async (page: Page, testId: string) => Number(await page.getByTestId(testId).first().getAttribute("data-angle"));

test("A1: a tap on a city puts it on top (name, time, analog hands of its zone); one at a time; kept after a reload", async ({ page }) => {
  await signUpViaApi(page, "Мировое", "Время");
  await openApp(page, "clock");
  await expect(clock(page)).toBeVisible();
  const hero = page.getByTestId("clock-world-hero");
  const omsk = clock(page).getByTestId("clock-city-select").and(page.locator('[data-zone="Asia/Omsk"]'));
  await omsk.click();
  await expect(hero).toHaveAttribute("data-zone", "Asia/Omsk");
  // The old city fades out (about 0.2 s) while the new one comes in.
  await expect(page.getByTestId("clock-here-name")).toHaveCount(1);
  await expect(page.getByTestId("clock-here-name")).toHaveText("Омск");
  const omskTime = await page.evaluate(() => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Omsk", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.now()));
  await expect(page.getByTestId("clock-here-time")).toHaveText(omskTime);
  await expect(page.getByTestId("clock-analog")).toHaveAttribute("data-zone", "Asia/Omsk");
  await expect(omsk).toHaveAttribute("aria-pressed", "true");
  // The hour hand shows Omsk's hour (UTC+6), the second hand glides.
  const expected = await page.evaluate(() => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Omsk", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(Date.now()).map((x) => [x.type, Number(x.value)]));
    return ((p.hour! % 12) * 30 + p.minute! / 2) % 360;
  });
  await expect.poll(async () => Math.abs((await angle(page, "clock-hand-hour")) - expected)).toBeLessThan(1.5);
  const s1 = await angle(page, "clock-hand-second");
  await page.waitForTimeout(400);
  const s2 = await angle(page, "clock-hand-second");
  expect((s2 - s1 + 360) % 360).toBeGreaterThan(0.5);
  // Another city replaces it (one at a time).
  const kgd = clock(page).getByTestId("clock-city-select").and(page.locator('[data-zone="Europe/Kaliningrad"]'));
  await kgd.click();
  await expect(hero).toHaveAttribute("data-zone", "Europe/Kaliningrad");
  await expect(omsk).toHaveAttribute("aria-pressed", "false");
  await expect(clock(page).locator('[aria-pressed="true"]')).toHaveCount(1);
  // The panel did not change its height while switching.
  const h1 = (await hero.boundingBox())!.height;
  await omsk.click();
  await page.waitForTimeout(80);
  const h2 = (await hero.boundingBox())!.height;
  expect(Math.abs(h2 - h1)).toBeLessThan(2);
  // Kept after a reload.
  await reloadUnlocked(page);
  await openApp(page, "clock");
  await expect(page.getByTestId("clock-world-hero")).toHaveAttribute("data-zone", "Asia/Omsk");
});

test("A2: the Clock widget shows the selected city; its menu switches 2 × 2 ⇄ 4 × 2, icons move aside, nothing lost; saved", async ({ page }) => {
  await signUpViaApi(page, "Виджет", "Мира");
  await clockWidgetOnHome(page);
  const w = page.locator('[data-widget="w_clock0001"]');
  // Select Omsk in Clock: the widget follows.
  await openApp(page, "clock");
  await clock(page).getByTestId("clock-city-select").and(page.locator('[data-zone="Asia/Omsk"]')).click();
  await reloadUnlocked(page);
  await expect(w.getByTestId("clock-widget")).toHaveAttribute("data-zone", "Asia/Omsk");
  await expect(w.getByTestId("clock-widget-city")).toHaveText("Омск");
  const small = (await w.boundingBox())!;
  const before = (await layoutOf(page)).mobile.pages[0]!.length + (await layoutOf(page)).desktop.spaces[0]!.items.length;
  // Long press → the menu with the size picker (only sizes it has).
  const b = small;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId("widget-sizes")).toBeVisible();
  await expect(page.getByTestId("widget-size-s")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("widget-size-w").click();
  await expect(w.getByTestId("clock-widget")).toHaveAttribute("data-size", "w");
  await expect.poll(async () => (await w.boundingBox())!.width).toBeGreaterThan(small.width * 1.7);
  await expect.poll(async () => (await layoutOf(page)).widgets[0]!.size).toBe("w");
  // Nothing went missing.
  const l = await layoutOf(page);
  expect(l.mobile.pages[0]!.length + l.desktop.spaces[0]!.items.length).toBe(before);
  // No icon under the wide widget.
  const wb = (await w.boundingBox())!;
  const icons = await page.locator("[data-home-grid] [data-tile]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })));
  for (const c of icons) expect(c.x > wb.x && c.x < wb.x + wb.width && c.y > wb.y && c.y < wb.y + wb.height).toBe(false);
  // Kept after a reload; and back to 2 × 2.
  await reloadUnlocked(page);
  await expect(w.getByTestId("clock-widget")).toHaveAttribute("data-size", "w");
  const big = (await w.boundingBox())!;
  await page.mouse.move(big.x + big.width / 2, big.y + big.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.getByTestId("widget-size-s").click();
  await expect(w.getByTestId("clock-widget")).toHaveAttribute("data-size", "s");
  await expect.poll(async () => (await layoutOf(page)).widgets[0]!.size).toBeUndefined();
});

test("A2: the Calculator widget has one size: no size picker in its menu", async ({ page }) => {
  await signUpViaApi(page, "Один", "Размер");
  const apps = ((await apiAs(page, "GET", "/api/apps")).body as { id: string }[]).map((a) => a.id) as never[];
  const l = normalizeLayout((await layoutOf(page)) ?? null, apps);
  const where = isMobile(page) ? { surface: "mobile" as const, page: 0, cell: { c: 0, r: 0 } } : { surface: "desktop" as const, space: l.desktop.spaces[0]!.id, cell: { c: 0, r: 0 } };
  await apiAs(page, "PATCH", "/api/preferences", { workspace: { layout: addWidget(l, "calculator", where, "w_calc00001") } });
  await reloadUnlocked(page);
  const w = page.locator('[data-widget="w_calc00001"]');
  const b = (await w.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 12);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId("home-context-menu")).toBeVisible();
  await expect(page.getByTestId("widget-sizes")).toHaveCount(0);
});
