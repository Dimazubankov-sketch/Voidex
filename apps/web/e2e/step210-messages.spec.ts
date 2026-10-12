import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { apiAs as api, newPage, openApp, recordVoice, signUpViaApi } from "./helpers";

/**
 * Step 2.10 — message actions: long press (phones) / right click (PC) opens a
 * compact menu next to the message (the chat dims, the message stays bright):
 * reply, copy, edit (mine), pin, forward, delete (for me / for everyone),
 * select; multi-select with per-message delete rights; swipe left to reply.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

async function setup(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Алиса", "Действий");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Борис", "Ответов");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Сообщение Бориса" });
  await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Моё сообщение" });
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
  await page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`).click();
  await expect(page.locator(`[data-testid="conversation"][data-chat-id="${chat.id}"]`)).toBeVisible();
  await page.waitForTimeout(500); // the chat page has slid in
  return { a, b, bp, chat };
}

const msg = (page: Page, text: string) => page.getByTestId("message").filter({ hasText: text });

async function openMenu(page: Page, m: Locator) {
  if (isMobile(page)) {
    const box = (await m.locator("p").first().boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 10, y: box.y + 5 }] });
    await page.waitForTimeout(650);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await m.locator("p").first().click({ button: "right" });
  }
  await expect(page.getByTestId("message-menu")).toBeVisible();
}

test("menu: the message stays bright over the dimmed chat; own vs other's actions; delete for me / for everyone in place", async ({ page, browser }) => {
  const { bp, chat } = await setup(page, browser);
  const mine = msg(page, "Моё сообщение");
  await openMenu(page, mine);
  const menu = page.getByTestId("message-menu");
  for (const id of ["reply", "copy", "edit", "pin", "forward", "delete", "select"]) await expect(menu.getByTestId(`msg-action-${id}`)).toBeVisible();
  // The chat is dimmed; the message is lifted above the dim layer.
  await expect(page.getByTestId("message-menu-backdrop")).toBeVisible();
  expect(await mine.evaluate((el) => getComputedStyle(el).zIndex)).toBe("31");
  // The menu sits next to the message, inside the chat.
  const mb = (await menu.boundingBox())!;
  const vb = page.viewportSize()!;
  expect(mb.x).toBeGreaterThanOrEqual(0);
  expect(mb.x + mb.width).toBeLessThanOrEqual(vb.width);
  await page.getByTestId("message-menu-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(menu).toHaveCount(0);

  // The other person's message: no «Редактировать»; «Удалить» offers «у себя» only.
  const theirs = msg(page, "Сообщение Бориса");
  await openMenu(page, theirs);
  await expect(menu.getByTestId("msg-action-edit")).toHaveCount(0);
  await menu.getByTestId("msg-action-delete").click();
  await expect(menu.getByTestId("msg-action-delete-me")).toBeVisible();
  await expect(menu.getByTestId("msg-action-delete-all")).toHaveCount(0);
  await menu.getByTestId("msg-action-delete-me").click();
  await expect(theirs).toHaveCount(0);
  // Boris still has it.
  const forB = (await api(bp, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items.map((m: { text: string }) => m.text);
  expect(forB).toContain("Сообщение Бориса");

  // Mine, for everyone: gone on both sides.
  await openMenu(page, mine);
  await menu.getByTestId("msg-action-delete").click();
  await menu.getByTestId("msg-action-delete-all").click();
  await expect(mine).toHaveCount(0);
  await expect.poll(async () => (await api(bp, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items.map((m: { text: string }) => m.text)).not.toContain("Моё сообщение");
  await bp.context().close();
});

test("edit, pin and forward", async ({ page, browser }) => {
  const { b, bp, chat } = await setup(page, browser);
  // Edit mine: the field takes the text; saved for both, marked "изменено".
  await openMenu(page, msg(page, "Моё сообщение"));
  await page.getByTestId("msg-action-edit").click();
  await expect(page.getByTestId("composer-edit")).toBeVisible();
  await expect(page.getByTestId("chat-input")).toHaveValue("Моё сообщение");
  await page.getByTestId("chat-input").fill("Моё сообщение, исправлено");
  await page.getByTestId("chat-edit-save").click();
  await expect(msg(page, "Моё сообщение, исправлено").getByTestId("message-edited")).toBeVisible();
  await expect(page.getByTestId("composer-edit")).toHaveCount(0);
  const seen = (await api(bp, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items[0];
  expect(seen.text).toBe("Моё сообщение, исправлено");
  expect(seen.editedAt).toBeTruthy();

  // Pin: the bar under the header; unpin from it.
  await openMenu(page, msg(page, "Сообщение Бориса"));
  await page.getByTestId("msg-action-pin").click();
  await expect(page.getByTestId("pinned-bar")).toContainText("Сообщение Бориса");
  expect((await api(bp, "GET", `/api/vibex/chats/${chat.id}`)).body.pinnedMessage.text).toBe("Сообщение Бориса");
  await page.getByTestId("pinned-unpin").click();
  await expect(page.getByTestId("pinned-bar")).toHaveCount(0);

  // Forward Boris's message into a group with Boris: it arrives as "Переслано от Борис…".
  const group = (await api(page, "POST", "/api/vibex/groups", { title: "Пересылки", memberIds: [b.id] })).body;
  await openMenu(page, msg(page, "Сообщение Бориса"));
  await page.getByTestId("msg-action-forward").click();
  await page.locator(`[data-testid="forward-chat"][data-chat-id="${group.id}"]`).click();
  await page.getByTestId("forward-send").click();
  await expect(page.getByTestId("forward-sheet")).toHaveCount(0);
  const copy = (await api(bp, "GET", `/api/vibex/chats/${group.id}/messages`)).body.items[0];
  expect(copy).toMatchObject({ text: "Сообщение Бориса", forwardedFrom: { id: b.id } });
  await bp.context().close();
});

test("multi-select: round selectors, count, forward / delete with per-message rights", async ({ page, browser }) => {
  const { bp, chat } = await setup(page, browser);
  await openMenu(page, msg(page, "Моё сообщение"));
  await page.getByTestId("msg-action-select").click();
  await expect(page.getByTestId("selection-bar")).toBeVisible();
  await expect(page.getByTestId("select-dot")).toHaveCount(2);
  await expect(page.getByTestId("selection-count")).toHaveText("Выбрано: 1");
  // Mine only: «у всех» is offered.
  await page.getByTestId("selection-delete").click();
  await expect(page.getByTestId("selection-delete-all")).toBeVisible();
  await page.getByTestId("selection-close").click();
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);

  await openMenu(page, msg(page, "Моё сообщение"));
  await page.getByTestId("msg-action-select").click();
  await msg(page, "Сообщение Бориса").click();
  await expect(page.getByTestId("selection-count")).toHaveText("Выбрано: 2");
  // Someone else's message among them: «у себя» only.
  await page.getByTestId("selection-delete").click();
  await expect(page.getByTestId("selection-delete-all")).toHaveCount(0);
  await page.getByTestId("selection-delete-me").click();
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  await expect(page.getByTestId("message")).toHaveCount(0);
  // Boris keeps both.
  expect((await api(bp, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items).toHaveLength(2);
  await bp.context().close();
});

/** A finger drag (real touch events): from (x, y) by dx in `steps` moves. */
async function touchDrag(page: Page, x: number, y: number, dx: number, steps: number, hold?: () => Promise<void>) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / steps, y }] });
    await page.waitForTimeout(16);
  }
  if (hold) await hold();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("swipe left to reply (with the threshold); a swipe on a voice waveform seeks instead", async ({ page, browser }) => {
  test.skip(!isMobile(page), "a finger gesture (PC replies from the hover button / the menu)");
  const { bp } = await setup(page, browser);
  const theirs = msg(page, "Сообщение Бориса");
  const icon = theirs.getByTestId("swipe-reply-icon");
  const box = (await theirs.locator("p").boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width - 4;
  // A short pull: the arrow only starts to show; nothing on release.
  await touchDrag(page, x, y, -36, 6, async () => {
    expect(Number(await icon.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
  });
  await page.waitForTimeout(400);
  await expect(page.getByTestId("composer-reply")).toHaveCount(0);
  // Past the threshold: the reply is set, the message goes back to its place.
  await touchDrag(page, x, y, -120, 10, async () => {
    await expect(icon).toHaveCSS("opacity", "1");
  });
  await expect(page.getByTestId("composer-reply")).toContainText("Сообщение Бориса");
  await page.waitForTimeout(500);
  expect(Math.abs((await theirs.locator("p").boundingBox())!.x - box.x)).toBeLessThan(2);
  await page.getByTestId("composer-reply-cancel").click();

  // A voice message: a drag on its waveform is a seek, never a reply.
  await recordVoice(page, 1500);
  const voice = page.getByTestId("message").filter({ has: page.getByTestId("voice-message") }).last();
  const wb = (await voice.locator("[data-gesture-owner]").first().boundingBox())!;
  await touchDrag(page, wb.x + wb.width - 6, wb.y + wb.height / 2, -100, 10);
  await page.waitForTimeout(400);
  await expect(page.getByTestId("composer-reply")).toHaveCount(0);
  await bp.context().close();
});
