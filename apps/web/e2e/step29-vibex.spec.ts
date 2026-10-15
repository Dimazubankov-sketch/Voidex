import { expect, test, type Browser, type Page } from "@playwright/test";
import { newPage, openApp, profileActionRow, recordCircle, recordVoice, signUpViaApi } from "./helpers";

/**
 * Step 2.9 — Vibex reconstruction: «Чаты» (sections, filter, search, stories,
 * long-press preview that never reads, delete for me / everyone, notifications
 * off, desktop two columns), the feed (search in place, +, History tabs,
 * looping carousel, post attachments), the profile (Публикации first, +).
 */

const SHOTS = process.env.STEP29_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(page: Page, method: string, url: string, body?: unknown, raw?: { name: string; base64: string }): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ({ method, url, body, raw }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const headers: Record<string, string> = { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}` };
      let payload: BodyInit | undefined;
      if (raw) {
        headers["Content-Type"] = "application/octet-stream";
        headers["X-File-Name"] = encodeURIComponent(raw.name);
        payload = Uint8Array.from(atob(raw.base64), (c) => c.charCodeAt(0));
      } else if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await fetch(url, { method, headers, body: payload });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body, raw },
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

/** A, B (with a direct chat where B wrote), C in a group made by A. */
async function people(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Алиса", "Чатова");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Борис", "Беседин");
  const cp = await newPage(browser, isMobile(page));
  const c = await signUpViaApi(cp, "Вера", "Группова");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  expect((await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет, встречаемся у фонтана" })).status).toBe(201);
  expect((await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "В семь вечера" })).status).toBe(201);
  const group = (await api(page, "POST", "/api/vibex/groups", { title: "Поход в горы", memberIds: [b.id, c.id] })).body;
  expect((await api(cp, "POST", `/api/vibex/chats/${group.id}/messages`, { text: "Беру палатку" })).status).toBe(201);
  return { a, b, c, bp, cp, chat, group };
}

test("«Чаты»: named Chats everywhere; sections Pinned / Chats / Groups and the filter (saved); search by name, @voidops address, group and text", async ({ page, browser }) => {
  const { b, chat, group, bp, cp } = await people(page, browser);
  await launchVibex(page);
  // The name is «Чаты» (tab bar on phones, side menu on PC); never «Сообщения».
  if (isMobile(page)) await expect(page.getByTestId("vibex-tab-chats")).toContainText("Чаты");
  else await expect(page.getByTestId("vibex-nav-chats")).toContainText("Чаты");
  await toChats(page);
  await expect(page.getByTestId("chats-pane")).not.toContainText("Сообщения");

  // Sections: chats first by default.
  const keys = async () => page.getByTestId("chat-section").evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
  await expect.poll(keys).toEqual(["chats", "groups"]);
  // Pin the group: it goes to the top in «Закреплённые».
  await api(page, "PUT", "/api/vibex/chats/pins", { conversationIds: [group.id] });
  await page.reload();
  await expect(page.getByTestId("lock-screen").or(page.getByTestId("workspace")).first()).toBeVisible();
  if (await page.getByTestId("lock-screen").count()) await page.keyboard.type("135790");
  await launchVibex(page);
  await toChats(page);
  await expect.poll(keys).toEqual(["pinned", "chats"]);
  await api(page, "PUT", "/api/vibex/chats/pins", { conversationIds: [] });

  // Pull-down / PC: the search with the filter button.
  if (isMobile(page)) {
    const list = (await page.getByTestId("chats-scroll").boundingBox())!;
    await page.mouse.move(list.x + list.width / 2, list.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(list.x + list.width / 2, list.y + 40 + i * 12);
    await page.mouse.up();
  } else {
    // Step 2.10: PC starts folded too; a wheel up at the top opens the search.
    const list = (await page.getByTestId("chats-scroll").boundingBox())!;
    await page.mouse.move(list.x + list.width / 2, list.y + 80);
    await page.mouse.wheel(0, -120);
  }
  await expect(page.getByTestId("chat-search")).toBeVisible();
  await page.getByTestId("chat-filter").click();
  await page.getByTestId("chat-order-groups-first").click();
  await page.waitForTimeout(400);
  await expect.poll(async () => (await keys()).filter((k) => k !== "pinned")).toEqual(["groups", "chats"]);
  await page.getByTestId("chat-filter").click();
  await page.getByTestId("chat-order-mixed").click();
  await expect.poll(keys).toEqual(["all"]);
  expect((await api(page, "GET", "/api/vibex/settings")).body.chats.order).toBe("mixed");
  await shot(page, `chats-mixed-${isMobile(page) ? "phone" : "pc"}`);

  // Search: name, address (both spellings), group title, message text.
  const field = page.getByTestId("chat-search");
  await field.fill("Борис");
  await expect(page.getByTestId("chat-search-chat").first()).toContainText("Борис");
  await field.fill(b.address);
  await expect(page.getByTestId("chat-search-chat").first()).toContainText("Борис");
  await field.fill(b.address + ".ru");
  await expect(page.getByTestId("chat-search-chat").first()).toContainText("Борис");
  await field.fill("горы");
  await expect(page.getByTestId("chat-search-chat").first()).toContainText("Поход в горы");
  await field.fill("фонтан");
  await expect(page.getByTestId("chat-search-message").first()).toContainText("фонтан");
  await page.getByTestId("chat-search-message").first().click();
  await expect(page.locator(`[data-testid="conversation"][data-chat-id="${chat.id}"]`)).toBeVisible();
  await bp.context().close();
  await cp.context().close();
});

test("preview (long press / right click → Preview) shows the messages and marks nothing read; notifications off; delete for me in place", async ({ page, browser }) => {
  const { chat, bp, cp } = await people(page, browser);
  await launchVibex(page);
  await toChats(page);
  const row = page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`);
  await expect(row.getByTestId("chat-unread")).toHaveText("2");
  if (isMobile(page)) {
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
  } else {
    await row.click({ button: "right" });
    await expect(page.getByTestId("chat-context-menu")).toBeVisible();
    await expect(page.getByTestId("chat-preview")).toHaveCount(0);
    await page.getByTestId("chat-action-preview").click();
  }
  const preview = page.getByTestId("chat-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId("preview-messages")).toContainText("В семь вечера");
  await shot(page, `chat-preview-${isMobile(page) ? "phone" : "pc"}`);
  await page.waitForTimeout(800);
  // Nothing read: the unread badge stays, the sender sees no read receipt, the server agrees.
  const mine = (await api(page, "GET", "/api/vibex/chats")).body.find((c: { id: string }) => c.id === chat.id);
  expect(mine.unread).toBe(2);
  expect((await api(bp, "GET", "/api/vibex/chats")).body.find((c: { id: string }) => c.id === chat.id).peerReadAt).toBeNull();

  // Notifications off from the preview's actions.
  await preview.getByTestId("chat-action-mute").click();
  await expect(preview).toHaveCount(0);
  await expect(row.getByTestId("chat-muted")).toBeVisible();
  expect((await api(page, "GET", "/api/vibex/chats")).body.find((c: { id: string }) => c.id === chat.id).muted).toBe(true);

  // Tap outside closes the preview.
  if (isMobile(page)) {
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
  } else {
    await row.click({ button: "right" });
    await page.getByTestId("chat-action-preview").click();
  }
  await expect(preview).toBeVisible();
  await page.getByTestId("chat-preview-backdrop").click({ position: { x: 8, y: 8 } });
  await expect(preview).toHaveCount(0);

  // Delete turns into two choices in its place; «Удалить у себя» removes it from my list only.
  if (isMobile(page)) {
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
  } else await row.click({ button: "right" });
  await page.getByTestId("chat-action-delete").last().click();
  await expect(page.getByTestId("chat-delete-choice")).toBeVisible();
  await expect(page.getByTestId("chat-action-delete-me")).toBeVisible();
  await expect(page.getByTestId("chat-action-delete-all")).toBeVisible();
  await shot(page, `chat-delete-choice-${isMobile(page) ? "phone" : "pc"}`);
  await page.getByTestId("chat-action-delete-me").click();
  await expect(row).toHaveCount(0);
  expect((await api(bp, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items.length).toBe(2);
  await bp.context().close();
  await cp.context().close();
});

test("group: a member can't delete it for everyone; the owner can", async ({ page, browser }) => {
  const { group, bp, cp } = await people(page, browser);
  await launchVibex(bp);
  await toChats(bp);
  const row = bp.locator(`[data-testid="chat-row"][data-chat-id="${group.id}"]`);
  if (isMobile(bp)) {
    const box = (await row.boundingBox())!;
    await bp.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await bp.mouse.down();
    await bp.waitForTimeout(700);
    await bp.mouse.up();
  } else await row.click({ button: "right" });
  await bp.getByTestId("chat-action-delete").last().click();
  await expect(bp.getByTestId("chat-action-delete-me")).toBeVisible();
  await expect(bp.getByTestId("chat-action-delete-all")).toHaveCount(0);
  await bp.keyboard.press("Escape");

  await launchVibex(page);
  await toChats(page);
  const mine = page.locator(`[data-testid="chat-row"][data-chat-id="${group.id}"]`);
  if (isMobile(page)) {
    const box = (await mine.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
  } else await mine.click({ button: "right" });
  await page.getByTestId("chat-action-delete").last().click();
  await page.getByTestId("chat-action-delete-all").click();
  await expect(mine).toHaveCount(0);
  await expect.poll(async () => (await api(cp, "GET", "/api/vibex/chats")).body.some((c: { id: string }) => c.id === group.id)).toBe(false);
  await bp.context().close();
  await cp.context().close();
});

test("stories: collapsed avatars in the header, pull down for search then stories; create, view (progress, pause, next), seen for the friend", async ({ page, browser }) => {
  const { bp, cp } = await people(page, browser);
  // B posts a story (B and A share a chat).
  const f = await api(bp, "POST", "/api/vibex/files?purpose=story", undefined, { name: "story.png", base64: PNG });
  expect((await api(bp, "POST", "/api/vibex/stories", { fileId: f.body.id })).status).toBe(201);
  await launchVibex(page);
  await toChats(page);
  await expect(page.getByTestId("stories-stack")).toBeVisible();
  // Step 2.10: folded by default on PC too.
  await expect(page.getByTestId("stories-strip")).toHaveCount(0);
  await page.getByTestId("stories-stack").click();
  await expect(page.getByTestId("stories-strip")).toBeVisible();
  await expect(page.getByTestId("story-mine")).toBeVisible();
  await shot(page, `stories-strip-${isMobile(page) ? "phone" : "pc"}`);
  await page.getByTestId("story-person").first().locator("button").first().click();
  const viewer = page.getByTestId("story-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId("story-image")).toBeVisible();
  // Step 2.11: a tap in the middle pauses (there is no pause button any more).
  const stage = (await viewer.getByTestId("story-stage").boundingBox())!;
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await expect(viewer).toHaveAttribute("data-paused", "true");
  await shot(page, `story-viewer-${isMobile(page) ? "phone" : "pc"}`);
  await page.getByTestId("story-close").click();
  await expect(viewer).toHaveCount(0);
  // Seen: B's story shows a grey ring for A now.
  await expect.poll(async () => (await api(page, "GET", "/api/vibex/stories")).body.find((g: { mine: boolean }) => !g.mine)?.seen).toBe(true);

  // My story: + → device photo → preview → publish.
  await page.getByTestId("story-create").click();
  await expect(page.getByTestId("story-source")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("story-source-device").click();
  await (await chooser).setFiles({ name: "me.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
  await expect(page.getByTestId("story-preview")).toBeVisible();
  await page.getByTestId("story-publish").click();
  await expect(page.getByTestId("story-preview")).toHaveCount(0);
  await expect.poll(async () => (await api(page, "GET", "/api/vibex/stories")).body.find((g: { mine: boolean }) => g.mine)?.stories.length).toBe(1);
  // The friend sees it.
  await expect.poll(async () => (await api(bp, "GET", "/api/vibex/stories")).body.some((g: { mine: boolean }) => !g.mine)).toBe(true);
  await bp.context().close();
  await cp.context().close();
});

test("PC: chat list and the conversation side by side (300–360 px list); right click menu", async ({ page, browser }) => {
  test.skip(isMobile(page), "PC layout");
  const { chat, bp, cp } = await people(page, browser);
  await launchVibex(page);
  await toChats(page);
  const col = (await page.getByTestId("vibex-chat-column").boundingBox())!;
  expect(col.width).toBeGreaterThanOrEqual(300);
  expect(col.width).toBeLessThanOrEqual(360);
  await page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`).click();
  const conv = (await page.getByTestId("conversation").boundingBox())!;
  expect(conv.x).toBeGreaterThanOrEqual(col.x + col.width - 1);
  expect(conv.width).toBeGreaterThan(col.width);
  await shot(page, "pc-two-columns");
  await bp.context().close();
  await cp.context().close();
});

// ------------------------------------------------------------- chat media

/** Real touches (Chromium): a finger down at (x, y), moved along `path`, then lifted after `holdMs`. */
async function touchGesture(page: Page, x: number, y: number, path: { dx: number; dy: number }[], holdMs: number, lift = true) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(holdMs);
  let last = { x, y };
  for (const p of path) {
    last = { x: x + p.dx, y: y + p.dy };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [last] });
    await page.waitForTimeout(30);
  }
  if (lift) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  return { cdp, last };
}
const steps = (dx: number, dy: number, n = 8) => Array.from({ length: n }, (_, i) => ({ dx: (dx * (i + 1)) / n, dy: (dy * (i + 1)) / n }));

async function openChatWith(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Запись", "Кнопкина");
  const other = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(other, "Слушатель", "Кругов");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  expect((await api(other, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Жду голосовое" })).status).toBe(201);
  await launchVibex(page);
  await toChats(page);
  await page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`).click();
  await expect(page.getByTestId("conversation")).toBeVisible();
  return { a, b, other, chat };
}

test("phone: one button — tap switches mic ↔ circle; hold records; slide left cancels; slide up locks (hands free), then send; release sends", async ({ page, browser }) => {
  test.skip(!isMobile(page), "touch gestures");
  const { other } = await openChatWith(page, browser);
  const btn = page.getByTestId("chat-record");
  await expect(btn).toHaveAttribute("data-mode", "voice");
  await expect(page.getByTestId("chat-voice")).toHaveCount(0);
  const box = (await btn.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // A quick tap switches the mode. A busy runner can deliver the touch end so late that the button rightly
  // takes it for a (too short, discarded) hold; then tap again once it is idle.
  const tapTo = async (mode: "voice" | "circle") => {
    await expect(async () => {
      await expect(btn).toHaveAttribute("data-state", "idle", { timeout: 3000 });
      if ((await btn.getAttribute("data-mode")) !== mode) await touchGesture(page, cx, cy, [], 0);
      await expect(btn).toHaveAttribute("data-mode", mode, { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
  };
  // Microphone → circle → microphone.
  await tapTo("circle");
  await tapTo("voice");

  // Hold: recording; slide left far: cancelled, nothing sent.
  const held = await touchGesture(page, cx, cy, [], 700, false);
  await expect(btn).toHaveAttribute("data-state", "recording");
  await expect(page.getByTestId("voice-recording")).toBeVisible();
  await expect(page.getByTestId("record-lock-hint")).toBeVisible();
  await expect(page.getByTestId("record-cancel-hint")).toBeVisible();
  await shot(page, "record-holding");
  for (const p of steps(-170, 0)) {
    await held.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + p.dx, y: cy }] });
    await page.waitForTimeout(25);
  }
  await held.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(btn).toHaveAttribute("data-state", "idle");
  await page.waitForTimeout(800);
  await expect(page.getByTestId("voice-message")).toHaveCount(0);

  // Hold, slide up: locked — the finger can go; then Send.
  await touchGesture(page, cx, cy, steps(0, -130), 600);
  await expect(btn).toHaveAttribute("data-state", "locked");
  await expect(page.getByTestId("voice-cancel")).toBeVisible();
  await shot(page, "record-locked");
  await page.waitForTimeout(900);
  await btn.click();
  await expect(page.getByTestId("voice-message")).toHaveCount(1);

  // Hold ~1.5 s and release: sent.
  await touchGesture(page, cx, cy, [], 1600);
  await expect(page.getByTestId("voice-message")).toHaveCount(2);

  // A touch taken away by the system (pointercancel) drops the recording.
  const c = await touchGesture(page, cx, cy, [], 700, false);
  await expect(btn).toHaveAttribute("data-state", "recording");
  await c.cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(btn).toHaveAttribute("data-state", "idle");
  await page.waitForTimeout(600);
  await expect(page.getByTestId("voice-message")).toHaveCount(2);

  // Video mode: hold + slide up locks the camera circle; switch camera only with two cameras; Send.
  await tapTo("circle");
  await touchGesture(page, cx, cy, steps(0, -130), 700);
  await expect(page.getByTestId("circle-recorder")).toHaveAttribute("data-state", "locked");
  await shot(page, "circle-locked");
  await page.waitForTimeout(1200);
  await btn.click();
  await expect(page.getByTestId("circle-message")).toHaveCount(1);
  await other.context().close();
});

test("PC: a click starts a hands-free recording (trash left, send right) — no auto-send on mouse up; right click switches to circles", async ({ page, browser }) => {
  test.skip(isMobile(page), "mouse");
  const { other } = await openChatWith(page, browser);
  const btn = page.getByTestId("chat-record");
  await btn.click();
  await expect(btn).toHaveAttribute("data-state", "locked");
  await page.waitForTimeout(1200);
  // Still recording after the mouse went up: nothing was sent.
  await expect(page.getByTestId("voice-message")).toHaveCount(0);
  await page.getByTestId("voice-cancel").click();
  await expect(btn).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("voice-message")).toHaveCount(0);
  await recordVoice(page, 1200);
  await expect(page.getByTestId("voice-message")).toHaveCount(1);
  await btn.click({ button: "right" });
  await expect(btn).toHaveAttribute("data-mode", "circle");
  await recordCircle(page, 1300);
  await expect(page.getByTestId("circle-message")).toHaveCount(1);
  await other.context().close();
});

test("video circles: loop muted on screen; tap opens them larger with sound; ring seek, play / pause, speed 1x → 1.5x → 2x → 1x kept while Vibex is open", async ({ page, browser }) => {
  const { other } = await openChatWith(page, browser);
  await recordCircle(page, 2200);
  const circle = page.getByTestId("circle-message");
  await expect(circle).toHaveCount(1);
  const small = circle.locator("video");
  await expect.poll(() => small.evaluate((v: HTMLVideoElement) => !v.paused && v.muted && v.loop && v.preload === "metadata")).toBe(true);
  await expect(circle).toHaveAttribute("data-autoplay", "on");

  await circle.click();
  const expanded = page.getByTestId("circle-expanded");
  const big = page.getByTestId("circle-expanded-video");
  await expect(expanded).toHaveAttribute("data-playing", "true");
  expect(await big.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
  await shot(page, `circle-expanded-${isMobile(page) ? "phone" : "pc"}`);
  // Speed: 1x → 1.5x → 2x → 1x → 1.5x.
  const speed = page.getByTestId("circle-speed");
  await expect(speed).toHaveText("1x");
  await speed.click();
  await expect(speed).toHaveText("1.5x");
  expect(await big.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
  await speed.click();
  await expect(speed).toHaveText("2x");
  await speed.click();
  await expect(speed).toHaveText("1x");
  await speed.click();
  await expect(speed).toHaveText("1.5x");
  // Seek on the ring: a press at "3 o'clock" is about a quarter of the way.
  await big.evaluate((v: HTMLVideoElement) => v.pause());
  const ring = (await page.getByTestId("circle-ring").boundingBox())!;
  // Step 2.11: the ring lies inside the circle's edge (7 px in).
  const r = ring.width / 2 - 22 - 7;
  await page.mouse.click(ring.x + ring.width / 2 + r, ring.y + ring.height / 2);
  await expect.poll(() => big.evaluate((v: HTMLVideoElement) => v.currentTime / v.duration)).toBeGreaterThan(0.12);
  expect(await big.evaluate((v: HTMLVideoElement) => v.currentTime / v.duration)).toBeLessThan(0.45);
  // A tap on the video plays / pauses.
  await big.click();
  await expect(expanded).toHaveAttribute("data-playing", "true");
  await big.click();
  await expect(expanded).not.toHaveAttribute("data-playing", "true");
  // X on the ring collapses; the speed is remembered while Vibex is open.
  await page.getByTestId("circle-collapse").click();
  await expect(expanded).toHaveCount(0);
  await circle.click();
  await expect(page.getByTestId("circle-speed")).toHaveText("1.5x");
  await page.getByTestId("circle-collapse").click();
  await other.context().close();
});

test("voice seek owns its drag: dragging on the waveform seeks and never swipes the chat away; elsewhere the swipe still goes back", async ({ page, browser }) => {
  test.skip(!isMobile(page), "chat swipe-back is a phone gesture");
  const { other } = await openChatWith(page, browser);
  await recordVoice(page, 2400);
  const voice = page.getByTestId("voice-message");
  await expect(voice).toHaveCount(1);
  const audio = voice.locator("audio");
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => (Number.isFinite(a.duration) ? a.duration : -1)), { timeout: 10_000 }).toBeGreaterThan(1);
  const wave = (await voice.getByTestId("voice-wave").boundingBox())!;
  await touchGesture(page, wave.x + 4, wave.y + wave.height / 2, steps(wave.width * 0.8, 6), 40);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("conversation")).toBeVisible();
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime / a.duration)).toBeGreaterThan(0.5);
  // The same swipe on the messages area (not a player) goes back to the list.
  const area = (await page.getByTestId("messages").boundingBox())!;
  await touchGesture(page, area.x + 30, area.y + 60, steps(220, 4, 10), 40);
  await expect(page.getByTestId("conversation")).toHaveCount(0);
  await other.context().close();
});

// ---------------------------------------------------------- feed / profile

test("feed: no search in the Main header (Step 2.13: the Search tab); History has Liked / Bookmarks; + opens a new post", async ({ page }) => {
  await signUpViaApi(page, "Лента", "Поисковая");
  const post = (await api(page, "POST", "/api/vibex/posts", { text: "Сохранённый пост" })).body;
  await api(page, "POST", `/api/vibex/posts/${post.id}/bookmark`);
  await launchVibex(page);
  await expect(page.getByTestId("vibex-feed")).toBeVisible();
  await expect(page.getByTestId("vibex-feed-search")).toHaveCount(0);
  await expect(page.getByTestId("vibex-search").filter({ visible: true })).toHaveCount(0);
  await page.getByTestId(isMobile(page) ? "vibex-tab-people" : "vibex-nav-people").last().click();
  await expect(page.getByTestId("search-screen")).toBeVisible();
  await page.getByTestId(isMobile(page) ? "vibex-tab-feed" : "vibex-nav-feed").last().click();
  await expect(page.getByTestId("vibex-feed")).toBeVisible();

  // The floating + (bottom right) opens a new post.
  const fab = page.getByTestId("vibex-new-post");
  const fb = (await fab.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(fb.x + fb.width).toBeGreaterThan(vp.width * 0.8);
  await fab.click();
  await expect(page.getByTestId("post-composer")).toBeVisible();
  await page.keyboard.press("Escape");

  // History: one item in the menu with two tabs; no separate «Закладки».
  if (isMobile(page)) await page.getByTestId("vibex-menu").click();
  await expect(page.getByTestId("vibex-nav-bookmarks")).toHaveCount(0);
  await page.getByTestId("vibex-nav-history").last().click();
  await expect(page.getByTestId("history-tab-liked")).toBeVisible();
  await page.getByTestId("history-tab-bookmarks").click();
  await expect(page.getByTestId("history-screen")).toHaveAttribute("data-kind", "bookmarks");
  await expect(page.getByTestId("history-list")).toContainText("Сохранённый пост");
});

test("posts: Media (VOIDEX Media / device) and a Files paperclip (Files only, no device); a post with several photos loops 1 → 2 → 3 → 1 and back", async ({ page }) => {
  await signUpViaApi(page, "Пост", "Вложенный");
  await launchVibex(page);
  await page.getByTestId("vibex-new-post").click();
  await expect(page.getByTestId("post-composer")).toBeVisible();
  await page.getByTestId("composer-media").click();
  await expect(page.getByTestId("post-media-source-media")).toBeVisible();
  await expect(page.getByTestId("post-media-source-device")).toBeVisible();
  await expect(page.getByTestId("post-media-source-files")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("composer-files").click();
  // Files opens straight on Files; there is no device option behind the paperclip.
  await expect(page.getByTestId("post-files-source-files")).toBeVisible();
  await expect(page.getByTestId("post-files-source-device")).toHaveCount(0);
  await expect(page.getByTestId("post-files-source-empty-device")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Three photos: the carousel (only three slides in the page), looping both ways.
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push((await api(page, "POST", "/api/vibex/files?purpose=post", undefined, { name: `p${i}.png`, base64: PNG })).body.id);
  expect((await api(page, "POST", "/api/vibex/posts", { text: "Три фото", mediaIds: ids })).status).toBe(201);
  await page.reload();
  await expect(page.getByTestId("lock-screen").or(page.getByTestId("workspace")).first()).toBeVisible();
  if (await page.getByTestId("lock-screen").count()) await page.keyboard.type("135790");
  await launchVibex(page);
  const carousel = page.locator("[data-carousel]").first();
  await expect(carousel).toHaveAttribute("data-index", "0");
  expect(await carousel.locator("[data-slide]").count()).toBe(3);
  // Measure only once the window has finished opening (on PC it grows out of its icon).
  const stableBox = async () => {
    let prev: { x: number; y: number; width: number; height: number } | null = null;
    await expect
      .poll(async () => {
        const b = await carousel.boundingBox();
        const same = !!prev && !!b && Math.abs(b.x - prev.x) < 0.5 && Math.abs(b.y - prev.y) < 0.5 && Math.abs(b.width - prev.width) < 0.5;
        prev = b;
        return same;
      })
      .toBe(true);
    return prev!;
  };
  const box = await stableBox();
  const swipe = async (dx: number) => {
    const box = await stableBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + (dx * i) / 8, box.y + box.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(450);
  };
  await swipe(-box.width * 0.5);
  await expect(carousel).toHaveAttribute("data-index", "1");
  await swipe(-box.width * 0.5);
  await swipe(-box.width * 0.5);
  await expect(carousel).toHaveAttribute("data-index", "0");
  await swipe(box.width * 0.5);
  await expect(carousel).toHaveAttribute("data-index", "2");
  await expect(carousel.getByTestId("carousel-counter")).toHaveText("3 / 3");
  expect(await carousel.locator("[data-slide]").count()).toBe(3);
});

test("profile: tabs Публикации · Посты · Репосты; one media grid with photo / video marks; text folded under «Показать текст»; + creates a post", async ({ page }) => {
  const me = await signUpViaApi(page, "Профиль", "Публикаций");
  const pic = (await api(page, "POST", "/api/vibex/files?purpose=post", undefined, { name: "p.png", base64: PNG })).body.id;
  await api(page, "POST", "/api/vibex/posts", { text: "Подпись к фото", mediaIds: [pic] });
  await api(page, "POST", "/api/vibex/posts", { text: "Только текст" });
  await launchVibex(page);
  if (isMobile(page)) await page.getByTestId("vibex-menu").click();
  await page.getByTestId("vibex-me").last().click();
  const tabs = await page.getByTestId("profile-tabs").getByRole("tab").allInnerTexts();
  expect(tabs.map((x) => x.trim())).toEqual(["Публикации", "Посты", "Репосты"]);
  await expect(page.getByTestId("profile-tab-media")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("media-kind-photo")).toHaveCount(0);
  await expect(page.getByTestId("publication-tile")).toHaveCount(1);
  await expect(page.getByTestId("publication-mark")).toHaveAttribute("data-mark", "photo");
  await shot(page, `profile-publications-${isMobile(page) ? "phone" : "pc"}`);
  // Step 2.13: a tap opens the publications as a feed (media first, the caption under it).
  await page.getByTestId("publication-tile").click();
  await expect(page.getByTestId("publication-viewer")).toBeVisible();
  await expect(page.getByTestId("publication-viewer").getByTestId("publication-caption")).toContainText("Подпись к фото");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("publication-viewer")).toHaveCount(0);
  // «Посты» shows the same post as a full card (one post, two views), and the text-only one.
  await page.getByTestId("profile-tab-posts").click();
  await expect(page.getByTestId("post-card")).toHaveCount(2);
  await expect(page.getByTestId("vibex-new-post")).toBeVisible();
  await page.getByTestId("vibex-new-post").click();
  await expect(page.getByTestId("post-composer")).toBeVisible();
  void me;
});

test("profile (hotfix): «Редактировать» never enters the fixed «…» zone, with a safe gap, at 320 / 390 / 430 and on PC", async ({ page }) => {
  await signUpViaApi(page, "Константин", "Длиннофамильный");
  await launchVibex(page);
  if (isMobile(page)) await page.getByTestId("vibex-menu").click();
  await page.getByTestId("vibex-nav-me").last().click();
  await expect(page.getByTestId("profile-header")).toBeVisible();
  const widths = isMobile(page) ? [320, 390, 430] : [page.viewportSize()!.width];
  for (const width of widths) {
    if (isMobile(page)) await page.setViewportSize({ width, height: 844 });
    const row = await profileActionRow(page);
    expect(row.settled, `settled at ${width}`).toBe(true);
    // A fixed 44 px zone for "…", the button inside it, both on one row.
    expect(Math.round(row.zoneRight - row.zoneLeft)).toBe(44);
    expect(row.moreLeft).toBeGreaterThanOrEqual(row.zoneLeft - 0.5);
    expect(Math.abs(row.editTop - row.moreTop)).toBeLessThan(2);
    // No overlap and a safe gap; nothing leaves the screen.
    expect(row.gap, `gap at ${width}`).toBeGreaterThanOrEqual(6);
    expect(row.editLeft).toBeGreaterThanOrEqual(0);
    expect(row.zoneRight).toBeLessThanOrEqual(row.width);
  }
});
