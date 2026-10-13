import { expect, test, type Page } from "@playwright/test";
import { apiAs as api, newPage, openApp, pullChats, signUpViaApi } from "./helpers";

/**
 * Step 2.10 — «Чаты»: folded header (pull / wheel for the search, more for the
 * stories, folds back), the pencil makes a group, chats are separate cards,
 * the preview scrolls the whole history without reading anything and a tap on
 * a message opens the real chat.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

async function toChats(page: Page) {
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
  await expect(page.getByTestId("chats-pane")).toBeVisible();
}

test("«Чаты» header: folded at first; a pull opens the search, more opens the stories; it folds back", async ({ page, browser }) => {
  await signUpViaApi(page, "Шапка", "Чатов");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Борис", "Карточкин");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Привет" });
  await toChats(page);
  const pane = page.getByTestId("chats-pane");
  await expect(pane).toHaveAttribute("data-level", "0");
  await expect(page.getByTestId("chat-search")).toHaveCount(0);
  await expect(page.getByTestId("stories-strip")).toHaveCount(0);

  await pullChats(page);
  await expect(pane).toHaveAttribute("data-level", "1");
  await expect(page.getByTestId("chat-search")).toBeVisible();
  await page.waitForTimeout(450);
  await pullChats(page);
  await expect(pane).toHaveAttribute("data-level", "2");
  await expect(page.getByTestId("stories-strip")).toBeVisible();

  // Folds back: a push up (phones) / a wheel down (PC) on a list with nowhere to scroll.
  const list = (await page.getByTestId("chats-scroll").boundingBox())!;
  for (let k = 0; k < 2; k++) {
    await page.waitForTimeout(450);
    if (isMobile(page)) {
      await page.mouse.move(list.x + list.width / 2, list.y + list.height - 60);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(list.x + list.width / 2, list.y + list.height - 60 - i * 10);
      await page.mouse.up();
    } else {
      await page.mouse.move(list.x + list.width / 2, list.y + 200);
      await page.mouse.wheel(0, 120);
    }
  }
  await expect(pane).toHaveAttribute("data-level", "0");
  await bp.context().close();
});

test("the pencil makes a group: members (search), name, create", async ({ page, browser }) => {
  await signUpViaApi(page, "Карандаш", "Групповой");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Борис", "Участник");
  await toChats(page);
  await expect(page.getByTestId("vibex-new-chat")).toHaveAttribute("aria-label", "Новая группа");
  await page.getByTestId("vibex-new-chat").click();
  await expect(page.getByTestId("new-chat")).toContainText("Новая группа");
  await page.getByTestId("new-chat-search").fill(b.username);
  await page.getByTestId("new-chat-contact").first().click();
  // One person is a group too.
  await expect(page.getByTestId("new-chat-next")).toHaveText("Далее");
  await page.getByTestId("new-chat-next").click();
  await page.getByTestId("new-group-title").fill("Двое в лодке");
  await page.getByTestId("new-group-create").click();
  await expect(page.getByTestId("group-header")).toContainText("Двое в лодке");
  const list = (await api(page, "GET", "/api/vibex/chats")).body as { kind: string; group: { title: string } | null }[];
  expect(list.some((c) => c.kind === "group" && c.group?.title === "Двое в лодке")).toBe(true);
  await bp.context().close();
});

test("chat cards: separate rounded cards with gaps, a background of their own, no border; light and dark", async ({ page, browser }) => {
  const a = await signUpViaApi(page, "Карточка", "Чата");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Борис", "Первый");
  const cp = await newPage(browser, isMobile(page));
  const c = await signUpViaApi(cp, "Вера", "Вторая");
  for (const [p, u] of [[bp, b], [cp, c]] as const) {
    const chat = (await api(p, "POST", "/api/vibex/chats/direct", { userId: a.id })).body;
    await api(p, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: `Привет от ${u.username}` });
  }
  await toChats(page);
  const rows = page.locator('[data-testid="chat-row"] .vx-chat-card');
  await expect(rows).toHaveCount(2);
  const look = async () =>
    rows.evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        // What the card lies on: the first ancestor with a background (a gradient counts as its own).
        let bg = "";
        for (let p: HTMLElement | null = el.closest('[data-testid="chats-scroll"]'); p && !bg; p = p.parentElement) {
          const ps = getComputedStyle(p);
          if (ps.backgroundImage !== "none") bg = "gradient";
          else if (ps.backgroundColor !== "rgba(0, 0, 0, 0)") bg = ps.backgroundColor;
        }
        return { card: cs.backgroundColor, app: bg, border: cs.borderTopWidth, radius: parseFloat(cs.borderTopLeftRadius), top: r.top, bottom: r.bottom };
      }),
    );
  const light = await look();
  for (const r of light) {
    expect(r.card).not.toBe(r.app);
    expect(r.card).not.toBe("rgba(0, 0, 0, 0)");
    expect(r.border).toBe("0px");
    expect(r.radius).toBeGreaterThanOrEqual(16);
  }
  expect(light[1]!.top - light[0]!.bottom).toBeGreaterThanOrEqual(4);
  // Every app look (the account's «Вид приложений»): the card always differs from what it lies on.
  for (const lookName of ["media", "notes", "mail", "dark"]) {
    await page.evaluate((v) => document.documentElement.setAttribute("data-app-look", v), lookName);
    // The card's colour has a transition: wait until it has settled (a slow runner takes longer).
    if (lookName === "dark") await expect.poll(async () => (await look())[0]!.card, { timeout: 5000 }).toMatch(/^rgb\((28, 28, 38|29, 29, 39|37, 37, 48)\)$/);
    else await page.waitForTimeout(450);
    await expect.poll(async () => { const l = await look(); return l[0]!.card !== l[0]!.app; }, { timeout: 5000 }).toBe(true);
  }
  await bp.context().close();
  await cp.context().close();
});

test("preview: the whole history scrolls and nothing is read (A/B); no «Открыть»; a tap on a message opens the chat", async ({ page, browser }) => {
  const me = await signUpViaApi(page, "Превью", "Читатель");
  const bp = await newPage(browser, isMobile(page));
  await signUpViaApi(bp, "Борис", "Писатель");
  const chat = (await api(bp, "POST", "/api/vibex/chats/direct", { userId: me.id })).body;
  for (let i = 1; i <= 60; i++) await api(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: `Сообщение ${i}` });
  await toChats(page);
  const row = page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`);
  await expect(row.getByTestId("chat-unread")).toHaveText("60");
  // The arrival banners go away first (they would sit over the first row).
  await expect(page.getByTestId("system-popup")).toHaveCount(0, { timeout: 20_000 });

  const openPreview = async () => {
    if (isMobile(page)) {
      const box = (await row.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
    } else {
      await row.click({ button: "right" });
      await page.getByTestId("chat-action-preview").click();
    }
    await expect(page.getByTestId("chat-preview")).toBeVisible();
  };
  await openPreview();
  const preview = page.getByTestId("chat-preview");
  // Not full screen: the free area around it is there.
  const box = (await preview.getByTestId("chat-preview-messages").boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.height).toBeLessThan(vp.height * 0.8);
  await expect(preview.getByTestId("chat-action-open")).toHaveCount(0);
  await expect(preview.getByTestId("chat-action-mute")).toBeVisible();
  await expect(preview.getByTestId("preview-messages")).toContainText("Сообщение 60");
  // Scroll to the very first message (older pages load as it goes).
  for (let i = 0; i < 12 && !(await preview.getByText("Сообщение 1", { exact: true }).count()); i++) {
    await preview.getByTestId("chat-preview-messages").hover();
    await page.mouse.wheel(0, -2500);
    await page.waitForTimeout(350);
  }
  await expect(preview.getByText("Сообщение 1", { exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  // A: still 60 unread; B: no read receipt.
  expect((await api(page, "GET", "/api/vibex/chats")).body.find((c: { id: string }) => c.id === chat.id).unread).toBe(60);
  expect((await api(bp, "GET", "/api/vibex/chats")).body.find((c: { id: string }) => c.id === chat.id).peerReadAt).toBeNull();
  await page.getByTestId("chat-preview-backdrop").click({ position: { x: 6, y: 6 } });
  await expect(preview).toHaveCount(0);
  await expect(row.getByTestId("chat-unread")).toHaveText("60");

  // A tap on a message: the preview closes, the real chat opens (and reads).
  await openPreview();
  await preview.getByTestId("message").last().click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator(`[data-testid="conversation"][data-chat-id="${chat.id}"]`)).toBeVisible();
  await expect.poll(async () => (await api(page, "GET", "/api/vibex/chats")).body.find((c: { id: string }) => c.id === chat.id).unread).toBe(0);
  await bp.context().close();
});
