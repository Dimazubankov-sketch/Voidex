import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs as api, newPage, openApp, signUpViaApi } from "./helpers";

/**
 * Step 2.11: chat media. Photos and videos as a Telegram-like mosaic (no
 * frames, no empty cells, one outer radius); attachments show at once with
 * real upload progress and an X that cancels (nothing is left on the
 * server, the mosaic closes the gap). Video circles: a thin grey seek ring
 * inside the circle with a knob while dragged, a two-finger zoom of the
 * picture inside (never below 1x), opening and closing in place.
 */

const SHOTS = process.env.STEP211_SHOTS;
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${isMobile(page) ? "phone" : "pc"}.png` });
}
// 2x1 PNG (a landscape picture) and a valid 1x1.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function uploadImage(page: Page, name: string): Promise<string> {
  return page.evaluate(
    async ({ b64, name }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const f = await fetch("/api/vibex/files?purpose=message", {
        method: "POST",
        headers: { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}`, "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(name) },
        body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      }).then((x) => x.json());
      return f.id as string;
    },
    { b64: PNG, name },
  );
}

async function openChat(page: Page, browser: Browser) {
  await signUpViaApi(page, "Мозаика", "Медийная");
  const other = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(other, "Галерея", "Друг");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body as { id: string };
  await api(other, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Покажи фото" });
  return { other, chat };
}
async function enterChat(page: Page, chatId: string) {
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
  await page.locator(`[data-testid="chat-row"][data-chat-id="${chatId}"]`).click();
  await expect(page.getByTestId("conversation")).toBeVisible();
}

test("mosaic layouts 1 · 2 · 3 · 4 · 5 · 7 (+N): no empty cells, no frames, one radius; a tap opens the viewer", async ({ page, browser }) => {
  const { other, chat } = await openChat(page, browser);
  const counts = [1, 2, 3, 4, 5, 7];
  for (const n of counts) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(await uploadImage(page, `p${n}-${i}.png`));
    expect((await api(page, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: `${n} фото`, fileIds: ids })).status).toBe(201);
  }
  await enterChat(page, chat.id);
  const expected: Record<number, { layout: string; tiles: number }> = {
    1: { layout: "one", tiles: 1 },
    2: { layout: "two", tiles: 2 },
    3: { layout: "three", tiles: 3 },
    4: { layout: "four", tiles: 4 },
    5: { layout: "five", tiles: 5 },
    7: { layout: "six", tiles: 6 },
  };
  for (const n of counts) {
    const msg = page.getByTestId("message").filter({ hasText: `${n} фото` });
    const mosaic = msg.getByTestId("media-mosaic");
    await mosaic.scrollIntoViewIfNeeded();
    await expect(mosaic).toHaveAttribute("data-layout", expected[n]!.layout);
    await expect(mosaic.getByTestId("mosaic-tile")).toHaveCount(expected[n]!.tiles);
    // No frame on the tiles; the gaps are thin; every cell is filled (the tiles cover the mosaic).
    const geo = await mosaic.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const tiles = [...el.querySelectorAll<HTMLElement>('[data-testid="mosaic-tile"]')].map((t) => t.getBoundingClientRect());
      const area = tiles.reduce((a, r) => a + r.width * r.height, 0);
      const borders = [...el.querySelectorAll<HTMLElement>('[data-testid="mosaic-tile"]')].map((t) => getComputedStyle(t).borderTopWidth);
      return { cover: area / (box.width * box.height), borders, radius: getComputedStyle(el).borderTopLeftRadius };
    });
    expect(geo.cover, `${n}`).toBeGreaterThan(0.93);
    expect(geo.borders.every((b) => b === "0px")).toBe(true);
    expect(geo.radius).toBe("18px");
  }
  // 7: the sixth cell says "+2".
  await expect(page.getByTestId("message").filter({ hasText: "7 фото" }).getByTestId("mosaic-more")).toHaveText("+2");
  await shot(page, "mosaic");
  // A tap opens the viewer on that picture.
  await page.getByTestId("message").filter({ hasText: "4 фото" }).getByTestId("mosaic-tile").nth(2).locator("button").first().click();
  await expect(page.getByTestId("vibex-lightbox")).toHaveAttribute("data-index", "2");
  await page.keyboard.press("Escape");
  await other.context().close();
});

