import { expect, test, type Page } from "@playwright/test";
import { apiAs, openApp, openWallpapersTab, signUpViaApi } from "./helpers";

/** Update 4 · D: new built-in wallpapers next to the old ones; my own wallpapers can be deleted, built-in ones can't. */
async function layoutWallpaper(page: Page) {
  const me = (await apiAs(page, "GET", "/api/me")).body as { preferences?: { workspace?: { layout?: { appearance?: { wallpaper?: { kind: string; version?: string; id?: string } } } } } };
  return me.preferences?.workspace?.layout?.appearance?.wallpaper ?? { kind: "default" };
}
/** A small real PNG (the server checks the bytes). */
async function png(page: Page, color: string) {
  return Buffer.from(
    await page.evaluate(async (c) => {
      const cv = document.createElement("canvas");
      cv.width = 64;
      cv.height = 64;
      const x = cv.getContext("2d")!;
      x.fillStyle = c;
      x.fillRect(0, 0, 64, 64);
      const b: Blob = await new Promise((r) => cv.toBlob((v) => r(v!), "image/png"));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    }, color),
  );
}

test("D1 / D2: new wallpapers are added (old ones kept); my own wallpapers stay in the catalogue and can be deleted; built-in ones can't", async ({ page }) => {
  await signUpViaApi(page, "Обои", "Новые");
  await openApp(page, "settings");
  await openWallpapersTab(page, "home");
  const s = page.getByTestId("settings-wallpapers").last();
  // The old built-ins are all still there, the new ones after them.
  for (const id of ["white", "aura", "mist", "wave-light", "wave-milk", "wave-milk-violet", "wave-gray", "wave-gray-purple", "wave-milk-gray-purple", "v-glow", "v-silk", "v-dawn", "v-orbit", "v-prism"]) await expect(s.getByTestId(`wallpapers-option-${id}`)).toHaveCount(1);
  // A new one applies like any other (and has no delete button).
  await s.getByTestId("wallpapers-option-v-silk").click();
  await expect(s.getByTestId("wallpapers-delete")).toHaveCount(0);
  await s.getByTestId("wallpapers-apply").click();
  await expect.poll(async () => (await layoutWallpaper(page)).id).toBe("v-silk");
  // Two own pictures: both stay in the catalogue; the second is in use.
  await s.getByTestId("wallpapers-file").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: await png(page, "#8a63ff") });
  await expect.poll(async () => (await layoutWallpaper(page)).version ?? "").toMatch(/^lib-/);
  const firstVersion = (await layoutWallpaper(page)).version!;
  await s.getByTestId("wallpapers-file").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: await png(page, "#3f63ff") });
  await expect.poll(async () => ((await apiAs(page, "GET", "/api/account/wallpapers")).body.wallpapers as unknown[]).length).toBe(2);
  await expect.poll(async () => (await layoutWallpaper(page)).version).not.toBe(firstVersion);
  const own = s.locator('[data-testid^="wallpapers-option-lib:"]');
  await expect(own).toHaveCount(2);
  const inUse = (await layoutWallpaper(page)).version!;
  // Delete the one not in use: plain confirmation, only that one goes.
  const ids = ((await apiAs(page, "GET", "/api/account/wallpapers")).body.wallpapers as { id: string }[]).map((w) => w.id);
  const spare = ids.find((id) => !inUse.includes(id.slice(-16)))!;
  await s.getByTestId(`wallpapers-option-lib:${spare}`).click();
  await s.getByTestId("wallpapers-delete").click();
  const confirm = page.getByTestId("wallpapers-delete-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).not.toContainText("сейчас установлены");
  await confirm.getByRole("button", { name: "Удалить обои" }).click();
  await expect(own).toHaveCount(1);
  expect((await layoutWallpaper(page)).version).toBe(inUse);
  // Delete the one in use: it says so and puts the standard wallpaper first.
  await own.first().click();
  await s.getByTestId("wallpapers-delete").click();
  await expect(confirm).toContainText("сейчас установлены");
  await confirm.getByRole("button", { name: "Заменить и удалить" }).click();
  await expect(own).toHaveCount(0);
  await expect.poll(async () => (await layoutWallpaper(page)).kind).toBe("default");
  expect(((await apiAs(page, "GET", "/api/account/wallpapers")).body.wallpapers as unknown[]).length).toBe(0);
});
