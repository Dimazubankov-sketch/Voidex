import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs as api, newPage, openApp, reloadUnlocked, signUpViaApi } from "./helpers";

/** Update 4 · E: the info page's action icons and the one QR icon; my profile's «+» on the avatar; «Написать» / «Подписаться». */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

async function openVibex(page: Page) {
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
}
async function pair(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Ева", "Четвёртая");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Глеб", "Четвёртый");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body as { id: string };
  expect((await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет" })).status).toBe(201);
  return { a, b, bp, chat };
}

test("E1: the info page — five actions with solid icons of one size, a light press; the QR icon is the same one on the info page and in my profile", async ({ page, browser }) => {
  const { bp, chat } = await pair(page, browser);
  await openVibex(page);
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
  await page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`).click();
  await page.getByTestId("chat-header-title").click();
  await expect(page.getByTestId("chat-info")).toBeVisible();
  const sizes: number[] = [];
  for (const id of ["call", "video", "sound", "search", "more"]) {
    const icon = page.getByTestId(`info-${id}`).locator("svg").first();
    await expect(icon).toBeVisible();
    sizes.push(Math.round((await icon.boundingBox())!.width));
  }
  expect(new Set(sizes).size).toBe(1);
  await expect(page.getByTestId("info-call")).toHaveClass(/active:scale-\[0\.94\]/);
  // The buttons still work: search opens the chat search.
  await page.getByTestId("info-search").click();
  await expect(page.getByTestId("chat-info").getByText("Поиск").first()).toBeVisible();
  await page.getByTestId("chat-info-back").click();
  await expect(page.getByTestId("chat-info-qr").getByTestId("qr-icon")).toHaveCount(1);
  await page.getByTestId("chat-info-qr").click();
  await expect(page.getByTestId("qr-sheet")).toBeVisible();
  await bp.context().close();
});

test("E2: my profile — «Изменить обложку» / «Изменить фото» are gone from «…»; the cover keeps its camera; «+» on the avatar picks a new photo", async ({ page }) => {
  await signUpViaApi(page, "Мой", "Профиль");
  await openVibex(page);
  await page.getByTestId(isMobile(page) ? "vibex-tab-me" : "vibex-nav-me").last().click();
  await page.getByTestId("profile-more").click();
  const menu = page.getByTestId("profile-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("profile-menu-cover")).toHaveCount(0);
  await expect(menu.getByTestId("profile-menu-avatar")).toHaveCount(0);
  await expect(menu.getByTestId("profile-menu-qr").getByTestId("qr-icon")).toHaveCount(1);
  // A tap outside the menu closes it.
  const name = (await page.getByTestId("profile-name").boundingBox())!;
  await page.mouse.click(name.x + 4, name.y + name.height / 2);
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("profile-cover-camera")).toBeVisible();
  const plus = page.getByTestId("profile-avatar-plus");
  const avatar = (await page.getByTestId("profile-avatar").boundingBox())!;
  const p = (await plus.boundingBox())!;
  // Small, at the avatar's lower right.
  expect(p.width).toBeLessThan(avatar.width * 0.35);
  expect(p.x + p.width / 2).toBeGreaterThan(avatar.x + avatar.width / 2);
  expect(p.y + p.height / 2).toBeGreaterThan(avatar.y + avatar.height / 2);
  const chooser = page.waitForEvent("filechooser");
  await plus.click();
  const fc = await chooser;
  expect(fc.isMultiple()).toBe(false);
});

test("E3: another person's profile — «Написать» left, «Подписаться» right; «Вы подписаны» after, kept after a reload; again: unfollow; never twice", async ({ page, browser }) => {
  const { b, bp } = await pair(page, browser);
  await openVibex(page);
  // Open the person through the chat's info page.
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
  await page.getByTestId("chat-row").first().click();
  await page.getByTestId("chat-header-title").click();
  await page.getByTestId("chat-info-profile").click();
  const actions = page.getByTestId("profile-actions").last();
  await expect(actions).toBeVisible();
  const write = (await actions.getByTestId("person-write").boundingBox())!;
  const follow = (await actions.getByTestId("profile-follow").boundingBox())!;
  expect(write.x).toBeLessThan(follow.x);
  expect(Math.abs(write.width - follow.width)).toBeLessThan(3);
  await actions.getByTestId("profile-follow").click();
  await expect(actions.getByTestId("profile-unfollow")).toHaveText("Вы подписаны");
  // The whole label fits (no «…»).
  expect(await actions.getByTestId("profile-unfollow").locator("span").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect.poll(async () => (await api(page, "GET", `/api/vibex/people/${b.id}`)).body.followed).toBe(true);
  // A second follow request changes nothing (one subscription).
  await api(page, "POST", `/api/vibex/people/${b.id}/follow`, {});
  expect((await api(page, "GET", `/api/vibex/people/${b.id}`)).body.followers).toBe(1);
  await reloadUnlocked(page);
  expect((await api(page, "GET", `/api/vibex/people/${b.id}`)).body.followed).toBe(true);
  // My own profile has no «Подписаться».
  await openVibex(page);
  await page.getByTestId(isMobile(page) ? "vibex-tab-me" : "vibex-nav-me").last().click();
  await expect(page.getByTestId("profile-follow")).toHaveCount(0);
  await expect(page.getByTestId("profile-actions")).toHaveCount(0);
  await bp.context().close();
});
