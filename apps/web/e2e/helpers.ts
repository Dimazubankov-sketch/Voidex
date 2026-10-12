import { expect, type Browser, type Locator, type Page } from "@playwright/test";

export const PASSWORD = "Violet-Orbit-42";
/** The code-password every e2e account creates (Step 2.4: required for new accounts). */
export const PASSCODE = "135790";

/** The lock screen is up (app start with a code-password, manual lock): unlock it with the code-password. */
export async function unlock(page: Page, code = PASSCODE) {
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await expect(page.getByTestId("passcode-pad")).toBeVisible();
  await page.keyboard.type(code);
  await expect(page.getByTestId("lock-screen")).toHaveCount(0);
}

/** Reload = a new app start: with a code-password VOIDEX opens on the lock screen first. */
export async function reloadUnlocked(page: Page) {
  await page.reload();
  await expect(page.getByTestId("lock-screen").or(page.getByTestId("workspace")).first()).toBeVisible();
  if (await page.getByTestId("lock-screen").count()) await unlock(page);
  await expect(page.getByTestId("workspace")).toBeVisible();
}

/** First setup after registration: create the code-password (twice), skip Face ID. */
export async function completeSecuritySetup(page: Page, code = PASSCODE) {
  await expect(page.getByTestId("security-setup")).toBeVisible();
  await expect(page.getByTestId("setup-pad-create")).toBeVisible();
  await page.keyboard.type(code);
  await expect(page.getByTestId("setup-pad-confirm")).toBeVisible();
  await page.keyboard.type(code);
  await page.getByTestId("face-setup-later").click();
  await expect(page.getByTestId("security-setup")).toHaveCount(0);
}
// A random start: Playwright restarts its worker after a failed test, and a counter starting at 0 again could
// then repeat a phone number used earlier in the same run (the sign-up is refused as a duplicate).
let seq = Math.floor(Math.random() * 100_000);
export function uniq(prefix = "e") {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}
/** Real Russian mobile operator codes (the server validates the number). */
const MOBILE_CODES = ["903", "905", "906", "909", "910", "915", "916", "917", "919", "925", "926", "977"];
export function uniquePhoneDigits() {
  const code = MOBILE_CODES[Math.floor(Math.random() * MOBILE_CODES.length)]!;
  return code + String(Date.now() + seq++ * 7919).slice(-7);
}

/** Clicks the big → button once any slide transition has finished. */
export async function next(page: Page) {
  await expect(page.getByTestId("step-next")).toHaveCount(1);
  await page.getByTestId("step-next").click();
}

/** Reads the development OTP shown on screen (dev SMS provider only). */
export async function devCode(page: Page) {
  const el = page.getByTestId("dev-code").last();
  await expect(el).toBeVisible();
  return (await el.getAttribute("data-code"))!;
}

/** Full sign-up through the real UI. Returns the new mail address. */
export async function signUpViaUi(page: Page, opts: { first?: string; last?: string } = {}) {
  const username = uniq("u");
  await page.goto("/");
  await page.getByTestId("welcome-create").click();
  await page.getByTestId("first-name").fill(opts.first ?? "Анна");
  await page.getByTestId("last-name").fill(opts.last ?? "Волкова");
  await next(page);
  await page.getByTestId("birth-day").fill("12");
  await page.getByTestId("birth-month").selectOption("4");
  await page.getByTestId("birth-year").fill("1995");
  await next(page);
  await page.getByTestId("country-search").fill("Росс");
  await page.getByTestId("country-RU").click();
  await next(page);
  await page.getByTestId("language-ru").click();
  await next(page);
  // One phone field: the country code and the number on the same line, a placeholder until typing.
  await expect(page.getByTestId("phone-country")).toContainText("+7");
  await expect(page.getByTestId("phone-input")).toHaveAttribute("placeholder", "Номер телефона");
  await page.getByTestId("phone-input").fill(uniquePhoneDigits());
  await next(page);
  await page.getByTestId("otp-input").fill(await devCode(page));
  await page.getByTestId("username").fill(username);
  await expect(page.getByText(`${username}@`).first()).toBeVisible();
  await expect(page.getByTestId("step-next")).toBeEnabled();
  await next(page);
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("password-confirm").fill(PASSWORD);
  await next(page);
  // Click the visible label like a user (Playwright waits until the step has
  // stopped sliding), instead of force-clicking the hidden input's coordinates.
  for (const k of ["terms", "offer", "privacy", "data_processing"]) {
    const box = page.getByTestId(`consent-${k}`);
    await page.locator("label", { has: box }).click();
    await expect(box).toBeChecked();
  }
  await next(page);
  await page.getByTestId("enter-workspace").click();
  await expect(page.getByTestId("workspace")).toBeVisible();
  // Step 2.4: the code-password is created before the desktop is usable.
  await completeSecuritySetup(page);
  return { username, address: `${username}@voidops` };
}

