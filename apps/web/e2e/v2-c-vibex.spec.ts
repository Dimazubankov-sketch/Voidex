import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs as api, newPage, openApp, recordVoice, reloadUnlocked, signUpViaApi, unlock } from "./helpers";

/** Update 2, stage C: Vibex — header and presence, several pins, the info page, QR codes, the composer, playback. */
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
  await page.waitForTimeout(400);
}
async function setup(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Алиса", "Вторая");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Борис", "Второй");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  const m1 = (await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Первое закреплённое" })).body;
  for (let i = 0; i < 4; i++) await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: `Обычное ${i}` });
  const m2 = (await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Второе закреплённое" })).body;
  await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Смотри https://voidex.su/docs" });
  return { a, b, bp, chat, m1, m2 };
}

test("C1 / C2 / C3: header with presence; several pins — a tap goes to each in turn, newest to first, and stays at the first", async ({ page, browser }) => {
  const { b, bp, chat, m1, m2 } = await setup(page, browser);
  await api(page, "POST", `/api/vibex/chats/${chat.id}/pins`, { messageId: m2.id });
  await api(bp, "POST", `/api/vibex/chats/${chat.id}/pins`, { messageId: m1.id });
  await openChat(page, chat.id);
  // Header: back (phones), the name with «в сети» (B's page is open), the avatar with a green dot.
  await expect(page.getByTestId("chat-header-title")).toContainText("Борис Второй");
  await expect(page.getByTestId("chat-header-title").getByTestId("presence-text")).toHaveAttribute("data-state", "online");
  await expect(page.getByTestId("chat-header-avatar").getByTestId("presence-dot")).toHaveAttribute("data-state", "online");
  if (isMobile(page)) await expect(page.getByTestId("chat-back")).toBeVisible();
  // Pins: the newest first (#2), then #1, then #2 again.
  const bar = page.getByTestId("pinned-bar");
  await expect(bar).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("pinned-title")).toHaveText("Закреплённое сообщение #2");
  await expect(page.getByTestId("pinned-text")).toHaveText("Второе закреплённое");
  await bar.click();
  await expect(page.locator(`[data-message-id="${m2.id}"][data-jumped]`)).toHaveCount(1);
  await expect(page.getByTestId("pinned-title")).toHaveText("Закреплённое сообщение #1");
  await bar.click();
  await expect(page.locator(`[data-message-id="${m1.id}"][data-jumped]`)).toHaveCount(1);
  // Update 3 · C2: at the first pin it stays there (no jump back to the newest).
  await expect(page.getByTestId("pinned-title")).toHaveText("Закреплённое сообщение #1");
  // Unpin the one shown: one pin left, both sides.
  await page.getByTestId("pinned-unpin").click();
  await expect(bar).toHaveAttribute("data-count", "1");
  await expect.poll(async () => (await api(bp, "GET", `/api/vibex/chats/${chat.id}`)).body.pins.map((p: { id: string }) => p.id)).toEqual([m1.id]);
  // B hides presence: A sees «был(а) недавно», grey, never the real time.
  await api(bp, "PATCH", "/api/vibex/settings", { privacy: { presence: "nobody" } });
  await reloadUnlocked(page);
  await openChat(page, chat.id);
  await expect(page.getByTestId("chat-header-title").getByTestId("presence-text")).toHaveText("был(а) недавно");
  await expect(page.getByTestId("chat-header-avatar").getByTestId("presence-dot")).toHaveAttribute("data-state", "hidden");
  void b;
  await bp.context().close();
});

