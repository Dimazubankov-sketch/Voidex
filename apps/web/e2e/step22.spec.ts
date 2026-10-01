import { expect, test, type Locator, type Page } from "@playwright/test";
import { signUpViaApi } from "./helpers";

/** Step 2.2 regressions: dock, view switching, window geometry, dock vs windows, phone brush / widgets. */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function longPressTouch(page: Page, p: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  await page.waitForTimeout(650);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/**
 * A window's box once its open / maximize animation is over: no scale left in
 * its transform (on-screen size = layout size), fully opaque, and unchanged
 * between two reads. A stalled first frame can't pass for "settled".
 */
async function settledBox(l: Locator) {
  let prev = "";
  let same = 0;
  await expect
    .poll(
      async () => {
        const s = await l.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const e = el as HTMLElement;
          const done = Math.abs(r.width - e.offsetWidth) < 0.5 && Math.abs(r.height - e.offsetHeight) < 0.5 && getComputedStyle(e).opacity === "1";
          return done ? JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height }) : "";
        });
        same = s !== "" && s === prev ? same + 1 : 0;
        prev = s;
        return same >= 2; // three identical reads in a row
      },
      { intervals: [150] },
    )
    .toBe(true);
  return JSON.parse(prev) as { x: number; y: number; width: number; height: number };
}

/** Right click on free desktop space once the desktop has loaded (not its loading skeleton). */
async function desktopMenu(page: Page, x = 60, y = 500) {
  await expect(page.getByTestId("app-mail")).toBeVisible();
  await page.mouse.click(x, y, { button: "right" });
  await expect(page.getByTestId("home-context-menu")).toBeVisible();
}

const dockOrder = (page: Page) => page.locator("[data-dock-app]").evaluateAll((els) => els.map((e) => e.getAttribute("data-dock-app")));

test("dock: dragging inside the dock never hides the app's desktop icon; Esc cancels; drop reorders; drag out unpins; drag in pins", async ({ page }) => {
  test.skip(isMobile(page), "PC dock");
  await signUpViaApi(page, "Дора", "Док");
  const desktopMail = page.getByTestId("app-mail");
  await expect(desktopMail).toBeVisible();
  expect(await dockOrder(page)).toEqual(["mail", "settings", "vibex"]);

  // Drag Mail inside the dock: the desktop icon stays fully visible the whole time.
  const a = await center(page.getByTestId("dock-app-mail"));
  const b = await center(page.getByTestId("dock-app-settings"));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 10, a.y, { steps: 2 });
  await page.mouse.move(b.x + 30, b.y, { steps: 8 });
  await expect(page.getByTestId("drag-ghost")).toBeVisible();
  await expect(desktopMail).toBeVisible();
  expect(await desktopMail.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  // Preview only: the saved order is untouched until the drop. Esc cancels.
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("drag-ghost")).toHaveCount(0);
  await expect.poll(() => dockOrder(page)).toEqual(["mail", "settings", "vibex"]);
  await expect(desktopMail).toBeVisible();

  // A real drop reorders (and is saved).
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 10, a.y, { steps: 2 });
  await page.mouse.move(b.x + 30, b.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => dockOrder(page)).toEqual(["settings", "mail", "vibex"]);
  await expect(desktopMail).toBeVisible();

  // Drag up and out of the dock → unpinned; the desktop icon is still there.
  const v = await center(page.getByTestId("dock-app-vibex"));
  await page.mouse.move(v.x, v.y);
  await page.mouse.down();
  await page.mouse.move(v.x, v.y - 20, { steps: 2 });
  await page.mouse.move(v.x, v.y - 220, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => dockOrder(page)).toEqual(["settings", "mail"]);
  await expect(page.getByTestId("app-vibex")).toBeVisible();

  // Drag the desktop icon onto the dock → pinned again, the desktop icon stays.
  const from = await center(page.getByTestId("app-vibex").locator("[data-tile]"));
  const to = await center(page.getByTestId("dock-app-mail"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y, { steps: 2 });
  await page.mouse.move(to.x + 30, to.y, { steps: 14 });
  await page.mouse.up();
  await expect.poll(() => dockOrder(page)).toEqual(["settings", "mail", "vibex"]);
  await expect(page.getByTestId("app-vibex")).toBeVisible();

  await page.waitForTimeout(600);
  await page.reload();
  await expect.poll(() => dockOrder(page)).toEqual(["settings", "mail", "vibex"]);
});

