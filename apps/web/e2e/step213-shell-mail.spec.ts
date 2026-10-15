import { expect, test, type Page } from "@playwright/test";
import { apiAs, newPage, openApp, phoneHome, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Step 2.13: the phone app switcher has a blurred background as soon as it
 * opens (cards stay sharp); app marks are optically normalised; VoidOps Mail
 * turns addresses into safe links and archives a letter with a swipe to the
 * left on phones (undo, no accident on scroll, kept after a reload).
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

async function bar(page: Page) {
  const box = (await page.locator('section[data-state="open"] [data-testid="home-indicator"]').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A real touch drag (pointerType "touch"), as a finger does it. */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("switcher: the background is blurred the moment it opens, the cards are sharp; home has no blur", async ({ page }) => {
  test.skip(!isMobile(page), "phone switcher");
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpViaApi(page, "Размытый", "Фон");
  await openApp(page, "settings");
  await phoneHome(page);
  await openApp(page, "notes");
  await page.waitForTimeout(600);
  const { x, y } = await bar(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Only a little way up: the blur is already full (it does not ramp with the finger).
  for (let i = 1; i <= 4; i++) await page.mouse.move(x, y - 6 * i);
  const peek = page.getByTestId("gesture-backdrop");
  await expect(peek).toBeVisible();
  expect(Number(await peek.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
  expect(await peek.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("blur");
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + 6 * i, y - 24 - 18 * i);
  await page.waitForTimeout(250);
  await page.mouse.up();
  await expect(page.getByTestId("app-switcher")).toBeVisible();
  const backdrop = page.getByTestId("switcher-backdrop");
  await expect(backdrop).toBeVisible();
  expect(await backdrop.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("blur");
  // Fully blurred from the first frame of the switcher: no fade-in of the blur.
  expect(Number(await backdrop.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
  // The cards themselves are not blurred.
  const card = page.getByTestId("switcher-card-notes");
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => getComputedStyle(el).filter + getComputedStyle(el).backdropFilter)).not.toContain("blur");
  // Back home: the blur layer goes away.
  await page.getByTestId("app-switcher").click({ position: { x: 20, y: 120 } });
  await expect(page.getByTestId("app-switcher")).toHaveCount(0);
  await expect(page.getByTestId("switcher-backdrop")).toHaveCount(0);
});

test("app marks: the optical size of each logo is normalised (Appex Store not smaller than the others)", async ({ page }) => {
  await signUpViaApi(page, "Ровные", "Иконки");
  // Every built-in mark fills the same box (trimmed artwork) times its optical factor.
  const marks = page.locator("[data-optical]");
  await expect.poll(() => marks.count()).toBeGreaterThan(3);
  const sizes = await marks.evaluateAll((els) =>
    els
      .map((el) => ({ app: el.getAttribute("data-logo") ?? "", optical: Number(el.getAttribute("data-optical")), box: el.getBoundingClientRect().width }))
      .filter((m) => m.box > 20)
      // The drawn mark: the box times its optical factor (the artwork is trimmed to the box).
      .map((m) => ({ ...m, w: m.box * m.optical })),
  );
  const store = sizes.find((s) => s.app.includes("store"));
  const notes = sizes.find((s) => s.app.includes("notes"));
  if (store && notes) expect(store.w).toBeGreaterThanOrEqual(notes.w);
  for (const s of sizes) expect(s.optical).toBeGreaterThan(0.85);
});

test("mail: http(s) addresses in a letter are links that open safely; a malformed one stays text", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Ссылки", "Вписьме");
  const bp = await newPage(browser, isMobile(page));
  await signUpViaApi(bp, "Отправитель", "Ссылок");
  const body = "Сайт: https://voidex.example/path?q=1, ещё www.example.org и http://test.example. Плохая: http://нет-точки и javascript:alert(1)";
  const draft = (await apiAs(bp, "POST", "/api/mail/drafts", { to: [me.address], subject: "Ссылки", body })).body;
  expect((await apiAs(bp, "POST", `/api/mail/drafts/${draft.id}/send`)).status).toBeLessThan(300);
  await openApp(page, "mail");
  await page.getByTestId("thread-row").first().click();
  const links = page.getByTestId("thread-view").getByTestId("mail-link");
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAttribute("href", "https://voidex.example/path?q=1");
  await expect(links.nth(1)).toHaveAttribute("href", /^https:\/\/www\.example\.org\/?$/);
  await expect(links.nth(2)).toHaveAttribute("href", /^http:\/\/test\.example\/?$/);
  for (const i of [0, 1, 2]) {
    await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    const rel = (await links.nth(i).getAttribute("rel")) ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  }
  // The rest stays text (no javascript: links, no half-addresses).
  await expect(page.getByTestId("thread-view")).toContainText("http://нет-точки");
  expect(await page.locator('[data-testid="thread-view"] a[href^="javascript"]').count()).toBe(0);
  await bp.context().close();
});

test("mail (phone): swipe left archives with undo; a short swipe springs back; scrolling never archives; kept after reload", async ({ page, browser }) => {
  test.skip(!isMobile(page), "phone gesture");
  const me = await signUpViaApi(page, "Свайп", "Архив");
  const bp = await newPage(browser, true);
  await signUpViaApi(bp, "Много", "Писем");
  for (let i = 1; i <= 9; i++) {
    const d = (await apiAs(bp, "POST", "/api/mail/drafts", { to: [me.address], subject: `Письмо ${i}`, body: `Текст ${i}` })).body;
    expect((await apiAs(bp, "POST", `/api/mail/drafts/${d.id}/send`)).status).toBeLessThan(300);
  }
  await openApp(page, "mail");
  const rows = page.getByTestId("thread-row");
  await expect(rows).toHaveCount(9);
  const swipe = page.getByTestId("thread-swipe");

  // A short swipe: the row springs back, nothing happens.
  let box = (await swipe.first().boundingBox())!;
  await touchDrag(page, { x: box.x + box.width - 30, y: box.y + box.height / 2 }, { x: box.x + box.width - 90, y: box.y + box.height / 2 });
  await page.waitForTimeout(500);
  await expect(rows).toHaveCount(9);

  // A vertical scroll that starts on a row never archives it.
  await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 + 200 }, { x: box.x + box.width / 2 - 30, y: box.y + box.height / 2 - 100 });
  await page.waitForTimeout(500);
  await expect(rows).toHaveCount(9);

  // A real swipe: archived, with undo in the toast.
  await page.getByTestId("thread-list").evaluate((el) => el.closest(".scroll-area, [data-scroll]")?.scrollTo?.({ top: 0 }));
  const first = rows.first();
  const subject = (await first.innerText()).match(/Письмо \d/)![0];
  box = (await swipe.first().boundingBox())!;
  await touchDrag(page, { x: box.x + box.width - 20, y: box.y + box.height / 2 }, { x: box.x + 20, y: box.y + box.height / 2 }, 14);
  await expect(rows).toHaveCount(8);
  const toast = page.getByTestId("toast").filter({ hasText: "архив" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Отменить" }).click();
  await expect(rows).toHaveCount(9);

  // Swipe it again and reload: it stays in the archive.
  box = (await swipe.first().boundingBox())!;
  await touchDrag(page, { x: box.x + box.width - 20, y: box.y + box.height / 2 }, { x: box.x + 20, y: box.y + box.height / 2 }, 14);
  await expect(rows).toHaveCount(8);
  await reloadUnlocked(page);
  await openApp(page, "mail");
  await expect(page.getByTestId("thread-row")).toHaveCount(8);
  await page.getByTestId("mail-drawer").click();
  await page.getByTestId("folder-archive").click();
  await expect(page.getByTestId("thread-row")).toHaveCount(1);
  await expect(page.getByTestId("thread-row").first()).toContainText(subject.replace(/\d/, ""));
  await bp.context().close();
});
