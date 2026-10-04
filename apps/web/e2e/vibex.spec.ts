import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PASSWORD, newPage, openApp, signUpViaApi, uniq, uniquePhoneDigits, reloadUnlocked } from "./helpers";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");

/** Calls the Vibex API as a given account (test setup only; the UI is what's under test). */
async function call(request: APIRequestContext, token: string, method: string, url: string, data?: unknown) {
  const res = await request.fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, "x-voidex-client": "web", ...(data ? { "content-type": "application/json" } : {}) },
    data: data ? JSON.stringify(data) : undefined,
  });
  expect(res.ok(), `${method} ${url} → ${res.status()}`).toBeTruthy();
  return res.json();
}

/** A second account created through the real sign-up API (dev SMS provider). */
async function apiAccount(request: APIRequestContext, first: string) {
  const h = { "content-type": "application/json", "x-voidex-client": "web" };
  const post = async (url: string, body: unknown) => (await request.post(url, { headers: h, data: JSON.stringify(body) })).json();
  const s = await post("/api/auth/phone/start", { phone: "+7" + uniquePhoneDigits() });
  const v = await post("/api/auth/phone/verify", { verificationId: s.verificationId, code: s.devCode });
  const consents = ["terms", "offer", "privacy", "data_processing"].map((key) => ({ key, version: "2026-09-draft.1" }));
  const username = uniq("v");
  const r = await post("/api/auth/register", {
    firstName: first,
    lastName: "Тестов",
    birthDate: "1991-05-06",
    country: "RU",
    language: "ru",
    phoneVerification: { id: s.verificationId, proof: v.proof },
    username,
    password: "Violet-Orbit-42",
    consents,
  });
  expect(r.user).toBeTruthy();
  const address = `${username}@voidops.ru`;
  // Turn Vibex on for this account (its Vibex sign-in).
  const act = await request.post("/api/vibex/activate", {
    headers: { ...h, authorization: `Bearer ${r.accessToken}` },
    data: JSON.stringify({ email: address, password: "Violet-Orbit-42" }),
  });
  expect(act.ok()).toBeTruthy();
  return { id: r.user.id as string, token: r.accessToken as string, address };
}

/** Opens Vibex; the first time, signs in to Vibex with the account's email (prefilled) and password. */
/** Vibex opens with the VOIDEX session (Step 2.3: no Vibex sign-in). */
async function openVibex(page: Page) {
  await openApp(page, "vibex");
  await expect(page.getByTestId("vibex-app")).toBeVisible();
}

function isMobile(page: Page) {
  return (page.viewportSize()?.width ?? 1000) < 900;
}

/** The Voyzen side menu: a rail on PC, a drawer from the avatar on phones. */
async function nav(page: Page, section: "feed" | "chats" | "people" | "history" | "bookmarks" | "me") {
  if (isMobile(page)) {
    // Close a chat / page first, then open the drawer.
    for (const id of ["chat-back", "vibex-back"]) {
      const b = page.getByTestId(id);
      if (await b.last().isVisible()) {
        await b.last().click();
        await expect(b).toHaveCount(0); // wait for the page to slide away
      }
    }
    await page.getByTestId("vibex-menu").click();
  }
  await page.getByTestId(section === "me" ? "vibex-me" : `vibex-nav-${section}`).click();
}

