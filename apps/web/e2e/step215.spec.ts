import { expect, test, type Page } from "@playwright/test";
import { addWidget, normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { addWidgetFromPicker, apiAs, homeSwitcher, openApp, phoneHome, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Step 2.15: the desktop on the whole screen, phone navigation (bar / buttons),
 * 4 icons per row, dock search toggle, grouped Notification Center, «Добавить
 * виджет», free widget drag, widget-only pages, multi-select, one theme.
 */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

async function layoutOf(page: Page): Promise<WorkspaceLayout> {
  return ((await apiAs(page, "GET", "/api/me")).body as { preferences: { workspace: { layout: WorkspaceLayout } } }).preferences.workspace.layout;
}
/** The stored layout once something was saved (polls tolerate the moment before the first save). */
async function storedLayout(page: Page): Promise<WorkspaceLayout | undefined> {
  return ((await apiAs(page, "GET", "/api/me")).body as { preferences?: { workspace?: { layout?: WorkspaceLayout } } }).preferences?.workspace?.layout;
}

async function saveLayout(page: Page, edit: (l: WorkspaceLayout) => WorkspaceLayout) {
  const apps = ((await apiAs(page, "GET", "/api/apps")).body as { id: string }[]).map((a) => a.id) as never[];
  const l = edit(normalizeLayout((await layoutOf(page)) ?? null, apps));
  expect((await apiAs(page, "PATCH", "/api/preferences", { workspace: { layout: l } })).status).toBe(200);
  await reloadUnlocked(page);
}

test("the desktop takes the whole screen; no nine-dot button; phone: 4 icons per row, no round switcher button", async ({ page }) => {
  await signUpViaApi(page, "Экран", "Целиком");
  const vp = page.viewportSize()!;
  const home = (await page.getByTestId("home").boundingBox())!;
  expect(home.x).toBe(0);
  expect(home.y).toBe(0);
  expect(Math.round(home.width)).toBe(vp.width);
  expect(Math.round(home.height)).toBe(vp.height);
  await expect(page.getByTestId("launcher-button")).toHaveCount(0);
  if (isMobile(page)) {
    await expect(page.getByTestId("mobile-switcher")).toHaveCount(0);
    await expect(page.getByTestId("home-gesture-bar")).toBeVisible();
    const grid = page.getByTestId("home-page-0").locator("[data-home-grid]");
    await expect(grid).toHaveAttribute("data-cols", "4");
    // Four icons share the first row.
    const tops = await page.locator("[data-home-item]").evaluateAll((els) => els.slice(0, 4).map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  } else {
    // PC: the dock and the icons never touch the system bar or the screen edge.
    const bar = (await page.getByTestId("system-bar").boundingBox())!;
    const first = (await page.locator("[data-home-item]").first().boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    const dock = (await page.getByTestId("dock").boundingBox())!;
    expect(dock.y + dock.height).toBeLessThan(vp.height);
    expect(vp.height - (dock.y + dock.height)).toBeLessThanOrEqual(12);
  }
});

test("phone navigation: «Полоской» by default; «Кнопками» shows back / home / open apps that work; saved with the account", async ({ page }) => {
  test.skip(!isMobile(page), "phone navigation");
  await signUpViaApi(page, "Навигация", "Кнопками");
  // Default: the gesture bar, and a swipe up on it at home opens the switcher.
  await expect(page.getByTestId("nav-buttons")).toHaveCount(0);
  await homeSwitcher(page);
  await page.getByTestId("app-switcher").click();
  await expect(page.getByTestId("app-switcher")).toHaveCount(0);

  await openApp(page, "settings");
  await page.getByTestId("settings-nav-desktop").last().click();
  await expect(page.getByTestId("phone-nav-bar")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("phone-nav")).not.toContainText(/iPhone|Android/);
  await page.getByTestId("phone-nav-buttons").click();
  await expect(page.getByTestId("phone-nav-buttons")).toHaveAttribute("aria-checked", "true");
  const nav = page.locator('section[data-state="open"]').getByTestId("nav-buttons");
  await expect(nav).toBeVisible();
  await expect(page.locator('section[data-state="open"]').getByTestId("home-indicator")).toHaveCount(0);
  // Back: one Settings page up, then out of Settings to the home screen.
  await nav.getByTestId("nav-back").click();
  await expect(page.getByTestId("settings-desktop")).toHaveCount(0);
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  await nav.getByTestId("nav-back").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="hidden"]')).toBeAttached();
  // Home screen: the buttons are there too; the square opens the switcher, home closes it.
  const homeNav = page.getByTestId("home").getByTestId("nav-buttons");
  await expect(homeNav).toBeVisible();
  await homeNav.getByTestId("nav-recents").click();
  await expect(page.getByTestId("switcher-card-settings")).toBeVisible();
  await page.getByTestId("switcher-card-settings").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  await page.locator('section[data-state="open"]').getByTestId("nav-home").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="hidden"]')).toBeAttached();
  // Kept after a reload (the account's layout).
  await expect.poll(async () => (await storedLayout(page))?.appearance.phoneNav).toBe("buttons");
  await reloadUnlocked(page);
  await expect(page.getByTestId("home").getByTestId("nav-buttons")).toBeVisible();
});

test("PC dock: the search can be turned off; the apps stay centred as if it never was there", async ({ page }) => {
  test.skip(isMobile(page), "PC dock");
  await signUpViaApi(page, "Док", "Безпоиска");
  await expect(page.getByTestId("dock-search")).toBeVisible();
  await openApp(page, "settings");
  await page.getByTestId("settings-nav-desktop").last().click();
  await page.getByTestId("dock-search-setting").getByRole("switch").click();
  await expect(page.getByTestId("dock-search")).toHaveCount(0);
  await expect(page.getByTestId("dock")).not.toHaveAttribute("data-search", "true");
  const vp = page.viewportSize()!;
  const dock = (await page.getByTestId("dock").boundingBox())!;
  expect(Math.abs(dock.x + dock.width / 2 - vp.width / 2)).toBeLessThanOrEqual(2);
  // The first item is an app now (no field before it), with the dock's own padding only.
  // (The dock apps glide into place, so wait for them to settle.)
  await expect
    .poll(async () => {
      const d = (await page.getByTestId("dock").boundingBox())!;
      return (await page.locator("[data-dock-app]").first().boundingBox())!.x - d.x;
    })
    .toBeLessThan(20);
  await expect.poll(async () => (await storedLayout(page))?.appearance.dockSearch).toBe(false);
});

test("Notification Center: grouped by app, a group opens and folds, clear one / a group / all (second tap confirms), scrolls; phone shows time and date", async ({ page }) => {
  await signUpViaApi(page, "Центр", "Уведомлений");
  for (const t of ["Первое", "Второе", "Третье"]) await apiAs(page, "POST", "/api/notifications/dev/system-update", { title: t, body: "Текст" });
  for (const [i, t] of ["Подъём", "Пробежка"].entries()) await apiAs(page, "POST", "/api/notifications/clock", { type: "clock.alarm", title: t, body: "07:0" + i, id: "a" + i, device: "other" });
  await reloadUnlocked(page);
  if (isMobile(page)) {
    // Pulled down from the very top edge (a real touch gesture).
    const cdp = await page.context().newCDPSession(page);
    const w = page.viewportSize()!.width;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: w / 2, y: 2 }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: w / 2, y: 2 + i * 42 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else await page.getByTestId("bell").click();
  const nc = page.getByTestId("notification-center");
  await expect(nc).toBeVisible();
  if (isMobile(page)) {
    await expect(nc.getByTestId("notifications-time")).toHaveText(/^\d{2}:\d{2}$/);
    await expect(nc.getByTestId("notifications-date")).not.toBeEmpty();
  }
  // The system glass: translucent, blurred.
  const glass = await nc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, blur: cs.backdropFilter || (cs as unknown as { webkitBackdropFilter: string }).webkitBackdropFilter };
  });
  expect(glass.blur).toContain("blur");
  expect(glass.bg).toMatch(/rgba\(255, 255, 255, 0\.7\d*\)/);

  const groups = nc.getByTestId("notification-group");
  await expect(groups).toHaveCount(2);
  const system = nc.locator('[data-testid="notification-group"][data-app="system"]');
  await expect(system).toHaveAttribute("data-count", "3");
  // Collapsed: only the newest card of each group.
  await expect(system.getByTestId("notification")).toHaveCount(1);
  await expect(system.getByTestId("notification-more")).toHaveText("Ещё 2");
  await system.getByTestId("notification-group-expand").click();
  await expect(system).toHaveAttribute("data-expanded", "true");
  await expect(system.getByTestId("notification")).toHaveCount(3);
  // One notification: its ×.
  await system.getByTestId("notification").first().hover();
  await system.getByTestId("notification").first().getByTestId("notification-clear").click();
  await expect(system).toHaveAttribute("data-count", "2");
  // «Показать меньше» folds it back.
  await system.getByTestId("notification-group-collapse").click();
  await expect(system).not.toHaveAttribute("data-expanded", "true");
  // A whole group: ×, then «Очистить».
  const clock = nc.locator('[data-testid="notification-group"][data-app="clock"]');
  await clock.getByTestId("notification-group-expand").click();
  await clock.getByTestId("notification-group-clear").click();
  await expect(clock.getByTestId("notification-group-clear-confirm")).toHaveText("Очистить");
  await clock.getByTestId("notification-group-clear-confirm").click();
  await expect(nc.locator('[data-testid="notification-group"][data-app="clock"]')).toHaveCount(0);
  await expect.poll(async () => ((await apiAs(page, "GET", "/api/notifications")).body.items as { app: string }[]).filter((n) => n.app === "clock").length).toBe(0);
  // Everything: the trash, then «Очистить».
  await nc.getByTestId("notifications-clear-all").click();
  await nc.getByTestId("notifications-clear-all-confirm").click();
  await expect(nc.getByTestId("notifications-empty")).toBeVisible();
  await expect.poll(async () => (await apiAs(page, "GET", "/api/notifications")).body.items.length).toBe(0);
});

