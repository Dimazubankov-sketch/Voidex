import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs as api, newPage, openApp, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Step 2.12: Vibex. The menu button (bars, no logo by «Чаты»), photos as the
 * message itself (no coloured frame), the avatar in the chat list (a story if
 * there is one, else the profile; no callout), my own story circle next to
 * «Моя история», rings purple while unseen and grey once seen, the profile
 * photo full screen, a video circle that stays round while it opens and
 * closes, and no pop-up for the app in front.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Uploads a picture as this account (a message file, a story, the avatar). */
async function upload(page: Page, kind: "message" | "story" | "avatar"): Promise<string> {
  return page.evaluate(
    async ({ b64, kind }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const auth = { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}` };
      const body = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (kind === "avatar") {
        const a = await fetch("/api/account/avatar", { method: "PUT", headers: { ...auth, "Content-Type": "image/png" }, body });
        return String(a.status);
      }
      const f = await fetch(`/api/vibex/files?purpose=${kind}`, { method: "POST", headers: { ...auth, "Content-Type": "application/octet-stream", "X-File-Name": "p.png" }, body }).then((x) => x.json());
      if (kind === "message") return f.id as string;
      const s = await fetch("/api/vibex/stories", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ fileId: f.id }) }).then((x) => x.json());
      return s.id as string;
    },
    { b64: PNG, kind },
  );
}

async function launchVibex(page: Page) {
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
}
async function toChats(page: Page) {
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
  await expect(page.getByTestId("chats-pane")).toBeVisible();
}

/** A (the page) and B with a direct chat that has a message from B. */
async function pair(page: Page, browser: Browser, names: [string, string] = ["Анна", "Борис"]) {
  const a = await signUpViaApi(page, names[0], "Двенадцатая");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, names[1], "Собеседник");
  const chat = (await api(bp, "POST", "/api/vibex/chats/direct", { userId: a.id })).body as { id: string };
  await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет" });
  return { a, b, bp, chat };
}

test("the menu button: bars instead of the logo, it opens the menu; no logo by «Чаты»", async ({ page }) => {
  await signUpViaApi(page, "Меню", "Вайбекса");
  await launchVibex(page);
  await toChats(page);
  // The bars: two lines (the lower one shorter), no logo by «Чаты».
  const segments = async (glyph: ReturnType<Page["locator"]>) => glyph.evaluate((el) => (el.querySelector("path")?.getAttribute("d")?.match(/M/g) ?? []).length);
  const title = page.getByTestId("vibex-header");
  if (isMobile(page)) {
    await expect(title).toContainText("Чаты");
    await expect(title.locator('image[href*="app-vibex"]')).toHaveCount(0);
    const menu = page.getByTestId("vibex-menu");
    expect(await segments(menu.getByTestId("vibex-menu-glyph"))).toBe(2);
    await expect(menu.locator('image[href*="app-vibex"]')).toHaveCount(0);
    await menu.click();
    await expect(page.getByTestId("vibex-drawer")).toHaveAttribute("data-open", "true");
  } else {
    // PC: the same bars fold and unfold the side menu; no logo by «Чаты».
    await expect(page.locator('[data-testid="window-vibex"] [data-testid="chats-pane"] image[href*="app-vibex"]')).toHaveCount(0);
    const glyph = page.locator('[data-testid="window-vibex"] [data-testid="vibex-menu-glyph"]').first();
    await expect(glyph).toBeVisible();
    expect(await segments(glyph)).toBe(2);
  }
});

test("photos are the message itself: no coloured frame, a sensible width, the time on the picture; with text the photos reach the bubble's edges", async ({ page, browser }) => {
  const { bp, chat } = await pair(page, browser, ["Фото", "Галерея"]);
  const ids = [await upload(page, "message"), await upload(page, "message"), await upload(page, "message")];
  expect((await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { fileIds: ids })).status).toBe(201);
  const two = [await upload(page, "message"), await upload(page, "message")];
  expect((await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "С подписью", fileIds: two })).status).toBe(201);
  await launchVibex(page);
  await toChats(page);
  await page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`).click();
  await expect(page.getByTestId("conversation")).toBeVisible();

  const media = page.getByTestId("message-media");
  await expect(media).toHaveCount(1);
  await expect(media.getByTestId("media-mosaic")).toHaveAttribute("data-layout", "three");
  await expect(media.getByTestId("mosaic-tile")).toHaveCount(3);
  const look = await media.evaluate((el) => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const meta = el.querySelector('[data-testid="message-media-meta"]')!.getBoundingClientRect();
    return { bg: cs.backgroundColor, border: cs.borderTopWidth, w: box.width, metaInside: meta.right <= box.right && meta.bottom <= box.bottom && meta.top >= box.top };
  });
  expect(look.bg).toBe("rgba(0, 0, 0, 0)");
  expect(look.border).toBe("0px");
  expect(look.w).toBeLessThanOrEqual(421);
  expect(look.w).toBeGreaterThan(200);
  expect(look.metaInside).toBe(true);
  await expect(media.getByTestId("message-media-meta")).toContainText(/\d{1,2}:\d{2}/);

  // With a caption: the bubble is as wide as the photos and they touch its edges (no violet frame around them).
  const captioned = page.getByTestId("message").filter({ hasText: "С подписью" });
  const edge = await captioned.getByTestId("media-mosaic").evaluate((m) => {
    const bubble = m.parentElement!.getBoundingClientRect();
    const r = m.getBoundingClientRect();
    return { left: r.left - bubble.left, right: bubble.right - r.right, top: r.top - bubble.top };
  });
  expect(edge.left).toBeLessThan(1);
  expect(edge.right).toBeLessThan(1);
  expect(edge.top).toBeLessThan(1);
  await bp.context().close();
});

