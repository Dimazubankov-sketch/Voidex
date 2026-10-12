import { expect, test, type Page } from "@playwright/test";
import { apiAs as api, newPage, openApp, signUpViaApi } from "./helpers";

/**
 * Step 2.10 — video circles: the camera-style mode icon; recording keeps the
 * composer (with «Отмена» in its middle); pause / go on (the time counts only
 * what is recorded); switching the camera keeps one continuous recording;
 * the camera's zoom (never below 1x, hidden without one); the circle opens in
 * place (no full-screen layer), X on the right, a tap plays / pauses, it
 * closes at the end.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 700;

/** Two cameras, and (optionally) a camera zoom of 0.5x–3x, as some phones report. */
async function fakeDevices(page: Page, opts: { zoom?: boolean } = {}) {
  await page.addInitScript(
    ({ zoom }) => {
      const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = async () => {
        const list = await enumerate();
        const cam = list.find((d) => d.kind === "videoinput");
        return cam ? [...list, { deviceId: "rear", groupId: "rear", kind: "videoinput", label: "rear", toJSON: () => ({}) } as MediaDeviceInfo] : list;
      };
      const w = window as unknown as { __zoom: number[]; __tracks: MediaStreamTrack[] };
      w.__zoom = [];
      w.__tracks = [];
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => {
        const s = await gum(c);
        w.__tracks.push(...s.getTracks());
        return s;
      };
      if (zoom) {
        const caps = MediaStreamTrack.prototype.getCapabilities;
        MediaStreamTrack.prototype.getCapabilities = function (this: MediaStreamTrack) {
          const base = caps ? caps.call(this) : {};
          return this.kind === "video" ? { ...base, zoom: { min: 0.5, max: 3, step: 0.1 } } : base;
        } as typeof caps;
        MediaStreamTrack.prototype.applyConstraints = async function (c?: MediaTrackConstraints) {
          const z = (c?.advanced?.[0] as { zoom?: number } | undefined)?.zoom;
          if (typeof z === "number") w.__zoom.push(z);
        };
      }
    },
    { zoom: !!opts.zoom },
  );
}