test("«Добавить виджет»: the catalogue, then the widget's page; phone: first free place from the top; PC: near the menu", async ({ page }) => {
  await signUpViaApi(page, "Добавить", "Виджет");
  if (isMobile(page)) {
    const pg = (await page.getByTestId("home-page-0").boundingBox())!;
    await page.mouse.move(pg.x + 30, pg.y + pg.height - 30);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await page.getByTestId("home-appearance").click();
    await expect(page.getByTestId("brush-widgets")).toContainText("Добавить виджет");
    await page.getByTestId("brush-widgets").click();
  } else {
    await page.mouse.click(1100, 600, { button: "right" });
    await expect(page.getByTestId("menu-widgets")).toContainText("Добавить виджет");
    await page.getByTestId("menu-widgets").click();
  }
  // List: search, previews, names, the app each one comes from.
  await expect(page.getByTestId("widgets-list")).toBeVisible();
  await expect(page.getByTestId("widget-card-clock")).toContainText("Часы");
  await expect(page.getByTestId("widget-card-clock")).toContainText("Аналоговые часы");
  await page.getByTestId("widgets-search").fill("калькул");
  await expect(page.getByTestId("widget-card-clock")).toHaveCount(0);
  await page.getByTestId("widgets-search").fill("");
  await page.getByTestId("widget-card-clock").click();
  await expect(page.getByTestId("widget-config-clock")).toBeVisible();
  await expect(page.getByTestId("widget-config-preview").getByTestId("clock-widget")).toBeVisible();
  await page.getByTestId("widget-config-back").click();
  await addWidgetFromPicker(page, "clock");
  const l = await layoutOf(page);
  const w = l.widgets.find((x) => x.type === "clock")!;
  const cells = isMobile(page) ? l.mobile.cells : l.desktop.cells;
  const at = cells[`widget:${w.id}`]!;
  if (isMobile(page)) {
    // 9 apps on 4 columns: rows 0 and 1 full, one icon in row 2 → the first free 2 x 2 is at column 1 of row 2.
    expect(at).toEqual({ c: 1, r: 2 });
  } else {
    // Near where the menu was opened (right part of the screen, lower half).
    const grid = page.getByTestId("desktop-grid");
    const cols = Number(await grid.getAttribute("data-cols"));
    expect(at.c).toBeGreaterThan(cols / 2);
    expect(at.r).toBeGreaterThan(0);
  }
  // No icon moved for it.
  const keys = Object.keys(cells).filter((k) => k.startsWith("app:"));
  expect(keys.every((k) => !(cells[k]!.c >= at.c && cells[k]!.c < at.c + 2 && cells[k]!.r >= at.r && cells[k]!.r < at.r + 2))).toBe(true);
});

