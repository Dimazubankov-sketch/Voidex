import { expect, test, type Browser, type CDPSession, type Page } from "@playwright/test";
import { apiAs as api, newPage, openApp, phoneHome, signUpViaApi } from "./helpers";

/** Update 3 · C–H: the Vibex chat, pins, QR, chat media tabs, feed media, profile sections, search and stories. */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

async function openVibex(page: Page) {
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
}
async function openChat(page: Page, chatId: string) {
  await openVibex(page);
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
  await page.locator(`[data-testid="chat-row"][data-chat-id="${chatId}"]`).click();
  await expect(page.locator(`[data-testid="conversation"][data-chat-id="${chatId}"]`)).toBeVisible();
  await page.waitForTimeout(450);
}
async function pair(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Алина", "Третья");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Богдан", "Третий");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body as { id: string };
  return { a, b, bp, chat };
}
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
async function upload(page: Page, name: string, purpose: "message" | "post" = "message", b64 = PNG): Promise<string> {
  return page.evaluate(
    async ({ b64, name, purpose }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const f = await fetch(`/api/vibex/files?purpose=${purpose}`, {
        method: "POST",
        headers: { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}`, "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(name) },
        body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      }).then((x) => x.json());
      return f.id as string;
    },
    { b64, name, purpose },
  );
}
async function touchSwipe(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("C1: the chat header is three glass capsules; on phones the history scrolls under it; bubbles 18 px with the time inside", async ({ page, browser }) => {
  const { bp, chat } = await pair(page, browser);
  for (let i = 0; i < 14; i++) await api(i % 2 ? bp : page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: `Сообщение ${i}` });
  await openChat(page, chat.id);
  const title = page.getByTestId("chat-header-title");
  const avatar = page.getByTestId("chat-header-avatar");
  expect(Math.round((await title.boundingBox())!.height)).toBe(40);
  expect(Math.round((await avatar.boundingBox())!.width)).toBe(40);
  const conv = page.getByTestId("conversation");
  const scroller = page.getByTestId("messages");
  if (isMobile(page)) {
    await expect(page.getByTestId("chat-back")).toBeVisible();
    // Floating: the history starts at the top of the chat (under the header) and is padded below it.
    await expect(conv).toHaveAttribute("data-floating-head", "true");
    const top = (await page.getByTestId("chat-top").boundingBox())!;
    const list = (await scroller.boundingBox())!;
    expect(Math.abs(list.y - top.y)).toBeLessThan(2);
    const pad = await scroller.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
    expect(pad).toBeGreaterThanOrEqual(top.height);
    // The space between the capsules lets touches through to the history.
    const gap = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="chat-top"]') ? "header" : "below", { x: top.x + 4, y: top.y + top.height - 3 });
    expect(gap).toBe("below");
  }
  // Bubbles: 18 px corners, the time inside the bubble.
  const bubble = page.locator('[data-testid="message"][data-mine="true"] .rounded-\\[18px\\]').last();
  await expect(bubble).toBeVisible();
  expect(await bubble.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("18px");
  const time = bubble.locator("span.tabular-nums").last();
  const tb = (await time.boundingBox())!;
  const bb = (await bubble.boundingBox())!;
  expect(tb.x + tb.width).toBeLessThanOrEqual(bb.x + bb.width + 0.5);
  expect(tb.y + tb.height).toBeLessThanOrEqual(bb.y + bb.height + 0.5);
  // The composer: 40 px controls.
  expect(Math.round((await page.getByTestId("chat-attach").boundingBox())!.height)).toBe(40);
  await bp.context().close();
});

test("C2: pins go from the newest to the very first and stop there (no jump back); each tap lands on its message", async ({ page, browser }) => {
  const { bp, chat } = await pair(page, browser);
  const ids: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const m = (await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: `Закреп ${i}` })).body as { id: string };
    ids.push(m.id);
    for (let k = 0; k < 6; k++) await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: `между ${i}.${k}` });
  }
  for (const id of ids) await api(page, "POST", `/api/vibex/chats/${chat.id}/pins`, { messageId: id });
  await openChat(page, chat.id);
  const bar = page.getByTestId("pinned-bar");
  await expect(bar).toHaveAttribute("data-count", "3");
  // The capsule: compact, fully rounded.
  const cap = bar.locator("xpath=..");
  expect(Math.round((await cap.boundingBox())!.height)).toBe(44);
  await expect(page.getByTestId("pinned-text")).toHaveText("Закреп 3");
  const expectJumped = async (id: string) => {
    await expect(page.locator(`[data-message-id="${id}"][data-jumped]`)).toHaveCount(1);
    // In view (not under the header).
    const m = (await page.locator(`[data-message-id="${id}"]`).boundingBox())!;
    const top = (await page.getByTestId("chat-top").boundingBox())!;
    expect(m.y).toBeGreaterThan(top.y + (isMobile(page) ? top.height - 4 : 0));
    await page.waitForTimeout(1700); // the highlight fades
  };
  await bar.click();
  await expectJumped(ids[2]!);
  await expect(page.getByTestId("pinned-text")).toHaveText("Закреп 2");
  await bar.click();
  await expectJumped(ids[1]!);
  await expect(page.getByTestId("pinned-text")).toHaveText("Закреп 1");
  await bar.click();
  await expectJumped(ids[0]!);
  // At the first pin: it stays the first (never back to the newest).
  await expect(page.getByTestId("pinned-text")).toHaveText("Закреп 1");
  await expect(bar).toHaveAttribute("data-at-first", "true");
  await bar.click();
  await expectJumped(ids[0]!);
  await expect(page.getByTestId("pinned-text")).toHaveText("Закреп 1");
  await bp.context().close();
});

test("D: the QR screen — «Поделиться» and «Сохранить» are the same size on one line; the logo is exactly in the middle", async ({ page }) => {
  await signUpViaApi(page, "Код", "Ровный");
  await openVibex(page);
  if (isMobile(page)) await page.getByTestId("vibex-tab-me").last().click();
  else await page.getByTestId("vibex-nav-me").last().click();
  await page.getByTestId("profile-more").click();
  await page.getByTestId("profile-menu-qr").click();
  const sheet = page.getByTestId("qr-sheet");
  await expect(sheet).toBeVisible();
  const share = (await page.getByTestId("qr-share").boundingBox())!;
  const save = (await page.getByTestId("qr-save").boundingBox())!;
  await expect(page.getByTestId("qr-save")).toHaveText("Сохранить");
  expect(Math.abs(share.width - save.width)).toBeLessThan(1);
  expect(Math.abs(share.height - save.height)).toBeLessThan(1);
  expect(save.height).toBeLessThanOrEqual(48);
  // Icon and text centred together in the button, 8 px apart.
  const centre = await page.getByTestId("qr-save").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const kids = [...el.children].map((c) => c.getBoundingClientRect());
    const left = Math.min(...kids.map((k) => k.left));
    const right = Math.max(...kids.map((k) => k.right));
    return { off: (left + right) / 2 - (r.left + r.width / 2), gap: kids[1]!.left - kids[0]!.right };
  });
  expect(Math.abs(centre.off)).toBeLessThan(1);
  expect(Math.round(centre.gap)).toBe(8);
  // The logo: centred on the code, the same size as the modules cut out for it.
  const code = (await page.getByTestId("qr-code").boundingBox())!;
  const logo = (await page.getByTestId("qr-logo").boundingBox())!;
  expect(Math.abs(logo.x + logo.width / 2 - (code.x + code.width / 2))).toBeLessThan(0.6);
  expect(Math.abs(logo.y + logo.height / 2 - (code.y + code.height / 2))).toBeLessThan(0.6);
  // Readable: the logo covers a small share of the code (error correction Q restores up to 25 %).
  const modules = Number(await page.getByTestId("qr-code").getAttribute("data-modules"));
  const unit = code.width / (modules + 2);
  const hole = Math.round(logo.width / unit);
  expect(hole % 2).toBe(1);
  expect((hole * hole) / (modules * modules)).toBeLessThan(0.08);
});

test("E: chat info tabs — «Медиа» has photos only (no video circles); the tab row moves with the finger, no scrollbar, never takes the page away", async ({ page, browser }) => {
  const { bp, chat } = await pair(page, browser);
  const f = await upload(page, "photo.png");
  await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "", fileIds: [f] });
  await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Смотри https://voidex.su" });
  await openChat(page, chat.id);
  await page.getByTestId("chat-header-title").click();
  const info = page.getByTestId("chat-info");
  await expect(info).toBeVisible();
  const strip = page.getByTestId("chat-info-tabs");
  await expect(strip).toHaveAttribute("data-gesture-owner", "");
  // No native scrolling (so no scroll indicator) in the row.
  expect(await strip.evaluate((el) => getComputedStyle(el).overflowX)).toBe("hidden");
  await page.getByTestId("chat-tab-media").click();
  await expect(page.getByTestId("chat-tab-thumb")).toHaveCount(1);
  if (isMobile(page)) {
    // A sideways swipe on the row moves the row, the info page stays (no swipe back, no drawer).
    const cdp = await page.context().newCDPSession(page);
    const sb = (await strip.boundingBox())!;
    const gif = page.getByTestId("chat-tab-gifs");
    const before = (await gif.boundingBox())!.x;
    await touchSwipe(cdp, { x: sb.x + sb.width - 20, y: sb.y + sb.height / 2 }, { x: sb.x + 30, y: sb.y + sb.height / 2 });
    await page.waitForTimeout(600);
    await expect(info).toBeVisible();
    await expect(page.locator('[data-testid="conversation"]')).toBeVisible();
    if ((await strip.getAttribute("data-strip-fits")) === null) expect((await gif.boundingBox())!.x).toBeLessThan(before - 20);
    await touchSwipe(cdp, { x: sb.x + 30, y: sb.y + sb.height / 2 }, { x: sb.x + sb.width - 20, y: sb.y + sb.height / 2 });
    await page.waitForTimeout(600);
    await expect(info).toBeVisible();
  }
  // Choosing a tab brings it into view.
  await page.getByTestId("chat-tab-links").click();
  await expect(page.getByTestId("chat-tab-links")).toHaveAttribute("aria-selected", "true");
  const lb = (await page.getByTestId("chat-tab-links").boundingBox())!;
  const sb2 = (await strip.boundingBox())!;
  expect(lb.x).toBeGreaterThanOrEqual(sb2.x - 1);
  expect(lb.x + lb.width).toBeLessThanOrEqual(sb2.x + sb2.width + 1);
  await expect(page.getByTestId("chat-tab-row")).toHaveCount(1);
  await bp.context().close();
});

test("F: feed media keep their shape (square / wide / tall); a carousel keeps one frame and moves one photo per swipe", async ({ page }) => {
  await signUpViaApi(page, "Лента", "Форматов");
  // 1×1 square, 16×9 wide and 9×16 tall PNGs drawn in the page.
  const png = (w: number, h: number) =>
    page.evaluate(
      ([w, h]) => {
        const c = document.createElement("canvas");
        c.width = w!;
        c.height = h!;
        const g = c.getContext("2d")!;
        g.fillStyle = "#7b6cff";
        g.fillRect(0, 0, w!, h!);
        return c.toDataURL("image/png").split(",")[1]!;
      },
      [w, h],
    );
  const sq = await upload(page, "sq.png", "post", await png(60, 60));
  const wide = await upload(page, "wide.png", "post", await png(160, 90));
  const tall = await upload(page, "tall.png", "post", await png(90, 160));
  await api(page, "POST", "/api/vibex/posts", { text: "квадрат", mediaIds: [sq] });
  await api(page, "POST", "/api/vibex/posts", { text: "широкое", mediaIds: [wide] });
  await api(page, "POST", "/api/vibex/posts", { text: "высокое", mediaIds: [tall] });
  // A file belongs to one post: the carousel gets its own copies.
  const c1 = await upload(page, "c1.png", "post", await png(160, 90));
  const c2 = await upload(page, "c2.png", "post", await png(60, 60));
  const c3 = await upload(page, "c3.png", "post", await png(90, 160));
  expect((await api(page, "POST", "/api/vibex/posts", { text: "карусель", mediaIds: [c1, c2, c3] })).status).toBe(201);
  await openVibex(page);
  const card = (text: string) => page.locator('[data-testid="post-card"]', { hasText: text }).first();
  const media = (text: string) => card(text).getByTestId("vibex-media");
  await expect(media("квадрат")).toHaveAttribute("data-shape", "square");
  await expect(media("широкое")).toHaveAttribute("data-shape", "wide");
  await expect(media("высокое")).toHaveAttribute("data-shape", "tall");
  const ratio = async (text: string) => {
    const b = (await media(text).boundingBox())!;
    return b.width / b.height;
  };
  expect(Math.abs((await ratio("квадрат")) - 1)).toBeLessThan(0.02);
  expect(Math.abs((await ratio("широкое")) - 16 / 9)).toBeLessThan(0.03);
  expect(Math.abs((await ratio("высокое")) - 9 / 16)).toBeLessThan(0.03);
  expect((await media("высокое").boundingBox())!.height).toBeLessThanOrEqual(521);
  // The carousel: one frame (the first photo's shape) for all, one step per swipe, a quiet indicator.
  const car = media("карусель");
  await car.scrollIntoViewIfNeeded();
  await expect(car).toHaveAttribute("data-shape", "wide");
  const frame = (await car.boundingBox())!;
  await expect(car).toHaveAttribute("data-index", "0");
  await expect(car.getByTestId("carousel-dots")).toBeVisible();
  const b = frame;
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width * 0.8 - (b.width * 0.5 * i) / 8, b.y + b.height / 2);
  await page.mouse.up();
  await expect(car).toHaveAttribute("data-index", "1");
  const after = (await car.boundingBox())!;
  expect(Math.abs(after.height - frame.height)).toBeLessThan(1);
  // A tap opens the whole picture.
  await car.click();
  await expect(page.getByTestId("vibex-lightbox")).toBeVisible();
  await expect(page.getByTestId("vibex-lightbox").locator("img")).toHaveClass(/object-contain/);
});

test("G: the profile — «Посты · Репосты · Видео», the arrow opens the photos; reposts never mix with posts", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Профиль", "Разделов");
  const bp = await newPage(browser, isMobile(page));
  await signUpViaApi(bp, "Чужой", "Автор");
  const theirs = (await api(bp, "POST", "/api/vibex/posts", { text: "Пост друга" })).body as { id: string };
  await api(page, "POST", "/api/vibex/posts", { text: "Мой пост" });
  await api(page, "POST", `/api/vibex/posts/${theirs.id}/repost`, {});
  const photo = await upload(page, "p.png", "post");
  await api(page, "POST", "/api/vibex/posts", { text: "С фото", mediaIds: [photo] });
  await bp.context().close();
  await openVibex(page);
  if (isMobile(page)) await page.getByTestId("vibex-tab-me").last().click();
  else await page.getByTestId("vibex-nav-me").last().click();
  const tabs = await page.getByTestId("profile-tabs").getByRole("tab").allInnerTexts();
  expect(tabs.map((x) => x.trim())).toEqual(["Посты", "Репосты", "Видео"]);
  await expect(page.getByTestId("profile-tab-posts")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid="post-card"][data-kind="post"]', { hasText: "Мой пост" })).toBeVisible();
  await expect(page.locator('[data-testid="post-card"][data-kind="repost"]')).toHaveCount(0);
  await page.getByTestId("profile-tab-reposts").click();
  await expect(page.locator('[data-testid="post-card"][data-kind="repost"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="post-card"][data-kind="post"]')).toHaveCount(0);
  await page.getByTestId("profile-tab-video").click();
  await expect(page.getByTestId("profile-videos")).toBeVisible();
  // The arrow opens the switch (smoothly) and leads to the photos.
  await page.getByTestId("profile-media-toggle").click();
  await expect(page.getByTestId("profile-media-switch")).toBeVisible();
  await page.getByTestId("profile-media-photos").click();
  await expect(page.getByTestId("profile-media-switch")).toHaveCount(0);
  await expect(page.getByTestId("profile-tab-photos")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("profile-tab-photos")).toHaveText("Фото");
  await expect(page.getByTestId("profile-photos").getByTestId("publication-tile")).toHaveCount(1);
  void me;
});

test("G3 / H: one glass tab bar (Vibex and Clock); search rises with «Отмена» and comes back; stories in a row with seen / new rings", async ({ page }) => {
  test.skip(!isMobile(page), "phone tab bars and search");
  await signUpViaApi(page, "Поиск", "Историй");
  await openVibex(page);
  const bar = page.getByTestId("vibex-tabbar");
  await expect(bar).toHaveAttribute("data-gesture-owner", "");
  await page.getByTestId("vibex-tab-chats").last().click();
  // Pull down: the search, then the stories row.
  const list = page.getByTestId("chats-scroll");
  const lb = (await list.boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(lb.x + lb.width / 2, lb.y + 40 + i * 16);
  await page.mouse.up();
  await expect(page.getByTestId("stories-header")).toBeVisible();
  await expect(page.getByTestId("chat-search")).toBeVisible();
  // Tap the search: the header folds, «Отмена» comes, the field has the focus.
  await page.getByTestId("chat-search").click();
  await expect(page.getByTestId("chats-pane")).toHaveAttribute("data-searching", "true");
  await expect(page.getByTestId("chat-search-cancel")).toBeVisible();
  await expect(page.getByTestId("stories-header")).toHaveCount(0);
  await expect(page.getByTestId("chat-search")).toBeFocused();
  await page.keyboard.type("кто");
  await page.getByTestId("chat-search-cancel").click();
  await expect(page.getByTestId("chats-pane")).not.toHaveAttribute("data-searching", "true");
  await expect(page.getByTestId("chat-search")).toHaveValue("");
  await expect(page.getByTestId("chat-search-cancel")).toHaveCount(0);
  // Clock uses the same bar.
  await phoneHome(page);
  await openApp(page, "clock");
  await expect(page.locator('[data-testid="clock-bottom-nav"]')).toHaveClass(/vx-tabbar/);
});
