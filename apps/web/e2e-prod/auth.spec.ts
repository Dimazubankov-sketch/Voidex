import { expect, test, type Route } from "@playwright/test";
import { signUpViaApi, signUpViaUi, unlock } from "../e2e/helpers";

/** Session restore on the release build: every way a session can be, none of them ends in a blank page. */

const jsonError = (route: Route, status: number, code: string) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message: code } }) });

test.describe("sign-in and session restore", () => {
  test("first start of a brand-new user: sign-up through the UI reaches the desktop", async ({ page }) => {
    await page.goto("/");
    await signUpViaUi(page);
    await expect(page.getByTestId("workspace")).toBeVisible();
  });

  test("an existing user is restored on the next start (lock screen with the code-password first)", async ({ page }) => {
    await signUpViaApi(page);
    await page.reload();
    await expect(page.getByTestId("lock-screen")).toBeVisible(); // a new start opens locked: unchanged security behaviour
    await unlock(page);
    await expect(page.getByTestId("workspace")).toBeVisible();
  });

  test("return after a long absence = a fresh page with the same cookies: the session is restored", async ({ page, context }) => {
    await signUpViaApi(page);
    await page.close();
    const again = await context.newPage();
    await again.goto("/");
    await expect(again.getByTestId("lock-screen")).toBeVisible();
    await unlock(again);
    await expect(again.getByTestId("workspace")).toBeVisible();
  });

  test("an expired / missing refresh cookie returns to the sign-in screens, not to a blank page", async ({ page, context }) => {
    await signUpViaApi(page);
    await context.clearCookies();
    await page.reload();
    await expect(page.getByTestId("welcome-signin")).toBeVisible();
    await expect(page.getByTestId("boot-fallback")).toHaveCount(0);
  });

  test("a revoked session ends at the sign-in form", async ({ page }) => {
    await page.route("**/api/auth/refresh", (r) => jsonError(r, 401, "session_revoked"));
    await page.goto("/");
    await expect(page.getByTestId("login-identifier")).toBeVisible();
    await expect(page.getByText("Вы вышли из аккаунта на этом устройстве.")).toBeVisible();
  });

  test("an expired session (server says so) ends at the sign-in form", async ({ page }) => {
    await page.route("**/api/auth/refresh", (r) => jsonError(r, 401, "session_expired"));
    await page.goto("/");
    await expect(page.getByTestId("welcome-signin").or(page.getByTestId("login-identifier")).first()).toBeVisible();
  });

  test("HTTP 423 'locked' opens the lock screen and does not hammer the server", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/auth/refresh", (r) => {
      calls++;
      return jsonError(r, 423, "session_locked");
    });
    await page.goto("/");
    await expect(page.getByTestId("lock-screen")).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(calls).toBeLessThanOrEqual(2);
  });

  test("the server is down while a signed-in user starts: «Нет связи», the session is kept, and it opens when the server returns", async ({ page }) => {
    await signUpViaApi(page);
    let down = true;
    await page.route("**/api/auth/refresh", (r) => (down ? jsonError(r, 502, "internal_error") : r.continue()));
    await page.reload();
    await expect(page.getByTestId("boot-unavailable")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("login-identifier")).toHaveCount(0);
    down = false;
    await page.getByTestId("boot-unavailable-retry").click();
    await reloadUnlockedAfterRetry(page);
  });

  test("a wrong password is still refused (security behaviour unchanged by the new timeouts)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("welcome-signin").click();
    await page.getByTestId("login-identifier").fill("nobody-here");
    await page.getByTestId("login-password").fill("Wrong-Password-1");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("login-identifier")).toBeVisible();
    await expect(page.getByTestId("workspace")).toHaveCount(0);
  });
});

async function reloadUnlockedAfterRetry(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("lock-screen").or(page.getByTestId("workspace")).first()).toBeVisible({ timeout: 20_000 });
  if (await page.getByTestId("lock-screen").count()) await unlock(page);
  await expect(page.getByTestId("workspace")).toBeVisible();
}