test("widget drag: follows the pointer freely, snaps on release, never past the bottom; a page with only a widget stays", async ({ page }) => {
  test.skip(!isMobile(page), "phone pages");
  await signUpViaApi(page, "Перенос", "Виджета");
  await saveLayout(page, (l) => addWidget(l, "clock", { surface: "mobile", page: 0, cell: { c: 2, r: 2 } }, "w_drag0001"));
  const pg = (await page.getByTestId("home-page-0").boundingBox())!;
  await page.mouse.move(pg.x + pg.width / 2, pg.y + pg.height - 30);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId("home")).toHaveAttribute("data-editing", "true");
  const widget = page.getByTestId("widget-clock");
  const start = (await widget.boundingBox())!;
  const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Mid-drag: exactly where the pointer took it (no hopping between cells).
  await page.mouse.move(from.x - 37, from.y + 23, { steps: 5 });
  const mid = (await widget.boundingBox())!;
  expect(Math.abs(mid.x - (start.x - 37))).toBeLessThanOrEqual(8);
  expect(Math.abs(mid.y - (start.y + 23))).toBeLessThanOrEqual(8);
  // Far below the screen: it stays inside the page (above the dots and the navigation).
  await page.mouse.move(from.x - 37, from.y + 2000, { steps: 8 });
  const host = (await page.getByTestId("home-page-0").boundingBox())!;
  const low = (await widget.boundingBox())!;
  expect(low.y + low.height).toBeLessThanOrEqual(host.y + host.height + 2);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const placed = (await widget.boundingBox())!;
  expect(placed.y + placed.height).toBeLessThanOrEqual(host.y + host.height + 2);
  // Snapped to the lowest row where the whole 2 x 2 block still fits on the page.
  await expect.poll(async () => (await storedLayout(page))?.mobile.cells["widget:w_drag0001"]?.r).toBe(3);

  // A page whose only content is a widget is kept (it is content of the desktop).
  await saveLayout(page, (l) => {
    const pages = [l.mobile.pages[0]!, []];
    return { ...l, mobile: { ...l.mobile, pages }, widgets: l.widgets.map((w) => ({ ...w, container: "1" })) };
  });
  await expect(page.getByTestId("page-dots")).toBeVisible();
  await expect(page.getByTestId("home-page-1").getByTestId("widget-clock")).toBeAttached();
  const l = await layoutOf(page);
  expect(l.mobile.pages).toHaveLength(2);
  expect(l.widgets[0]!.container).toBe("1");
});