/** Fast sign-up through the API (still real SMS verification via the dev provider). */
export async function signUpViaApi(page: Page, first = "Борис", last = "Орлов", opts: { passcode?: boolean } = {}) {
  const username = uniq("a");
  const phone = "+7" + uniquePhoneDigits();
  await page.goto("/");
  const res = await page.evaluate(
    async ({ first, last, username, phone }) => {
      const h = { "Content-Type": "application/json", "X-Voidex-Client": "web" };
      const post = async (u: string, b: unknown) => (await fetch(u, { method: "POST", headers: h, body: JSON.stringify(b) })).json();
      const s = await post("/api/auth/phone/start", { phone });
      const v = await post("/api/auth/phone/verify", { verificationId: s.verificationId, code: s.devCode });
      const consents = ["terms", "offer", "privacy", "data_processing"].map((key) => ({ key, version: "2026-09-draft.1" }));
      return post("/api/auth/register", { firstName: first, lastName: last, birthDate: "1990-02-03", country: "RU", language: "ru", phoneVerification: { id: s.verificationId, proof: v.proof }, username, password: "Violet-Orbit-42", consents });
    },
    { first, last, username, phone },
  );
  expect(res.user).toBeTruthy();
  if (opts.passcode === false) {
    // Leave the first-setup screen to the test.
    await page.reload();
    return { username, address: `${username}@voidops`, id: res.user.id as string, token: res.accessToken as string };
  }
  // The required code-password, set through the API like the setup screen does.
  const set = await page.evaluate(
    async ({ token, passcode }) =>
      (await fetch("/api/security/passcode", { method: "POST", headers: { "Content-Type": "application/json", "X-Voidex-Client": "web", Authorization: `Bearer ${token}` }, body: JSON.stringify({ passcode }) })).status,
    { token: res.accessToken as string, passcode: PASSCODE },
  );
  expect(set).toBe(200);
  await reloadUnlocked(page);
  return { username, address: `${username}@voidops`, id: res.user.id as string, token: res.accessToken as string };
}

export async function newPage(browser: Browser, mobile: boolean) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, locale: "ru-RU" }
      : { viewport: { width: 1440, height: 900 }, locale: "ru-RU", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" },
  );
  return ctx.newPage();
}

export async function openApp(page: Page, id: "mail" | "settings" | "vibex" | "calculator" | "notes" | "files" | "media") {
  await page.getByTestId(`app-${id}`).click();
  await expect(page.locator(`[data-testid="window-${id}"][data-state="open"]`)).toBeVisible();
}

/**
 * Step 2.7: wallpapers are chosen only in Settings → Обои (other sections no
 * longer link there). From anywhere in Settings: go to Обои, on this tab.
 */
export async function openWallpapersTab(page: Page, tab: "lock" | "home") {
  await settingsRoot(page);
  await page.getByTestId("settings-nav-wallpapers").last().click();
  await page.getByTestId(`wallpapers-tab-${tab}`).click();
  await expect(page.getByTestId("settings-wallpapers").last()).toHaveAttribute("data-tab", tab);
}

/** Back to the Settings list on phones (the PC sidebar is always there): back until no section page is left. */
export async function settingsRoot(page: Page) {
  await expect(page.getByTestId("settings-nav-wallpapers").last().or(page.getByTestId("settings-back").last()).first()).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(450); // a page that is sliding away is not a target
    if (!(await page.getByTestId("settings-back").count())) return;
    // The page may be leaving already (then the button detaches): fine, look again.
    await page.getByTestId("settings-back").last().click({ timeout: 2500 }).catch(() => undefined);
  }
  await expect(page.getByTestId("settings-back")).toHaveCount(0);
}

