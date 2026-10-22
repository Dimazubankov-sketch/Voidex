import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, signUpViaApi } from "./helpers";

/** Stage B: Clock — momentum drums (B1) and sound that stays (B2). Real touch input through CDP. */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

/**
 * A swipe of `dy` px over `ms` on a drum. Slow ones use real touch input (CDP); quick ones are dispatched
 * inside the page every 16 ms (CDP round trips here take ~60 ms each, far slower than a finger).
 */
async function flick(page: Page, wheel: Locator, dy: number, ms: number) {
  const b = (await wheel.boundingBox())!;
  const x = b.x + b.width / 2;
  const y0 = b.y + b.height / 2 + (dy < 0 ? 60 : -60);
  if (ms >= 400) {
    const cdp = await page.context().newCDPSession(page);
    const steps = Math.max(3, Math.round(ms / 40));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + (dy * i) / steps }] });
      await page.waitForTimeout(ms / steps);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    await wheel.evaluate(
      (el, { x, y0, dy, ms }) =>
        new Promise<void>((done) => {
          const target = document.elementFromPoint(x, y0) ?? el;
          const fire = (type: string, y: number) => target.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: "touch", clientX: x, clientY: y, bubbles: true, button: 0, isPrimary: true }));
          fire("pointerdown", y0);
          const steps = Math.max(3, Math.round(ms / 16));
          let i = 0;
          const tick = () => {
            i++;
            fire("pointermove", y0 + (dy * i) / steps);
            if (i < steps) setTimeout(tick, 16);
            else {
              fire("pointerup", y0 + dy);
              done();
            }
          };
          setTimeout(tick, 16);
        }),
      { x, y0, dy, ms },
    );
  }
  await page.waitForTimeout(2200);
}

const value = async (w: Locator) => Number(await w.getAttribute("aria-valuenow"));
const travelled = (from: number, to: number, count: number) => (to - from + count) % count;

for (const where of ["timer", "alarm"] as const) {
  test(`B1: ${where} drums: slow = one value, medium = a few, fast = many, always on an exact value`, async ({ page }) => {
    test.skip(!isMobile(page), "touch drums");
    await signUpViaApi(page, "Барабан", "Инерция");
    await openApp(page, "clock");
    const win = page.locator('[data-testid="window-clock"]');
    let wheel: Locator;
    if (where === "timer") {
      await win.getByTestId("clock-tab-timers").click();
      wheel = win.getByTestId("clock-timer-composer").getByTestId("clock-wheel-minutes");
    } else {
      await win.getByTestId("clock-tab-alarm").click();
      await win.getByTestId("clock-add").click();
      wheel = page.getByTestId("clock-wheel-alarm-minutes");
    }
    await expect(wheel).toBeVisible();
    // Slow: one row of finger travel (44 px) over 600 ms → exactly one value.
    let before = await value(wheel);
    await flick(page, wheel, -44, 600);
    expect(travelled(before, await value(wheel), 60)).toBe(1);
    // Medium swipe.
    before = await value(wheel);
    await flick(page, wheel, -90, 110);
    const medium = travelled(before, await value(wheel), 60);
    expect(medium).toBeGreaterThanOrEqual(3);
    expect(medium).toBeLessThanOrEqual(14);
    // Fast swipe: many more.
    before = await value(wheel);
    await flick(page, wheel, -160, 60);
    const fast = travelled(before, await value(wheel), 60);
    expect(fast).toBeGreaterThan(medium);
    // Resting exactly on a value (the selected row is centred).
    const offset = await wheel.evaluate((el) => el.scrollTop % 44);
    expect(offset).toBe(0);
  });
}

test("B2: the drum clicks once the first touch ends (iPhone gesture), and still clicks after the tab was hidden", async ({ page }) => {
  test.skip(!isMobile(page), "touch drums");
  await page.addInitScript(() => {
    const w = window as unknown as { __starts: number; AudioContext: typeof AudioContext };
    w.__starts = 0;
    const orig = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a: Parameters<typeof orig>) {
      w.__starts++;
      return orig.apply(this, a);
    };
  });
  await signUpViaApi(page, "Звук", "Часов");
  await openApp(page, "clock");
  const win = page.locator('[data-testid="window-clock"]');
  await win.getByTestId("clock-tab-timers").click();
  const wheel = win.getByTestId("clock-timer-composer").getByTestId("clock-wheel-minutes");
  // First touch unlocks sound (touchend is the iPhone gesture), the next drag clicks.
  await wheel.tap();
  await page.waitForTimeout(800);
  const s0 = await page.evaluate(() => (window as unknown as { __starts: number }).__starts);
  await flick(page, wheel, -132, 500);
  const s1 = await page.evaluate(() => (window as unknown as { __starts: number }).__starts);
  expect(s1 - s0).toBeGreaterThanOrEqual(2);
  // The tab goes to the background and comes back: the context is resumed / replaced, clicks go on.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await wheel.tap();
  await flick(page, wheel, -132, 500);
  const s2 = await page.evaluate(() => (window as unknown as { __starts: number }).__starts);
  expect(s2 - s1).toBeGreaterThanOrEqual(2);
});