test("C4 / C5 / C6: the info page — actions, search in the chat, clear for me, tabs, the QR code; the profile link opens the person", async ({ page, browser }) => {
  const { b, bp, chat, m1 } = await setup(page, browser);
  await openChat(page, chat.id);
  await page.getByTestId("chat-header-title").click();
  const info = page.getByTestId("chat-info");
  await expect(info).toBeVisible();
  await expect(page.getByTestId("chat-info-name")).toHaveText("Борис Второй");
  await expect(page.getByTestId("chat-info-handle")).toHaveText(`@${b.username}`);
  for (const id of ["call", "video", "sound", "search", "more"]) await expect(page.getByTestId(`info-${id}`)).toBeVisible();
  // Links tab: the message with the link.
  await page.getByTestId("chat-tab-links").click();
  await expect(page.getByTestId("chat-tab-row")).toHaveCount(1);
  await expect(page.getByTestId("chat-tab-row")).toContainText("voidex.su/docs");
  await page.getByTestId("chat-tab-media").click();
  await expect(page.getByTestId("chat-tab-empty")).toBeVisible();
  // QR code: only the public link, from the username.
  await page.getByTestId("chat-info-qr").click();
  const qr = page.getByTestId("qr-sheet");
  await expect(qr).toBeVisible();
  const text = await qr.getByTestId("qr-code").getAttribute("data-text");
  expect(text).toMatch(new RegExp(`/u/${b.username}$`));
  expect(text).not.toContain(b.address);
  await expect(qr.getByTestId("qr-handle")).toHaveText(`@${b.username}`);
  await page.getByTestId("qr-close").click();
  await expect(qr).toHaveCount(0);
  // Search in the chat: a tap goes to the message.
  await page.getByTestId("info-search").click();
  await page.getByTestId("chat-search-input").fill("Первое");
  await expect(page.getByTestId("chat-search-result")).toHaveCount(1);
  await page.getByTestId("chat-search-result").click();
  await expect(info).toHaveCount(0);
  await expect(page.locator(`[data-message-id="${m1.id}"][data-jumped]`)).toHaveCount(1);
  // Sound: notifications of this chat off.
  await page.getByTestId("chat-header-title").click();
  await page.getByTestId("info-sound").click();
  await page.getByTestId("menu-mute").click();
  await expect.poll(async () => (await api(page, "GET", "/api/vibex/chats")).body.find((c: { id: string }) => c.id === chat.id).muted).toBe(true);
  // More → clear the history for me (asked first): gone for A, kept for B.
  await page.getByTestId("info-more").click();
  await expect(page.getByTestId("menu-clear-all")).toBeVisible();
  await page.getByTestId("menu-clear-me").click();
  await expect(page.getByTestId("chat-info-confirm")).toBeVisible();
  await page.getByTestId("chat-info-confirm").getByTestId("confirm-action").click();
  await expect.poll(async () => (await api(page, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items.length).toBe(0);
  expect((await api(bp, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items.length).toBeGreaterThan(0);
  await bp.context().close();
  // The profile link opens B in Vibex.
  await page.goto(`/u/${b.username}`);
  // A new app start opens on the lock screen (code-password); the link waits behind it.
  await page.getByTestId("lock-screen").waitFor({ state: "visible", timeout: 10_000 });
  await unlock(page);
  await expect(page.getByTestId("profile-name").first()).toHaveText("Борис Второй", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/$/);
});

test("C3: Vibex privacy — who sees I'm online; «always online» is only announced as coming", async ({ page }) => {
  await signUpViaApi(page, "Тихая", "Настройка");
  await openVibex(page);
  if (isMobile(page)) {
    await page.getByTestId("vibex-tab-me").last().click();
    await page.getByTestId("profile-more").click();
    await page.getByTestId("profile-menu-settings").click();
  } else await page.getByTestId("vibex-nav-settings").last().click();
  await page.getByTestId("vs-presence-nobody").click();
  await expect.poll(async () => (await api(page, "GET", "/api/vibex/settings")).body.privacy.presence).toBe("nobody");
  await page.getByTestId("vs-always-online").click();
  await expect(page.getByText("Функция находится в разработке")).toBeVisible();
  expect((await api(page, "GET", "/api/vibex/settings")).body.privacy.presence).toBe("nobody");
});

test("C7 / C8: the composer (attach · field · mic / send); voice playback bar replaces the pins and goes when closed", async ({ page, browser }) => {
  const { bp, chat, m1 } = await setup(page, browser);
  await api(page, "POST", `/api/vibex/chats/${chat.id}/pins`, { messageId: m1.id });
  await openChat(page, chat.id);
  for (const id of ["chat-attach", "composer-field", "chat-record"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("chat-send")).toHaveCount(0);
  await page.getByTestId("chat-input").fill("Текст");
  await expect(page.getByTestId("chat-send")).toBeVisible();
  await expect(page.getByTestId("chat-record")).toHaveCount(0);
  await page.getByTestId("chat-input").fill("");
  // The attach sheet offers hands-free recording (no gesture needed).
  await page.getByTestId("chat-attach").click();
  await expect(page.getByTestId("attach-source-voice-hands-free")).toBeVisible();
  await expect(page.getByTestId("attach-source-circle-hands-free")).toBeVisible();
  await page.keyboard.press("Escape");
  // A voice message; playing it shows the playback bar instead of the pins.
  await recordVoice(page, 1500);
  await expect(page.getByTestId("voice-message")).toHaveCount(1);
  await expect(page.getByTestId("pinned-bar")).toBeVisible();
  await page.getByTestId("voice-play").click();
  await expect(page.getByTestId("playback-bar")).toBeVisible();
  await expect(page.getByTestId("pinned-bar")).toHaveCount(0);
  await page.getByTestId("playback-close").click();
  await expect(page.getByTestId("playback-bar")).toHaveCount(0);
  await expect(page.getByTestId("pinned-bar")).toBeVisible();
  await expect(page.getByTestId("voice-message")).not.toHaveAttribute("data-playing", "true");
  await bp.context().close();
});
