import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PASSWORD, openApp, signUpViaApi, uniq, uniquePhoneDigits, reloadUnlocked } from "./helpers";

/**
 * Update 5 · 4 / 5 / 7: the Vibex chat list — «Изм.» (select, pin / unpin, delete with a confirmation, only
 * from my list), the stories icon beside «Чаты» that folds into the full row, the compact long-press preview,
 * and pinned chats that open their menu on a long press (never a drag).
 */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

async function call(request: APIRequestContext, token: string, method: string, url: string, data?: unknown) {
  const res = await request.fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, "x-voidex-client": "web", ...(data ? { "content-type": "application/json" } : {}) },
    data: data ? JSON.stringify(data) : undefined,
  });
  expect(res.ok(), `${method} ${url} → ${res.status()}`).toBeTruthy();
  return res.json();
}

async function apiAccount(request: APIRequestContext, first: string) {
  const h = { "content-type": "application/json", "x-voidex-client": "web" };
  const post = async (url: string, body: unknown) => (await request.post(url, { headers: h, data: JSON.stringify(body) })).json();
  const s = await post("/api/auth/phone/start", { phone: "+7" + uniquePhoneDigits() });
  const v = await post("/api/auth/phone/verify", { verificationId: s.verificationId, code: s.devCode });
  const consents = ["terms", "offer", "privacy", "data_processing"].map((key) => ({ key, version: "2026-09-draft.1" }));
  const username = uniq("v");
  const r = await post("/api/auth/register", { firstName: first, lastName: "Тестов", birthDate: "1991-05-06", country: "RU", language: "ru", phoneVerification: { id: s.verificationId, proof: v.proof }, username, password: PASSWORD, consents });
  const address = `${username}@voidops`;
  await request.post("/api/vibex/activate", { headers: { ...h, authorization: `Bearer ${r.accessToken}` }, data: JSON.stringify({ email: address, password: PASSWORD }) });
  return { id: r.user.id as string, token: r.accessToken as string, address };
}

/** Me with four chats (each with a message from the other person). */
async function setup(page: Page, request: APIRequestContext) {
  const a = await signUpViaApi(page, "Алиса", "Правка");
  await call(request, a.token, "POST", "/api/vibex/activate", { email: a.address, password: PASSWORD });
  const people = [];
  const chats: string[] = [];
  for (const name of ["Вера", "Глеб", "Дина", "Егор"]) {
    const p = await apiAccount(request, name);
    const chat = await call(request, p.token, "POST", "/api/vibex/chats/direct", { userId: a.id });
    await call(request, p.token, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: `привет от ${name}` });
    people.push(p);
    chats.push(chat.id);
  }
  await openApp(page, "vibex");
  await expect(page.getByTestId("vibex-app")).toBeVisible();
  await openChats(page);
  await expect(page.locator("[data-testid=chat-row]")).toHaveCount(4);
  return { a, people, chats };
}

async function openChats(page: Page) {
  if (isMobile(page)) await page.getByTestId("vibex-tab-chats").last().click();
  else await page.getByTestId("vibex-nav-chats").last().click();
}

const row = (page: Page, id: string) => page.locator(`[data-testid=chat-row][data-chat-id="${id}"]`);
const pinnedOnServer = async (request: APIRequestContext, token: string) =>
  ((await call(request, token, "GET", "/api/vibex/chats")) as { id: string; pinnedPosition: number | null }[])
    .filter((c) => c.pinnedPosition !== null)
    .sort((x, y) => x.pinnedPosition! - y.pinnedPosition!)
    .map((c) => c.id);

test("Update 5 · 4: «Изм.» — select chats, pin / unpin them, delete them after a confirmation (only from my list); «Готово» ends it", async ({ page, request }) => {
  const { a, people, chats } = await setup(page, request);
  await page.getByTestId("chats-edit").click();
  await expect(page.getByTestId("chats-edit")).toHaveText("Готово");
  await expect(page.getByTestId("chats-edit-bar")).toBeVisible();
  // Nothing selected: the actions wait.
  await expect(page.getByTestId("chats-edit-delete")).toBeDisabled();
  // A tap selects (it does not open the chat).
  await row(page, chats[0]!).click();
  await row(page, chats[1]!).click();
  await expect(page.locator("[data-testid=chat-row][data-selected]")).toHaveCount(2);
  await expect(page.getByTestId("chats-edit-count")).toHaveText("Выбрано: 2");
  await expect(page.getByTestId("chat-page")).toHaveCount(0);
  // Pin the two; they go to the top (kept on the server).
  await page.getByTestId("chats-edit-pin").click();
  // In the list's own order (the newest on top), above the rest.
  await expect.poll(() => pinnedOnServer(request, a.token)).toEqual([chats[1], chats[0]]);
  await expect(row(page, chats[0]!)).toHaveAttribute("data-pinned", "true");
  await expect(page.locator("[data-testid=chat-row][data-selected]")).toHaveCount(0);
  // Unpin one of them again.
  await row(page, chats[1]!).click();
  await page.getByTestId("chats-edit-unpin").click();
  await expect.poll(() => pinnedOnServer(request, a.token)).toEqual([chats[0]]);

  // Delete two: a confirmation first; cancelling keeps them.
  await row(page, chats[2]!).click();
  await row(page, chats[3]!).click();
  await page.getByTestId("chats-edit-delete").click();
  const confirm = page.getByTestId("chats-delete-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Удалить чаты (2)?");
  await confirm.getByRole("button", { name: "Отмена" }).click();
  await expect(page.locator("[data-testid=chat-row]")).toHaveCount(4);
  await page.getByTestId("chats-edit-delete").click();
  await confirm.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.locator("[data-testid=chat-row]")).toHaveCount(2);
  // Only from my list: the other side still has the conversation and its history.
  const theirs = (await call(request, people[2]!.token, "GET", "/api/vibex/chats")) as { id: string }[];
  expect(theirs.map((c) => c.id)).toContain(chats[2]);
  const msgs = (await call(request, people[2]!.token, "GET", `/api/vibex/chats/${chats[2]}/messages`)) as { items?: unknown[] } | unknown[];
  expect((Array.isArray(msgs) ? msgs : msgs.items ?? []).length).toBeGreaterThan(0);
  // «Готово» ends the edit mode; the pinned order survives a reload.
  await page.getByTestId("chats-edit").click();
  await expect(page.getByTestId("chats-edit-bar")).toHaveCount(0);
  await expect(page.getByTestId("chat-select")).toHaveCount(0);
  await reloadUnlocked(page);
  await openApp(page, "vibex");
  await openChats(page);
  await expect(page.locator("[data-testid=chat-row]")).toHaveCount(2);
  await expect(row(page, chats[0]!)).toHaveAttribute("data-pinned", "true");
});

