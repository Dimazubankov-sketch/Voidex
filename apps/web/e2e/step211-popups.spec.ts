import { expect, test, type Page } from "@playwright/test";
import { apiAs as api, newPage, signUpViaApi } from "./helpers";

/**
 * Step 2.11: system pop-up notifications. Phone: a banner from the top that
 * goes away by itself and with a swipe up; PC: a card at the bottom right
 * with an X. App icon and name, title, preview, avatar. One at a time on a
 * phone (the rest wait), a tap opens what it is about (a Vibex message: its
 * chat; a letter: its thread) and reads it in the Notification Center too.
 * Notifications of an app turned off: no pop-up.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const SHOTS = process.env.STEP211_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${isMobile(page) ? "phone" : "pc"}.png` });
}

test("a Vibex message pops up (phone: top, PC: bottom right) with the app, the sender and the preview; a tap opens the chat and reads it", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Получатель", "Всплывашек");
  const bp = await newPage(browser, isMobile(page));
  await signUpViaApi(bp, "Отправитель", "Сообщений");
  const chat = (await api(bp, "POST", "/api/vibex/chats/direct", { userId: me.id })).body as { id: string };
  await page.waitForTimeout(1500);
  await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет из Vibex" });
  const popup = page.getByTestId("system-popup");
  await expect(popup).toBeVisible();
  await expect(page.getByTestId("system-popups")).toHaveAttribute("data-placement", isMobile(page) ? "top" : "bottom-right");
  await expect(popup.getByTestId("system-popup-app")).toHaveText("Vibex");
  await expect(popup.getByTestId("system-popup-title")).toHaveText("Отправитель Сообщений");
  await expect(popup.getByTestId("system-popup-body")).toHaveText("Привет из Vibex");
  const box = (await popup.boundingBox())!;
  const vp = page.viewportSize()!;
  if (isMobile(page)) expect(box.y).toBeLessThan(80);
  else {
    expect(box.y + box.height).toBeGreaterThan(vp.height - 120);
    expect(box.x + box.width).toBeGreaterThan(vp.width - 40);
    await expect(popup.getByTestId("system-popup-close")).toBeVisible();
  }
  await shot(page, "system-popup");
  await popup.click();
  await expect(popup).toHaveCount(0);
  await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  await expect(page.getByTestId("conversation")).toBeVisible();
  // Read in the Notification Center too.
  await expect.poll(async () => (await api(page, "GET", "/api/notifications")).body.items.find((n: { type: string }) => n.type === "vibex.message")?.read).toBe(true);
  await bp.context().close();
});

test("it goes away by itself; phone: a swipe up dismisses it, and the next one waits its turn; PC: X closes", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Очередь", "Всплывашек");
  const bp = await newPage(browser, isMobile(page));
  await signUpViaApi(bp, "Первый", "Автор");
  const cp = await newPage(browser, isMobile(page));
  await signUpViaApi(cp, "Второй", "Автор");
  const c1 = (await api(bp, "POST", "/api/vibex/chats/direct", { userId: me.id })).body as { id: string };
  const c2 = (await api(cp, "POST", "/api/vibex/chats/direct", { userId: me.id })).body as { id: string };
  await page.waitForTimeout(1500);
  await api(bp, "POST", `/api/vibex/chats/${c1.id}/messages`, { text: "Первое" });
  await expect(page.getByTestId("system-popup")).toHaveCount(1);
  await api(cp, "POST", `/api/vibex/chats/${c2.id}/messages`, { text: "Второе" });
  const popups = page.getByTestId("system-popup");
  if (isMobile(page)) {
    // One at a time: the second waits.
    await page.waitForTimeout(500);
    await expect(popups).toHaveCount(1);
    await expect(popups.first()).toContainText("Первое");
    const box = (await popups.first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, { steps: 6 });
    await page.mouse.up();
    await expect(popups.filter({ hasText: "Первое" })).toHaveCount(0);
    await expect(popups.filter({ hasText: "Второе" })).toBeVisible();
  } else {
    await expect(popups).toHaveCount(2);
    await popups.filter({ hasText: "Первое" }).getByTestId("system-popup-close").click();
    await expect(popups.filter({ hasText: "Первое" })).toHaveCount(0);
  }
  // Then it goes away by itself.
  await expect(popups).toHaveCount(0, { timeout: 9000 });
  await bp.context().close();
  await cp.context().close();
});

test("a letter pops up as VoidOps Mail and opens its thread; Vibex notifications off: no pop-up", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Письмо", "Всплывает");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Почтальон", "Печкин");
  await page.waitForTimeout(1500);
  const draft = (await api(bp, "POST", "/api/mail/drafts", { to: [me.address], subject: "Посылка", body: "Ваша посылка пришла" })).body;
  expect((await api(bp, "POST", `/api/mail/drafts/${draft.id}/send`)).status).toBeLessThan(300);
  const popup = page.getByTestId("system-popup");
  await expect(popup).toHaveAttribute("data-app", "mail");
  await expect(popup.getByTestId("system-popup-body")).toHaveText("Посылка");
  await popup.click();
  await expect(page.locator('[data-testid="window-mail"][data-state="open"]')).toBeVisible();

  // Vibex notifications off (Settings → Apps → Vibex): the Notification Center lists it, no pop-up.
  expect((await api(page, "PATCH", "/api/preferences", { apps: { vibex: { notifications: false } } })).status).toBeLessThan(300);
  await page.waitForTimeout(800);
  const chat = (await api(bp, "POST", "/api/vibex/chats/direct", { userId: me.id })).body as { id: string };
  await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Тихо" });
  await expect.poll(async () => (await api(page, "GET", "/api/notifications")).body.items.some((n: { type: string }) => n.type === "vibex.message")).toBe(true);
  await page.waitForTimeout(800);
  await expect(page.getByTestId("system-popup")).toHaveCount(0);
  void b;
  await bp.context().close();
});
