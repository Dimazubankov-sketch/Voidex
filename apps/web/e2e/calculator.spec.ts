import { expect, test, type Page } from "@playwright/test";
import { addWidget, normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { fileURLToPath } from "node:url";
import { openApp, signUpViaApi, reloadUnlocked } from "./helpers";

/**
 * Step 2.3: the Calculator (packages/calculator) as a VOIDEX system app —
 * registry / desktop / dock / search / widget, lazy loading, the original
 * engine through the real UI, no page scroll at any size, and the local OCR
 * path (a real Tesseract run on a fixed image; only the photo is a fixture).
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
const OCR_IMAGE = fileURLToPath(new URL("./fixtures/ocr-2x-plus-4.png", import.meta.url));

async function api<T = unknown>(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const res = await fetch(url, {
        method,
        headers: { "X-Voidex-Client": "web", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as never };
    },
    { method, url, body },
  );
}

/** Types into the calculator's own field and presses Enter (the original keyboard path). */
async function solveIn(page: Page, expression: string) {
  const field = page.getByTestId("calc-expression");
  await field.fill(expression);
  await field.press("Enter");
}

const answer = (page: Page) => page.getByTestId("calc-answer");

/** Nothing on the page scrolls: the document, the window and the calculator root keep their size. */
async function expectNoPageScroll(page: Page) {
  await expect(page.getByTestId("calc-answer")).toBeVisible();
  const m = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".vxc")!;
    const calc = document.querySelector<HTMLElement>("#vxc-calculator")!;
    const overflowing = [...root.querySelectorAll<HTMLElement>("*")].filter((e) => {
      if (!e.offsetParent || e.closest("dialog") || e.closest(".katex")) return false;
      const s = getComputedStyle(e);
      return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1;
    });
    return {
      doc: document.scrollingElement!.scrollHeight - innerHeight,
      rootOverflow: getComputedStyle(root).overflow,
      calcOverflow: calc.scrollHeight - calc.clientHeight,
      // Only the step-by-step list may scroll (history scrolls inside its dialog).
      scrollers: overflowing.map((e) => e.id || e.className).filter((n) => n !== "vxc-steps" && !String(n).includes("steps")),
    };
  });
  expect(m.doc).toBeLessThanOrEqual(0);
  expect(m.rootOverflow).toBe("hidden");
  expect(m.calcOverflow).toBeLessThanOrEqual(1);
  expect(m.scrollers).toEqual([]);
}