async function openChat(page: Page, browser: import("@playwright/test").Browser) {
  await signUpViaApi(page, "Кружок", "Снимающий");
  const other = await newPage(browser, isMobile(page));
  const b = await signUpViaApi(other, "Зритель", "Кругов");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  await api(other, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Жду кружок" });
  if (isMobile(page)) await openApp(page, "vibex");
  else {
    await page.getByTestId("dock-app-vibex").click();
    await expect(page.locator('[data-testid="window-vibex"][data-state="open"]')).toBeVisible();
  }
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").last().click();
  await page.locator(`[data-testid="chat-row"][data-chat-id="${chat.id}"]`).click();
  await expect(page.getByTestId("conversation")).toBeVisible();
  await page.waitForTimeout(500);
  return { other, chat };
}

async function startLockedCircle(page: Page) {
  const btn = page.getByTestId("chat-record");
  if ((await btn.getAttribute("data-mode")) !== "circle") await btn.click({ button: "right" });
  await expect(btn).toHaveAttribute("data-mode", "circle");
  await expect(btn.getByTestId("video-message-glyph")).toBeVisible();
  await btn.click();
  await expect(page.getByTestId("circle-recorder")).toHaveAttribute("data-state", "locked");
  return btn;
}

const secs = (s: string) => {
  const [m, ss] = s.trim().split(" ")[0]!.split(":").map(Number);
  return m! * 60 + ss!;
};

test("recording: the composer stays with «Отмена» in its middle; pause stops the time; one continuous recording across a camera switch", async ({ page, browser }) => {
  await fakeDevices(page);
  const { other, chat } = await openChat(page, browser);
  const btn = await startLockedCircle(page);
  const startedAt = Date.now();
  const rec = page.getByTestId("circle-recorder");
  // The camera covers the chat only above the composer; the composer shows «Отмена» in its middle.
  const row = (await page.getByTestId("composer-row").boundingBox())!;
  const area = (await rec.boundingBox())!;
  expect(area.y + area.height).toBeLessThanOrEqual(row.y + 1);
  const cancel = (await page.getByTestId("circle-cancel").boundingBox())!;
  expect(Math.abs(cancel.x + cancel.width / 2 - (row.x + row.width / 2))).toBeLessThan(24);
  await expect(btn).toBeVisible();

  // Pause: the time stands still, then goes on from there.
  await page.waitForTimeout(1300);
  const pausedAt = Date.now();
  await page.getByTestId("circle-pause").click();
  await expect(rec).toHaveAttribute("data-paused", "true");
  const atPause = secs(await page.getByTestId("voice-elapsed").innerText());
  await page.waitForTimeout(2200);
  expect(secs(await page.getByTestId("voice-elapsed").innerText())).toBe(atPause);
  await page.getByTestId("circle-resume").click();
  const pausedFor = Date.now() - pausedAt;
  await expect(rec).not.toHaveAttribute("data-paused", "true");

  // Switch camera: the same recording goes on (the time is not reset).
  await page.waitForTimeout(800);
  const before = secs(await page.getByTestId("voice-elapsed").innerText());
  expect(before).toBeGreaterThanOrEqual(1);
  await page.getByTestId("circle-flip").click();
  await expect(rec).toHaveAttribute("data-facing", "environment");
  await page.waitForTimeout(1200);
  expect(secs(await page.getByTestId("voice-elapsed").innerText())).toBeGreaterThan(before);
  await expect(rec).toHaveAttribute("data-state", "locked");
  // No zoom on this camera: no control.
  await expect(page.getByTestId("circle-zoom")).toHaveCount(0);

  // Send: one circle; its length leaves the pause out (wall time minus the pause, give or take the clicks).
  const wall = Date.now() - startedAt;
  await btn.click();
  await expect(page.getByTestId("circle-message")).toHaveCount(1);
  const sent = (await api(page, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items[0];
  expect(sent.kind).toBe("circle");
  expect(sent.durationMs).toBeGreaterThan(2500);
  // The 2.2 s wait while paused is never counted (the measured pause also holds click round trips, so it is
  // only an upper bound of the paused time; the recorded time is the wall time minus at least that wait).
  expect(pausedFor).toBeGreaterThanOrEqual(2200);
  expect(sent.durationMs).toBeLessThan(wall + 1500 - 2200);
  // Every camera and the microphone are released.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every((t) => t.readyState === "ended"))).toBe(true);
  await other.context().close();
});

test("cancel from the composer sends nothing and releases the camera; zoom never goes below 1x", async ({ page, browser }) => {
  await fakeDevices(page, { zoom: true });
  const { other, chat } = await openChat(page, browser);
  await startLockedCircle(page);
  const zoom = page.getByTestId("circle-zoom");
  await expect(zoom).toBeVisible();
  // The camera reports 0.5x–3x: the control starts at 1x and never goes lower.
  await expect(zoom).toHaveAttribute("min", "1");
  await expect(zoom).toHaveAttribute("max", "3");
  await zoom.fill("2");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __zoom: number[] }).__zoom.at(-1))).toBe(2);
  await page.getByTestId("circle-cancel").click();
  await expect(page.getByTestId("circle-recorder")).toHaveCount(0);
  await expect(page.getByTestId("chat-record")).toHaveAttribute("data-state", "idle");
  await page.waitForTimeout(600);
  await expect(page.getByTestId("circle-message")).toHaveCount(0);
  expect((await api(page, "GET", `/api/vibex/chats/${chat.id}/messages`)).body.items).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every((t) => t.readyState === "ended"))).toBe(true);
  await other.context().close();
});

test("player: opens in place (chat visible, no full-screen layer), X on the right, tap plays / pauses, closes at the end", async ({ page, browser }) => {
  const { other } = await openChat(page, browser);
  const btn = await startLockedCircle(page);
  await page.waitForTimeout(2000);
  await btn.click();
  const circle = page.getByTestId("circle-message");
  await expect(circle).toHaveCount(1);
  await circle.click();
  const expanded = page.getByTestId("circle-expanded");
  await expect(expanded).toHaveAttribute("data-playing", "true");
  // In the message list, not over the screen: the chat header and the composer stay visible.
  expect(await expanded.evaluate((el) => !!el.closest('[data-testid="messages"]'))).toBe(true);
  await expect(page.getByTestId("chat-input")).toBeVisible();
  await expect(page.locator('[role="dialog"][data-testid="circle-expanded"]')).toHaveCount(0);
  // X on the right side of the ring; no separate pause button.
  const box = (await expanded.boundingBox())!;
  const x = (await page.getByTestId("circle-collapse").boundingBox())!;
  expect(x.x + x.width / 2).toBeGreaterThan(box.x + box.width / 2);
  await expect(page.getByTestId("circle-toggle")).toHaveCount(0);
  // Tap: pause / play.
  const big = page.getByTestId("circle-expanded-video");
  await big.click();
  await expect(expanded).not.toHaveAttribute("data-playing", "true");
  await big.click();
  await expect(expanded).toHaveAttribute("data-playing", "true");
  // At the end it closes by itself.
  await big.evaluate((v: HTMLVideoElement) => {
    v.currentTime = Math.max(0, v.duration - 0.2);
  });
  await expect(expanded).toHaveCount(0, { timeout: 6000 });
  await expect(circle).toBeVisible();
  await other.context().close();
});