test("view: Grid ↔ Categories switched many times stays on the last choice (no flip-back) and survives a reload", async ({ page }) => {
  test.skip(isMobile(page), "PC right-click");
  await signUpViaApi(page, "Вика", "Вид");
  await desktopMenu(page);
  await page.getByTestId("menu-view").click();
  const grid = page.getByTestId("menu-view-grid");
  const cats = page.getByTestId("menu-view-categories");
  // Quick back-and-forth: each click lands while the previous save / its echo is in flight.
  for (let i = 0; i < 4; i++) {
    await cats.click();
    await expect(page.getByTestId("desktop-categories")).toBeVisible();
    await page.waitForTimeout(150 + i * 120);
    await grid.click();
    await expect(page.getByTestId("desktop-grid")).toBeVisible();
    await page.waitForTimeout(150 + i * 120);
  }
  await cats.click();
  await expect(cats).toHaveAttribute("aria-checked", "true");
  // Let every save and every server echo arrive: the view must not move on its own.
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(250);
    expect(await page.getByTestId("desktop-grid").count()).toBe(0);
  }
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("desktop-categories")).toBeVisible();
  await desktopMenu(page);
  await page.getByTestId("menu-view").click();
  await page.getByTestId("menu-view-grid").click();
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByTestId("desktop-grid")).toBeVisible();
});

test("view race (slow network): our own save's echo arriving late never flips the view back", async ({ page }) => {
  test.skip(isMobile(page), "PC right-click");
  await signUpViaApi(page, "Рита", "Гонка");
  // The account refetch after each preferences.updated echo reads the server
  // right away but arrives late — like a slow mobile network.
  await page.route("**/api/me", async (route) => {
    const res = await route.fetch();
    await new Promise((r) => setTimeout(r, 1200));
    await route.fulfill({ response: res });
  });
  await desktopMenu(page);
  await page.getByTestId("menu-view").click();
  await page.getByTestId("menu-view-categories").click(); // saved ~350 ms later → echo → slow refetch (categories)
  await page.waitForTimeout(600);
  await page.getByTestId("menu-view-grid").click(); // the user changed their mind before the echo arrived
  await expect(page.getByTestId("desktop-grid")).toBeVisible();
  // The late "categories" copy lands during this window: the view must stay a grid.
  // (instant checks, not auto-retrying ones: a short flip must fail the test)
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(200);
    expect(await page.getByTestId("desktop-categories").count()).toBe(0);
  }
  await page.unroute("**/api/me");
  await page.reload();
  await expect(page.getByTestId("desktop-grid")).toBeVisible();
});

test("free placement: drop an icon anywhere, it stays there after a reload; the grid comes back unchanged", async ({ page }) => {
  test.skip(isMobile(page), "PC free placement");
  await signUpViaApi(page, "Фрида", "Фри");
  await desktopMenu(page);
  await page.getByTestId("menu-view").click();
  await page.getByTestId("menu-view-free").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("desktop-free")).toBeVisible();
  // Icons glide from the grid to their free spots (layout animation): grab the icon once it rests.
  const tileBox = async () => JSON.stringify(await page.getByTestId("app-settings").locator("[data-tile]").boundingBox());
  await expect.poll(async () => {
    const a = await tileBox();
    await page.waitForTimeout(100);
    return a === (await tileBox());
  }).toBe(true);
  const area = (await page.getByTestId("desktop-free").boundingBox())!;
  const from = await center(page.getByTestId("app-settings").locator("[data-tile]"));
  const target = { x: area.x + area.width * 0.7, y: area.y + area.height * 0.6 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 2 });
  await page.mouse.move(target.x, target.y, { steps: 14 });
  await page.mouse.up();
  const near = async () => {
    const c = await center(page.getByTestId("app-settings").locator("[data-tile]"));
    return Math.abs(c.x - target.x) < 70 && Math.abs(c.y - target.y) < 90;
  };
  await expect.poll(near).toBe(true);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId("desktop-free")).toBeVisible();
  await expect.poll(near).toBe(true);
  // The position adapts to another window size and never leaves the screen.
  await page.setViewportSize({ width: 1180, height: 820 });
  const tile = (await page.getByTestId("app-settings").boundingBox())!;
  expect(tile.x + tile.width).toBeLessThanOrEqual(1180);
  expect(tile.y + tile.height).toBeLessThanOrEqual(820);
  // Back to the grid: the grid order is intact.
  await desktopMenu(page, 590, 140); // free space (icons sit top-left and where Settings was dropped)
  await page.getByTestId("menu-view").click();
  await page.getByTestId("menu-view-free").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("desktop-grid")).toBeVisible();
  const order = await page.locator('[data-testid="desktop-grid"] > [data-home-item]').evaluateAll((els) => els.map((e) => e.getAttribute("data-home-item")));
  expect(order).toEqual(["app:mail", "app:settings", "app:vibex"]);
});

