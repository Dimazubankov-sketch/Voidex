import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs, newPage, openApp, signUpViaApi } from "./helpers";

/**
 * Step 2.11: stories. A tap pauses / plays (it never closes; only X does);
 * deleting my story asks above the viewer (Cancel goes back to it, Delete
 * really deletes); my story shows views and reactions with the viewers;
 * someone else's story has «Ответить...» (a direct message with the story)
 * and quick reactions (one per person, replaceable). Rings on avatars in the
 * chat list and the profile for unseen stories only.
 */

const SHOTS = process.env.STEP211_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${isMobile(page) ? "phone" : "pc"}.png` });
}
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function postStory(page: Page): Promise<string> {
  const id = await page.evaluate(async (b64) => {
    const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
    const { accessToken } = await r.json();
    const auth = { "X-Voidex-Client": "web", Authorization: `Bearer ${accessToken}` };
    const f = await fetch("/api/vibex/files?purpose=story", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/octet-stream", "X-File-Name": "s.png" },
      body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    }).then((x) => x.json());
    const s = await fetch("/api/vibex/stories", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ fileId: f.id }) }).then((x) => x.json());
    return s.id as string;
  }, PNG);
  return id;
}

async function launchVibex(page: Page) {
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
}
async function toChats(page: Page) {
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
  await expect(page.getByTestId("chats-pane")).toBeVisible();
}
async function openStrip(page: Page) {
  await page.getByTestId("stories-stack").click();
  await expect(page.getByTestId("stories-strip")).toBeVisible();
}
async function tapStage(page: Page, at = 0.5) {
  const box = (await page.getByTestId("story-stage").boundingBox())!;
  await page.mouse.click(box.x + box.width * at, box.y + box.height / 2);
}

/** A (the page) and B, with a direct chat; B follows A. */
async function pair(page: Page, browser: Browser) {
  const a = await signUpViaApi(page, "Алла", "Историева");
  const bp = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(bp, "Борис", "Зритель");
  await apiAs(page, "POST", "/api/vibex/chats/direct", { userId: b.id });
  await apiAs(bp, "POST", `/api/vibex/people/${a.id}/follow`);
  return { a, b, bp };
}

test("a tap pauses and plays the story (it does not close); only X closes", async ({ page, browser }) => {
  const { bp } = await pair(page, browser);
  await postStory(bp);
  await launchVibex(page);
  await toChats(page);
  await openStrip(page);
  await page.getByTestId("story-person").first().locator("button").first().click();
  const viewer = page.getByTestId("story-viewer");
  await expect(viewer.getByTestId("story-image")).toBeVisible();
  // No pause button.
  await expect(viewer.getByTestId("story-pause")).toHaveCount(0);
  await tapStage(page);
  await expect(viewer).toHaveAttribute("data-paused", "true");
  await expect(viewer.getByTestId("story-paused")).toBeVisible();
  // Paused: the photo's timer stands still (5 s would have closed the viewer).
  await page.waitForTimeout(5600);
  await expect(viewer).toBeVisible();
  await tapStage(page);
  await expect(viewer).not.toHaveAttribute("data-paused", "true");
  await expect(viewer).toBeVisible();
  // Tap again (pause), then X closes.
  await tapStage(page);
  await page.getByTestId("story-close").click();
  await expect(viewer).toHaveCount(0);
  await bp.context().close();
});

test("deleting my story: the confirmation is above the viewer; Cancel returns to it; Delete removes it and its ring", async ({ page, browser }) => {
  const { bp } = await pair(page, browser);
  await postStory(page);
  await launchVibex(page);
  await toChats(page);
  await openStrip(page);
  await page.getByTestId("story-mine").locator("button").first().click();
  const viewer = page.getByTestId("story-viewer");
  await expect(viewer.getByTestId("story-image")).toBeVisible();
  await viewer.getByTestId("story-delete").click();
  const confirm = page.getByTestId("story-delete-confirm");
  await expect(confirm).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "story-delete-confirm");
  // It is on top: the topmost element in the middle of the dialog belongs to it, not to the viewer.
  // (Polled: on phones the sheet slides up first.)
  await expect
    .poll(async () => {
      const box = (await confirm.getByTestId("confirm-action").boundingBox())!;
      return page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('[data-testid="story-delete-confirm"]'), [box.x + box.width / 2, box.y + box.height / 2]);
    })
    .toBe(true);
  // Cancel: back to the story, still there and paused while the dialog was open.
  await confirm.getByRole("button", { name: "Отмена" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(viewer).toBeVisible();
  // Delete: gone on the server, the viewer closes (it was the last one), no ring on «Моя история».
  await viewer.getByTestId("story-delete").click();
  await page.getByTestId("story-delete-confirm").getByTestId("confirm-action").click();
  await expect(viewer).toHaveCount(0);
  await expect.poll(async () => (await apiAs(page, "GET", "/api/vibex/stories")).body.find((g: { mine: boolean }) => g.mine) ?? null).toBeNull();
  await expect(page.getByTestId("story-mine").locator("button").first()).not.toHaveAttribute("data-unseen", "true");
  await bp.context().close();
});

test("someone else's story: a reaction (replaceable) and a reply (a direct message with the story); the author sees views and reactions", async ({ page, browser }) => {
  const { a, b, bp } = await pair(page, browser);
  const storyId = await postStory(bp);
  await launchVibex(page);
  await toChats(page);
  await openStrip(page);
  await page.getByTestId("story-person").first().locator("button").first().click();
  const viewer = page.getByTestId("story-viewer");
  await expect(viewer.getByTestId("story-image")).toBeVisible();
  // The heart reacts with ❤️; the field offers the other reactions; a new one replaces it.
  await viewer.getByTestId("story-like").click();
  await expect(viewer.getByTestId("story-like")).toHaveAttribute("data-reacted", "❤️");
  await viewer.getByTestId("story-reply").click();
  await expect(viewer).toHaveAttribute("data-paused", "true");
  await shot(page, "story-reply-reactions");
  await viewer.locator('[data-testid="story-reaction"][data-reaction="🔥"]').click();
  await expect.poll(async () => (await apiAs(bp, "GET", `/api/vibex/stories/${storyId}/viewers`)).body.map((v: { reaction: string | null }) => v.reaction)).toEqual(["🔥"]);
  // Reply.
  await viewer.getByTestId("story-reply").fill("Классная история");
  await viewer.getByTestId("story-reply-send").click();
  await expect(viewer.getByTestId("story-reply")).toHaveValue("");
  const chats = (await apiAs(bp, "GET", "/api/vibex/chats")).body as { id: string; peer: { id: string } | null }[];
  const chat = chats.find((c) => c.peer?.id === a.id)!;
  await expect
    .poll(async () => (await apiAs(bp, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items.find((m: { text: string }) => m.text === "Классная история")?.story?.id)
    .toBe(storyId);
  await page.getByTestId("story-close").click();

  // The author: views and reactions, the viewer with 🔥 on the avatar.
  const bvx = bp;
  await launchVibex(bvx);
  await toChats(bvx);
  await openStrip(bvx);
  await bvx.getByTestId("story-mine").locator("button").first().click();
  const own = bvx.getByTestId("story-viewer");
  await expect(own.getByTestId("story-views-count")).toHaveText("1");
  await expect(own.getByTestId("story-reactions-count")).toHaveText("1");
  await own.getByTestId("story-views").click();
  const sheet = bvx.getByTestId("story-viewers");
  await expect(sheet.getByTestId("story-viewer-row")).toHaveCount(1);
  await expect(sheet.getByTestId("story-viewer-row")).toHaveAttribute("data-reaction", "🔥");
  await expect(sheet).toContainText("Алла Историева");
  await shot(bvx, "story-viewers");
  // The reply is in the chat with the story.
  await bvx.keyboard.press("Escape");
  await own.getByTestId("story-close").click();
  void b;
  await bp.context().close();
});

test("story rings: on the chat list avatar while unseen, gone once seen", async ({ page, browser }) => {
  const { a, bp } = await pair(page, browser);
  // A chat with a message (empty chats are not listed).
  const chat = (await apiAs(bp, "POST", "/api/vibex/chats/direct", { userId: a.id })).body as { id: string };
  await apiAs(bp, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "привет" });
  await postStory(bp);
  await launchVibex(page);
  await toChats(page);
  const row = page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`);
  await expect(row.locator('[data-story-ring="unseen"]')).toBeVisible();
  await shot(page, "chat-story-ring");
  await openStrip(page);
  await page.getByTestId("story-person").first().locator("button").first().click();
  await expect(page.getByTestId("story-image")).toBeVisible();
  await page.getByTestId("story-close").click();
  await expect(row.locator('[data-story-ring="unseen"]')).toHaveCount(0);
  await bp.context().close();
});
