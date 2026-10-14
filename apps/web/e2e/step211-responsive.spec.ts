import { expect, test, type Page } from "@playwright/test";
import { signUpViaApi } from "./helpers";

/**
 * Step 2.11 responsive QA: Vibex (chats, search) and Appex Store (catalog,
 * an app's page) at 320 / 390 / 430 / 820 (phone layout) and 1180 / 1440 /
 * 1920 (computer). Nothing scrolls sideways; the main controls are on screen.
 * Step 2.12: the Store's account, update center and version history too.
 */

const WIDTHS = [320, 390, 430, 820, 1180, 1440, 1920];
const SHOTS = process.env.STEP211_SHOTS;

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}
async function inside(page: Page, testId: string) {
  const box = (await page.getByTestId(testId).first().boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
}

for (const width of WIDTHS) {
  test(`Vibex and Appex Store at ${width}px`, async ({ page }) => {
    // One project is enough: the width decides the layout (phone below 900 px).
    test.skip((page.viewportSize()?.width ?? 1000) < 700, "sized per width below");
    const phone = width < 900;
    await page.setViewportSize({ width, height: phone ? 844 : width >= 1440 ? 900 : 800 });
    await signUpViaApi(page, "Ширина", "Экранова");
    const open = async (id: string) => {
      if (phone) await page.getByTestId(`app-${id}`).click();
      else await page.getByTestId(`dock-app-${id}`).click();
      await expect(page.locator(`[data-testid="window-${id}"][data-state="open"]`)).toBeVisible();
    };
    await open("vibex");
    await page.getByTestId(phone ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
    await expect(page.getByTestId("chats-pane")).toBeVisible();
    await noOverflow(page);
    await inside(page, "vibex-header-title");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/resp-${width}-vibex.png` });
    await page.getByTestId(phone ? "vibex-tab-people" : "vibex-nav-people").last().click();
    await expect(page.getByTestId("search-screen")).toBeVisible();
    await noOverflow(page);

    if (phone) {
      await page.reload();
      await expect(page.getByTestId("lock-screen").or(page.getByTestId("workspace")).first()).toBeVisible();
      if (await page.getByTestId("lock-screen").count()) await page.keyboard.type("135790");
      await expect(page.getByTestId("workspace")).toBeVisible();
    }
    await open("store");
    await expect(page.getByTestId("store-home")).toBeVisible();
    await noOverflow(page);
    await inside(page, "store-hero");
    await inside(page, "store-search");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/resp-${width}-store.png` });
    await page.getByTestId("store-see-all").first().click();
    await page.locator('[data-testid="store-row"][data-app="vibex"] [data-testid="store-row-open"]').click();
    await expect(page.getByTestId("store-app-page")).toBeVisible();
    await noOverflow(page);
    await inside(page, "store-stats");
    await inside(page, "store-get");
    // Step 2.12: Back and Share, the screenshots, «Ещё для вашего пространства», versions, the account and the update center.
    await inside(page, "store-back");
    await inside(page, "store-share-open");
    await inside(page, "store-more");
    await page.getByTestId("store-versions-open").click();
    await expect(page.getByTestId("store-versions")).toBeVisible();
    await noOverflow(page);
    await inside(page, "store-release");
    await page.getByTestId("store-back").click();
    await page.getByTestId("store-back").click();
    await page.getByTestId("store-back").click();
    await page.getByTestId("store-account-open").click();
    await expect(page.getByTestId("store-account")).toBeVisible();
    await noOverflow(page);
    await inside(page, "store-pref-auto");
    await inside(page, "store-account-reviews");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/resp-${width}-store-account.png` });
    await page.getByTestId("store-account-updates").click();
    await expect(page.getByTestId("store-updates")).toBeVisible();
    await noOverflow(page);
    await inside(page, "store-updates-none");
  });
}
