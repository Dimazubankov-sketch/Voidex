import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs, reloadUnlocked, signUpViaApi } from "../../e2e/helpers";

/**
 * Step 2.11 / 2.12 (development only): the screenshots of Appex Store, taken
 * from the real apps on the local stack. Fresh local accounts with made-up
 * names and texts; the "photos" are abstract pictures drawn on the spot (no
 * real person, no account data). Three scenes per app on a phone (390 x 844)
 * and three on a computer (1440 x 900), JPEG, into public/store/screens as
 * `<app>-phone-<n>.jpg` and `<app>-desktop-<n>.jpg` (see apps/store/catalog.ts).
 *
 *   pnpm --filter @voidex/web store:screens
 */

const OUT = new URL("../../public/store/screens/", import.meta.url).pathname;
type Id = "vibex" | "mail" | "notes" | "calculator" | "files" | "media";

async function phone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: "ru-RU" });
  return ctx.newPage();
}
async function desktop(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" });
  return ctx.newPage();
}
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const snap = (page: Page, id: Id, n: number) => page.screenshot({ path: `${OUT}${id}-${isPhone(page) ? "phone" : "desktop"}-${n}.jpg`, type: "jpeg", quality: 72 });
async function open(page: Page, id: Id) {
  if (isPhone(page)) await page.getByTestId(`app-${id}`).click();
  else await page.getByTestId(`dock-app-${id}`).click();
  await expect(page.locator(`[data-testid="window-${id}"][data-state="open"]`)).toBeVisible();
  await page.waitForTimeout(1200);
}
/** On a computer the window fills the desktop (as people use it), so the picture shows the app, not the desktop around it. */
async function maximize(page: Page, id: Id) {
  if (isPhone(page)) return;
  await page.locator(`[data-testid="window-${id}"] [data-testid="window-menu"]`).first().click();
  await page.getByTestId("menu-maximize").click();
  await page.waitForTimeout(600);
}
/** The calculator's own field: cleared, typed, Enter (its keyboard path). */
async function calc(page: Page, expr: string) {
  const field = page.getByTestId("calc-expression");
  await field.click();
  await field.fill("");
  await field.type(expr);
  await field.press("Enter");
}
async function hidePopups(page: Page) {
  await page.addStyleTag({ content: '[data-testid="system-popups"],[data-testid="toast"]{display:none!important}' });
}

