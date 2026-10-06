import { expect, test } from "@playwright/test";
import { devCode, newPage, next, openApp, PASSWORD, phoneHome, reloadUnlocked, signUpViaApi, signUpViaUi } from "./helpers";

test("new user: sign up, see data in Settings, edit, sign out, sign back in, session restores", async ({ page }) => {
  const { address } = await signUpViaUi(page);

  // "VOIDEX doesn't forget me": reload restores the session straight into the workspace.
  await reloadUnlocked(page);
  await expect(page.getByTestId("workspace")).toBeVisible();

  await openApp(page, "settings");
  const isMobile = (page.viewportSize()?.width ?? 1000) < 900;
  await page.getByTestId("settings-nav-account").first().click();
  await expect(page.getByTestId("account-name").last()).toHaveText("Анна Волкова");
  await expect(page.getByText(address).first()).toBeVisible();

  // Edit an allowed field.
  await page.getByTestId("row-personal").last().click();
  await page.getByTestId("settings-first-name").last().fill("Мария");
  await page.getByTestId("settings-save-profile").last().click();
  await expect(page.getByText("Профиль обновлён")).toBeVisible();

  // Sign out and back in on the same (trusted) device: no extra confirmation needed.
  if (isMobile) await page.getByTestId("settings-back").last().click();
  else await page.getByTestId("settings-nav-account").first().click();
  await page.getByTestId("sign-out").last().click();
  await expect(page.getByTestId("welcome-signin")).toBeVisible();
  await page.getByTestId("welcome-signin").click();
  await page.getByTestId("login-identifier").fill(address);
  await page.getByTestId("login-password").fill("wrong-password-1");
  await next(page);
  await expect(page.getByText("Неверная почта/телефон или пароль.")).toBeVisible();
  await page.getByTestId("login-password").fill(PASSWORD);
  await next(page);
  await expect(page.getByTestId("workspace")).toBeVisible();
  await openApp(page, "settings");
  await page.getByTestId("settings-nav-account").first().click();
  await expect(page.getByTestId("account-name").last()).toHaveText("Мария Волкова");
});

test("second device: SMS confirmation, then approval from a trusted device; devices list; revoke", async ({ page, browser }) => {
  const { address } = await signUpViaApi(page, "Ирина", "Лебедева");

  // Device 2 — new device must confirm by SMS.
  const pc = await newPage(browser, false);
  await pc.goto("/");
  await pc.getByTestId("welcome-signin").click();
  await pc.getByTestId("login-identifier").fill(address);
  await pc.getByTestId("login-password").fill(PASSWORD);
  await next(pc);
  await pc.getByTestId("challenge-sms").click();
  await pc.getByTestId("otp-input").fill(await devCode(pc));
  await expect(pc.getByTestId("workspace")).toBeVisible();
  await openApp(pc, "settings");
  await pc.getByTestId("settings-nav-account").first().click();
  await expect(pc.getByTestId("account-name")).toHaveText("Ирина Лебедева");

  // Device 3 — confirmed by approving on device 1 (real-time prompt).
  const tablet = await newPage(browser, true);
  await tablet.goto("/");
  await tablet.getByTestId("welcome-signin").click();
  await tablet.getByTestId("login-identifier").fill(address);
  await tablet.getByTestId("login-password").fill(PASSWORD);
  await next(tablet);
  await tablet.getByTestId("challenge-device").click();
  await expect(tablet.getByTestId("waiting-approval")).toBeVisible();
  await page.getByTestId("approval-approve").click();
  await expect(tablet.getByTestId("workspace")).toBeVisible();

  // Device list on device 1 shows all three; sign device 3 out remotely.
  await openApp(page, "settings");
  const isMobile = (page.viewportSize()?.width ?? 1000) < 900;
  // Account sections live in the profile (not in the Settings list).
  await expect(page.getByTestId("settings-nav-devices")).toHaveCount(0);
  await page.getByTestId("settings-nav-account").first().click();
  await page.getByTestId("row-devices").last().click();
  await expect(page.getByTestId("session-row")).toHaveCount(3);
  await page.getByTestId("session-revoke").first().click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("session-row")).toHaveCount(2);
  void isMobile;

  // One of the other devices is now signed out and sees the sign-in screen.
  await expect
    .poll(async () => (await pc.getByTestId("login-identifier").count()) + (await tablet.getByTestId("login-identifier").count()), { timeout: 15_000 })
    .toBe(1);
});

test("forgot password: SMS recovery signs in and signs other devices out", async ({ page, browser }) => {
  const { address } = await signUpViaApi(page, "Олег", "Быстров");
  const other = await newPage(browser, false);
  await other.goto("/");
  await other.getByTestId("welcome-signin").click();
  await other.getByTestId("forgot-password").click();
  await other.getByTestId("recovery-identifier").fill(address);
  await next(other);
  await other.getByTestId("challenge-sms").click();
  await other.getByTestId("otp-input").fill(await devCode(other));
  await other.getByTestId("new-password").fill("Brand-New-Orbit-77");
  await other.getByTestId("new-password-confirm").fill("Brand-New-Orbit-77");
  await next(other);
  await expect(other.getByTestId("workspace")).toBeVisible();
  // The first device was signed out by the reset.
  await expect(page.getByTestId("login-identifier")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("login-identifier").fill(address);
  await page.getByTestId("login-password").fill("Brand-New-Orbit-77");
  await next(page);
  await expect(page.getByTestId("workspace")).toBeVisible();
});

test("change password in Settings", async ({ page }) => {
  await signUpViaApi(page, "Вера", "Новикова");
  await openApp(page, "settings");
  await page.getByTestId("settings-nav-account").first().click();
  await page.getByTestId("row-password").last().click();
  await page.getByTestId("current-password").last().fill("Not-The-Password-1");
  await page.getByTestId("new-password").last().fill("Another-Strong-99");
  await page.getByTestId("new-password-confirm").last().fill("Another-Strong-99");
  await page.getByTestId("change-password").last().click();
  await expect(page.getByText("Неверный пароль.")).toBeVisible();
  await page.getByTestId("current-password").last().fill(PASSWORD);
  await page.getByTestId("change-password").last().click();
  await expect(page.getByText("Пароль изменён")).toBeVisible();
});

test("window system: open, minimize (PC: [...] menu, phone: gesture bar), reopen from launcher", async ({ page }) => {
  await signUpViaApi(page, "Ян", "Ким");
  await openApp(page, "settings");
  const isMobile = (page.viewportSize()?.width ?? 1000) < 900;
  if (!isMobile) {
    await page.getByTestId("window-menu").last().click();
    await expect(page.getByTestId("menu-minimize")).toBeVisible();
    await expect(page.getByTestId("menu-maximize")).toBeVisible();
    // Minimizing is the way back to the workspace; no duplicate "Workspace" item.
    await expect(page.getByTestId("menu-home")).toHaveCount(0);
    await page.getByTestId("menu-minimize").click();
  } else {
    // Step 2.7: phones have no system "…"; the gesture bar takes the app home.
    await expect(page.getByTestId("window-menu")).toHaveCount(0);
    await phoneHome(page);
  }
  await expect(page.locator('[data-testid="window-settings"][data-state="hidden"]')).toBeAttached();
  await page.getByTestId("launcher-button").click();
  await page.getByTestId("launcher-settings").click();
  await expect(page.locator('[data-testid="window-settings"][data-state="open"]')).toBeVisible();
});
