import { expect, test, type Locator, type Page } from "@playwright/test";
import { normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { newPage, openApp, signUpViaApi, reloadUnlocked } from "./helpers";

/**
 * Step 2.3: one VOIDEX identity for every app, the Notification Center (phone
 * top-edge gesture, PC bell), the PC system bar, grid-cell placement, labels,
 * the View toggle, the Calculator widget, the dock click cycle, and Vibex
 * follows / profile editor / threads / media / chat recordings / notifications.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

/** Calls the API as the signed-in user of this page (fresh access token from the refresh cookie). */
async function api<T = unknown>(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const res = await fetch(url, {
        method,
        headers: { "X-Voidex-Client": "web", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* empty */
      }
      return { status: res.status, body: json as never };
    },
    { method, url, body },
  );
}

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** A slow pointer drag (mouse events; the phone also takes them as pointer events). */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
}

const cellOf = (page: Page, id: string) => page.locator(`[data-cell]:has([data-testid="app-${id}"])`).first().getAttribute("data-cell");

/** The account's stored layout (the default one until the user first customises the desktop). */
async function layoutOf(page: Page): Promise<WorkspaceLayout> {
  const me = await api<{ preferences: { workspace: { layout?: WorkspaceLayout } } }>(page, "GET", "/api/me");
  return normalizeLayout(me.body.preferences.workspace.layout ?? null, ["settings", "mail", "vibex", "calculator"]);
}

// ---------------------------------------------------------------- account

test("account: one VOIDEX login — Vibex opens without its own sign-in, one profile, the API needs the session", async ({ page }) => {
  const me = await signUpViaApi(page, "Ева", "Единая");
  await openApp(page, "vibex");
  await expect(page.getByTestId("vibex-app")).toBeVisible();
  // No Vibex sign-in screen, no account switcher, no second identity anywhere.
  await expect(page.getByTestId("vibex-auth")).toHaveCount(0);
  await expect(page.getByTestId("vibex-switch-account")).toHaveCount(0);
  const vm = await api<{ activated: boolean; person: { id: string } }>(page, "GET", "/api/vibex/me");
  expect(vm.body).toMatchObject({ activated: true, person: { id: me.id } });
  // The retired activation never takes another identity.
  expect((await api<{ person: { id: string } }>(page, "POST", "/api/vibex/activate", { email: "someone@voidops.ru", password: "x" })).body.person.id).toBe(me.id);
  // Without the session the Vibex API answers 401.
  const anon = await page.evaluate(async () => (await fetch("/api/vibex/feed", { headers: { "X-Voidex-Client": "web" } })).status);
  expect(anon).toBe(401);
});

// ---------------------------------------------------------- notifications

test("phone: a pull from the top edge opens the Notification Center (home and inside an app); a normal pull-down still searches", async ({ page }) => {
  test.skip(!isMobile(page), "phone gesture");
  await signUpViaApi(page);
  await api(page, "POST", "/api/notifications/dev/system-update", { title: "VOIDEX 2.3", body: "Что нового", version: "2.3" });
  await reloadUnlocked(page);
  await expect(page.getByTestId("app-mail")).toBeVisible();

  // Normal pull-down on the icons → search (not notifications).
  await drag(page, { x: 200, y: 420 }, { x: 200, y: 600 });
  await expect(page.getByTestId("home-search-overlay")).toBeVisible();
  await expect(page.getByTestId("notification-center")).toHaveCount(0);
  await page.getByTestId("home-search-cancel").click();

  // From the very top edge → Notification Center.
  await drag(page, { x: 200, y: 4 }, { x: 200, y: 420 });
  const nc = page.getByTestId("notification-center");
  await expect(nc).toBeVisible();
  await expect(nc.getByTestId("notification")).toHaveCount(1);
  await expect(nc.getByTestId("notification-unread")).toHaveCount(1);
  await nc.getByTestId("notifications-read-all").click();
  await expect(nc.getByTestId("notification-unread")).toHaveCount(0);
  await nc.getByTestId("notification-clear").click();
  await expect(nc.getByTestId("notifications-empty")).toBeVisible();
  // A tap on the dimmed area below the sheet closes it.
  await page.mouse.click(200, page.viewportSize()!.height - 24);
  await expect(page.getByTestId("notification-center")).toHaveCount(0);

  // Inside an app: the same top-edge gesture.
  await openApp(page, "mail");
  await drag(page, { x: 200, y: 4 }, { x: 200, y: 420 });
  await expect(page.getByTestId("notification-center")).toBeVisible();
});

