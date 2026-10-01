import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { signUpViaApi } from "./helpers";

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Real touch input (pointerType "touch") through the DevTools protocol. */
class Finger {
  private constructor(
    private cdp: CDPSession,
    private page: Page,
  ) {}
  static async on(page: Page) {
    return new Finger(await page.context().newCDPSession(page), page);
  }
  down(p: { x: number; y: number }) {
    return this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
  }
  async moveTo(from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
    for (let i = 1; i <= steps; i++) {
      await this.cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }],
      });
      await this.page.waitForTimeout(16);
    }
  }
  up() {
    return this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  async tap(p: { x: number; y: number }) {
    await this.down(p);
    await this.page.waitForTimeout(60);
    await this.up();
  }
  async longPress(p: { x: number; y: number }) {
    await this.down(p);
    await this.page.waitForTimeout(650);
    await this.up();
  }
}

test("phone home screen: edit mode, remove & restore, pages, folders, search, wallpaper — saved to the account", async ({ page }) => {
  test.skip(!isMobile(page), "phone gestures");
  await signUpViaApi(page, "Ева", "Ли");
  const finger = await Finger.on(page);
  const home = page.getByTestId("home");
  const page0 = page.getByTestId("home-page-0");
  const box = (await page0.boundingBox())!;
  const empty = { x: box.x + box.width / 2, y: box.y + box.height - 80 };

  // Long press on free space → edit mode: wiggle, brush top-left, ✓ top-right.
  await finger.longPress(empty);
  await expect(home).toHaveAttribute("data-editing", "true");
  await expect(page.getByTestId("home-appearance")).toBeVisible();
  await expect(page.getByTestId("home-done")).toBeVisible();

  // "−" removes the icon from the desktop only; the app stays in the app menu.
  await page.getByTestId("app-settings").getByTestId("home-remove-badge").click({ force: true });
  await expect(page.getByTestId("app-settings")).toHaveCount(0);
  await page.getByTestId("home-done").click();
  await expect(home).not.toHaveAttribute("data-editing", "true");
  await page.getByTestId("launcher-button").click();
  await expect(page.getByTestId("launcher-settings")).toBeVisible();
  await page.getByTestId("launcher-add-settings").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("launcher")).toHaveCount(0);
  await expect(page.getByTestId("app-settings")).toBeVisible();

  // Long press on an app → the phone menu: exactly remove / create folder / add to folder.
  await finger.longPress(await center(page.getByTestId("app-mail")));
  const menu = page.getByTestId("home-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await expect(page.getByTestId("menu-remove")).toBeVisible();
  await expect(page.getByTestId("menu-add-to-folder")).toBeVisible();

  // …create a folder: it opens for naming.
  await page.getByTestId("menu-create-folder").click();
  await expect(page.getByTestId("folder-overlay")).toBeVisible();
  await page.getByTestId("folder-name-input").fill("Работа");
  await page.getByTestId("folder-name-input").press("Enter");
  await expect(page.getByTestId("folder-name")).toHaveText("Работа");
  await page.getByTestId("folder-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("folder-overlay")).toHaveCount(0);
  const folder = page.locator('[data-testid^="folder-f_"]');
  await expect(folder).toHaveCount(1);

  // Drag Settings to the right edge and hold → a new page is created for it.
  const from = await center(page.getByTestId("app-settings"));
  await finger.down(from);
  await page.waitForTimeout(600); // long press: menu, then moving picks the icon up
  const edge = { x: box.x + box.width - 8, y: from.y };
  await finger.moveTo(from, edge);
  await page.waitForTimeout(1000);
  await finger.up();
  await expect(page.getByTestId("page-dots")).toBeVisible();
  await expect(page.getByTestId("home-page-1").getByTestId("app-settings")).toBeVisible();

  // Swipe back to page 1, then add Settings to the folder from its menu.
  await page.getByTestId("home-done").click();
  const p1 = await center(page.getByTestId("home-page-1"));
  await finger.down({ x: p1.x - 150, y: p1.y + 200 });
  await finger.moveTo({ x: p1.x - 150, y: p1.y + 200 }, { x: p1.x + 120, y: p1.y + 200 }, 6);
  await finger.up();
  await expect(page.getByTestId("page-dots").getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("page-dots").getByRole("tab").nth(1).click();
  await expect(page.getByTestId("app-settings")).toBeInViewport({ ratio: 1 });
  await page.waitForTimeout(400); // page slide finished
  await finger.longPress(await center(page.getByTestId("app-settings")));
  await page.getByTestId("menu-add-to-folder").click();
  await page.getByRole("menuitem", { name: "Работа" }).click();
  await expect(page.getByTestId("app-settings")).toHaveCount(0);
  await expect(page.getByTestId("page-dots")).toHaveCount(0); // the emptied page is gone

  // Pull down → quick search.
  const mid = { x: box.x + box.width / 2 };
  await finger.down({ x: mid.x, y: box.y + 40 });
  await finger.moveTo({ x: mid.x, y: box.y + 40 }, { x: mid.x, y: box.y + 200 }, 6);
  await finger.up();
  await expect(page.getByTestId("home-search-overlay")).toBeVisible();
  await page.getByTestId("home-search").fill("почт");
  await expect(page.getByTestId("search-result-mail")).toBeVisible();
  await page.getByTestId("home-search-cancel").click();

  // Brush → menu (Wallpaper · View · Widgets) → Wallpaper.
  await finger.longPress(empty);
  await page.getByTestId("home-appearance").click();
  await expect(page.getByTestId("brush-menu")).toBeVisible();
  await page.getByTestId("brush-wallpaper").click();
  await page.getByTestId("wallpaper-preset-wave-light").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("home-done").click();

  // Everything comes back from the server after a reload.
  await page.waitForTimeout(600); // debounced save
  await page.reload();
  await expect(page.getByTestId("workspace")).toBeVisible();
  await expect(folder).toHaveCount(1);
  await expect(folder).toHaveAccessibleName("Работа");
  await expect(page.getByTestId("app-settings")).toHaveCount(0);
  await expect(home).toHaveAttribute("style", /svg/);
  await folder.click();
  await expect(page.getByTestId("folder-overlay").getByTestId("app-settings")).toBeVisible();
  await expect(page.getByTestId("folder-overlay").getByTestId("app-mail")).toBeVisible();
});

test("PC home screen: right-click menu, drag to make a folder, search, virtual desktops, categories", async ({ page }) => {
  test.skip(isMobile(page), "PC mouse");
  await signUpViaApi(page, "Лев", "Ма");

  // Right click → Rename the icon (the app keeps its name elsewhere).
  await page.getByTestId("app-mail").click({ button: "right" });
  for (const id of ["open", "remove", "create-folder", "add-to-folder", "rename", "category"]) await expect(page.getByTestId(`menu-${id}`)).toBeVisible();
  await page.getByTestId("menu-rename").click();
  await page.getByTestId("rename-input").fill("Письма");
  await page.getByTestId("rename-save").click();
  await expect(page.getByTestId("app-mail")).toHaveAccessibleName("Письма");

  // Category menu is data, not hard-wired: move Mail to "Работа".
  await page.getByTestId("app-mail").click({ button: "right" });
  await page.getByTestId("menu-category").click();
  await page.getByTestId("menu-cat-work").click();

  // Drag Settings onto Mail and hold → a folder.
  const a = await center(page.getByTestId("app-settings").locator("[data-tile]"));
  const b = await center(page.getByTestId("app-mail").locator("[data-tile]"));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.waitForTimeout(500);
  await page.mouse.up();
  const folder = page.locator('[data-testid^="folder-f_"]');
  await expect(folder).toHaveCount(1);
  await expect(page.getByTestId("app-mail")).toHaveCount(0);

  // Open, rename, close.
  await folder.click();
  await expect(page.getByTestId("folder-overlay")).toBeVisible();
  await page.getByTestId("folder-name").click();
  await page.getByTestId("folder-name-input").fill("Главное");
  await page.getByTestId("folder-name-input").press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("folder-overlay")).toHaveCount(0);

  // Bottom search finds apps by name, alias and description, even inside folders.
  await page.getByTestId("home-search").fill("параметры");
  await expect(page.getByTestId("search-result-settings")).toBeVisible();
  await page.getByTestId("home-search").fill("");

  // No desktop tabs at the top any more (and no desktop "..."): desktops live in the dock.
  await expect(page.getByTestId("space-tabs")).toHaveCount(0);
  await expect(page.getByTestId("workspace-menu")).toHaveCount(0);
  const space = page.getByTestId("desktop-space");
  const goSpace = async (n: number) => {
    await page.getByTestId("dock-desktops").click();
    await page.getByTestId(`dock-space-${n}`).click();
    await expect(space).toHaveAttribute("data-space", String(n));
  };

  // Virtual desktops: a new one is empty; windows stay on the desktop they were opened on.
  await page.mouse.click(60, 500, { button: "right" });
  await page.getByTestId("menu-new-space").click();
  await expect(space).toHaveAttribute("data-space", "2");
  await expect(folder).toHaveCount(0);
  await page.getByTestId("launcher-button").click();
  await page.getByTestId("launcher-settings").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  // With windows open, Ctrl+Alt+← / → switches desktops.
  await page.keyboard.press("Control+Alt+ArrowLeft");
  await expect(space).toHaveAttribute("data-space", "1");
  await expect(page.locator('[data-testid="window-settings"][data-state="hidden"]')).toBeAttached();
  await expect(folder).toHaveCount(1);
  await goSpace(2);
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  await page.getByTestId("window-menu").last().click();
  await page.getByTestId("menu-minimize").click();
  await goSpace(1);

  // Right click on free space → View → Categories: applied at once, the menu stays.
  const grid = (await page.getByTestId("desktop-grid").boundingBox())!;
  await page.mouse.click(grid.x + 20, grid.y + grid.height + 120, { button: "right" });
  for (const id of ["appearance", "view", "widgets", "edit"]) await expect(page.getByTestId(`menu-${id}`)).toBeVisible();
  await page.getByTestId("menu-view").click();
  await page.getByTestId("menu-view-categories").click();
  await expect(page.getByTestId("desktop-categories")).toBeVisible();
  await expect(page.getByTestId("category-folders")).toBeVisible();
  await expect(page.getByTestId("menu-view-categories")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("menu-view-grid").click();
  await expect(page.getByTestId("desktop-grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);

  // Long press on free space → edit mode; a click on free space leaves it.
  await page.mouse.move(40, 400);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId("home")).toHaveAttribute("data-editing", "true");
  await page.mouse.click(40, 420);
  await expect(page.getByTestId("home")).not.toHaveAttribute("data-editing", "true");

  // Saved on the server: reload keeps folder, name and the second desktop.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(folder).toHaveAccessibleName("Главное");
  await page.getByTestId("dock-desktops").click();
  await expect(page.getByTestId("dock-space-2")).toBeVisible();
});

test("Settings → Desktop: scale (PC) / icons per row (phone), wallpaper, glass; no label colour / size", async ({ page }) => {
  await signUpViaApi(page, "Ира", "Ву");
  await page.getByTestId("app-settings").click();
  await page.getByTestId("settings-nav-desktop").click();
  await expect(page.getByTestId("settings-desktop")).toBeVisible();
  // Retired settings are gone; the profile sections are not in the Settings list.
  await expect(page.getByTestId("label-size")).toHaveCount(0);
  await expect(page.getByTestId("label-color")).toHaveCount(0);
  for (const id of ["personal", "security", "password", "phone", "email", "devices"]) await expect(page.getByTestId(`settings-nav-${id}`)).toHaveCount(0);
  if (isMobile(page)) {
    // Phones scale by icons per row only — no second scale control.
    await expect(page.getByTestId("scale")).toHaveCount(0);
    await page.getByTestId("phone-columns-4").click();
    await expect(page.getByTestId("phone-columns-4")).toHaveAttribute("aria-checked", "true");
  } else {
    await expect(page.getByTestId("phone-columns")).toHaveCount(0);
    await page.getByTestId("scale-compact").click();
    await expect(page.getByTestId("scale-compact")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("dock-scale-l").click();
    await expect(page.getByTestId("dock-scale-l")).toHaveAttribute("aria-checked", "true");
  }
  await page.getByTestId("wallpaper-preset-mist").click();
  await expect(page.getByTestId("home")).toHaveAttribute("style", /rgb\(240, 240, 243\)/);
  // Glass effect: a real document-wide setting (default on).
  await expect(page.locator("html")).toHaveAttribute("data-glass", "on");
  await page.getByTestId("glass-off").click();
  await expect(page.locator("html")).toHaveAttribute("data-glass", "off");
  await page.getByTestId("glass-medium").click();
  await expect(page.locator("html")).toHaveAttribute("data-glass", "medium");
});

test("phone: touch drag works inside a folder; first tap on − after a drag removes the icon", async ({ page }) => {
  test.skip(!isMobile(page), "phone gestures");
  await signUpViaApi(page, "Ада", "Ро");
  const finger = await Finger.on(page);
  // Folder with both apps (via the menus).
  await finger.longPress(await center(page.getByTestId("app-mail")));
  await page.getByTestId("menu-create-folder").click();
  await page.getByTestId("folder-name-input").press("Enter");
  await page.getByTestId("folder-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("folder-overlay")).toHaveCount(0);
  await finger.longPress(await center(page.getByTestId("app-settings")));
  await page.getByTestId("menu-add-to-folder").click();
  await page.getByTestId("home-context-menu").getByRole("menuitem").first().click();
  await page.locator('[data-testid^="folder-f_"]').click();
  const overlay = page.getByTestId("folder-overlay");
  await expect(overlay.locator("[data-home-item]")).toHaveCount(2);
  await page.waitForTimeout(400);
  const order = () => overlay.locator("[data-home-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-home-item")));
  const before = await order();
  const a = await center(overlay.locator("[data-home-item]").first().locator("[data-tile]"));
  const b = await center(overlay.locator("[data-home-item]").nth(1).locator("[data-tile]"));
  await finger.down(a);
  await page.waitForTimeout(600);
  await finger.moveTo(a, { x: b.x + 40, y: b.y }, 10);
  await page.waitForTimeout(400);
  await finger.up();
  await expect.poll(order).toEqual([...before].reverse());

  // Drag the first app out of the folder, then the very first tap on "−" works.
  const c = await center(overlay.locator("[data-home-item]").first().locator("[data-tile]"));
  const out = { x: c.x, y: (page.viewportSize()?.height ?? 900) - 120 };
  await finger.down(c);
  await finger.moveTo(c, out, 14);
  await page.waitForTimeout(700);
  await finger.moveTo(out, { x: out.x + 5, y: out.y - 20 }, 3);
  await page.waitForTimeout(300);
  await finger.up();
  await expect(overlay).toHaveCount(0);
  // The folder of one dissolves: Mail, Settings and Vibex are on the page again.
  const top = page.locator('[data-home-container="mobile:0"] > [data-home-item]');
  await expect(top).toHaveCount(3);
  const app = page.locator('[data-home-container="mobile:0"] [data-testid^="app-"]').first();
  await finger.tap(await center(app.getByTestId("home-remove-badge")));
  await expect(top).toHaveCount(2);
});

test("PC dock: pinned apps, hover desktops menu, reorder, unpin, pin by drag, empty dock leaves only search", async ({ page }) => {
  test.skip(isMobile(page), "PC dock");
  await signUpViaApi(page, "Дан", "Ок");
  const dockOrder = () => page.locator("[data-dock-app]").evaluateAll((els) => els.map((e) => e.getAttribute("data-dock-app")));
  await expect(page.getByTestId("dock")).toBeVisible();
  expect(await dockOrder()).toEqual(["mail", "settings", "vibex"]);

  // Hover the Desktops system icon → glass menu; create and switch desktops there.
  await page.getByTestId("dock-desktops").hover();
  await expect(page.getByTestId("dock-desktops-menu")).toBeVisible();
  await page.getByTestId("dock-space-add").click();
  await expect(page.getByTestId("desktop-space")).toHaveAttribute("data-space", "2");
  await page.getByTestId("dock-desktops").hover();
  await expect(page.getByTestId("dock-space-2")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("dock-space-1").click();
  await expect(page.getByTestId("desktop-space")).toHaveAttribute("data-space", "1");
  await page.mouse.move(700, 300);

  // Reorder inside the dock.
  const a = await center(page.getByTestId("dock-app-mail"));
  const b = await center(page.getByTestId("dock-app-settings"));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 10, a.y, { steps: 2 });
  await page.mouse.move(b.x + 40, b.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(dockOrder).toEqual(["settings", "mail", "vibex"]);

  // Open from the dock.
  await page.getByTestId("dock-app-mail").click();
  await expect(page.locator('[data-testid="window-mail"][data-state="open"]')).toBeVisible();
  await page.getByTestId("window-menu").last().click();
  await page.getByTestId("menu-close").click();

  // The search field is inside the dock's one glass shell.
  await expect(page.getByTestId("dock")).toHaveAttribute("data-glass-shell", "true");
  await expect(page.getByTestId("dock").getByTestId("home-search")).toBeVisible();

  // Unpin all apps and the Desktops item → no glass, only the search field.
  for (const id of ["mail", "settings", "vibex"]) {
    await expect(page.getByTestId("home-context-menu")).toHaveCount(0);
    await page.getByTestId(`dock-app-${id}`).click({ button: "right" });
    await page.getByTestId("menu-unpin").click();
  }
  await expect(page.getByTestId("home-context-menu")).toHaveCount(0);
  await page.getByTestId("dock-desktops").click({ button: "right" });
  await page.getByTestId("menu-unpin").click();
  await expect(page.getByTestId("dock")).not.toHaveAttribute("data-glass-shell", "true");
  await expect(page.locator("[data-dock-app]")).toHaveCount(0);
  await expect(page.getByTestId("home-search")).toBeVisible();
  // …and the Desktops item comes back from the desktop's right-click menu.
  await page.mouse.click(60, 500, { button: "right" });
  await page.getByTestId("menu-dock-desktops").click();
  await expect(page.getByTestId("dock-desktops")).toBeVisible();

  // Pin by context menu; it survives a reload.
  await page.getByTestId("app-settings").click({ button: "right" });
  await page.getByTestId("menu-pin").click();
  await expect(page.getByTestId("dock-app-settings")).toBeVisible();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId("dock-app-settings")).toBeVisible();
  expect(await dockOrder()).toEqual(["settings"]);
});

test("phone: long press → brush → View switches Grid / Categories in place, menu stays open; saved to the account", async ({ page }) => {
  test.skip(!isMobile(page), "phone home");
  await signUpViaApi(page, "Ли", "Ван");
  const finger = await Finger.on(page);
  // No permanent view button / "..." / desktops button at the top of the home screen.
  await expect(page.getByTestId("home-view")).toHaveCount(0);
  await expect(page.getByTestId("workspace-menu")).toHaveCount(0);
  const box = (await page.getByTestId("home-page-0").boundingBox())!;
  await finger.longPress({ x: box.x + box.width / 2, y: box.y + box.height - 80 });
  await page.getByTestId("home-appearance").click();
  for (const id of ["brush-wallpaper", "brush-view-row", "brush-widgets"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("brush-view-grid")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("brush-view-categories").click();
  await expect(page.getByTestId("home-categories")).toBeVisible();
  await expect(page.getByTestId("brush-menu")).toBeVisible(); // still open
  await expect(page.getByTestId("brush-view-row")).toContainText("По категориям");
  await expect(page.getByTestId("category-communication").getByTestId("app-mail")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("home-done").click();
  await page.getByTestId("app-mail").click(); // apps still open from the categories view
  await expect(page.locator('[data-testid="window-mail"][data-state="open"]')).toBeVisible();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId("home-categories")).toBeVisible();
});