test("PC: Ctrl / Cmd + click and a selection frame select several icons; they move together, each into its own cell; no Rename", async ({ page }) => {
  test.skip(isMobile(page), "PC mouse");
  await signUpViaApi(page, "Выделение", "Группой");
  const mail = page.getByTestId("app-mail");
  const settings = page.getByTestId("app-settings");
  const a = (await mail.boundingBox())!;
  // A frame from free space over the first two icons.
  await page.mouse.move(a.x - 8, a.y + a.height + 40);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width * 1.6, a.y + 10, { steps: 8 });
  await expect(page.getByTestId("selection-frame")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("selection-frame")).toHaveCount(0);
  await expect(mail).toHaveAttribute("data-selected", "true");
  await expect(settings).toHaveAttribute("data-selected", "true");
  // Ctrl + click adds one and takes it out again.
  await page.keyboard.down("Control");
  await page.getByTestId("app-notes").click();
  await expect(page.getByTestId("app-notes")).toHaveAttribute("data-selected", "true");
  await page.getByTestId("app-notes").click();
  await expect(page.getByTestId("app-notes")).not.toHaveAttribute("data-selected", "true");
  await page.keyboard.up("Control");
  // Drag one of them: the selection moves as a group.
  const grid = page.getByTestId("desktop-grid");
  const cw = Number(await grid.getAttribute("data-cell-w"));
  const rh = Number(await grid.getAttribute("data-row-h"));
  await page.mouse.move(a.x + a.width / 2, a.y + 24);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + 30, { steps: 3 });
  await expect(page.getByTestId("drag-group-count")).toHaveText("2");
  await page.mouse.move(a.x + a.width / 2 + cw * 3, a.y + 24 + rh * 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await storedLayout(page))?.desktop.cells["app:mail"]).toEqual({ c: 3, r: 2 });
  const cells = (await layoutOf(page)).desktop.cells;
  expect(cells["app:settings"]).toEqual({ c: 4, r: 2 });
  const all = await grid.locator("[data-cell]").evaluateAll((els) => els.map((e) => e.getAttribute("data-cell")));
  expect(new Set(all).size).toBe(all.length);
  // Escape ends the selection; built-in apps have no Rename.
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-selected]")).toHaveCount(0);
  await mail.click({ button: "right" });
  await expect(page.getByTestId("menu-rename")).toHaveCount(0);
});

test("one theme for everything: dark makes the desktop, the system bar / dock glass, the Notification Center and the apps dark", async ({ page }) => {
  await signUpViaApi(page, "Тёмная", "Тема");
  await saveLayout(page, (l) => ({ ...l, appearance: { ...l.appearance, theme: "dark", wallpaper: { kind: "preset", id: "wave-light" } } }));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The built-in wallpaper switches to its night version (dark base colour).
  const wp = await page.getByTestId("home").evaluate((el) => getComputedStyle(el).backgroundImage + getComputedStyle(el).backgroundColor);
  expect(wp).toContain("rgb(21, 19, 29)");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--glass-bg").trim())).toBe("rgba(30, 30, 40, 0.72)");
  await openApp(page, "clock");
  const bg = await page.locator('[data-testid="window-clock"]').evaluate((el) => getComputedStyle(el.classList.contains("vx-app") ? el : el.querySelector(".vx-app")!).backgroundColor);
  expect(bg).toBe("rgb(18, 18, 24)");
  if (isMobile(page)) await phoneHome(page);
});