/** Phone (Step 2.7: no window "…"): swipe up on the gesture bar of the app in front → home. */
export async function phoneHome(page: Page) {
  await page.waitForTimeout(600); // the window finishes opening
  const box = (await page.locator('section[data-state="open"] [data-testid="home-indicator"]').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Step 2.9: velocity + distance decide. Past 40% of the screen height is home at any speed, so a
  // slow (loaded) run can't read it as the switcher.
  const up = (page.viewportSize()?.height ?? 844) * 0.55;
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y - (up * i) / 8);
  await page.mouse.up();
  await expect(page.locator('section[data-state="open"]')).toHaveCount(0);
}

/**
 * Step 2.9: the composer's one record button (voice ↔ circle). With a mouse a
 * click starts a hands-free recording (nothing is sent by a stray mouse-up)
 * and a second click on the same button sends it; a right click switches
 * microphone ↔ video circle.
 */
export async function recordVoice(page: Page, ms = 1500) {
  const btn = page.getByTestId("chat-record");
  if ((await btn.getAttribute("data-mode")) !== "voice") await btn.click({ button: "right" });
  await expect(btn).toHaveAttribute("data-mode", "voice");
  await btn.click();
  await expect(btn).toHaveAttribute("data-state", "locked");
  await expect(page.getByTestId("voice-recording")).toBeVisible();
  await page.waitForTimeout(ms);
  await btn.click();
}

export async function recordCircle(page: Page, ms = 1500) {
  const btn = page.getByTestId("chat-record");
  if ((await btn.getAttribute("data-mode")) !== "circle") await btn.click({ button: "right" });
  await expect(btn).toHaveAttribute("data-mode", "circle");
  await btn.click();
  await expect(page.getByTestId("circle-recorder")).toHaveAttribute("data-state", "locked");
  await page.waitForTimeout(ms);
  // Step 2.10: the composer stays; its button on the right sends (Cancel is in its middle).
  await btn.click();
}

/**
 * Step 2.9 hotfix: the own-profile action row, measured in ONE frame once fonts are loaded and the page has
 * stopped moving (the screen slides back after the side menu closes; two separate measurements taken during
 * that slide used to report a false overlap). Returns the gap between "Редактировать" and the "…" zone.
 */
export async function profileActionRow(page: Page) {
  await page.getByTestId("profile-edit").waitFor();
  return page.evaluate(async () => {
    await document.fonts.ready;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    const read = () => {
      const r = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
      const edit = r("profile-edit");
      const zone = r("profile-more-zone");
      const more = r("profile-more");
      return { editLeft: edit.left, editRight: edit.right, zoneLeft: zone.left, zoneRight: zone.right, moreLeft: more.left, moreRight: more.right, editTop: edit.top, moreTop: more.top, width: innerWidth };
    };
    // Settled: the same rectangles in 5 consecutive frames (at most ~3 s).
    let prev = read();
    let same = 0;
    for (let i = 0; i < 180 && same < 5; i++) {
      await frame();
      const cur = read();
      same = Math.abs(cur.editRight - prev.editRight) < 0.5 && Math.abs(cur.zoneLeft - prev.zoneLeft) < 0.5 ? same + 1 : 0;
      prev = cur;
    }
    return { ...prev, gap: prev.zoneLeft - prev.editRight, settled: same >= 5 };
  });
}

/**
 * Replace (never append to) an input's value. A sheet can show its field for a frame or two before it is
 * filled with the current value; typing into that frame used to end up in front of the value arriving
 * after it ("АльфаАльфа 2"). Wait for the current value, clear, type, and check the exact result.
 */
export async function replaceValue(field: Locator, current: string, next: string) {
  await expect(field).toHaveValue(current);
  await field.fill("");
  await expect(field).toHaveValue("");
  await field.fill(next);
  await expect(field).toHaveValue(next);
}

/** Authenticated API call from the page's own session (refresh → access token). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function apiAs(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const headers: Record<string, string> = { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
}

/** Vibex «Чаты» pulled down a bit (phones: a short drag at the top; PC: a wheel up): the search comes out. */
export async function pullChats(page: Page) {
  const list = (await page.getByTestId("chats-scroll").boundingBox())!;
  if ((page.viewportSize()?.width ?? 1000) < 700) {
    await page.mouse.move(list.x + list.width / 2, list.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(list.x + list.width / 2, list.y + 40 + i * 12);
    await page.mouse.up();
  } else {
    await page.mouse.move(list.x + list.width / 2, list.y + 80);
    await page.mouse.wheel(0, -120);
  }
}
