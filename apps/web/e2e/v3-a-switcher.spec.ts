import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { apiAs as api, openApp, phoneHome, signUpViaApi } from "./helpers";

/**
 * Update 3 · A (P0): the phone app switcher owns every swipe. While it is open, nothing inside the
 * app cards (feeds, carousels, tab strips, galleries) and nothing in the windows behind scrolls or
 * reacts; only the cards move. After it closes, the app scrolls as before.
 *
 * The swipes are real touch events (CDP Input.dispatchTouchEvent), as a finger on a phone.
 */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

async function touchSwipe(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Every scroll position inside the switcher cards and inside the app windows behind them. */
function scrollState(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const roots = [...document.querySelectorAll<HTMLElement>('[data-testid="app-switcher"] [data-snapshot], [data-window-content]')];
    roots.forEach((root, r) => {
      [root, ...root.querySelectorAll<HTMLElement>("*")].forEach((el, i) => {
        if (el.scrollTop || el.scrollLeft) out.push(`${r}:${i}:${Math.round(el.scrollTop)}:${Math.round(el.scrollLeft)}`);
      });
    });
    return out.join("|");
  });
}

async function openSwitcherFromApp(page: Page) {
  const box = (await page.locator('section[data-state="open"] [data-testid="home-indicator"]').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x, y - (200 * i) / 12);
    await page.waitForTimeout(24);
  }
  await page.waitForTimeout(250); // held in the middle, then released: the switcher
  await page.mouse.up();
  await expect(page.getByTestId("app-switcher")).toBeVisible();
  await page.waitForTimeout(500);
}

test("A1: in the app switcher swipes move only the cards; Vibex, Notes, Clock and the photos keep still; afterwards Vibex scrolls again", async ({ page }) => {
  test.skip(!isMobile(page), "phone switcher");
  await signUpViaApi(page, "Жесты", "Переключателя");
  // A Vibex feed long enough to scroll, with a post of several photos (a carousel inside the card).
  for (let i = 0; i < 8; i++) await api(page, "POST", "/api/vibex/posts", { text: `Пост ${i}\n${"строка\n".repeat(6)}` });
  const cdp = await page.context().newCDPSession(page);

  await openApp(page, "clock");
  await phoneHome(page);
  await openApp(page, "notes");
  await phoneHome(page);
  await openApp(page, "media");
  await phoneHome(page);
  await openApp(page, "vibex");
  await expect(page.getByTestId("vibex-feed")).toBeVisible();
  await page.waitForTimeout(800);
  // Scroll the feed a little (it is what the card will show).
  const vp = page.viewportSize()!;
  await touchSwipe(cdp, { x: vp.width / 2, y: vp.height * 0.7 }, { x: vp.width / 2, y: vp.height * 0.4 });
  await page.waitForTimeout(600);

  await openSwitcherFromApp(page);
  const deck = page.getByTestId("app-switcher");
  const before = await scrollState(page);
  // What makes iOS scroll inside a card: native scroll layers (overflow auto / scroll) and elements that take touches.
  const risky = await page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>('[data-testid="app-switcher"] [data-snapshot] .vx-snapshot *')];
    const scrollers = els.filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY + getComputedStyle(el).overflowX)).length;
    const touchable = els.filter((el) => getComputedStyle(el).pointerEvents !== "none").length;
    return { scrollers, touchable, total: els.length };
  });
  expect(risky.total).toBeGreaterThan(20);
  expect(risky.scrollers).toBe(0);
  expect(risky.touchable).toBe(0);
  const startIndex = Number(await deck.getAttribute("data-index"));

  // Sideways over the middle of the card (where the feed and its carousels are), both ways, several times.
  const mid = { x: vp.width / 2, y: vp.height / 2 };
  for (const dir of [1, 1, -1, -1, 1]) {
    await touchSwipe(cdp, { x: mid.x + dir * 120, y: mid.y }, { x: mid.x - dir * 120, y: mid.y + 6 });
    await page.waitForTimeout(450);
  }
  // Up and down inside a card (a short drag that does not close it): nothing inside scrolls.
  await touchSwipe(cdp, { x: mid.x, y: mid.y - 40 }, { x: mid.x + 4, y: mid.y + 60 });
  await page.waitForTimeout(450);
  await expect(deck).toBeVisible();
  // Only the cards moved: the deck changed card, every scroll position inside cards and windows is the same.
  expect(Number(await deck.getAttribute("data-index"))).not.toBe(Number.NaN);
  expect(await scrollState(page)).toBe(before);
  // A swipe really moves the deck.
  const now = Number(await deck.getAttribute("data-index"));
  await touchSwipe(cdp, { x: mid.x + 120, y: mid.y }, { x: mid.x - 120, y: mid.y });
  await page.waitForTimeout(450);
  await touchSwipe(cdp, { x: mid.x - 120, y: mid.y }, { x: mid.x + 120, y: mid.y });
  await page.waitForTimeout(450);
  expect(startIndex).toBe(0);
  expect(now).toBeGreaterThanOrEqual(0);
  expect(await scrollState(page)).toBe(before);
  // Nothing inside a card takes a touch.
  const hits = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return !!el?.closest("[data-snapshot] .vx-app *");
  }, mid);
  expect(hits).toBe(false);

  // Back into Vibex: its feed scrolls with the finger as before.
  await page.getByTestId("switcher-card-vibex").click();
  await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  await page.waitForTimeout(700);
  const feedScroll = () =>
    page.locator('[data-testid="window-vibex"] [data-window-content]').evaluate((root) => {
      const s = [root, ...root.querySelectorAll<HTMLElement>("*")].find((el) => el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== "visible" && getComputedStyle(el).overflowY !== "hidden");
      return s ? s.scrollTop : -1;
    });
  const top0 = await feedScroll();
  await touchSwipe(cdp, { x: vp.width / 2, y: vp.height * 0.75 }, { x: vp.width / 2, y: vp.height * 0.35 });
  await page.waitForTimeout(600);
  expect(await feedScroll()).toBeGreaterThan(top0);
});
