import { execSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PASSCODE, openApp, reloadUnlocked, signUpViaApi, uniq, uniquePhoneDigits, unlock } from "./helpers";

/**
 * Step 2.4 — lock screen, code-password, Face ID (WebAuthn), step-up,
 * Settings, PC view toggle and open-apps overview, Vibex groups.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
const DB = process.env.DATABASE_URL ?? "postgres://voidex:voidex@localhost:5432/voidex";

/** Ages this account's confirmation window (the server allows sensitive changes for 5 minutes after one). */
function expireStepUp(userId: string) {
  execSync(`psql "${DB}" -qc "update sessions set step_up_at = now() - interval '10 minutes' where user_id = '${userId}'"`);
}

async function lockFromUi(page: Page) {
  if (isMobile(page)) {
    await openApp(page, "settings");
    await page.getByTestId("settings-nav-lock").click();
    await page.getByTestId("settings-lock-now").click();
  } else {
    await page.getByTestId("lock-now").click();
  }
  await expect(page.getByTestId("lock-screen")).toBeVisible();
}

test("first setup: the code-password is required (weak and mismatched codes refused), Face ID can be skipped", async ({ page }) => {
  await signUpViaApi(page, "Ника", "Код", { passcode: false });
  await expect(page.getByTestId("security-setup")).toBeVisible();
  await expect(page.getByTestId("setup-step")).toHaveText("Шаг 1 из 3");
  await page.keyboard.type("111111");
  await expect(page.getByTestId("passcode-error")).toContainText("Слишком просто");
  await page.keyboard.type("246813");
  await expect(page.getByTestId("setup-pad-confirm")).toBeVisible();
  await page.keyboard.type("246800");
  await expect(page.getByTestId("setup-pad-create")).toBeVisible();
  await expect(page.getByTestId("passcode-error")).toContainText("Коды не совпали");
  // The pad on screen works too (phones: the keypad; PC: the keyboard-first field, Step 2.5).
  const enter = async () => {
    if (isMobile(page)) for (const d of PASSCODE) await page.getByTestId(`key-${d}`).click();
    else await page.keyboard.type(PASSCODE);
  };
  await enter();
  await expect(page.getByTestId("setup-pad-confirm")).toBeVisible();
  await enter();
  // Face ID step: on this address the browser can't offer it — said honestly, and it is skippable.
  await expect(page.getByTestId("face-setup")).toBeVisible();
  await expect(page.getByTestId("setup-step")).toHaveText("Шаг 3 из 3");
  await expect(page.getByTestId("face-unavailable")).toBeVisible();
  await page.getByTestId("face-setup-later").click();
  await expect(page.getByTestId("security-setup")).toHaveCount(0);
  // The next start opens on the lock screen.
  await page.reload();
  await unlock(page);
  await expect(page.getByTestId("workspace")).toBeVisible();
});

