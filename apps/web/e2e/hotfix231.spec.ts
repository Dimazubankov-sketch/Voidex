import { expect, test, type Locator, type Page } from "@playwright/test";
import { newPage, openApp, signUpViaApi } from "./helpers";

/**
 * Step 2.3.1 hotfix: the Vibex post action row stays inside its card at any
 * width; the phone app switcher shows only the cards (no "Desktops" button or
 * pages menu); moving icons draws no grid / drop-cell outline but still snaps.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

async function api(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const res = await fetch(url, {
        method,
        headers: { "X-Voidex-Client": "web", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
}

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Every action row inside its card, under the divider; "Share" fully visible. */
async function expectActionsInsideCards(page: Page) {
  const cards = page.locator('[data-testid="post-card"]:has([data-testid="post-actions"])');
  await expect(cards.first()).toBeVisible();
  const rows = await cards.evaluateAll((els) =>
    els.map((card) => {
      const c = card.getBoundingClientRect();
      const row = card.querySelector<HTMLElement>("[data-testid=post-actions]")!;
      const r = row.getBoundingClientRect();
      const buttons = [...row.querySelectorAll<HTMLElement>("button")].map((b) => b.getBoundingClientRect());
      const label = row.querySelector<HTMLElement>("[data-testid=post-share] span.truncate");
      return {
        inside: r.top >= c.top && r.bottom <= c.bottom + 0.5 && r.left >= c.left && r.right <= c.right + 0.5,
        buttonsInside: buttons.every((b) => b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5 && b.left >= r.left - 0.5 && b.right <= r.right + 0.5),
        divider: getComputedStyle(row).borderTopWidth !== "0px",
        shareFull: !label || label.scrollWidth <= label.clientWidth,
      };
    }),
  );
  for (const r of rows) expect(r).toEqual({ inside: true, buttonsInside: true, divider: true, shareFull: true });
}

test("vibex: the post action row (like · comment · share) stays inside the card at 320 / 390 / 430 and on PC", async ({ page }) => {
  await signUpViaApi(page);
  expect((await api(page, "POST", "/api/vibex/posts", { text: "Короткий пост." })).status).toBe(201);
  expect((await api(page, "POST", "/api/vibex/posts", { text: "Длинный пост для проверки. ".repeat(12) })).status).toBe(201);
  await openApp(page, "vibex");
  await expect(page.getByTestId("vibex-app")).toBeVisible();
  if (!isMobile(page)) return expectActionsInsideCards(page);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(300);
    await expectActionsInsideCards(page);
  }
});

test("vibex chats: the row's “…” button doesn't cover the time and the unread badge (shown on hover only)", async ({ page, browser }) => {
  const a = await signUpViaApi(page, "Ада", "Чат");
  const other = await newPage(browser, isMobile(page));
  await signUpViaApi(other, "Бен", "Чат");
  const chat = await api(other, "POST", "/api/vibex/chats/direct", { userId: a.id });
  expect((await api(other, "POST", `/api/vibex/chats/${chat.body.id}/messages`, { text: "Привет!" })).status).toBe(201);
  await openApp(page, "vibex");
  await page.getByRole("button", { name: /Сообщения/ }).first().click();
  const row = page.getByTestId("chat-row").first();
  await expect(row).toBeVisible();
  await expect(row.getByTestId("chat-unread")).toBeVisible();
  await expect(row.getByTestId("chat-row-menu")).toBeHidden();
  if (!isMobile(page)) {
    await row.hover();
    await expect(row.getByTestId("chat-row-menu")).toBeVisible();
  }
});

test("phone app switcher: only the app cards — no “Desktops” button, no pages menu", async ({ page }) => {
  test.skip(!isMobile(page), "phone switcher");
  await signUpViaApi(page);
  // Two apps running in the background (minimized from their [...] menu).
  for (const id of ["calculator", "mail"] as const) {
    await openApp(page, id);
    await page.getByTestId(`window-${id}`).getByTestId("window-menu").first().click();
    await page.getByTestId("menu-minimize").click();
    await expect(page.getByTestId("home")).toBeVisible();
  }
  await page.getByTestId("mobile-switcher").click();
  const sw = page.getByTestId("app-switcher");
  await expect(sw).toBeVisible();
  await expect(sw.getByTestId(/^switcher-card-/)).toHaveCount(2);
  await expect(page.getByTestId("switcher-pages")).toHaveCount(0);
  await expect(sw).not.toContainText(/Рабочие столы|Страницы/);
  // Every button in the switcher is a card or a card's close button.
  const names = await sw.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? e.getAttribute("aria-label") ?? ""));
  expect(names.every((n) => n.startsWith("switcher-card-") || n.startsWith("Закрыть"))).toBe(true);
  await expect(page.getByTestId("mobile-spaces-sheet")).toHaveCount(0);
  // Empty switcher: just the message.
  await sw.getByRole("button", { name: /^Закрыть/ }).first().click();
  await expect(sw.getByTestId(/^switcher-card-/)).toHaveCount(1);
  await sw.getByRole("button", { name: /^Закрыть/ }).first().click();
  await expect(page.getByTestId("switcher-empty")).toBeVisible();
  await expect(page.getByTestId("switcher-pages")).toHaveCount(0);
  await expect(page.getByTestId("app-switcher").getByRole("button")).toHaveCount(0);
});

test("PC: moving an icon draws no grid or drop-cell outline, but it still lands on the cell", async ({ page }) => {
  test.skip(isMobile(page), "PC mouse drag");
  await signUpViaApi(page);
  await expect(page.getByTestId("app-vibex")).toBeVisible();
  const grid = page.getByTestId("desktop-grid");
  const g = (await grid.boundingBox())!;
  const cw = Number(await grid.getAttribute("data-cell-w")) + Number(await grid.getAttribute("data-gap-x"));
  const rh = Number(await grid.getAttribute("data-row-h")) + Number(await grid.getAttribute("data-gap-y"));
  const to = { x: g.x + cw * 4 + cw / 2, y: g.y + rh + rh / 2 };
  const from = await center(page.getByTestId("app-vibex").locator("[data-tile]"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14);
    await page.waitForTimeout(16);
  }
  // Mid-drag: the target cell is known to the grid, but nothing outlines it.
  await expect(grid).toHaveAttribute("data-drop-cell", "4,1");
  await expect(page.getByTestId("home-drop-cell")).toHaveCount(0);
  const outlined = await grid.evaluate((el) => [...el.querySelectorAll<HTMLElement>("*")].filter((e) => getComputedStyle(e).borderStyle.includes("dashed")).length);
  expect(outlined).toBe(0);
  await page.mouse.up();
  await expect.poll(() => page.locator('[data-cell]:has([data-testid="app-vibex"])').first().getAttribute("data-cell")).toBe("4,1");
  await expect(grid).not.toHaveAttribute("data-drop-cell", /.*/);
});
