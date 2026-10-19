import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Forma: the app builder, on a phone and on a computer. The whole route of
 * the MVP: Мои проекты → create an app → editor (select, move mode on the
 * 8 px grid, library, events, sounds) → preview from the start screen →
 * an AI agent writes the backend through its own token → the person sees it
 * read-only, and the bound button reports honestly that the backend is not
 * running yet.
 */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const SHOTS = process.env.FORMA_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${isMobile(page) ? "phone" : "pc"}.png` });
}

async function createSample(page: Page, name: string) {
  await openApp(page, "forma");
  await expect(page.getByTestId("forma-app")).toBeVisible();
  await page.getByTestId("forma-create").click();
  await page.getByTestId("forma-create-name").fill(name);
  await page.getByTestId("forma-template-sample").click();
  await page.getByTestId("forma-create-submit").click();
  await expect(page.getByTestId("forma-editor")).toBeVisible();
  await expect(page.getByTestId("forma-save-state")).toHaveAttribute("data-state", "saved");
}

const node = (page: Page, name: string) => page.locator(`.fx-canvas [data-forma-el]`).filter({ has: page.locator(`text=${name}`) }).first();

test("Forma: create, select without moving, move on the grid, add a component, save and restore", async ({ page }) => {
  await signUpViaApi(page, "Фёдор", "Формин");
  await createSample(page, "Демо");
  await shot(page, "forma-editor");

  const button = page.locator('.fx-canvas [data-forma-type="button"]').first();
  const board = page.locator(".fx-artboard");
  const relY = async () => (await button.boundingBox())!.y - (await board.boundingBox())!.y;
  // A plain tap only selects: purple frame, tools, no movement.
  await button.click();
  await expect(page.getByTestId("forma-element-bar")).toBeVisible();
  await expect(page.locator(".fx-node.selected")).toHaveCount(1);
  await page.waitForTimeout(300);
  const before = await relY();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 80, { steps: 6 });
  await page.mouse.up();
  expect(await relY()).toBeCloseTo(before, 0);

  // Move mode: the drag moves it, snapped to 8 px.
  await page.getByTestId("forma-el-move").click();
  await expect(page.getByTestId("forma-el-move")).toHaveAttribute("aria-pressed", "true");
  const b2 = (await button.boundingBox())!;
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2 - 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await button.boundingBox())!.y).toBeLessThan(b2.y - 20);
  await page.getByTestId("forma-el-move").click();
  if (!isMobile(page)) {
    const y = Number(await page.getByTestId("forma-layout-y").inputValue());
    expect(y % 8).toBe(0);
    expect(y).toBeLessThan(568);
  }

  // Add a toggle from the library.
  if (isMobile(page)) {
    await page.getByLabel("Снять выделение").click();
    await page.getByTestId("forma-tab-components").click();
  } else if (!(await page.getByTestId("forma-panel-components").isVisible())) await page.getByTestId("forma-tab-components").click();
  await page.getByTestId("forma-add-toggle").click();
  await expect(page.locator('.fx-canvas [data-forma-type="toggle"]')).toHaveCount(1);
  await expect(page.getByTestId("forma-save-state")).toHaveAttribute("data-state", "saved", { timeout: 15_000 });

  // Undo removes it, redo brings it back.
  if (isMobile(page)) await page.getByLabel("Снять выделение").click();
  await page.getByTestId("forma-undo").click();
  await expect(page.locator('.fx-canvas [data-forma-type="toggle"]')).toHaveCount(0);
  await page.getByTestId("forma-redo").click();
  await expect(page.locator('.fx-canvas [data-forma-type="toggle"]')).toHaveCount(1);
  await expect(page.getByTestId("forma-save-state")).toHaveAttribute("data-state", "saved", { timeout: 15_000 });

  // Restored after a reload (from the server).
  await reloadUnlocked(page);
  await openApp(page, "forma");
  await expect(page.getByTestId("forma-editor")).toBeVisible();
  await expect(page.locator('.fx-canvas [data-forma-type="toggle"]')).toHaveCount(1);
});

test("Forma: events and preview; an AI agent builds the backend; the person reads it, the preview never fakes an answer", async ({ page }) => {
  await signUpViaApi(page, "Ада", "Агентова");
  await createSample(page, "Агент");

  // Event: the toggle-less sample button gets a toast + navigation to Настройки.
  await page.locator('.fx-canvas [data-forma-type="button"]').first().click();
  if (isMobile(page)) await page.getByTestId("forma-el-edit").click();
  await page.getByTestId("forma-tab-events").click();
  await page.getByTestId("forma-event-press").getByTestId("forma-add-action").selectOption("showToast");
  await expect(page.getByTestId("forma-event-press").getByTestId("forma-action")).toHaveCount(1);
  if (isMobile(page)) await page.getByLabel("Закрыть").first().click();
  await shot(page, "forma-events");

  // Preview starts on the start screen; the bottom menu switches screens.
  await page.getByTestId("forma-preview-open").click();
  const preview = page.getByTestId("forma-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByText("Привет!")).toBeVisible();
  await preview.getByRole("button", { name: "Настройки" }).click();
  await expect(preview.getByRole("switch").first()).toBeVisible();
  await preview.getByRole("button", { name: "Главная" }).click();
  await preview.getByRole("button", { name: "Поздороваться" }).click();
  await expect(preview.locator(".fx-app-toasts")).toContainText("Готово");
  await page.getByTestId("forma-preview-close").click();

  // Connect an agent (Claude Code), get the one-time token.
  await page.getByTestId("forma-backend-open").click();
  await page.getByTestId("forma-backend-tab-ai").click();
  await page.getByTestId("forma-connect").click();
  const token = (await page.getByTestId("forma-token-value").textContent())!.trim();
  expect(token).toMatch(/^fma_/);
  await shot(page, "forma-ai");

  // The agent works through the API with its token only.
  const h = { Authorization: `Bearer ${token}`, "X-Voidex-Client": "native" };
  const info = await (await page.request.get("/api/forma/agent/v1/project/info", { headers: h })).json();
  const project = (await (await page.request.get("/api/forma/agent/v1/project", { headers: h })).json()).project;
  const main = project.frontend.screens[0];
  const id = (name: string) => main.elements.find((e: { name: string }) => e.name === name).id;
  const write = await page.request.post("/api/forma/agent/v1/backend/commands", {
    headers: h,
    data: {
      baseRevision: info.backendRevision,
      commands: [
        {
          type: "upsertOperation",
          operation: {
            name: "demo.greet",
            input: { fields: [{ name: "name", type: "string", required: true, min: 1 }] },
            output: { fields: [{ name: "message", type: "string", required: true }] },
            handler: { language: "javascript", source: "export default async function handler(input) {\n  return { message: `Привет, ${input.name}!` };\n}" },
            tests: [{ name: "ok", input: { name: "Ада" }, expect: { ok: true, output: { message: "Привет, Ада!" } } }],
          },
        },
        {
          type: "upsertBinding",
          binding: {
            elementId: id("Поздороваться"),
            event: "press",
            operation: "demo.greet",
            input: { name: { from: "element", elementId: id("Имя") } },
            output: { targetId: id("Ответ сервера"), field: "message" },
            errorTargetId: id("Ответ сервера"),
            loading: { disable: true, text: "Отправка..." },
          },
        },
      ],
    },
  });
  expect(write.status()).toBe(200);
  // No session token works for agents, and no agent token works for people's routes.
  expect((await page.request.get("/api/forma/projects", { headers: h })).status()).toBe(401);

  // The editor picks the agent's change up; the code is readable and copyable, never editable.
  await page.getByTestId("forma-backend-close").click();
  await expect(page.locator(".fx-count")).toHaveText("1", { timeout: 20_000 });
  await page.getByTestId("forma-backend-open").click();
  await page.getByTestId("forma-backend-tab-operations").click();
  await page.getByTestId("forma-operation").locator("button").first().click();
  await expect(page.getByTestId("forma-code")).toContainText("export default async function handler");
  await expect(page.getByTestId("forma-backend").locator("textarea, [contenteditable=true]")).toHaveCount(0);
  await expect(page.getByTestId("forma-copy-code")).toBeVisible();
  await page.getByTestId("forma-backend-tab-bindings").click();
  await expect(page.getByTestId("forma-check")).toContainText("пройдена");
  await shot(page, "forma-backend");
  await page.getByTestId("forma-backend-close").click();

  // Preview: the bound button validates the input and reports that the backend is not running (no invented answer).
  await page.getByTestId("forma-preview-open").click();
  await preview.getByPlaceholder("Например, Анна").fill("Ада");
  await preview.getByRole("button", { name: "Поздороваться" }).click();
  await expect(preview.locator(".fx-r-text").filter({ hasText: "Backend ещё не исполняется" })).toBeVisible();
  if (!isMobile(page)) await expect(page.getByTestId("forma-call").first()).toHaveAttribute("data-status", "unavailable");
  await shot(page, "forma-preview");
});
