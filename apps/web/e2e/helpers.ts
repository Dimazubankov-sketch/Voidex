import { expect, type Browser, type Page } from "@playwright/test";

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
let seq = 0;
export function uniq(prefix = "e") {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}
export function uniquePhoneDigits() {
  return "916" + String(Date.now() + seq++ * 7919).slice(-7);
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
  return { username, address: `${username}@voidops.ru` };
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
    return { username, address: `${username}@voidops.ru`, id: res.user.id as string, token: res.accessToken as string };
  }
  // The required code-password, set through the API like the setup screen does.
  const set = await page.evaluate(
    async ({ token, passcode }) =>
      (await fetch("/api/security/passcode", { method: "POST", headers: { "Content-Type": "application/json", "X-Voidex-Client": "web", Authorization: `Bearer ${token}` }, body: JSON.stringify({ passcode }) })).status,
    { token: res.accessToken as string, passcode: PASSCODE },
  );
  expect(set).toBe(200);
  await reloadUnlocked(page);
  return { username, address: `${username}@voidops.ru`, id: res.user.id as string, token: res.accessToken as string };
}

export async function newPage(browser: Browser, mobile: boolean) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, locale: "ru-RU" }
      : { viewport: { width: 1440, height: 900 }, locale: "ru-RU", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" },
  );
  return ctx.newPage();
}

export async function openApp(page: Page, id: "mail" | "settings" | "vibex" | "calculator" | "notes") {
  await page.getByTestId(`app-${id}`).click();
  await expect(page.locator(`[data-testid="window-${id}"][data-state="open"]`)).toBeVisible();
}