test("lock screen: lock, wrong code refused with no access, right code unlocks; start locked", async ({ page }) => {
  await signUpViaApi(page, "Лера", "Замкова");
  await lockFromUi(page);
  await expect(page.getByTestId("lock-clock")).toBeVisible();
  // The workspace is hidden underneath and the server refuses this session.
  await expect(page.getByTestId("workspace")).toBeHidden();
  const me = await page.evaluate(async () => (await fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json", "X-Voidex-Client": "web" }, body: "{}" })).status);
  expect(me).toBe(423);
  await page.keyboard.type("000000");
  await expect(page.getByTestId("passcode-error")).toHaveText("Неверный код-пароль");
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await page.keyboard.type(PASSCODE);
  await expect(page.getByTestId("lock-screen")).toHaveCount(0);
  await expect(page.getByTestId("workspace")).toBeVisible();
  await reloadUnlocked(page);
});

test("step-up: personal data asks for the code-password once the confirmation window is over", async ({ page }) => {
  const a = await signUpViaApi(page, "Стас", "Шагов");
  await openApp(page, "settings");
  await page.getByTestId("settings-nav-account").first().click();
  // Fresh sign-in: no extra question.
  await page.getByTestId("row-personal").last().click();
  await expect(page.getByTestId("settings-first-name").last()).toBeVisible();
  if (isMobile(page)) await page.getByTestId("settings-back").last().click();
  else await page.getByTestId("settings-nav-account").first().click();
  expireStepUp(a.id);
  await page.getByTestId("row-personal").last().click();
  await expect(page.getByTestId("step-up")).toBeVisible();
  await page.keyboard.type("999999");
  await expect(page.getByTestId("step-up").getByTestId("passcode-error")).toContainText("Неверный код-пароль");
  await page.keyboard.type(PASSCODE);
  await expect(page.getByTestId("step-up")).toHaveCount(0);
  await expect(page.getByTestId("settings-first-name").last()).toBeVisible();
  // A sensitive change after the window: the API asks, the sheet confirms, the change goes through.
  expireStepUp(a.id);
  await page.getByTestId("settings-first-name").last().fill("Станислав");
  await page.getByTestId("settings-save-profile").last().click();
  await expect(page.getByTestId("step-up")).toBeVisible();
  await page.keyboard.type(PASSCODE);
  await expect(page.getByText("Профиль обновлён")).toBeVisible();
});

test("Settings: lock-screen wallpaper separate from the desktop; code-password change", async ({ page }) => {
  await signUpViaApi(page, "Оля", "Обоева");
  await openApp(page, "settings");
  await page.getByTestId("settings-nav-lock").click();
  await expect(page.getByTestId("settings-lock")).toBeVisible();
  await expect(page.getByTestId("lock-wallpaper-same")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("lock-wallpaper-preset-wave-gray").click();
  await expect(page.getByTestId("lock-wallpaper-preset-wave-gray")).toHaveAttribute("aria-pressed", "true");
  // The desktop keeps its own wallpaper.
  await expect(page.getByTestId("wallpaper-default")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1500); // the layout is saved to the account
  // Change the code-password (confirmed: right after sign-up).
  await page.getByTestId("passcode-change").click();
  await expect(page.getByTestId("passcode-sheet")).toBeVisible();
  await page.keyboard.type("864208");
  await expect(page.getByTestId("passcode-sheet-confirm")).toBeVisible();
  await page.keyboard.type("864208");
  await expect(page.getByTestId("passcode-sheet")).toHaveCount(0);
  await page.getByTestId("settings-lock-now").click();
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  // The lock screen shows its own wallpaper (the grey wave: base #eeeef1).
  await expect.poll(async () => (await page.getByTestId("lock-screen").getAttribute("style")) ?? "").toContain("eeeef1");
  await unlock(page, "864208");
});

test("Face ID: set up with the device authenticator, unlock with it; failure falls back to the code-password", async ({ page }) => {
  test.skip(isMobile(page), "one virtual authenticator run is enough");
  // WebAuthn needs a domain, not an IP address.
  const origin = "http://localhost:5173";
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.goto(origin);
  await registerOn(page);
  await page.reload();
  await expect(page.getByTestId("security-setup")).toBeVisible();
  await page.keyboard.type(PASSCODE);
  await expect(page.getByTestId("setup-pad-confirm")).toBeVisible();
  await page.keyboard.type(PASSCODE);
  await page.getByTestId("face-setup-start").click();
  await expect(page.locator('[data-testid="face-setup"][data-stage="done"]')).toBeVisible();
  await page.getByTestId("face-setup-finish").click();
  // Lock → Face ID tries at once and unlocks. (First wait for the lock screen: the lock request takes a moment.)
  await page.getByTestId("lock-now").click();
  await expect(page.getByTestId("lock-screen")).toBeAttached();
  await expect(page.getByTestId("lock-screen")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("workspace")).toBeVisible();
  // The device doesn't confirm: "not confirmed", the code-password still works.
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
  await page.getByTestId("lock-now").click();
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await page.getByTestId("lock-face-button").click();
  await expect(page.locator('[data-testid="face-lens"][data-face-state="error"]')).toBeVisible();
  await page.getByTestId("lock-use-code").click();
  await unlock(page);
  // Settings shows it on for this device.
  await openApp(page, "settings");
  await page.getByTestId("settings-nav-lock").click();
  await expect(page.getByTestId("face-id-toggle").getByRole("switch")).toHaveAttribute("aria-checked", "true");
});

/** Registers an account through the API on the current page's origin (no code-password yet). */
async function registerOn(page: Page) {
  const username = uniq("f");
  const phone = "+7" + uniquePhoneDigits();
  const r = await page.evaluate(
    async ({ username, phone }) => {
      const h = { "Content-Type": "application/json", "X-Voidex-Client": "web" };
      const post = async (u: string, b: unknown) => (await fetch(u, { method: "POST", headers: h, body: JSON.stringify(b) })).json();
      const s = await post("/api/auth/phone/start", { phone });
      const v = await post("/api/auth/phone/verify", { verificationId: s.verificationId, code: s.devCode });
      const consents = ["terms", "offer", "privacy", "data_processing"].map((key) => ({ key, version: "2026-09-draft.1" }));
      return post("/api/auth/register", { firstName: "Фея", lastName: "Лицова", birthDate: "1990-02-03", country: "RU", language: "ru", phoneVerification: { id: s.verificationId, proof: v.proof }, username, password: "Violet-Orbit-42", consents });
    },
    { username, phone },
  );
  expect(r.user).toBeTruthy();
}

test("PC: double click on Desktops opens the open-apps overview; a single click still shows the desktops", async ({ page }) => {
  test.skip(isMobile(page), "PC dock");
  await signUpViaApi(page, "Ося", "Обзоров");
  await openApp(page, "mail");
  await page.getByTestId("window-menu").last().click();
  await page.getByTestId("menu-minimize").click();
  await page.getByTestId("dock-desktops").dblclick();
  await expect(page.getByTestId("window-overview")).toBeVisible();
  await expect(page.getByTestId("dock-desktops-menu")).toHaveCount(0);
  await page.getByTestId("overview-window-mail").click();
  await expect(page.getByTestId("window-overview")).toHaveCount(0);
  await expect(page.locator('[data-testid="window-mail"][data-state="open"]')).toBeVisible();
  await page.getByTestId("dock-desktops").click();
  await expect(page.getByTestId("dock-desktops-menu")).toBeVisible();
});

/** An account made through the API only (a group member). */
async function apiAccount(request: APIRequestContext, first: string) {
  const h = { "content-type": "application/json", "x-voidex-client": "web" };
  const post = async (url: string, body: unknown) => (await request.post(url, { headers: h, data: JSON.stringify(body) })).json();
  const s = await post("/api/auth/phone/start", { phone: "+7" + uniquePhoneDigits() });
  const v = await post("/api/auth/phone/verify", { verificationId: s.verificationId, code: s.devCode });
  const consents = ["terms", "offer", "privacy", "data_processing"].map((key) => ({ key, version: "2026-09-draft.1" }));
  const username = uniq("g");
  const r = await post("/api/auth/register", { firstName: first, lastName: "Группов", birthDate: "1991-05-06", country: "RU", language: "ru", phoneVerification: { id: s.verificationId, proof: v.proof }, username, password: "Violet-Orbit-42", consents });
  expect(r.user).toBeTruthy();
  return { id: r.user.id as string, token: r.accessToken as string, username };
}

test("Vibex: the pencil starts a group (people, name) and a direct chat as before", async ({ page, request }) => {
  await signUpViaApi(page, "Гера", "Создатель");
  const b = await apiAccount(request, "Борис");
  const c = await apiAccount(request, "Вера");
  await openApp(page, "vibex");
  if (isMobile(page)) await page.getByTestId("vibex-tab-chats").click();
  else await page.getByTestId("vibex-nav-chats").click();
  await page.getByTestId("vibex-new-chat").click();
  for (const u of [b, c]) {
    await page.getByTestId("new-chat-search").fill(u.username);
    await page.getByTestId("new-chat-contact").first().click();
  }
  await expect(page.getByTestId("new-chat-picked").locator("button")).toHaveCount(2);
  await page.getByTestId("new-chat-next").click();
  await expect(page.getByTestId("new-group-create")).toBeDisabled();
  await page.getByTestId("new-group-title").fill("Команда 2.4");
  await page.getByTestId("new-group-create").click();
  await expect(page.getByTestId("group-header")).toContainText("Команда 2.4");
  await expect(page.getByTestId("group-header")).toContainText("Участники: 3");
  await page.getByTestId("chat-input").fill("Привет, команда!");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("message").last()).toContainText("Привет, команда!");
  // B sees the group with the message.
  const chats = await (await request.get("/api/vibex/chats", { headers: { authorization: `Bearer ${b.token}`, "x-voidex-client": "web" } })).json();
  expect(chats.find((x: { kind: string; group: { title: string } | null }) => x.kind === "group" && x.group?.title === "Команда 2.4")).toMatchObject({ unread: 1, lastMessage: { text: "Привет, команда!" } });
  // B answers: A sees the author's name on the bubble.
  const g = chats.find((x: { kind: string }) => x.kind === "group");
  await request.post(`/api/vibex/chats/${g.id}/messages`, { headers: { authorization: `Bearer ${b.token}`, "x-voidex-client": "web", "content-type": "application/json" }, data: JSON.stringify({ text: "Борис на связи" }) });
  await expect(page.getByTestId("message-author").last()).toHaveText("Борис Группов");
  // One person → a direct chat, as before.
  if (isMobile(page)) await page.getByTestId("chat-back").click();
  await page.getByTestId("vibex-new-chat").click();
  await page.getByTestId("new-chat-search").fill(c.username);
  await page.getByTestId("new-chat-contact").first().click();
  await expect(page.getByTestId("new-chat-next")).toHaveText("Написать");
  await page.getByTestId("new-chat-next").click();
  await expect(page.getByTestId("chat-call-audio")).toBeVisible();
});

test("PC dock: an open app that isn't pinned shows while it runs and leaves when closed; pinned apps always stay", async ({ page }) => {
  test.skip(isMobile(page), "PC dock");
  await signUpViaApi(page, "Дора", "Доков");
  const pinned = () => page.locator("[data-dock-app]").evaluateAll((els) => els.map((e) => e.getAttribute("data-dock-app")));
  // Unpin Calculator: it leaves the dock.
  await page.getByTestId("dock-app-calculator").click({ button: "right" });
  await page.getByTestId("menu-unpin").click();
  await expect.poll(pinned).not.toContain("calculator");
  await expect(page.getByTestId("dock-running-calculator")).toHaveCount(0);
  // Open it from the desktop: it appears in the dock (after the pinned apps) while it runs.
  await openApp(page, "calculator");
  await expect(page.getByTestId("dock-running-calculator")).toBeVisible();
  await expect(page.getByTestId("dock-running-separator")).toBeVisible();
  // Minimized it stays (still running); a click on it brings the window back.
  await page.getByTestId("window-menu").last().click();
  await page.getByTestId("menu-minimize").click();
  await expect(page.getByTestId("dock-running-calculator")).toBeVisible();
  await page.getByTestId("dock-running-calculator").locator("button").click();
  await expect(page.locator('[data-testid="window-calculator"][data-state="open"]')).toBeVisible();
  // Closed: it leaves the dock.
  await page.getByTestId("dock-running-calculator").locator("button").click({ button: "right" });
  await page.getByTestId("menu-close-app").click();
  await expect(page.getByTestId("dock-running-calculator")).toHaveCount(0);
  await expect(page.getByTestId("dock-running-separator")).toHaveCount(0);
  // A pinned app stays when it is closed.
  await openApp(page, "mail");
  await page.getByTestId("dock-app-mail").click({ button: "right" });
  await page.getByTestId("menu-close-app").click();
  await expect(page.locator('[data-testid="window-mail"]')).toHaveCount(0);
  await expect(page.getByTestId("dock-app-mail")).toBeVisible();
  // Running and pinned from its menu: it moves to the pinned apps and stays after closing.
  await openApp(page, "calculator");
  await page.getByTestId("dock-running-calculator").locator("button").click({ button: "right" });
  await page.getByTestId("menu-pin").click();
  await expect.poll(pinned).toContain("calculator");
  await expect(page.getByTestId("dock-running-calculator")).toHaveCount(0);
  await page.getByTestId("dock-app-calculator").click({ button: "right" });
  await page.getByTestId("menu-close-app").click();
  await expect(page.getByTestId("dock-app-calculator")).toBeVisible();
});
