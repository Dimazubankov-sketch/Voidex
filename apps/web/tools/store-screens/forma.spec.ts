import { expect, test, type Browser, type Page } from "@playwright/test";
import { signUpViaApi } from "../../e2e/helpers";

/**
 * Appex Store screenshots of Forma (development only, like store-screens.spec.ts):
 * the real app on the local stack with a fresh test account and the example
 * project. Three scenes per platform: the editor, the libraries, the backend
 * written by an agent. JPEGs into public/store/screens as forma-<platform>-<n>.jpg.
 *
 *   pnpm --filter @voidex/web exec playwright test --config playwright.screens.config.ts forma
 */
const OUT = new URL("../../public/store/screens/", import.meta.url).pathname;

async function phone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: "ru-RU" });
  return ctx.newPage();
}
async function desktop(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" });
  return ctx.newPage();
}
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const snap = (page: Page, n: number) => page.screenshot({ path: `${OUT}forma-${isPhone(page) ? "phone" : "desktop"}-${n}.jpg`, type: "jpeg", quality: 72 });

async function scenes(page: Page) {
  await signUpViaApi(page, "Ника", "Формова");
  await page.addStyleTag({ content: '[data-testid="system-popups"],[data-testid="toast"]{display:none!important}' });
  if (isPhone(page)) await page.getByTestId("app-forma").click();
  else await page.getByTestId("dock-app-forma").click();
  await expect(page.locator('[data-testid="window-forma"][data-state="open"]')).toBeVisible();
  if (!isPhone(page)) {
    await page.locator('[data-testid="window-forma"] [data-testid="window-menu"]').first().click();
    await page.getByTestId("menu-maximize").click();
  }
  await page.getByTestId("forma-create").click();
  await page.getByTestId("forma-create-name").fill("Мой сервис");
  await page.getByTestId("forma-template-sample").click();
  await page.getByTestId("forma-create-submit").click();
  await expect(page.getByTestId("forma-editor")).toBeVisible();
  await page.waitForTimeout(800);

  // 1: the editor with a selected component.
  await page.locator('.fx-canvas [data-forma-type="button"]').first().click();
  await page.waitForTimeout(500);
  await snap(page, 1);

  // 2: the sound library (computer) / the component library (phone).
  if (isPhone(page)) {
    await page.getByLabel("Снять выделение").click();
    await page.getByTestId("forma-tab-components").click();
  } else {
    await page.getByTestId("forma-tab-sounds").click();
    await page.getByTestId("forma-sounds").waitFor();
  }
  await page.waitForTimeout(900);
  await snap(page, 2);
  if (isPhone(page)) await page.getByLabel("Закрыть").first().click();

  // 3: an agent wrote the backend; the person reads it.
  await page.getByTestId("forma-backend-open").click();
  await page.getByTestId("forma-backend-tab-ai").click();
  await page.getByTestId("forma-connect").click();
  const token = (await page.getByTestId("forma-token-value").textContent())!.trim();
  const h = { Authorization: `Bearer ${token}`, "X-Voidex-Client": "native" };
  const project = (await (await page.request.get("/api/forma/agent/v1/project", { headers: h })).json()).project;
  const main = project.frontend.screens[0];
  const id = (name: string) => main.elements.find((e: { name: string }) => e.name === name).id;
  await page.request.post("/api/forma/agent/v1/backend/commands", {
    headers: h,
    data: {
      baseRevision: 1,
      commands: [
        {
          type: "upsertOperation",
          operation: {
            name: "demo.greet",
            description: "Возвращает приветствие для имени из формы.",
            input: { fields: [{ name: "name", type: "string", required: true, min: 1, max: 40 }] },
            output: { fields: [{ name: "message", type: "string", required: true }] },
            errors: [{ code: "empty_name", message: "Введите имя." }],
            handler: { language: "javascript", source: "export default async function handler(input) {\n  const name = input.name.trim();\n  if (!name) return { error: 'empty_name' };\n  return { message: `Привет, ${name}!` };\n}" },
            tests: [{ name: "Приветствие", input: { name: "Анна" }, expect: { ok: true, output: { message: "Привет, Анна!" } } }],
          },
        },
        {
          type: "upsertBinding",
          binding: { elementId: id("Поздороваться"), event: "press", operation: "demo.greet", input: { name: { from: "element", elementId: id("Имя") } }, output: { targetId: id("Ответ сервера"), field: "message" } },
        },
      ],
    },
  });
  await page.getByTestId("forma-backend-close").click();
  await expect(page.locator(".fx-count")).toHaveText("1", { timeout: 20_000 });
  await page.getByTestId("forma-backend-open").click();
  await page.getByTestId("forma-operation").locator("button").first().click();
  await page.waitForTimeout(500);
  await snap(page, 3);
}

test("Forma screenshots: phone", async ({ browser }) => scenes(await phone(browser)));
test("Forma screenshots: computer", async ({ browser }) => scenes(await desktop(browser)));