test("calculator: system app (desktop, search, dock), lazy loaded; the original engine through the UI", async ({ page }) => {
  const heavy: string[] = [];
  page.on("request", (r) => {
    if (/katex|mathjs|tesseract|traineddata|\/apps\/calculator\/ocr\/|calculator-app/i.test(r.url())) heavy.push(r.url());
  });
  await signUpViaApi(page);
  // Installed for the account like the other system apps.
  const apps = await api<{ apps: { id: string }[] } | { id: string }[]>(page, "GET", "/api/apps");
  expect(JSON.stringify(apps.body)).toContain('"calculator"');
  // A normal VOIDEX load fetches none of the calculator, KaTeX, mathjs or OCR files.
  await expect(page.getByTestId("app-calculator")).toBeVisible();
  expect(heavy).toEqual([]);

  // Search finds it, also by a keyword that is not in its name (PC: the dock field).
  if (!isMobile(page)) {
    await page.getByTestId("dock").getByTestId("home-search").fill("уравнен");
    await expect(page.getByTestId("search-result-calculator")).toBeVisible();
    await page.getByTestId("dock").getByTestId("home-search").fill("");
  }

  await openApp(page, "calculator");
  await expect(page.getByTestId("calculator-app")).toBeVisible();
  // The app chunk (with KaTeX / mathjs) loads now; the OCR engine still does not.
  expect(heavy.some((u) => /calculator-app|katex/i.test(u))).toBe(true);
  expect(heavy.filter((u) => /tesseract|traineddata|\/ocr\//i.test(u))).toEqual([]);
  // Not an iframe: the calculator is part of the VOIDEX document.
  await expect(page.locator('[data-testid="window-calculator"] iframe')).toHaveCount(0);

  // Initial example of the original app.
  await expect(answer(page)).toHaveText(/^5\s000$/);
  await solveIn(page, "1250 × 4");
  await expect(answer(page)).toHaveText(/^5\s000$/);
  await solveIn(page, "1/3 + 1/6");
  await expect(answer(page)).toHaveText("1/2");
  await solveIn(page, "sqrt(72) + sqrt(8)");
  await expect(answer(page)).toHaveText("8√2");
  await page.getByTestId("calc-mode-science").click();
  await solveIn(page, "x^2 - 5x + 6 = 0");
  await expect(answer(page)).toHaveText("x1 = 2; x2 = 3");
  await solveIn(page, "sqrt(x+5) = x-1");
  await expect(answer(page)).toHaveText("x = 4");
  await solveIn(page, "(x^2-1)/(x-1) = 2");
  await expect(answer(page)).toHaveText("Нет действительных решений");
  // Step-by-step solution with KaTeX.
  await expect(page.getByTestId("calc-steps").locator(".step").first()).toBeAttached();
  await expect(page.getByTestId("calc-steps").locator(".katex").first()).toBeAttached();
  // Division by zero → an error, not a number.
  await solveIn(page, "1/0");
  await expect(answer(page)).toHaveText("Проверьте ввод");
  await expect(page.getByTestId("calc-error")).toHaveText("На ноль делить нельзя.");

  // Keypad (touch / mouse): 7 × 6 =
  await page.getByTestId("calc-mode-basic").click();
  await page.locator("#vxc-keypad [data-key=clear]").click();
  for (const k of ["7", "×", "6", "solve"]) await page.locator(`#vxc-keypad [data-key="${k}"]`).click();
  await expect(answer(page)).toHaveText("42");

  // History keeps the calculations of this session.
  await page.getByTestId("calc-history-open").click();
  await expect(page.getByTestId("calc-history").locator(".history-item").first()).toContainText("42");
  await page.getByTestId("calc-history").getByRole("button", { name: "Закрыть" }).click();
  await expect(page.getByTestId("calc-history")).toBeHidden();

  // No page scroll in either mode.
  await expectNoPageScroll(page);
  await page.getByTestId("calc-mode-science").click();
  await expectNoPageScroll(page);
});

test("calculator: dock pin / unpin on PC; maximize uses the area between the system bar and the dock", async ({ page }) => {
  test.skip(isMobile(page), "PC dock");
  await signUpViaApi(page);
  const dock = page.getByTestId("dock");
  await expect(dock.getByTestId("dock-app-calculator")).toBeVisible();
  await openApp(page, "calculator");
  const win = page.getByTestId("window-calculator");
  // The window opens with a scale animation from its launcher: measure once it has settled.
  await expect.poll(async () => (await win.boundingBox())!.width).toBeGreaterThanOrEqual(360);
  await page.waitForTimeout(400);
  const box = (await win.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(560);
  await win.getByTestId("calculator-app").locator("> div").first().dblclick({ position: { x: 300, y: 20 } });
  await expect.poll(async () => (await win.boundingBox())!.width).toBeGreaterThan(box.width + 100);
  const max = (await win.boundingBox())!;
  const bar = (await page.getByTestId("system-bar").boundingBox())!;
  const dockBox = (await dock.boundingBox())!;
  expect(max.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect(max.y + max.height).toBeLessThanOrEqual(dockBox.y + 1);
  await expectNoPageScroll(page);
  // Unpin from the dock and pin it back (right-click menus), as for any app.
  // Dock click on the focused app minimizes it (the desktop icons are free again).
  await dock.getByTestId("dock-app-calculator").click();
  await expect(win).toHaveAttribute("data-state", "hidden");
  await dock.getByTestId("dock-app-calculator").click({ button: "right" });
  await page.getByTestId("menu-unpin").click();
  await expect(dock.getByTestId("dock-app-calculator")).toHaveCount(0);
  await page.getByTestId("app-calculator").click({ button: "right" });
  await page.getByTestId("menu-pin").click();
  await expect(dock.getByTestId("dock-app-calculator")).toBeVisible();
});

test("calculator widget: a tap on its title opens the full Calculator app", async ({ page }) => {
  await signUpViaApi(page);
  const me = await api<{ preferences: { workspace: { layout?: WorkspaceLayout } } }>(page, "GET", "/api/me");
  let l = normalizeLayout(me.body.preferences.workspace.layout ?? null, ["settings", "mail", "vibex", "calculator"]);
  l = addWidget(l, "calculator", isMobile(page) ? { surface: "mobile", page: 0 } : { surface: "desktop", space: l.desktop.spaces[0]!.id }, "w_calcopen1");
  expect((await api(page, "PATCH", "/api/preferences", { workspace: { layout: l } })).status).toBe(200);
  await reloadUnlocked(page);
  const w = page.getByTestId("widget-calculator");
  await expect(w).toBeVisible();
  await w.getByTestId("calc-widget-open").click();
  await expect(page.locator('[data-testid="window-calculator"][data-state="open"]')).toBeVisible();
  await expect(page.getByTestId("calc-answer")).toBeVisible();
});

test("calculator on a phone: fits without scrolling, solution panel, top-edge Notification Center still works", async ({ page }) => {
  test.skip(!isMobile(page), "phone");
  await signUpViaApi(page);
  await openApp(page, "calculator");
  await expectNoPageScroll(page);
  await page.getByTestId("calc-mode-science").click();
  await expectNoPageScroll(page);
  await solveIn(page, "x^2 - 5x + 6 = 0");
  await page.getByTestId("calc-solution-toggle").click();
  await expect(page.getByTestId("calc-solution")).toBeInViewport();
  await expect(page.getByTestId("calc-result-card")).toContainText("2");
  await page.getByTestId("calc-solution-back").click();
  await expect(page.getByTestId("calc-solution")).not.toBeInViewport();
  // Keys are touch-sized.
  const key = (await page.locator('#vxc-keypad [data-key="7"]').boundingBox())!;
  expect(key.height).toBeGreaterThanOrEqual(40);
  // The OS gesture from the very top edge still opens the Notification Center over the calculator.
  await page.mouse.move(200, 4);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(200, 4 + (416 * i) / 14);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expect(page.getByTestId("notification-center")).toBeVisible();
});

test("calculator OCR: gallery photo → crop → local recognition → editable expression → solved (x = 3); bad files are rejected", async ({ page }) => {
  test.skip(isMobile(page), "one OCR run is enough (same code on phones)");
  test.setTimeout(180_000);
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && !r.url().includes("/api/auth/")) uploads.push(r.url());
  });
  await signUpViaApi(page);
  await openApp(page, "calculator");
  await page.getByTestId("calc-mode-science").click();

  // Not an image → a clear message, no dialog.
  await page.getByTestId("calc-gallery-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("2x+4=10") });
  await expect(page.locator("#vxc-toast")).toHaveText("Выберите файл изображения");
  await expect(page.getByTestId("calc-photo-dialog")).toBeHidden();
  // Claims to be an image but cannot be decoded.
  await page.getByTestId("calc-gallery-input").setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not a png") });
  await expect(page.getByTestId("calc-ocr-status")).toHaveText(/Не удалось открыть изображение/);
  await expect(page.getByTestId("calc-recognize")).toBeDisabled();

  // The fixed photo of "2x + 4 = 10" (the only fixture; recognition itself is the real local Tesseract).
  await page.getByTestId("calc-gallery-input").setInputFiles(OCR_IMAGE);
  const dialog = page.getByTestId("calc-photo-dialog");
  await expect(dialog).toBeVisible();
  // Crop: select the equation area on the photo.
  await page.getByTestId("calc-crop").click();
  const img = (await page.locator("#vxc-photoPreview").boundingBox())!;
  await page.mouse.move(img.x + 20, img.y + 20);
  await page.mouse.down();
  await page.mouse.move(img.x + img.width / 2, img.y + img.height / 2, { steps: 4 });
  await page.mouse.move(img.x + img.width - 20, img.y + img.height - 20, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId("calc-ocr-status")).toHaveText(/Область выделена/);

  await page.getByTestId("calc-recognize").click();
  const text = page.getByTestId("calc-ocr-text");
  await expect(text).not.toHaveValue("", { timeout: 120_000 });
  const recognized = (await text.inputValue()).replace(/\s+/g, "");
  expect(recognized).toBe("2x+4=10");
  // The result stays editable before solving.
  await text.fill("2x + 4 = 10");
  await page.getByTestId("calc-use-photo").click();
  await expect(dialog).toBeHidden();
  await expect(answer(page)).toHaveText("x = 3");
  await expect(page.getByTestId("calc-result-card")).toBeVisible();
  // The photo never left the device.
  expect(uploads).toEqual([]);
});
