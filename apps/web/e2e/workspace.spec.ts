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

  // Brush → wallpaper and 4 icons per row.
  await finger.longPress(empty);
  await page.getByTestId("home-appearance").click();
  await page.getByTestId("wallpaper-gradient-night").click();
  await page.getByTestId("phone-columns-4").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("home-done").click();

  // Everything comes back from the server after a reload.
  await page.waitForTimeout(600); // debounced save
  await page.reload();
  await expect(page.getByTestId("workspace")).toBeVisible();
  await expect(folder).toHaveCount(1);
  await expect(folder).toHaveAccessibleName("Работа");
  await expect(page.getByTestId("app-settings")).toHaveCount(0);
  await expect(home).toHaveAttribute("style", /linear-gradient/);
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

  // Virtual desktops: a new one is empty; windows stay on the desktop they were opened on.
  await page.getByTestId("space-add").click();
  await expect(page.getByTestId("space-2")).toHaveAttribute("aria-selected", "true");
  await expect(folder).toHaveCount(0);
  await page.getByTestId("launcher-button").click();
  await page.getByTestId("launcher-settings").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  // With windows open, Ctrl+Alt+← / → switches desktops.
  await page.keyboard.press("Control+Alt+ArrowLeft");
  await expect(page.getByTestId("space-1")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid="window-settings"][data-state="hidden"]')).toBeAttached();
  await expect(folder).toHaveCount(1);
  await page.getByTestId("space-2").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  await page.getByTestId("window-menu").last().click();
  await page.getByTestId("menu-minimize").click();
  await page.getByTestId("space-1").click();

  // Right click on free space → categories view.
  const grid = (await page.getByTestId("desktop-grid").boundingBox())!;
  await page.mouse.click(grid.x + 20, grid.y + grid.height + 120, { button: "right" });
  await page.getByTestId("menu-view").click();
  await expect(page.getByTestId("desktop-categories")).toBeVisible();
  await expect(page.getByTestId("category-folders")).toBeVisible();
  await expect(page.getByTestId("home-context-menu")).toHaveCount(0);
  await page.mouse.click(40, 400, { button: "right" });
  await page.getByTestId("menu-view").click();

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
  await expect(page.getByTestId("space-2")).toBeVisible();
});

test("Settings → Desktop: text size and wallpaper apply to desktop labels only", async ({ page }) => {
  await signUpViaApi(page, "Ира", "Ву");
  await page.getByTestId("app-settings").click();
  if (isMobile(page)) await page.getByTestId("settings-nav-desktop").click();
  else await page.getByTestId("settings-nav-desktop").click();
  await expect(page.getByTestId("settings-desktop")).toBeVisible();
  await page.getByTestId("label-size-l").click();
  await page.getByTestId("wallpaper-color-e0f2fe").click();
  await expect(page.getByTestId("label-size-l")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("home")).toHaveAttribute("style", /rgb\(224, 242, 254\)/);
});
