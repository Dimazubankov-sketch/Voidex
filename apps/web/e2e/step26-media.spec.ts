import { expect, test, type Page } from "@playwright/test";
import { newPage, openApp, signUpViaApi } from "./helpers";

/**
 * Step 2.6 — Vibex voice messages and video circles under the production
 * Content-Security-Policy. The dev server sends no CSP, which is why Step
 * 2.5.1's tests passed while production refused to play: there the page's
 * policy had no media-src, so blob: audio / video fell back to default-src
 * 'self'. Here the page gets the API server's real policy (only script-src
 * is widened for the dev server's inline module preamble) and a real
 * recording is played from its blob.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

async function productionCsp(page: Page): Promise<string> {
  const res = await page.request.get(`${API}/api/health`);
  const csp = res.headers()["content-security-policy"];
  expect(csp, "the server sends a Content-Security-Policy").toBeTruthy();
  return csp!;
}

/** Serve the app page with the server's policy and record every violation. */
async function enforce(page: Page) {
  const csp = (await productionCsp(page))
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !d.startsWith("upgrade-insecure-requests"))
    // Dev only: Vite's inline React refresh preamble. Production has no inline script.
    .map((d) => (d.startsWith("script-src") ? `${d} 'unsafe-inline'` : d))
    .join("; ");
  await page.route(
    (url) => url.pathname === "/" || url.pathname === "/index.html",
    async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), "content-security-policy": csp } });
    },
  );
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.effectiveDirective} ${e.blockedURI}${e.blockedURI === "eval" ? ` @${e.sourceFile}:${e.lineNumber}` : ""}`));
  });
}

const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

async function api(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const res = await fetch(url, { method, headers: { "X-Voidex-Client": "web", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
}

test("Vibex media under the production CSP: a recorded voice message and a video circle play from their blobs (sender and recipient)", async ({ page, browser }) => {
  await enforce(page);
  await signUpViaApi(page, "Голос", "Прод");
  // The policy really is in force on this page.
  expect(await page.evaluate(() => typeof (window as unknown as { __csp?: unknown }).__csp)).toBe("object");

  const other = await newPage(browser, false);
  await enforce(other);
  const b = await signUpViaApi(other, "Слушатель", "Прод");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  expect((await api(other, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Пришли голосовое" })).status).toBe(201);

  await openApp(page, "vibex");
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").click();
  await page.getByTestId("chat-row").first().click();

  // A real recording from the (fake) microphone, uploaded, read back as a blob.
  await page.getByTestId("chat-voice").click();
  await expect(page.getByTestId("voice-recording")).toBeVisible();
  await page.waitForTimeout(2400);
  await page.getByTestId("voice-send").click();
  const voice = page.getByTestId("voice-message");
  await expect(voice).toHaveCount(1);
  const audio = voice.locator("audio");
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.src.startsWith("blob:"))).toBe(true);
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => (Number.isFinite(a.duration) ? a.duration : -1)), { timeout: 10_000 }).toBeGreaterThan(0.8);
  await voice.getByTestId("voice-play").click();
  await expect(voice).toHaveAttribute("data-playing", "true");
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.2);
  await voice.getByTestId("voice-play").click();

  // A video circle from the (fake) camera.
  await page.getByTestId("chat-circle").click();
  await expect(page.getByTestId("circle-recorder")).toBeVisible();
  await page.waitForTimeout(1800);
  await page.getByTestId("circle-send").click();
  const circle = page.getByTestId("circle-message");
  await expect(circle).toHaveCount(1);
  const video = circle.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.src.startsWith("blob:"))).toBe(true);
  await circle.click();
  await expect(circle).toHaveAttribute("data-playing", "true");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);

  // The recipient gets both and can play them too.
  await openApp(other, "vibex");
  await other.getByTestId("vibex-nav-chats").click();
  await other.getByTestId("chat-row").first().click();
  const theirVoice = other.getByTestId("voice-message");
  await expect(theirVoice).toHaveCount(1);
  const theirAudio = theirVoice.locator("audio");
  await expect.poll(() => theirAudio.evaluate((a: HTMLAudioElement) => (Number.isFinite(a.duration) ? a.duration : -1)), { timeout: 10_000 }).toBeGreaterThan(0.8);
  await theirVoice.getByTestId("voice-play").click();
  await expect.poll(() => theirAudio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.2);
  const theirCircle = other.getByTestId("circle-message");
  await theirCircle.click();
  await expect.poll(() => theirCircle.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);

  // Nothing was blocked by the policy (media, the waveform's blob read, anything else).
  expect(await violations(page)).toEqual([]);
  expect(await violations(other)).toEqual([]);
  await other.context().close();
});