/** An abstract picture drawn on a canvas (soft gradient and circles), as JPEG bytes. */
async function picture(page: Page, seed: number, w = 1200, h = 900): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ seed, w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      const hues = ([[262, 300], [210, 260], [320, 20], [170, 220], [30, 60], [240, 280]] as const)[seed % 6]!;
      const lg = g.createLinearGradient(0, 0, w, h);
      lg.addColorStop(0, `hsl(${hues[0]} 70% 74%)`);
      lg.addColorStop(1, `hsl(${hues[1]} 62% 56%)`);
      g.fillStyle = lg;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 7; i++) {
        g.fillStyle = `hsla(${hues[0] + i * 11} 85% 92% / 0.22)`;
        g.beginPath();
        g.arc((w * ((seed * 37 + i * 53) % 100)) / 100, (h * ((seed * 13 + i * 29) % 100)) / 100, 50 + i * 34, 0, Math.PI * 2);
        g.fill();
      }
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.86));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (const x of bytes) s += String.fromCharCode(x);
      return btoa(s);
    },
    { seed, w, h },
  );
  return Buffer.from(b64, "base64");
}
async function uploadVibex(page: Page, purpose: string, bytes: Buffer, name: string): Promise<string> {
  return page.evaluate(
    async ({ b64, purpose, name }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const f = await fetch(`/api/vibex/files?purpose=${purpose}`, {
        method: "POST",
        headers: { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}`, "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(name) },
        body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      }).then((x) => x.json());
      return f.id as string;
    },
    { b64: bytes.toString("base64"), purpose, name },
  );
}

async function content(a: Page, b: Page, c: Page, ids: { b: string; c: string }, aAddress: string) {
  const posts: [Page, string, number[]][] = [
    [b, "Утро в горах, кофе и тишина. Отличное начало недели!", [1, 2]],
    [c, "Собрали команду на новый проект. Делимся идеями в Заметках.", []],
    [b, "Закат над рекой. Сохраню в альбом выходных.", [3]],
  ];
  for (const [p, text, pics] of posts) {
    const mediaIds: string[] = [];
    for (const n of pics) mediaIds.push(await uploadVibex(p, "post", await picture(p, n), `post-${n}.jpg`));
    await apiAs(p, "POST", "/api/vibex/posts", { text, mediaIds });
  }
  await apiAs(a, "POST", `/api/vibex/people/${ids.b}/follow`);
  await apiAs(a, "POST", `/api/vibex/people/${ids.c}/follow`);
  await apiAs(b, "POST", "/api/vibex/stories", { fileId: await uploadVibex(b, "story", await picture(b, 4, 900, 1600), "story.jpg") });
  const chat = (await apiAs(a, "POST", "/api/vibex/chats/direct", { userId: ids.b })).body as { id: string };
  const chat2 = (await apiAs(a, "POST", "/api/vibex/chats/direct", { userId: ids.c })).body as { id: string };
  await apiAs(c, "POST", `/api/vibex/chats/${chat2.id}/messages`, { text: "Увидимся завтра на встрече?" });
  await apiAs(b, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет! Как продвигается презентация?" });
  await apiAs(a, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Почти готова, осталось два слайда" });
  const photos = [await uploadVibex(a, "message", await picture(a, 5, 900, 1200), "p1.jpg"), await uploadVibex(a, "message", await picture(a, 1), "p2.jpg"), await uploadVibex(a, "message", await picture(a, 2), "p3.jpg")];
  await apiAs(a, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "", fileIds: photos });
  await apiAs(b, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Красота! Тогда созвонимся вечером" });
  for (const [subject, body] of [
    ["План встречи", "Привет! Отправляю план нашей встречи и первые идеи по запуску."],
    ["Материалы проекта", "Здесь всё, что нужно к четвергу: тезисы, сроки и список задач."],
    ["Отчёт за неделю", "Коротко о том, что успели и что планируем дальше."],
  ]) {
    const d = (await apiAs(b, "POST", "/api/mail/drafts", { to: [aAddress], subject, body })).body as { id: string };
    await apiAs(b, "POST", `/api/mail/drafts/${d.id}/send`);
  }
  const project = (await apiAs(a, "POST", "/api/notes/projects", { name: "Запуск продукта" })).body as { id: string };
  await apiAs(a, "POST", "/api/notes/projects", { name: "Личное" });
  for (const name of ["План работ", "Идеи для презентации", "Итоги встречи"]) await apiAs(a, "POST", `/api/notes/projects/${project.id}/documents`, { kind: "note", name });
  return chat.id;
}

async function setup(browser: Browser, make: (b: Browser) => Promise<Page>) {
  const a = await make(browser);
  const me = await signUpViaApi(a, "Алина", "Морозова");
  const b = await make(browser);
  const ib = await signUpViaApi(b, "Илья", "Соколов");
  const c = await make(browser);
  const ic = await signUpViaApi(c, "Мария", "Белова");
  const chatId = await content(a, b, c, { b: ib.id, c: ic.id }, me.address);
  await b.context().close();
  await c.context().close();
  const home = async () => {
    await reloadUnlocked(a);
    await a.waitForTimeout(1200);
    await hidePopups(a);
  };
  await home();
  return { a, chatId, home };
}

async function scenes(a: Page, chatId: string, home: () => Promise<void>) {
  const pc = !isPhone(a);
  // Vibex: the feed, the chats, a conversation with photos.
  await open(a, "vibex");
  await maximize(a, "vibex");
  await a.waitForTimeout(800);
  await snap(a, "vibex", 1);
  await a.getByTestId(pc ? "vibex-nav-chats" : "vibex-tab-chats").last().click();
  await a.waitForTimeout(1000);
  await snap(a, "vibex", 2);
  await a.locator(`[data-testid="chat-row"][data-chat-id="${chatId}"] button`).first().click();
  await a.waitForTimeout(1500);
  await snap(a, "vibex", 3);

  // Mail: the inbox, a letter, a new letter.
  await home();
  await open(a, "mail");
  await maximize(a, "mail");
  await snap(a, "mail", 1);
  await a.getByTestId("thread-row").first().click();
  await a.waitForTimeout(1000);
  await snap(a, "mail", 2);
  await home();
  await open(a, "mail");
  await maximize(a, "mail");
  await a.locator('[data-testid="compose"]:visible').first().click();
  await a.waitForTimeout(600);
  await a.getByTestId("composer-subject").fill("Идеи к выходным");
  await a.getByTestId("composer-body").fill("Предлагаю собраться в субботу и обсудить план поездки.");
  await a.waitForTimeout(500);
  await snap(a, "mail", 3);

  // Notes: the projects, a project, a note.
  await home();
  await open(a, "notes");
  await maximize(a, "notes");
  await snap(a, "notes", 1);
  await a.getByText("Запуск продукта").first().click();
  await a.waitForTimeout(1000);
  await snap(a, "notes", 2);
  await a.getByText("Идеи для презентации").first().click();
  await a.waitForTimeout(1200);
  await a.getByRole("textbox", { name: "Текст" }).first().click();
  await a.keyboard.type("Главная мысль: всё рабочее пространство в одном месте.\nТри слайда: проблема, решение, план запуска.");
  await a.waitForTimeout(800);
  await snap(a, "notes", 3);

  // Calculator: an expression, the scientific mode, an equation with its steps.
  await home();
  await open(a, "calculator");
  await maximize(a, "calculator");
  await calc(a, "12*(3+4)");
  await a.waitForTimeout(600);
  await snap(a, "calculator", 1);
  await a.getByText("Научный", { exact: true }).first().click();
  await a.waitForTimeout(600);
  await calc(a, "sqrt(144)+2^5");
  await a.waitForTimeout(600);
  await snap(a, "calculator", 2);
  await calc(a, "x^2-5x+6=0");
  await a.waitForTimeout(900);
  await snap(a, "calculator", 3);

  // Files: files of this session (as they arrive from Vibex or Mail), one open, the recent ones.
  await home();
  await a.evaluate(async () => {
    const m = await import(/* @vite-ignore */ "/src/os/cloud/session.ts");
    const files = m.sessionFiles();
    await files.importFile("План встречи.txt", "1. Итоги недели\n2. Запуск продукта\n3. Вопросы команды");
    await files.importFile("Список покупок.txt", "Кофе, молоко, хлеб, фрукты");
    await files.importFile("Идеи для поездки.txt", "Горы, озеро, старый город. Выезд в субботу утром.");
  });
  // The file that arrived last opens by itself (as a received file does): that is the open-file scene.
  await open(a, "files");
  await a.waitForTimeout(800);
  if (!isPhone(a)) {
    // A window is made full size before the file is shown again.
    await a.keyboard.press("Escape");
    await a.waitForTimeout(500);
    await maximize(a, "files");
    await a.getByText("Идеи для поездки.txt").first().dblclick();
    await a.waitForTimeout(800);
  }
  await snap(a, "files", 2);
  await a.keyboard.press("Escape");
  await a.waitForTimeout(800);
  await snap(a, "files", 1);
  await a.getByRole("button", { name: "Недавние" }).last().click({ force: true });
  await a.waitForTimeout(800);
  await snap(a, "files", 3);

  // Media: the library with photos (added to this session's library, as the album "add" does), the collections, a photo open.
  await home();
  await a.evaluate(async () => {
    const m = await import(/* @vite-ignore */ "/src/os/cloud/session.ts");
    const media = m.sessionMedia();
    const names = ["Горы на рассвете", "Вечерний город", "У моря", "Поле", "Озеро", "Облака", "Сад", "Закат", "Лес"];
    const now = Date.now();
    const items = [];
    for (let i = 0; i < 9; i++) {
      const hues = [[262, 300], [210, 260], [320, 20], [170, 220], [30, 60], [240, 280]][i % 6]!;
      const [w, h] = i % 3 ? [1200, 900] : [900, 1200];
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      const lg = g.createLinearGradient(0, 0, w, h);
      lg.addColorStop(0, `hsl(${hues[0]} 70% 74%)`);
      lg.addColorStop(1, `hsl(${hues[1]} 62% 56%)`);
      g.fillStyle = lg;
      g.fillRect(0, 0, w, h);
      for (let k = 0; k < 7; k++) {
        g.fillStyle = `hsla(${hues[0] + k * 11} 85% 92% / 0.22)`;
        g.beginPath();
        g.arc((w * ((i * 37 + k * 53) % 100)) / 100, (h * ((i * 13 + k * 29) % 100)) / 100, 50 + k * 34, 0, Math.PI * 2);
        g.fill();
      }
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.86));
      const file = new File([blob], `photo-${i + 1}.jpg`, { type: "image/jpeg" });
      const src = await media.upload(file);
      const at = now - i * 86_400_000;
      items.push({ id: crypto.randomUUID(), name: names[i]!, kind: "photo", src, width: w, height: h, bytes: file.size, mime: "image/jpeg", capturedAt: at, addedAt: at, favorite: i === 1, hidden: false, edited: false, tags: [], place: "" });
    }
    const { revision } = await media.load();
    const album = (name: string, ids: string[]) => ({ id: crypto.randomUUID(), name, itemIds: ids, coverId: ids[0], pinned: false, group: "album" });
    await media.save({ version: 1, items, albums: [album("Путешествия", [items[0]!.id, items[2]!.id, items[4]!.id]), album("Дом", [items[1]!.id, items[6]!.id])] } as never, revision);
  });
  await open(a, "media");
  await maximize(a, "media");
  await a.waitForTimeout(1500);
  await snap(a, "media", 1);
  await a.getByText("Коллекции", { exact: true }).last().click();
  await a.waitForTimeout(900);
  await snap(a, "media", 2);
  await a.getByText("Медиатека", { exact: true }).last().click();
  await a.waitForTimeout(800);
  await a.locator(`[data-testid="window-media"] img`).nth(1).click();
  await a.waitForTimeout(1200);
  await snap(a, "media", 3);
}

test("Appex Store screenshots: phone", async ({ browser }) => {
  const { a, chatId, home } = await setup(browser, phone);
  await scenes(a, chatId, home);
  await a.context().close();
});

test("Appex Store screenshots: desktop", async ({ browser }) => {
  const { a, chatId, home } = await setup(browser, desktop);
  await scenes(a, chatId, home);
  await a.context().close();
});