test("chat list avatar: no callout; a tap opens the story when there is one, else the profile; the profile photo opens full screen", async ({ page, browser }) => {
  const { b, bp, chat } = await pair(page, browser, ["Аватар", "Профиль"]);
  expect(await upload(bp, "avatar")).toBe("200");
  await launchVibex(page);
  await toChats(page);
  const avatar = page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"] [data-testid="chat-avatar"]`);
  const style = await avatar.evaluate((el) => {
    const cs = getComputedStyle(el) as CSSStyleDeclaration & { webkitTouchCallout?: string };
    return { callout: cs.webkitTouchCallout ?? cs.getPropertyValue("-webkit-touch-callout"), select: cs.userSelect };
  });
  expect(style.select).toBe("none");
  if (style.callout) expect(style.callout).toBe("none");
  // The picture under it can't be dragged out or saved from a menu.
  await expect(page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"] img[draggable="true"]`)).toHaveCount(0);

  // No story: the profile.
  await avatar.click();
  await expect(page.getByTestId("profile-header")).toBeVisible();
  await expect(page.getByTestId("profile-header")).toContainText(b.username);
  // The profile photo, without a story: full screen, no download.
  await page.getByTestId("profile-avatar").getByTestId("avatar-open").click();
  await expect(page.getByTestId("avatar-viewer")).toBeVisible();
  await expect(page.getByTestId("avatar-viewer-image")).toBeVisible();
  await expect(page.getByTestId("avatar-viewer").getByText("Скачать")).toHaveCount(0);
  await page.getByTestId("avatar-viewer-close").click();
  await expect(page.getByTestId("avatar-viewer")).toHaveCount(0);

  await bp.context().close();
});

test("with a story: the avatar opens it; rings are purple while unseen and grey once seen; my own story has its own circle", async ({ page, browser }) => {
  const { a, bp, chat } = await pair(page, browser, ["Кольцо", "История"]);
  await upload(bp, "story");
  await launchVibex(page);
  await toChats(page);
  const row = page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`);
  await expect(row.locator('[data-story-ring="unseen"]')).toBeVisible();
  const unseenBg = await row.locator('[data-story-ring="unseen"] [data-testid="story-ring"]').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(unseenBg).toContain("gradient");
  await row.getByTestId("chat-avatar").click();
  await expect(page.getByTestId("story-viewer")).toBeVisible();
  await page.getByTestId("story-close").click();
  await expect(page.getByTestId("story-viewer")).toHaveCount(0);
  // Seen: a grey ring (not gone, not purple).
  const seen = row.locator('[data-story-ring="seen"] [data-testid="story-ring"]');
  await expect(seen).toBeVisible();
  expect(await seen.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");

  // Mine: «Моя история» stays the button to add; my story is a circle of its own, purple until I look at it.
  await upload(page, "story");
  await reloadUnlocked(page);
  await launchVibex(page);
  await toChats(page);
  await page.getByTestId("stories-stack").click();
  await expect(page.getByTestId("stories-strip")).toBeVisible();
  await expect(page.getByTestId("story-mine")).toBeVisible();
  const own = page.getByTestId("story-own");
  await expect(own).toBeVisible();
  await expect(own.locator('[data-unseen="true"]')).toHaveCount(1);
  await own.locator("button").first().click();
  await expect(page.getByTestId("story-viewer")).toBeVisible();
  await page.getByTestId("story-close").click();
  await expect(own.locator('[data-unseen="true"]')).toHaveCount(0);
  // Seen by me: views count only other people.
  const mine = (await api(page, "GET", "/api/vibex/stories")).body as { person: { id: string }; stories: { views: number; seen: boolean }[] }[];
  const group = mine.find((g) => g.person.id === a.id)!;
  expect(group.stories[0]!.seen).toBe(true);
  expect(group.stories[0]!.views).toBe(0);
  await bp.context().close();
});

test("the video circle stays round while it opens and closes (never a square frame)", async ({ page, browser }) => {
  const { bp, chat } = await pair(page, browser, ["Круг", "Кружок"]);
  await launchVibex(page);
  await toChats(page);
  await page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`).click();
  const btn = page.getByTestId("chat-record");
  if ((await btn.getAttribute("data-mode")) !== "circle") await btn.click({ button: "right" });
  await expect(btn).toHaveAttribute("data-mode", "circle");
  await btn.click();
  await expect(page.getByTestId("circle-recorder")).toHaveAttribute("data-state", "locked");
  await page.waitForTimeout(2000);
  await btn.click();
  const circle = page.getByTestId("circle-message");
  await expect(circle).toHaveCount(1);
  await page.waitForTimeout(500);

  // Every frame while it opens and closes: the face is clipped to a circle and square.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: string[]; __stop: boolean };
    w.__frames = [];
    w.__stop = false;
    const tick = () => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-testid="circle-face"], [data-testid="circle-message"] button')) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width < 4) continue;
        const round = cs.clipPath.startsWith("circle") || parseFloat(cs.borderTopLeftRadius) >= r.width / 2 - 1 || cs.borderTopLeftRadius.endsWith("%");
        if (!round || Math.abs(r.width - r.height) > 1.5) w.__frames.push(`${el.dataset.testid ?? "button"} ${cs.clipPath} ${cs.borderTopLeftRadius} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
      }
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await circle.click();
  await expect(page.getByTestId("circle-expanded")).toBeVisible();
  await page.waitForTimeout(900);
  await page.getByTestId("circle-collapse").click();
  await expect(page.getByTestId("circle-expanded")).toHaveCount(0);
  await page.waitForTimeout(400);
  const bad = await page.evaluate(() => {
    const w = window as unknown as { __frames: string[]; __stop: boolean };
    w.__stop = true;
    return w.__frames;
  });
  expect(bad, bad.slice(0, 5).join("\n")).toEqual([]);
  await bp.context().close();
});

test("no pop-up for the app in front; another app's pop-up still shows", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Фокус", "Окна");
  const bp = await newPage(browser, isMobile(page));
  await signUpViaApi(bp, "Пишущий", "Друг");
  const chat = (await api(bp, "POST", "/api/vibex/chats/direct", { userId: me.id })).body as { id: string };
  // A banner that came before Vibex was opened goes away once Vibex is in front.
  await page.waitForTimeout(1200);
  await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "До открытия" });
  await expect(page.locator('[data-testid="system-popup"][data-app="vibex"]')).toBeVisible();
  await launchVibex(page);
  await expect(page.locator('[data-testid="system-popup"][data-app="vibex"]')).toHaveCount(0);
  await toChats(page);
  await page.waitForTimeout(1200);
  await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Пока Vibex открыт" });
  // The chat list shows it; no banner, the Notification Center still has it.
  await expect(page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`)).toContainText("Пока Vibex открыт");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("system-popup")).toHaveCount(0);
  await expect.poll(async () => (await api(page, "GET", "/api/notifications")).body.items.some((n: { type: string }) => n.type === "vibex.message")).toBe(true);

  // Another app's notification (a letter) still pops up over Vibex.
  const draft = (await api(bp, "POST", "/api/mail/drafts", { to: [me.address], subject: "Письмо поверх", body: "Текст" })).body;
  expect((await api(bp, "POST", `/api/mail/drafts/${draft.id}/send`)).status).toBeLessThan(300);
  const popup = page.getByTestId("system-popup");
  await expect(popup).toHaveAttribute("data-app", "mail");
  await expect(popup.getByTestId("system-popup-body")).toHaveText("Письмо поверх");
  await bp.context().close();
});