test("upload: a preview at once, progress, «Загрузка», X cancels (nothing left on the server), the mosaic closes the gap; the composer keeps working", async ({ page, browser }) => {
  const { other, chat } = await openChat(page, browser);
  await enterChat(page, chat.id);
  // Hold the uploads on the way, so they can be seen and cancelled.
  const answered: string[] = [];
  await page.route("**/api/vibex/files?purpose=message", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await route.fetch().catch(() => null);
    if (!res) return;
    const body = await res.json().catch(() => null);
    if (body?.id) answered.push(body.id);
    await route.fulfill({ response: res, json: body });
  });
  const files = [0, 1, 2].map((i) => ({ name: `кадр-${i}.png`, mimeType: "image/png", buffer: Buffer.from(PNG, "base64") }));
  await page.getByTestId("chat-file").setInputFiles(files);
  const mosaic = page.getByTestId("composer-mosaic");
  await expect(mosaic).toHaveAttribute("data-layout", "three");
  await expect(mosaic.locator('[data-testid="mosaic-tile"][data-uploading="true"]')).toHaveCount(3);
  await expect(mosaic.getByTestId("mosaic-progress").first()).toContainText("Загрузка");
  await expect(page.getByTestId("chat-send")).toBeDisabled();
  await shot(page, "upload-progress");
  // Cancel the middle one: the mosaic is two side by side, no hole.
  await mosaic.getByTestId("mosaic-cancel").nth(1).click();
  await expect(mosaic).toHaveAttribute("data-layout", "two");
  await expect(mosaic.getByTestId("mosaic-tile")).toHaveCount(2);
  // The others finish; the composer still works; the message has two pictures.
  await expect(mosaic.locator('[data-testid="mosaic-tile"][data-uploading="true"]')).toHaveCount(0, { timeout: 15_000 });
  await page.getByTestId("chat-input").fill("Два кадра");
  await expect(page.getByTestId("chat-send")).toBeEnabled();
  await page.getByTestId("chat-send").click();
  const sent = page.getByTestId("message").filter({ hasText: "Два кадра" });
  await expect(sent.getByTestId("media-mosaic")).toHaveAttribute("data-layout", "two");
  // Nothing of the cancelled one stays: every file the server answered with is either in the message or gone.
  const msg = (await api(page, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items.find((m: { text: string }) => m.text === "Два кадра");
  const kept = new Set((msg.files as { id: string }[]).map((f) => f.id));
  for (const id of answered.filter((x) => !kept.has(x))) {
    await expect.poll(async () => (await api(page, "GET", `/api/vibex/files/${id}`)).status).toBe(404);
  }
  await page.unroute("**/api/vibex/files?purpose=message");
  await other.context().close();
});

async function sendCircle(page: Page) {
  const btn = page.getByTestId("chat-record");
  if ((await btn.getAttribute("data-mode")) !== "circle") await btn.click({ button: "right" });
  await expect(btn).toHaveAttribute("data-mode", "circle");
  await btn.click();
  await expect(page.getByTestId("circle-recorder")).toHaveAttribute("data-state", "locked");
  await page.waitForTimeout(2500);
  await btn.click();
  await expect(page.getByTestId("circle-message")).toHaveCount(1);
}

test("video circle: thin grey seek ring inside the circle, a knob while dragging; it opens and closes in place", async ({ page, browser }) => {
  const { other, chat } = await openChat(page, browser);
  await enterChat(page, chat.id);
  await sendCircle(page);
  const circle = page.getByTestId("circle-message");
  const small = (await circle.boundingBox())!;
  await circle.click();
  const expanded = page.getByTestId("circle-expanded");
  await expect(expanded).toHaveAttribute("data-playing", "true");
  await page.waitForTimeout(600);
  const face = (await page.getByTestId("circle-face").boundingBox())!;
  // In place: the opened circle grows around where the small one was (horizontally on the same side).
  expect(Math.abs(face.x + face.width - (small.x + small.width))).toBeLessThan(face.width);
  // The ring is grey and thin, inside the circle's edge.
  const ring = await page.getByTestId("circle-ring-progress").evaluate((c) => ({ stroke: c.getAttribute("stroke"), width: c.getAttribute("stroke-width"), r: Number(c.getAttribute("r")) }));
  expect(ring.stroke).not.toContain("8b7bff");
  expect(Number(ring.width)).toBeLessThanOrEqual(3);
  expect(ring.r).toBeLessThan(face.width / 2);
  // Knob: hidden, shown while dragging the ring, hidden after.
  const knob = page.getByTestId("circle-knob");
  await expect(knob).not.toHaveAttribute("data-visible", "true");
  const box = (await page.getByTestId("circle-ring").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + ring.r, cy);
  await page.mouse.down();
  await expect(knob).toHaveAttribute("data-visible", "true");
  await page.mouse.move(cx, cy + ring.r, { steps: 6 });
  await shot(page, "circle-seek");
  await page.mouse.up();
  await expect(knob).not.toHaveAttribute("data-visible", "true");
  const big = page.getByTestId("circle-expanded-video");
  await expect.poll(() => big.evaluate((v: HTMLVideoElement) => v.currentTime / v.duration)).toBeGreaterThan(0.3);
  // X closes in place: the small circle is back where it was.
  await page.getByTestId("circle-collapse").click();
  await expect(expanded).toHaveCount(0);
  await page.waitForTimeout(600);
  const back = (await circle.boundingBox())!;
  expect(Math.abs(back.width - small.width)).toBeLessThan(2);
  await other.context().close();
});

test("video circle: two fingers zoom the picture inside (the circle keeps its size, never below 1x, the page does not zoom)", async ({ page, browser }) => {
  test.skip(!isMobile(page), "pinch is a phone gesture");
  const { other, chat } = await openChat(page, browser);
  await enterChat(page, chat.id);
  await sendCircle(page);
  await page.getByTestId("circle-message").click();
  const face = page.getByTestId("circle-face");
  await expect(face).toBeVisible();
  await page.waitForTimeout(600);
  const before = (await face.boundingBox())!;
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const pts = (d: number) => [
    { x: cx - d, y: cy, id: 1 },
    { x: cx + d, y: cy, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(25) });
  for (let d = 30; d <= 60; d += 5) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => Number(await face.getAttribute("data-zoom"))).toBeGreaterThan(1.8);
  const after = (await face.boundingBox())!;
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  // Back in: never below 1x.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(70) });
  for (let d = 60; d >= 5; d -= 5) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => Number(await face.getAttribute("data-zoom"))).toBe(1);
  await other.context().close();
});