test("PC: the bell opens the right panel between the system bar and the dock; a tap opens the app context; read all / clear", async ({ page, browser }) => {
  test.skip(isMobile(page), "PC panel");
  const me = await signUpViaApi(page, "Нина", "Колокол");
  const other = await newPage(browser, false);
  await signUpViaApi(other, "Марк", "Писатель");
  // Another person writes in Vibex → a notification arrives live (no reload).
  const chat = await api<{ id: string }>(other, "POST", "/api/vibex/chats/direct", { userId: me.id });
  await api(other, "POST", `/api/vibex/chats/${chat.body.id}/messages`, { text: "Привет из Vibex" });
  await expect(page.getByTestId("bell-badge")).toHaveText("1");

  await page.getByTestId("bell").click();
  const panel = page.getByTestId("notification-center");
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const bar = (await page.getByTestId("system-bar").boundingBox())!;
  const dock = (await page.getByTestId("dock").boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(1400); // right side
  expect(box.width).toBeLessThanOrEqual(420);
  expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
  const n = panel.getByTestId("notification").first();
  await expect(n).toHaveAttribute("data-type", "vibex.message");
  await expect(n).toContainText("Привет из Vibex");
  // Tap → Vibex opens the chat, the notification is read.
  await n.getByTestId("notification-open").click();
  await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  await expect(page.locator(`[data-testid="conversation"][data-chat-id="${chat.body.id}"]`)).toBeVisible();
  await expect(page.getByTestId("bell-badge")).toHaveCount(0);

  await api(page, "POST", "/api/notifications/dev/system-update", { title: "VOIDEX 2.3", body: "Обновление" });
  await expect(page.getByTestId("bell-badge")).toHaveText("1");
  await page.getByTestId("bell").click();
  await page.getByTestId("notifications-read-all").click();
  await expect(page.getByTestId("bell-badge")).toHaveCount(0);
  await page.getByTestId("notifications-clear-all").click();
  await expect(page.getByTestId("notifications-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("notification-center")).toHaveCount(0);
  await other.context().close();
});

// ------------------------------------------------------------- workspace

test("PC grid: drop on an empty cell takes it, on an occupied one swaps; positions survive a reload; categories can't be arranged", async ({ page }) => {
  test.skip(isMobile(page), "PC grid");
  await signUpViaApi(page);
  await expect(page.getByTestId("app-mail")).toBeVisible();
  expect(await cellOf(page, "mail")).toBe("0,0");
  expect(await cellOf(page, "vibex")).toBe("2,0");

  // Empty cell: three columns right, one row down from Vibex.
  const grid = page.getByTestId("desktop-grid");
  const g = (await grid.boundingBox())!;
  const cw = Number(await grid.getAttribute("data-cell-w")) + Number(await grid.getAttribute("data-gap-x"));
  const rh = Number(await grid.getAttribute("data-row-h")) + Number(await grid.getAttribute("data-gap-y"));
  const target = { x: g.x + cw * 4 + cw / 2, y: g.y + rh + rh / 2 };
  await drag(page, await center(page.getByTestId("app-vibex").locator("[data-tile]")), target);
  await expect.poll(() => cellOf(page, "vibex")).toBe("4,1");
  expect(await cellOf(page, "mail")).toBe("0,0"); // nothing else moved
  expect(await cellOf(page, "settings")).toBe("1,0");

  // Occupied cell: swap Mail and Settings (drop next to the tile centre, not on it: on it makes a folder).
  const s = (await page.getByTestId("app-settings").boundingBox())!;
  await drag(page, await center(page.getByTestId("app-mail").locator("[data-tile]")), { x: s.x + 6, y: s.y + s.height - 6 });
  await expect.poll(() => cellOf(page, "mail")).toBe("1,0");
  expect(await cellOf(page, "settings")).toBe("0,0");
  // Saved to the account (not only on screen).
  await expect.poll(async () => JSON.stringify((await layoutOf(page)).desktop.cells["app:mail"])).toBe(JSON.stringify({ c: 1, r: 0 }));

  await reloadUnlocked(page);
  await expect(page.getByTestId("app-mail")).toBeVisible();
  expect(await cellOf(page, "vibex")).toBe("4,1");
  expect(await cellOf(page, "mail")).toBe("1,0");

  // Categories view: no grid, nothing to drop into.
  const l = await layoutOf(page);
  await api(page, "PATCH", "/api/preferences", { workspace: { layout: { ...l, desktop: { ...l.desktop, view: "categories" } } } });
  await expect(page.getByTestId("desktop-categories")).toBeVisible();
  await expect(page.locator("[data-home-grid]")).toHaveCount(0);
});

test("phone: brush → View toggles in one tap; the Calculator widget works; the old Workspaces widget is gone; move to an empty cell on another page", async ({ page }) => {
  test.skip(!isMobile(page), "phone");
  await signUpViaApi(page);
  // A stored Step 2.2 "Workspaces" widget is dropped, no broken placeholder.
  const l0 = await layoutOf(page);
  await api(page, "PATCH", "/api/preferences", { workspace: { layout: { ...l0, widgets: [{ id: "w_legacy01", type: "desktops", surface: "mobile", container: "0", x: 0, y: 0 }] } } });
  await reloadUnlocked(page);
  await expect(page.getByTestId("app-mail")).toBeVisible();
  await expect(page.locator("[data-widget]")).toHaveCount(0);
  expect((await layoutOf(page)).widgets).toEqual([]);

  // Edit mode → brush (long press on free space of the page).
  const pg = (await page.getByTestId("home-page-0").boundingBox())!;
  await page.mouse.move(pg.x + 30, pg.y + pg.height - 30);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.getByTestId("home-appearance").click();
  const row = page.getByTestId("brush-view-row");
  await expect(row).toHaveAttribute("data-view", "grid");
  await row.click();
  await expect(row).toHaveAttribute("data-view", "categories");
  await expect(page.getByTestId("home-categories")).toBeVisible();
  await expect(page.getByTestId("brush-view-grid")).toHaveCount(0); // no second panel
  await row.click();
  await expect(row).toHaveAttribute("data-view", "grid");

  // Widgets → Calculator (2×2), working keys.
  await page.getByTestId("brush-widgets").click();
  await expect(page.getByTestId("widget-card-desktops")).toHaveCount(0);
  await page.getByTestId("widget-add-calculator").click();
  await page.keyboard.press("Escape");
  const w = page.getByTestId("widget-calculator");
  await expect(w).toBeVisible();
  await page.getByTestId("home-done").click();
  for (const k of ["1", "2", "5", "0", "×", "4", "="]) await w.getByTestId(`calc-key-${k}`).click();
  await expect(w.getByTestId("calc-widget-display")).toHaveText("5000");
  await w.getByTestId("calc-key-C").click();
  for (const k of ["7", "÷", "0", "="]) await w.getByTestId(`calc-key-${k}`).click();
  await expect(w.getByTestId("calc-widget-display")).toHaveText(/Ошибка/);

  // Move Vibex to an empty cell lower on the page (edit mode first: long press on free space of the page).
  const page0 = page.getByTestId("home-page-0");
  const p = (await page0.boundingBox())!;
  await page.mouse.move(p.x + 30, p.y + p.height - 30);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId("home")).toHaveAttribute("data-editing", "true");
  await drag(page, await center(page.getByTestId("app-vibex").locator("[data-tile]")), { x: p.x + p.width - 60, y: p.y + p.height - 90 });
  await expect.poll(async () => Number((await cellOf(page, "vibex"))?.split(",")[1])).toBeGreaterThan(2);
  await page.getByTestId("home-done").click();
  const kept = await cellOf(page, "vibex");
  // The layout is saved to the account shortly after the drop: reload only once the server has it.
  const [c, r] = kept!.split(",").map(Number);
  await expect.poll(async () => (await layoutOf(page)).mobile.cells["app:vibex"] ?? null).toEqual({ c, r });
  await reloadUnlocked(page);
  await expect(page.getByTestId("app-vibex")).toBeVisible();
  expect(await cellOf(page, "vibex")).toBe(kept);
});

test("app names on / off from Settings → Desktop (icons only), synced to the account", async ({ page }) => {
  await signUpViaApi(page);
  await expect(page.getByTestId("home-label").first()).toBeVisible();
  await openApp(page, "settings");
  await page.getByTestId("settings-nav-desktop").click();
  await page.getByTestId("show-labels").getByRole("switch").click();
  await expect.poll(async () => (await layoutOf(page)).appearance.showLabels).toBe(false);
  await reloadUnlocked(page);
  await expect(page.getByTestId("app-mail")).toBeVisible();
  await expect(page.getByTestId("home-label")).toHaveCount(0);
  // The icon keeps its accessible name; search still shows names.
  await expect(page.getByTestId("app-mail")).toHaveAttribute("aria-label", "Почта VoidOps");
});

test("PC: dock click — closed → open, focused → minimize, again → restore; system bar above windows, maximized stays between bar and dock", async ({ page }) => {
  test.skip(isMobile(page), "PC dock");
  await signUpViaApi(page);
  const win = page.getByTestId("window-mail");
  await page.getByTestId("dock-app-mail").click();
  await expect(win).toHaveAttribute("data-state", "open");
  await page.getByTestId("dock-app-mail").click();
  await expect(win).toHaveAttribute("data-state", "hidden");
  await page.getByTestId("dock-app-mail").click();
  await expect(win).toHaveAttribute("data-state", "open");
  // Background (another app focused) → a click focuses it, does not minimize.
  await page.getByTestId("dock-app-settings").click();
  await expect(page.getByTestId("window-settings")).toHaveAttribute("data-state", "open");
  await page.getByTestId("dock-app-mail").click();
  await expect(win).toHaveAttribute("data-state", "open");
  await page.getByTestId("dock-app-mail").click();
  await expect(win).toHaveAttribute("data-state", "hidden");

  await page.getByTestId("dock-app-mail").click();
  await win.getByTestId("window-menu").click();
  await page.getByTestId("menu-maximize").click();
  await expect
    .poll(async () => {
      const w = (await win.boundingBox())!;
      const bar = (await page.getByTestId("system-bar").boundingBox())!;
      const dock = (await page.getByTestId("dock").boundingBox())!;
      return w.y >= bar.y + bar.height && w.y + w.height <= dock.y && w.width > 1300;
    })
    .toBe(true);
});

// ------------------------------------------------------------------ vibex

test("vibex: A follows B — counters on both sides, B gets a notification, A unfollows", async ({ page, browser }) => {
  test.skip(isMobile(page), "desktop flow");
  const a = await signUpViaApi(page, "Аня", "Подписчица");
  const bPage = await newPage(browser, false);
  const b = await signUpViaApi(bPage, "Борис", "Автор");
  await openApp(page, "vibex");
  await page.getByTestId("vibex-nav-people").click();
  await page.getByTestId("people-search").fill(b.username);
  await page.getByTestId("person-row").first().click();
  await page.getByTestId("profile-follow").click();
  await expect(page.getByTestId("profile-unfollow")).toBeVisible();
  await expect(page.getByTestId("profile-followers-count")).toHaveText("1");
  // B sees the follower and the notification.
  await expect(bPage.getByTestId("bell-badge")).toHaveText("1");
  const prof = await api<{ followers: number; followsMe: boolean }>(bPage, "GET", `/api/vibex/people/${b.id}`);
  expect(prof.body.followers).toBe(1);
  expect((await api<{ followsMe: boolean }>(bPage, "GET", `/api/vibex/people/${a.id}`)).body.followsMe).toBe(true);
  await bPage.getByTestId("bell").click();
  await expect(bPage.getByTestId("notification").first()).toHaveAttribute("data-type", "vibex.follow");
  await page.getByTestId("profile-unfollow").click();
  await expect(page.getByTestId("profile-follow")).toBeVisible();
  await expect(page.getByTestId("profile-followers-count")).toHaveText("0");
  await bPage.context().close();
});

test("vibex: profile editor — bio, site, city; avatar and cover through the photo editor; shown on the profile", async ({ page }) => {
  test.skip(isMobile(page), "desktop flow");
  await signUpViaApi(page, "Ира", "Редактор");
  await openApp(page, "vibex");
  await page.getByTestId("vibex-me").click();
  await page.getByTestId("profile-edit").click();
  const editor = page.getByTestId("profile-editor");
  await expect(editor).toBeVisible();
  // A tiny PNG picture for avatar and cover.
  // A small valid PNG picture for avatar and cover.
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");
  await editor.getByTestId("pe-avatar-file").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
  await expect(page.getByTestId("photo-editor")).toHaveAttribute("data-shape", "circle");
  await page.getByTestId("photo-zoom").fill("2");
  await page.getByTestId("photo-confirm").click();
  await expect(page.getByTestId("photo-editor")).toHaveCount(0);
  await editor.getByTestId("pe-cover-file").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await expect(page.getByTestId("photo-editor")).toHaveAttribute("data-shape", "wide");
  await page.getByTestId("photo-confirm").click();
  await editor.getByTestId("pe-bio").fill("Привет! Это мой профиль");
  await editor.getByTestId("pe-website").fill("void-code.ru");
  await editor.getByTestId("pe-city").fill("Moscow");
  await editor.getByTestId("pe-save").click();
  await expect(page.getByTestId("profile-editor")).toHaveCount(0);
  await expect(page.getByTestId("profile-bio")).toHaveText("Привет! Это мой профиль");
  await expect(page.getByTestId("profile-website")).toContainText("void-code.ru");
  await expect(page.getByTestId("profile-city")).toContainText("Moscow");
  await expect(page.getByTestId("profile-cover")).toHaveAttribute("data-cover", "1");
  const me = await api<{ hasAvatar: boolean }>(page, "GET", "/api/me");
  expect(me.body.hasAvatar).toBe(true);
});

test("vibex: comment threads — root, reply, reply to a reply (one level, @name); post photos appear in Photo / Video", async ({ page, browser }) => {
  const mobile = isMobile(page);
  const a = await signUpViaApi(page, "Алла", "Треды");
  const bPage = await newPage(browser, false);
  await signUpViaApi(bPage, "Богдан", "Ответов");
  // A posts a photo (through the API: the composer is covered by older tests).
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");
  const file = await page.evaluate(async (bytes) => {
    const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
    const { accessToken } = await r.json();
    const res = await fetch("/api/vibex/files?purpose=post", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/octet-stream", "X-File-Name": "pic.png", Authorization: `Bearer ${accessToken}` }, body: new Uint8Array(bytes) });
    return res.json();
  }, [...png]);
  const post = await api<{ id: string }>(page, "POST", "/api/vibex/posts", { text: "Треды и фото", mediaIds: [file.id] });
  const root = await api<{ id: string }>(bPage, "POST", `/api/vibex/posts/${post.body.id}/comments`, { text: "Корневой комментарий" });
  // A gets a "comment" notification.
  if (!mobile) await expect(page.getByTestId("bell-badge")).toHaveText("1");
  const notes = await api<{ items: { type: string; target: { postId?: string } }[] }>(page, "GET", "/api/notifications");
  expect(notes.body.items[0]).toMatchObject({ type: "vibex.comment", target: { postId: post.body.id } });

  await openApp(page, "vibex");
  const card = page.locator(`[data-testid="post-card"][data-post-id="${post.body.id}"]`);
  await card.getByTestId("post-comment").click();
  const screen = page.getByTestId("comments-screen");
  await expect(screen.getByTestId("comment")).toHaveCount(1);
  await screen.getByTestId("comment-reply-button").first().click();
  await expect(screen.getByTestId("comment-replying")).toBeVisible();
  await screen.getByTestId("comment-input").fill("Ответ автору");
  await screen.getByTestId("comment-send").click();
  await expect(screen.getByTestId("comment-reply")).toHaveCount(1);
  // B answers A's reply: still in the same thread, with @name.
  const replies = await api<{ id: string; rootId: string | null }[]>(page, "GET", `/api/vibex/posts/${post.body.id}/comments`);
  const myReply = replies.body.find((c) => c.rootId === root.body.id)!;
  await api(bPage, "POST", `/api/vibex/posts/${post.body.id}/comments`, { text: "Ответ на ответ", replyToId: myReply.id });
  await expect(screen.getByTestId("comment-reply")).toHaveCount(2);
  await expect(screen.getByTestId("comment-mention")).toContainText("Алла Треды");
  await screen.getByTestId("comment-replies-toggle").click();
  await expect(screen.getByTestId("comment-reply")).toHaveCount(0);
  await screen.getByTestId("comment-replies-toggle").click();
  await expect(screen.getByTestId("comment-reply")).toHaveCount(2);
  await screen.getByTestId("comments-back").click();

  // Profile → Photo / Video: the post's picture is there automatically.
  if (mobile) {
    await page.getByTestId("vibex-menu").click();
    await page.getByTestId("vibex-drawer").getByTestId("vibex-me").click();
  } else await page.getByTestId("vibex-me").click();
  await page.getByTestId("profile-tab-media").click();
  await expect(page.getByTestId("profile-media-grid").getByTestId("vibex-image")).toHaveCount(1);
  await page.getByTestId("profile-media-grid").getByTestId("vibex-image").click();
  await expect(page.getByTestId("vibex-lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("vibex-lightbox")).toHaveCount(0);
  expect(a.id).toBeTruthy();
  await bPage.context().close();
});

test("vibex chat: text, file, voice message recorded from the microphone; reply; B gets a message notification; calls are not faked", async ({ page, browser }) => {
  test.skip(isMobile(page), "desktop flow");
  await signUpViaApi(page, "Ольга", "Голосова");
  const bPage = await newPage(browser, false);
  const b = await signUpViaApi(bPage, "Пётр", "Слушатель");
  await openApp(page, "vibex");
  await page.getByTestId("vibex-nav-people").click();
  await page.getByTestId("people-search").fill(b.username);
  await page.getByTestId("person-row").first().click();
  await page.getByTestId("person-write").click();
  await page.getByTestId("chat-input").fill("Привет, Пётр!");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("message")).toHaveCount(1);
  await page.getByTestId("chat-file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByTestId("composer-files")).toContainText("notes.txt");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("vibex-file")).toHaveCount(1);
  // Voice: record ~1.5 s from the fake microphone and send.
  await page.getByTestId("chat-voice").click();
  await expect(page.getByTestId("voice-recording")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByTestId("voice-send").click();
  await expect(page.getByTestId("voice-message")).toHaveCount(1);
  // Reply to the first message (hover button on PC).
  const first = page.getByTestId("message").filter({ hasText: "Привет, Пётр!" });
  await first.hover();
  await first.getByTestId("message-reply").click();
  await expect(page.getByTestId("composer-reply")).toBeVisible();
  await page.getByTestId("chat-input").fill("Это ответ");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("message-reply-quote")).toHaveCount(1);
  // Calls: honest "not available", no call state.
  await page.getByTestId("chat-call-audio").click();
  await expect(page.getByTestId("call-unavailable")).toBeVisible();
  await page.keyboard.press("Escape");

  // B: one collapsed notification for the chat; it opens the conversation.
  await bPage.getByTestId("bell").click();
  const notes = bPage.getByTestId("notification-center").getByTestId("notification");
  await expect(notes).toHaveCount(1);
  await expect(notes.first()).toHaveAttribute("data-type", "vibex.message");
  await notes.first().getByTestId("notification-open").click();
  await expect(bPage.getByTestId("voice-message")).toHaveCount(1);
  await expect(bPage.getByTestId("vibex-file")).toHaveCount(1);
  await bPage.context().close();
});

test("vibex ownership: nobody edits another person's profile, post, comment or media; settings are per person", async ({ page, browser }) => {
  test.skip(isMobile(page), "API checks once");
  const a = await signUpViaApi(page, "Анна", "Владелец");
  const bPage = await newPage(browser, false);
  await signUpViaApi(bPage, "Борис", "Чужой");
  const post = await api<{ id: string }>(page, "POST", "/api/vibex/posts", { text: "Мой пост" });
  const comment = await api<{ id: string }>(page, "POST", `/api/vibex/posts/${post.body.id}/comments`, { text: "Мой комментарий" });
  expect((await api(bPage, "PATCH", `/api/vibex/posts/${post.body.id}`, { text: "взлом" })).status).toBe(404);
  expect((await api(bPage, "DELETE", `/api/vibex/posts/${post.body.id}`)).status).toBe(404);
  expect((await api(bPage, "DELETE", `/api/vibex/comments/${comment.body.id}`)).status).toBe(404);
  // The profile route only ever changes the caller.
  await api(bPage, "PATCH", "/api/vibex/profile", { bio: "чужое" });
  expect((await api<{ bio: string }>(bPage, "GET", `/api/vibex/people/${a.id}`)).body.bio).toBe("");
  await api(page, "PATCH", "/api/vibex/settings", { privacy: { posts: "followers" } });
  expect((await api<{ items: unknown[] }>(bPage, "GET", `/api/vibex/people/${a.id}/posts`)).body.items).toHaveLength(0);
  expect((await api<{ privacy: { posts: string } }>(bPage, "GET", "/api/vibex/settings")).body.privacy.posts).toBe("everyone");
  await bPage.context().close();
});