test("Update 5 · 5 / 7: a long press on a pinned chat opens the compact preview with «Открепить»; the chat goes back to the list (saved)", async ({ page, request }) => {
  test.skip(!isMobile(page), "phone long press");
  const { a, chats } = await setup(page, request);
  await call(request, a.token, "PUT", "/api/vibex/chats/pins", { conversationIds: [chats[1]] });
  await expect(row(page, chats[1]!)).toHaveAttribute("data-pinned", "true");
  const b = (await row(page, chats[1]!).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await page.waitForTimeout(500);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const preview = page.getByTestId("chat-preview");
  await expect(preview).toBeVisible();
  await expect(page.locator("[data-lifted]")).toHaveCount(0);
  // Compact: a floating card (well under the screen's height) with the menu below it; both on screen.
  const vp = page.viewportSize()!;
  await page.waitForTimeout(350);
  const card = (await page.getByTestId("chat-preview-card").boundingBox())!;
  const menu = (await page.getByTestId("chat-preview-menu").boundingBox())!;
  expect(card.height).toBeLessThan(vp.height * 0.5);
  expect(card.width).toBeLessThan(vp.width);
  expect(menu.y).toBeGreaterThanOrEqual(card.y + card.height);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(vp.height);
  expect(menu.x + menu.width).toBeLessThanOrEqual(vp.width);
  // The last messages are in the card; the existing actions are in the menu.
  await expect(preview.getByText("привет от Глеб")).toBeVisible();
  for (const id of ["mute", "unpin", "profile", "delete"]) await expect(preview.getByTestId(`chat-action-${id}`)).toBeVisible();
  await preview.getByTestId("chat-action-unpin").click();
  await expect(preview).toHaveCount(0);
  await expect(row(page, chats[1]!)).toHaveAttribute("data-pinned", "false");
  await expect.poll(() => pinnedOnServer(request, a.token)).toEqual([]);
  await reloadUnlocked(page);
  await openApp(page, "vibex");
  await openChats(page);
  await expect(row(page, chats[1]!)).toHaveAttribute("data-pinned", "false");
  await expect(page.getByTestId("pinned-chats")).toHaveCount(0);
});

test("Update 5 · 4: the stories icon sits left of «Чаты»; a pull opens the full row under the title and the icon folds into it; it comes back", async ({ page }) => {
  test.skip(!isMobile(page), "phone header");
  await signUpViaApi(page, "Истории", "Заголовок");
  await openApp(page, "vibex");
  await openChats(page);
  const stack = page.getByTestId("stories-stack");
  await expect(stack).toBeVisible();
  const title = (await page.getByTestId("vibex-header-title").boundingBox())!;
  const s = (await stack.boundingBox())!;
  expect(s.x + s.width).toBeLessThanOrEqual(title.x + 1);
  // A long pull on the list opens the stories row under the title; the small icon folds away.
  const list = (await page.getByTestId("chats-scroll").boundingBox())!;
  await page.mouse.move(list.x + list.width / 2, list.y + 40);
  await page.mouse.down();
  await page.mouse.move(list.x + list.width / 2, list.y + 200, { steps: 14 });
  await page.mouse.up();
  await expect(page.getByTestId("stories-strip")).toBeVisible();
  await expect(page.locator("[data-folded]")).toHaveCount(1);
  await expect(page.getByTestId("story-mine")).toBeVisible();
  // Scrolling the list back up folds the row; the icon returns beside the title.
  await page.mouse.move(list.x + list.width / 2, list.y + 300);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(60);
  }
  await expect(page.getByTestId("stories-strip")).toHaveCount(0);
  await expect(page.locator("[data-folded]")).toHaveCount(0);
  await expect(stack).toBeVisible();
});