test("vibex: A posts, B likes, bookmarks privately, reposts and shares into a chat; A replies with a file; deleted post becomes unavailable", async ({ page, browser }) => {
  const a = await signUpViaApi(page, "Алиса", "Смирнова");
  const bPage = await newPage(browser, !isMobile(page));
  const b = await signUpViaApi(bPage, "Борис", "Орлов");

  // A writes a post with a picture.
  await openVibex(page);
  await page.getByTestId("composer-prompt").click();
  await page.getByTestId("composer-text").fill("Пост для Бориса");
  await page.getByTestId("composer-file").setInputFiles({ name: "кадр.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("post-composer").getByTestId("vibex-image")).toHaveCount(1);
  await page.getByTestId("composer-publish").click();
  // Email instead of a short @handle.
  const aCard = page.locator('[data-testid=post-card][data-kind=post]').filter({ hasText: a.address });
  await expect(aCard).toHaveCount(1);
  const postId = await aCard.getAttribute("data-post-id");

  // B sees it, likes and bookmarks it.
  await openVibex(bPage);
  const bCard = bPage.locator(`[data-testid=post-card][data-post-id="${postId}"]`);
  await expect(bCard).toBeVisible();
  await bCard.getByTestId("post-like").click();
  await expect(bCard.getByTestId("post-like")).toHaveAttribute("aria-pressed", "true");
  // Voyzen's action row order: heart, comment, share.
  expect(await bCard.locator("[data-testid^=post-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")).filter((t) => ["post-like", "post-comment", "post-share"].includes(t!)))).toEqual(["post-like", "post-comment", "post-share"]);
  await bCard.getByTestId("post-menu").click();
  await bPage.getByTestId("menu-bookmark").click();

  // B shares it on their page: a repost card wrapping the original (same id).
  await bCard.getByTestId("post-share").click();
  await bPage.getByTestId("share-repost").click();
  await expect(bPage.getByTestId("share-sheet")).toHaveCount(0);

  // ...and sends it to A in a message from the share sheet.
  await bCard.getByTestId("post-share").click();
  await bPage.getByTestId("share-search").fill(a.username);
  await bPage.getByTestId("share-contact").first().click();
  await bPage.getByTestId("share-comment").fill("Смотри, что нашёл");
  await bPage.getByTestId("share-send").click();
  await expect(bPage.getByTestId("share-sheet")).toHaveCount(0);

  // A sees B's repost in the feed with the original inside.
  await reloadUnlocked(page);
  await expect(page.getByTestId("workspace")).toBeVisible();
  await openVibex(page);
  const repost = page.locator("[data-testid=post-card][data-kind=repost]").filter({ hasText: b.address });
  await expect(repost).toBeVisible();
  await expect(repost.getByTestId("nested-post")).toHaveAttribute("data-post-id", postId!);
  await expect(page.locator(`[data-testid=post-card][data-post-id="${postId}"] [data-testid=post-like]`)).toContainText("1");

  // Bookmarks are private: A has none, B has the post.
  // Step 2.3: Bookmarks is its own section of the side menu.
  await nav(page, "bookmarks");
  await expect(page.getByTestId("bookmarks")).toBeVisible();
  await expect(page.getByTestId("history-list")).toHaveCount(0);
  await nav(bPage, "bookmarks");
  await expect(bPage.getByTestId("history-list").getByTestId("post-card")).toHaveCount(1);

  // A has the shared post in the chat, answers with a file; B gets it, and read receipts work.
  await nav(page, "chats");
  await expect(page.getByTestId("chat-unread")).toHaveText("1");
  await page.getByTestId("chat-row").first().click();
  await expect(page.getByTestId("message-shared-post").getByTestId("nested-post")).toHaveAttribute("data-post-id", postId!);
  await page.getByTestId("chat-file").setInputFiles({ name: "ответ.txt", mimeType: "text/plain", buffer: Buffer.from("спасибо") });
  await expect(page.getByTestId("composer-files")).toBeVisible();
  await page.getByTestId("chat-input").fill("Спасибо!");
  await expect(page.getByTestId("chat-send")).toBeEnabled();
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("message").filter({ hasText: "Спасибо!" })).toBeVisible();
  await nav(bPage, "chats");
  await bPage.getByTestId("chat-row").first().click();
  await expect(bPage.getByTestId("vibex-file")).toContainText("ответ.txt");
  await expect(page.getByTestId("msg-read").last()).toBeVisible();
  const download = bPage.waitForEvent("download");
  await bPage.getByTestId("vibex-file").click();
  expect((await download).suggestedFilename()).toBe("ответ.txt");

  // A deletes the post: B's repost and bookmark now say "post unavailable".
  await nav(page, "me");
  const mine = page.locator(`[data-testid=post-card][data-post-id="${postId}"]`);
  await mine.getByTestId("post-menu").click();
  await page.getByTestId("menu-delete-post").click();
  await page.getByTestId("confirm-action").click();
  await expect(mine).toHaveCount(0);

  await nav(bPage, "bookmarks");
  await expect(bPage.getByTestId("bookmarks").getByTestId("post-unavailable")).toBeVisible();
  await nav(bPage, "me");
  await bPage.getByTestId("profile-tab-reposts").click(); // Voyzen profile: Posts / Reposts
  await expect(bPage.locator("[data-testid=post-card][data-kind=repost]").first().getByTestId("post-unavailable")).toBeVisible();
});

