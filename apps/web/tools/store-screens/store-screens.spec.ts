import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs, reloadUnlocked, signUpViaApi } from "../../e2e/helpers";

/**
 * Step 2.11 (development only): the screenshots of Appex Store, taken from
 * the real apps. Two fresh local accounts with made-up names and texts.
 * Phone 390×844 and PC 1440×900, JPEG, into public/store/screens.
 */

const OUT = new URL("../../public/store/screens/", import.meta.url).pathname;
type Id = "vibex" | "mail" | "notes" | "calculator" | "files" | "media";

async function phone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: "ru-RU" });
  return ctx.newPage();
}
async function pc(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" });
  return ctx.newPage();
}
const snap = (page: Page, name: string) => page.screenshot({ path: `${OUT}${name}.jpg`, type: "jpeg", quality: 72 });
async function open(page: Page, id: Id, mobile: boolean) {
  if (mobile) await page.getByTestId(`app-${id}`).click();
  else await page.getByTestId(`dock-app-${id}`).click();
  await expect(page.locator(`[data-testid="window-${id}"][data-state="open"]`)).toBeVisible();
  await page.waitForTimeout(1200);
}
/** The calculator's own field: cleared, typed, Enter (its keyboard path). */
async function calc(page: Page, expr: string) {
  const field = page.getByTestId("calc-expression");
  await field.click();
  await field.fill("");
  await field.type(expr);
  await field.press("Enter");
}
async function hideOwnPopups(page: Page) {
  await page.addStyleTag({ content: '[data-testid="system-popups"],[data-testid="toast"]{display:none!important}' });
}

async function content(a: Page, b: Page, bId: string, aAddress: string) {
  const posts = ["Утро в горах, кофе и тишина. Отличное начало недели!", "Собрали команду на новый проект. Делимся идеями в Заметках."];
  for (const text of posts) await apiAs(b, "POST", "/api/vibex/posts", { text });
  const chat = (await apiAs(a, "POST", "/api/vibex/chats/direct", { userId: bId })).body as { id: string };
  const lines: [Page, string][] = [
    [b, "Привет! Как продвигается презентация?"],
    [a, "Почти готова, осталось два слайда"],
    [b, "Отлично, тогда созвонимся вечером"],
    [a, "Договорились 👍"],
  ];
  for (const [p, text] of lines) await apiAs(p, "POST", `/api/vibex/chats/${chat.id}/messages`, { text });
  for (const [subject, body] of [
    ["План встречи", "Привет! Отправляю план нашей встречи и первые идеи."],
    ["Материалы проекта", "Здесь всё, что нужно к четвергу."],
  ]) {
    const d = (await apiAs(b, "POST", "/api/mail/drafts", { to: [aAddress], subject, body })).body as { id: string };
    await apiAs(b, "POST", `/api/mail/drafts/${d.id}/send`);
  }
  const project = (await apiAs(a, "POST", "/api/notes/projects", { name: "Запуск продукта" })).body as { id: string };
  for (const name of ["План работ", "Идеи для презентации", "Итоги встречи"]) await apiAs(a, "POST", `/api/notes/projects/${project.id}/documents`, { kind: "note", name });
  return chat.id;
}

async function setup(browser: Browser, make: (b: Browser) => Promise<Page>) {
  const a = await make(browser);
  const me = await signUpViaApi(a, "Алина", "Морозова");
  const b = await make(browser);
  const other = await signUpViaApi(b, "Илья", "Соколов");
  const chatId = await content(a, b, other.id, me.address);
  await b.context().close();
  await reloadUnlocked(a);
  await a.waitForTimeout(1500);
  await hideOwnPopups(a);
  const home = async () => {
    await reloadUnlocked(a);
    await a.waitForTimeout(1200);
    await hideOwnPopups(a);
  };
  return { a, chatId, home };
}

test("Appex Store screenshots: phone", async ({ browser }) => {
  const { a, chatId, home } = await setup(browser, phone);
  await open(a, "vibex", true);
  await snap(a, "vibex-phone-1");
  await a.getByTestId("vibex-tab-chats").click();
  await a.locator(`[data-testid="chat-row"][data-chat-id="${chatId}"]`).click();
  await a.waitForTimeout(1200);
  await snap(a, "vibex-phone-2");
  await home();
  await open(a, "mail", true);
  await snap(a, "mail-phone-1");
  await a.getByTestId("thread-row").first().click();
  await a.waitForTimeout(1000);
  await snap(a, "mail-phone-2");
  await home();
  await open(a, "notes", true);
  await snap(a, "notes-phone-1");
  await a.getByText("Запуск продукта").first().click();
  await a.waitForTimeout(1000);
  await snap(a, "notes-phone-2");
  await home();
  await open(a, "calculator", true);
  await calc(a, "12*(3+4)");
  await a.waitForTimeout(600);
  await snap(a, "calculator-phone-1");
  await a.getByText("Научный", { exact: true }).first().click();
  await a.waitForTimeout(600);
  await snap(a, "calculator-phone-2");
  for (const id of ["files", "media"] as const) {
    await home();
    await open(a, id, true);
    await snap(a, `${id}-phone-1`);
  }
  await a.context().close();
});

test("Appex Store screenshots: PC", async ({ browser }) => {
  const { a, chatId, home } = await setup(browser, pc);
  await open(a, "vibex", false);
  await a.getByTestId("vibex-nav-chats").last().click();
  await a.locator(`[data-testid="chat-row"][data-chat-id="${chatId}"]`).click();
  await a.waitForTimeout(1200);
  await snap(a, "vibex-pc-1");
  for (const id of ["mail", "notes", "calculator", "files", "media"] as const) {
    await home();
    await open(a, id, false);
    if (id === "calculator") {
      await calc(a, "x^2-5x+6=0");
    }
    await a.waitForTimeout(800);
    await snap(a, `${id}-pc-1`);
  }
  await a.context().close();
});