test("windows: a resized window reopens at its standard size; a maximized one reopens normal; maximized never covers the dock", async ({ page }) => {
  test.skip(isMobile(page), "PC windows");
  await signUpViaApi(page, "Оля", "Окно");
  const win = page.getByTestId("window-settings");
  await page.getByTestId("app-settings").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  const initial = await settledBox(win);

  // Resize from the bottom-right corner.
  const corner = { x: initial.x + initial.width - 4, y: initial.y + initial.height - 4 };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x - 160, corner.y - 120, { steps: 8 });
  await page.mouse.up();
  const resized = await settledBox(win);
  expect(resized.width).toBeLessThan(initial.width - 100);

  // Close and reopen → the standard geometry again.
  await page.getByTestId("window-menu").last().click();
  await page.getByTestId("menu-close").click();
  await expect(win).toHaveCount(0);
  await page.getByTestId("app-settings").click();
  const reopened = await settledBox(win);
  expect(Math.round(reopened.width)).toBe(Math.round(initial.width));
  expect(Math.round(reopened.height)).toBe(Math.round(initial.height));

  // Maximize: the window ends above the dock, the dock stays fully visible on top.
  await page.getByTestId("window-menu").last().click();
  await page.getByTestId("menu-maximize").click();
  await settledBox(win);
  const dock = (await page.getByTestId("dock").boundingBox())!;
  // Final geometry: the window ends just above the dock (no overlap, no big gap).
  const gap = async () => {
    const b = (await win.boundingBox())!;
    return dock.y - (b.y + b.height);
  };
  await expect.poll(gap).toBeGreaterThanOrEqual(0);
  expect(await gap()).toBeLessThan(16);
  const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("[data-dock]"), { x: dock.x + dock.width / 2, y: dock.y + dock.height / 2 });
  expect(hit).toBe(true);

  // Close a maximized window → it reopens normal (not maximized), standard size.
  await page.getByTestId("window-menu").last().click();
  await page.getByTestId("menu-close").click();
  await page.getByTestId("app-settings").click();
  const again = await settledBox(win);
  expect(Math.round(again.width)).toBe(Math.round(initial.width));
});

test("phone: long press → brush → Widgets: add the Desktops widget; round Desktops button; app menu says Minimize", async ({ page }) => {
  test.skip(!isMobile(page), "phone");
  await signUpViaApi(page, "Мира", "Моб");
  const box = (await page.getByTestId("home-page-0").boundingBox())!;
  await longPressTouch(page, { x: box.x + box.width / 2, y: box.y + box.height - 80 });
  await expect(page.getByTestId("home")).toHaveAttribute("data-editing", "true");
  await page.getByTestId("home-appearance").click();
  await page.getByTestId("brush-widgets").click();
  await expect(page.getByTestId("widgets-panel")).toBeVisible();
  await page.getByTestId("widgets-search").fill("рабоч");
  await expect(page.getByTestId("widget-card-desktops")).toBeVisible();
  await page.getByTestId("widgets-search").fill("zzzz");
  await expect(page.getByTestId("widget-card-desktops")).toHaveCount(0);
  await page.getByTestId("widgets-search").fill("");
  await page.getByTestId("widget-add-desktops").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("home-done").click();
  await expect(page.getByTestId("mobile-widgets").getByTestId("widget-desktops")).toBeVisible();

  // The round glass Desktops button at the bottom (not part of the icon grid).
  const btn = page.getByTestId("mobile-spaces");
  await expect(btn).toBeVisible();
  expect(await btn.evaluate((el) => !!el.closest("[data-home-container]"))).toBe(false);
  await btn.click();
  await expect(page.getByTestId("mobile-spaces-sheet")).toBeVisible();
  await expect(page.getByTestId("mobile-page-1")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  // Saved with the account.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId("mobile-widgets").getByTestId("widget-desktops")).toBeVisible();

  // Inside an app the [...] menu offers "Minimize" (not "Workspace"), back to the home screen.
  await page.getByTestId("app-settings").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
  await page.getByTestId("window-menu").last().click();
  await expect(page.getByTestId("menu-home")).toHaveCount(0);
  await expect(page.getByTestId("menu-minimize")).toHaveText(/Свернуть/);
  await page.getByTestId("menu-minimize").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="hidden"]')).toBeAttached();
  await expect(page.getByTestId("home")).toBeVisible();
});

test("PC: widgets panel from the right-click menu; the Desktops widget switches desktops; system icons can't be dragged out as images", async ({ page }) => {
  test.skip(isMobile(page), "PC");
  await signUpViaApi(page, "Пётр", "Вид");
  await desktopMenu(page);
  await page.getByTestId("menu-new-space").click();
  await page.getByTestId("dock-desktops").click();
  await page.getByTestId("dock-space-1").click();
  await desktopMenu(page);
  await page.getByTestId("menu-widgets").click();
  await page.getByTestId("widget-add-desktops").click();
  await page.keyboard.press("Escape");
  const widget = page.getByTestId("desktop-widgets").getByTestId("widget-desktops");
  await expect(widget).toBeVisible();
  await widget.getByTestId("widget-space-2").click();
  await expect(page.getByTestId("desktop-space")).toHaveAttribute("data-space", "2");

  // Icons / logos are system UI: no native drag, no callout (user images are not marked).
  const draggable = await page.getByTestId("dock-app-vibex").locator("img, svg").first().evaluate((el) => (el as HTMLElement).draggable ?? false);
  expect(draggable).toBe(false);
  expect(await page.getByTestId("dock").evaluate((el) => el.closest("[data-system-ui]") !== null)).toBe(true);
});