test("vibex: pinned chats reorder by press-and-hold drag and stay in order; regular chats don't move by hand", async ({ page, request }) => {
  const a = await signUpViaApi(page, "Алиса", "Закреп");
  await call(request, a.token, "POST", "/api/vibex/activate", { email: a.address, password: PASSWORD });
  const people = [];
  for (const name of ["Вера", "Глеб", "Дина", "Егор"]) people.push(await apiAccount(request, name));
  const chats: string[] = [];
  for (const p of people) {
    const chat = await call(request, p.token, "POST", "/api/vibex/chats/direct", { userId: a.id });
    await call(request, p.token, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "привет" });
    chats.push(chat.id);
  }
  // Pin three of them: Вера, Глеб, Дина (in that order). Егор stays a regular chat.
  await call(request, a.token, "PUT", "/api/vibex/chats/pins", { conversationIds: chats.slice(0, 3) });

  await openVibex(page);
  await nav(page, "chats");
  const pinned = page.getByTestId("pinned-chats").locator("[data-testid=chat-row]");
  await expect(pinned).toHaveCount(3);
  const order = () => pinned.evaluateAll((els) => els.map((e) => e.getAttribute("data-chat-id")));
  expect(await order()).toEqual(chats.slice(0, 3));

  // Lift "Дина" (3rd) and drop it on top.
  const from = (await pinned.nth(2).boundingBox())!;
  const to = (await pinned.nth(0).boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: start.x, y: to.y + 6 };
  if (isMobile(page)) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", p?: { x: number; y: number }) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [p] : [] });
    await touch("touchStart", start);
    await page.waitForTimeout(500);
    await expect(page.locator("[data-lifted]")).toHaveCount(1);
    for (let i = 1; i <= 12; i++) {
      await touch("touchMove", { x: start.x, y: start.y + ((end.y - start.y) * i) / 12 });
      await page.waitForTimeout(24);
    }
    await touch("touchEnd");
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-lifted]")).toHaveCount(1);
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
  }
  await expect.poll(order).toEqual([chats[2], chats[0], chats[1]]);
  await expect(page.locator("[data-lifted]")).toHaveCount(0);

  // Saved on the server: a reload (or another device) shows the same order.
  await expect
    .poll(async () => (await call(request, a.token, "GET", "/api/vibex/chats")).filter((c: { pinnedPosition: number | null }) => c.pinnedPosition !== null).map((c: { id: string }) => c.id))
    .toEqual([chats[2], chats[0], chats[1]]);
  await reloadUnlocked(page);
  await openVibex(page);
  await nav(page, "chats");
  expect(await order()).toEqual([chats[2], chats[0], chats[1]]);

  // A regular chat is not draggable: press-and-hold opens its menu instead, nothing moves.
  const regular = page.locator('[data-testid=chat-row][data-pinned="false"]');
  await expect(regular).toHaveCount(1);
  const openMenu = async () => {
    const rb = (await regular.boundingBox())!;
    if (isMobile(page)) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 }] });
      await page.waitForTimeout(500);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await regular.click({ button: "right" });
    }
    await expect(page.getByTestId("chat-menu")).toBeVisible();
  };
  await openMenu();
  // The chat list can re-render under the open menu (live updates); pin again only if it did not take.
  await expect(async () => {
    if ((await regular.count()) === 0) return; // pinned
    if (!(await page.getByTestId("chat-menu").isVisible())) await openMenu();
    await page.getByTestId("menu-pin").click({ timeout: 4000 });
    await expect(regular).toHaveCount(0, { timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  // Pinning puts it on top of the pinned group.
  await expect.poll(order).toEqual([chats[3], chats[2], chats[0], chats[1]]);
});

test("vibex: the VOIDEX session is the identity (no Vibex sign-in); comments both ways, edit, translate, profile, sidebar", async ({ page, browser, request }) => {
  const a = await signUpViaApi(page, "Аня", "Вход");
  const b = await apiAccount(request, "Бен");

  // Step 2.3: Vibex opens straight away — no sign-in screen, no account switching.
  await openApp(page, "vibex");
  await expect(page.getByTestId("vibex-app")).toBeVisible();
  await expect(page.getByTestId("vibex-auth")).toHaveCount(0);

  // Sidebar: dense sections, Vibex's own settings; no account switch / sign-out, no Plus / analytics.
  if (isMobile(page)) await page.getByTestId("vibex-menu").click();
  const sidebar = page.getByTestId("vibex-sidebar");
  for (const id of ["vibex-nav-feed", "vibex-nav-me", "vibex-nav-chats", "vibex-nav-people", "vibex-nav-bookmarks", "vibex-nav-history", "vibex-nav-settings", "vibex-me"]) await expect(sidebar.getByTestId(id)).toBeVisible();
  await expect(sidebar.getByTestId("vibex-switch-account")).toHaveCount(0);
  await expect(sidebar.getByTestId("vibex-sign-out")).toHaveCount(0);
  await expect(sidebar).not.toContainText(/Plus|Premium|Аналитика|Монетизация|Тёмная|Поддержка/);
  await expect(page.getByTestId("vibex-sidebar")).toContainText("Vibex");
  // Settings → Vibex Settings (not the VOIDEX Settings app).
  await sidebar.getByTestId("vibex-nav-settings").click();
  await expect(page.getByTestId("vibex-settings")).toBeVisible();
  await expect(page.locator('[data-testid="window-settings"]')).toHaveCount(0);
  await nav(page, "feed");

  // A posts in Russian (no Translate for a Russian interface) and in English (Translate offered).
  const tag = uniq("");
  for (const text of [`Привет всем, это мой первый пост ${tag}`, `Hello everyone, this is my first post today ${tag}`]) {
    await page.getByTestId("composer-prompt").click();
    await page.getByTestId("composer-text").fill(text);
    await page.getByTestId("composer-publish").click();
    await expect(page.getByTestId("post-composer")).toHaveCount(0);
  }
  const ru = page.locator("[data-testid=post-card]").filter({ hasText: `Привет всем, это мой первый пост ${tag}` });
  const en = page.locator("[data-testid=post-card]").filter({ hasText: `Hello everyone, this is my first post today ${tag}` });
  await expect(ru.getByTestId("post-translate")).toHaveCount(0);
  await expect(en.getByTestId("post-translate")).toBeVisible();

  // Edit my post (marked as edited).
  await ru.getByTestId("post-menu").click();
  await page.getByTestId("menu-edit-post").click();
  await page.getByTestId("post-edit-text").fill(`Привет всем, это мой первый пост ${tag} (исправлено)`);
  await page.getByTestId("post-edit-save").click();
  await expect(ru).toContainText("(исправлено)");
  await expect(ru.getByTestId("post-meta")).toContainText("изменено");

  // B comments; A sees the comment (count + list) and answers.
  const postId = await ru.getAttribute("data-post-id");
  await call(request, b.token, "POST", `/api/vibex/posts/${postId}/comments`, { text: "Отличный пост!" });
  await expect(ru.getByTestId("post-comment")).toContainText("1");
  await ru.getByTestId("post-comment").click();
  await expect(page.getByTestId("comments-screen").getByTestId("comment")).toHaveCount(1);
  await expect(page.getByTestId("comments-screen")).toContainText("Отличный пост!");
  await page.getByTestId("comment-input").fill("Спасибо!");
  await page.getByTestId("comment-send").click();
  await expect(page.getByTestId("comments-count")).toHaveText("2");
  const fromB = await call(request, b.token, "GET", `/api/vibex/posts/${postId}/comments`);
  expect(fromB.map((c: { text: string }) => c.text)).toEqual(["Отличный пост!", "Спасибо!"]);
  await page.getByTestId("comments-back").click();

  // Profile: email, posts tab.
  await nav(page, "me");
  await expect(page.getByTestId("profile-email")).toHaveText(a.address);
  await expect(page.getByTestId("profile-tab-posts")).toHaveAttribute("aria-selected", "true");

  void browser;
});
