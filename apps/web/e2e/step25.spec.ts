import { expect, test, type Page } from "@playwright/test";
import { signUpViaApi } from "./helpers";

/**
 * Step 2.5 — Notes, Vibex additions, shell, Settings, two-step app removal.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

/** Edit mode on the home screen: long press on free space (phone), the desktop menu (PC). */
async function enterEdit(page: Page) {
  const home = page.getByTestId("home");
  if (isMobile(page)) {
    const box = (await page.getByTestId("home-page-0").boundingBox())!;
    const p = { x: box.x + box.width / 2, y: box.y + box.height - 80 };
    const cdp = await page.context().newCDPSession(page);
    await expect(async () => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
      await page.waitForTimeout(700);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(home).toHaveAttribute("data-editing", "true", { timeout: 1500 });
    }).toPass({ timeout: 15_000 });
  } else {
    const box = (await page.getByTestId("desktop-space").boundingBox())!;
    await page.mouse.click(box.x + box.width - 60, box.y + box.height - 60, { button: "right" });
    await page.getByTestId("menu-edit").click();
    await expect(home).toHaveAttribute("data-editing", "true");
  }
}

const badge = (page: Page, id: string) => page.getByTestId(`app-${id}`).getByTestId("home-remove-badge");

test("removing apps asks twice; Cancel / Esc / outside at any step keeps them; several apps at once", async ({ page }) => {
  await signUpViaApi(page, "Удаля", "Дважды");
  await enterEdit(page);

  // "−" only marks the app.
  await badge(page, "settings").click({ force: true });
  await expect(badge(page, "settings")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("app-settings")).toBeVisible();
  await page.getByTestId("remove-selection-delete").click();

  // Step 1 → "Удалить" → step 2; the app is still there.
  const dialog = page.getByTestId("remove-confirm");
  await expect(dialog).toHaveAttribute("data-step", "1");
  await expect(page.getByTestId("remove-confirm-app-settings")).toBeVisible();
  await page.getByTestId("remove-confirm-ok").click();
  await expect(dialog).toHaveAttribute("data-step", "2");
  await expect(page.getByTestId("remove-confirm-title")).toHaveText("Точно удалить выбранные приложения?");
  await expect(page.getByTestId("app-settings")).toBeVisible();
  await expect(page.getByTestId("remove-confirm-app-settings")).toBeVisible();

  // Cancel at step 2: nothing removed, the dialog is gone.
  await page.getByTestId("remove-confirm-cancel").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("app-settings")).toBeVisible();

  // Esc at step 1, tap outside at step 2: nothing removed.
  await page.getByTestId("remove-selection-delete").click();
  await expect(dialog).toHaveAttribute("data-step", "1");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("home")).toHaveAttribute("data-editing", "true");
  await page.getByTestId("remove-selection-delete").click();
  await page.getByTestId("remove-confirm-ok").click();
  await expect(dialog).toHaveAttribute("data-step", "2");
  await page.getByTestId("remove-confirm-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("app-settings")).toBeVisible();

  // A double click on step 1's "Удалить" doesn't fall through to step 2's.
  await page.getByTestId("remove-selection-delete").click();
  await page.getByTestId("remove-confirm-ok").dblclick();
  await expect(dialog).toHaveAttribute("data-step", "2");
  await page.waitForTimeout(300);
  await expect(page.getByTestId("app-settings")).toBeVisible();
  await page.getByTestId("remove-confirm-cancel").click();

  // Several apps: all icons on both steps; both confirmations remove them all.
  await badge(page, "vibex").click({ force: true });
  await badge(page, "calculator").click({ force: true });
  await expect(page.getByTestId("remove-selection-bar")).toContainText("3");
  await page.getByTestId("remove-selection-delete").click();
  for (const id of ["settings", "vibex", "calculator"]) await expect(page.getByTestId(`remove-confirm-app-${id}`)).toBeVisible();
  await page.getByTestId("remove-confirm-ok").click();
  await expect(dialog).toHaveAttribute("data-step", "2");
  for (const id of ["settings", "vibex", "calculator"]) {
    await expect(page.getByTestId(`remove-confirm-app-${id}`)).toBeVisible();
    await expect(page.getByTestId(`app-${id}`)).toBeVisible();
  }
  await page.getByTestId("remove-confirm-ok").click();
  await expect(dialog).toHaveCount(0);
  for (const id of ["settings", "vibex", "calculator"]) await expect(page.getByTestId(`app-${id}`)).toHaveCount(0);
  await expect(page.getByTestId("app-mail")).toBeVisible();
  await expect(page.getByTestId("remove-selection-bar")).toHaveCount(0);
});
