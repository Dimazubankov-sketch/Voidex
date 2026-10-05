import { expect, test, type Page } from "@playwright/test";
import { normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { newPage, openApp, signUpViaApi } from "./helpers";

/**
 * Step 2.5.1 — stabilization: one Wallpapers screen (stable on PC), the
 * bounded PC desktop, deleting desktops, Vibex voice / circle playback,
 * the dock search field.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

/** API call as the signed-in page (a fresh access token from the refresh cookie). */
async function api(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const res = await fetch(url, {
        method,
        headers: { "X-Voidex-Client": "web", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
}

// ------------------------------------------------------------------ Vibex media

test("Vibex: a recorded voice message plays, pauses, seeks and shows its duration; a video circle plays, pauses and replays", async ({ page, browser }) => {
  await signUpViaApi(page, "Голос", "Играет");
  const other = await newPage(browser, false);
  const b = await signUpViaApi(other, "Слушает", "Круги");
  const chat = (await api(page, "POST", "/api/vibex/chats/direct", { userId: b.id })).body;
  expect((await api(other, "POST", `/api/vibex/chats/${chat.id}/messages`, { text: "Запиши голосовое" })).status).toBe(201);
  await openApp(page, "vibex");
  await page.getByTestId(isMobile(page) ? "vibex-tab-chats" : "vibex-nav-chats").click();
  await page.getByTestId("chat-row").first().click();

  // Record ~2.5 s from the (fake) microphone and send.
  await page.getByTestId("chat-voice").click();
  await expect(page.getByTestId("voice-recording")).toBeVisible();
  await page.waitForTimeout(2600);
  await page.getByTestId("voice-send").click();
  const voice = page.getByTestId("voice-message");
  await expect(voice).toHaveCount(1);
  await expect(voice.getByTestId("voice-play")).toBeEnabled();
  await expect(voice.getByTestId("voice-duration")).toHaveText(/^0:0[1-3]$/);
  const audio = voice.locator("audio");
  // The real recording is loaded as a blob and has a usable (finite) length.
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => (Number.isFinite(a.duration) ? Math.round(a.duration) : -1)), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

  // Play → time moves, the button says pause.
  await voice.getByTestId("voice-play").click();
  await expect(voice).toHaveAttribute("data-playing", "true");
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.2);
  // Pause → time stops.
  await voice.getByTestId("voice-play").click();
  await expect(voice).not.toHaveAttribute("data-playing", "true");
  const stopped = await audio.evaluate((a: HTMLAudioElement) => a.currentTime);
  await page.waitForTimeout(400);
  expect(await audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeCloseTo(stopped, 1);
  // Seek: a tap on the waveform at ~75 % moves playback there.
  const wave = (await voice.getByTestId("voice-wave").boundingBox())!;
  await page.mouse.click(wave.x + wave.width * 0.75, wave.y + wave.height / 2);
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime / a.duration)).toBeGreaterThan(0.6);
  await expect(voice.getByTestId("voice-wave")).not.toHaveAttribute("aria-valuenow", "0");

  // A video circle from the (fake) camera.
  await page.getByTestId("chat-circle").click();
  await expect(page.getByTestId("circle-recorder")).toBeVisible();
  await page.waitForTimeout(2600);
  await page.getByTestId("circle-send").click();
  const circle = page.getByTestId("circle-message");
  await expect(circle).toHaveCount(1);
  const video = circle.locator("video");
  await expect(video).toHaveAttribute("playsinline", "");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : -1)), { timeout: 10_000 }).toBeGreaterThan(0.5);
  // The bubble stays a circle.
  const box = (await circle.boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);
  expect(await video.evaluate((v) => parseFloat(getComputedStyle(v).borderRadius) >= v.clientWidth / 2)).toBe(true);

  // Tap: plays with sound; the voice message (if playing) stops — one at a time.
  await voice.getByTestId("voice-play").click();
  await expect(voice).toHaveAttribute("data-playing", "true");
  await circle.click();
  await expect(circle).toHaveAttribute("data-playing", "true");
  await expect(voice).not.toHaveAttribute("data-playing", "true");
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
  // Tap again: pause.
  await circle.click();
  await expect(circle).not.toHaveAttribute("data-playing", "true");
  // Let it end, then a tap replays from the start.
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = Math.max(0, v.duration - 0.2);
    return v.play();
  });
  await expect(circle).toHaveAttribute("data-ended", "true", { timeout: 5000 });
  await circle.click();
  await expect(circle).toHaveAttribute("data-playing", "true");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(1.5);
  await other.context().close();
});

// ------------------------------------------------------------------ helpers

/** The account's stored layout (raw; null until the desktop was first customised). */
async function storedLayout(page: Page): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (await api(page, "GET", "/api/preferences")).body.workspace.layout ?? null;
}

/** The layout as the app sees it (the default one until the desktop was first customised). */
async function layoutFor(page: Page): Promise<WorkspaceLayout> {
  return normalizeLayout(await storedLayout(page), ["settings", "mail", "vibex", "calculator", "notes"]);
}

async function saveLayout(page: Page, layout: WorkspaceLayout) {
  expect((await api(page, "PATCH", "/api/preferences", { workspace: { layout } })).status).toBe(200);
}

async function reloadUnlocked(page: Page) {
  await page.reload();
  await page.getByTestId("lock-screen").waitFor();
  await page.waitForTimeout(300);
  await page.keyboard.type("135790");
  await expect(page.getByTestId("lock-screen")).toHaveCount(0);
}

async function openSettingsSection(page: Page, id: string) {
  await openApp(page, "settings");
  await page.getByTestId(isMobile(page) ? `settings-nav-${id}` : `settings-home-${id}`).click();
}

/** Bounding boxes (rounded) of the parts of the Wallpapers screen that must never move sideways. */
async function wallpaperBoxes(page: Page) {
  return page.evaluate(() => {
    const ids = ["wallpapers-tab-lock", "wallpapers-tab-home", "wallpapers-carousel", "wallpapers-apply", "wallpapers-add", "wallpapers-sync", "wallpapers-dots"];
    const out: Record<string, number[]> = {};
    for (const id of ids) {
      const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
      out[id] = [Math.round(r.x), Math.round(r.width)];
    }
    const strip = document.querySelector('[data-testid="wallpapers-carousel"]')!.getBoundingClientRect();
    const cur = document.querySelector('[data-testid="wallpapers-carousel"] [aria-current="true"]')!.getBoundingClientRect();
    out.centre = [Math.round(cur.x + cur.width / 2 - (strip.x + strip.width / 2))];
    return out;
  });
}

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// ------------------------------------------------------------------ wallpapers

test("Wallpapers: one screen with Lock / Home tabs, carousel, Apply, Add your own and sync; no Filters, no other pickers", async ({ page }) => {
  await signUpViaApi(page, "Обои", "Одни");
  await openSettingsSection(page, "wallpapers");
  const screen = page.getByTestId("settings-wallpapers");
  await expect(screen).toBeVisible();
  await expect(screen).toContainText("Экран блокировки и главный экран");
  await expect(page.getByTestId("wallpapers-filters-toggle")).toHaveCount(0);
  await expect(page.getByTestId("wallpapers-filters")).toHaveCount(0);
  await expect(page.getByTestId("wallpaper-presets")).toHaveCount(0);
  await expect(page.getByTestId("wallpapers-tab-home")).toHaveText(isMobile(page) ? "Главный экран" : "Рабочий стол");

  // Home tab: icons + dock preview; choose a wallpaper by tapping its card, then Apply.
  await page.getByTestId("wallpapers-tab-home").click();
  await expect(screen).toHaveAttribute("data-tab", "home");
  await expect(page.getByTestId("wallpapers-preview-dock").first()).toBeVisible();
  await expect(page.getByTestId("wallpapers-apply")).toBeDisabled(); // the wallpaper in use
  await page.getByTestId("wallpapers-option-wave-gray").click();
  await expect(page.getByTestId("wallpapers-option-wave-gray")).toHaveAttribute("aria-current", "true");
  await page.getByTestId("wallpapers-apply").click();
  await expect(page.getByTestId("wallpapers-apply")).toBeDisabled();
  await expect.poll(async () => (await storedLayout(page))?.appearance?.wallpaper).toEqual({ kind: "preset", id: "wave-gray" });

  // Lock tab: its own wallpaper.
  await page.getByTestId("wallpapers-tab-lock").click();
  await expect(screen).toHaveAttribute("data-tab", "lock");
  await page.getByTestId("wallpapers-option-mist").click();
  await page.getByTestId("wallpapers-apply").click();
  await expect.poll(async () => (await storedLayout(page))?.appearance?.lockWallpaper).toEqual({ kind: "preset", id: "mist" });

  // Add your own: the picture becomes the lock wallpaper and shows in the carousel.
  await page.getByTestId("wallpapers-file").setInputFiles({ name: "mine.png", mimeType: "image/png", buffer: PNG_1x1 });
  await expect(page.getByTestId("wallpapers-option-image")).toBeVisible();
  await expect.poll(async () => (await storedLayout(page))?.appearance?.lockWallpaper?.kind).toBe("image");

  // Sync toggle.
  const sync = page.getByTestId("wallpapers-sync").getByRole("switch");
  await expect(sync).toHaveAttribute("aria-checked", "true");
  await sync.click();
  await expect(sync).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await storedLayout(page))?.appearance?.syncWallpapers).toBe(false);
  await sync.click();
  await expect(sync).toHaveAttribute("aria-checked", "true");
});

test("Settings links to the one Wallpapers screen: Lock screen → Lock tab, Desktop → Home tab; PC has a way back to Settings Home", async ({ page }) => {
  await signUpViaApi(page, "Ссылки", "Обоев");
  await openSettingsSection(page, "lock");
  await expect(page.getByTestId("lock-wallpaper-presets")).toHaveCount(0);
  await expect(page.getByTestId("preview-lock")).toHaveCount(0);
  await page.getByTestId("wallpaper-link-lock").click();
  await expect(page.getByTestId("settings-wallpapers").last()).toHaveAttribute("data-tab", "lock");
  if (isMobile(page)) {
    await page.getByTestId("settings-back").last().click();
    await page.getByTestId("settings-back").last().click();
    await page.getByTestId("settings-nav-desktop").click();
  } else {
    await page.getByTestId("settings-home-button").click();
    await expect(page.getByTestId("settings-home")).toBeVisible();
    await page.getByTestId("settings-home-desktop").click();
    await expect(page.getByTestId("settings-breadcrumb")).toHaveText("Рабочий стол");
  }
  await expect(page.getByTestId("appearance-panel")).toBeVisible();
  await expect(page.getByTestId("wallpaper-presets")).toHaveCount(0);
  await expect(page.getByTestId("pc-columns")).toHaveCount(0);
  await page.getByTestId("wallpaper-link-home").click();
  await expect(page.getByTestId("settings-wallpapers").last()).toHaveAttribute("data-tab", "home");
  if (!isMobile(page)) {
    await page.getByTestId("settings-home-button").click();
    await expect(page.getByTestId("settings-home")).toBeVisible();
    await expect(page.getByTestId("settings-breadcrumb")).toHaveCount(0);
  }
});

test("PC Wallpapers: nothing shifts sideways on tab switch, carousel navigation or a wallpaper change; the current card is centred", async ({ page }) => {
  test.skip(isMobile(page), "PC layout");
  await signUpViaApi(page, "Не", "Сдвигается");
  await openSettingsSection(page, "wallpapers");
  await expect(page.getByTestId("settings-wallpapers")).toBeVisible();
  await page.waitForTimeout(400);
  const base = await wallpaperBoxes(page);
  expect(Math.abs(base.centre![0]!)).toBeLessThanOrEqual(1);
  const same = async (label: string) => {
    await page.waitForTimeout(700); // smooth scrolling settles
    const now = await wallpaperBoxes(page);
    for (const k of Object.keys(base)) {
      if (k === "centre") expect(Math.abs(now.centre![0]!), `${label}: current card centred`).toBeLessThanOrEqual(1);
      else expect(now[k], `${label}: ${k}`).toEqual(base[k]);
    }
  };
  await page.getByTestId("wallpapers-tab-home").click();
  await same("home tab");
  await page.getByTestId("wallpapers-next").click();
  await same("next");
  await page.getByTestId("wallpapers-next").click();
  await same("next 2");
  await page.locator('[data-testid^="wallpapers-option-"]').last().click();
  await same("last card");
  await page.getByTestId("wallpapers-apply").click();
  await same("applied");
  await page.getByTestId("wallpapers-prev").click();
  await same("prev");
  await page.getByTestId("wallpapers-option-default").click();
  await same("first card");
  await page.getByTestId("wallpapers-tab-lock").click();
  await same("lock tab");
  // The Settings page itself did not scroll sideways.
  expect(await page.getByTestId("settings-content").evaluate((e) => e.scrollLeft)).toBe(0);
});

// ------------------------------------------------------------------ desktop grid

test("PC desktop: never scrolls, the grid fills the free area (more columns than rows), corners stay inside, positions stay valid after a resize", async ({ page }) => {
  test.skip(isMobile(page), "PC desktop");
  await signUpViaApi(page, "Сетка", "Края");
  const grid = page.getByTestId("desktop-grid");
  await expect(grid).toBeVisible();
  const geo = async () => ({ cols: Number(await grid.getAttribute("data-cols")), rows: Number(await grid.getAttribute("data-rows")) });
  let g = await geo();
  expect(g.cols).toBeGreaterThan(g.rows);

  // Apps stored far outside the screen (another, bigger monitor): they land in the nearest cells — the four corners.
  const base = await layoutFor(page);
  const cells = { "app:mail": { c: 0, r: 0 }, "app:settings": { c: 60, r: 0 }, "app:vibex": { c: 0, r: 200 }, "app:calculator": { c: 60, r: 200 } };
  await saveLayout(page, { ...base, desktop: { ...base.desktop, sort: "manual", view: "grid", cells } });
  await reloadUnlocked(page);
  await expect(grid).toBeVisible();
  g = await geo();
  const cellOf = (id: string) => page.locator(`[data-cell]:has([data-testid="app-${id}"])`).first().getAttribute("data-cell");
  await expect.poll(() => cellOf("mail")).toBe("0,0");
  await expect.poll(() => cellOf("settings")).toBe(`${g.cols - 1},0`);
  await expect.poll(() => cellOf("vibex")).toBe(`0,${g.rows - 1}`);
  await expect.poll(() => cellOf("calculator")).toBe(`${g.cols - 1},${g.rows - 1}`);

  const check = async () => {
    const r = await page.evaluate(() => {
      const area = document.querySelector('[data-testid="desktop-area"]') as HTMLElement;
      const doc = document.scrollingElement!;
      const bar = document.querySelector('[data-testid="system-bar"]')!.getBoundingClientRect();
      const dock = document.querySelector('[data-testid="dock"]')!.getBoundingClientRect();
      const icons = [...document.querySelectorAll('[data-testid="desktop-grid"] [data-home-item]')].map((e) => e.getBoundingClientRect().toJSON());
      return { area: [area.scrollWidth, area.clientWidth, area.scrollHeight, area.clientHeight], doc: [doc.scrollWidth, doc.clientWidth, doc.scrollHeight, doc.clientHeight], bar: bar.bottom, dock: dock.top, w: innerWidth, h: innerHeight, icons };
    });
    expect(r.area[0]).toBeLessThanOrEqual(r.area[1]!);
    expect(r.area[2]).toBeLessThanOrEqual(r.area[3]!);
    expect(r.doc[0]).toBeLessThanOrEqual(r.doc[1]!);
    expect(r.doc[2]).toBeLessThanOrEqual(r.doc[3]!);
    expect(r.icons.length).toBeGreaterThanOrEqual(4);
    for (const b of r.icons) {
      expect(b.top).toBeGreaterThanOrEqual(r.bar); // never under the system bar
      expect(b.bottom).toBeLessThanOrEqual(r.dock); // never under the dock
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(r.w);
    }
  };
  await check();

  // A drop on the bottom-right cell lands there (edit mode, drag the Notes icon).
  await page.getByTestId("desktop-area").click({ button: "right", position: { x: 600, y: 300 } });
  await page.getByTestId("menu-edit").click();
  const box = (await grid.boundingBox())!;
  const from = (await page.getByTestId("app-notes").boundingBox())!;
  const to = { x: box.x + box.width * ((g.cols - 2 + 0.5) / g.cols), y: box.y + box.height * ((g.rows - 1 + 0.4) / g.rows) };
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(from.x + from.width / 2 + ((to.x - from.x - from.width / 2) * i) / 16, from.y + from.height / 2 + ((to.y - from.y - from.height / 2) * i) / 16);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect.poll(() => cellOf("notes")).toBe(`${g.cols - 2},${g.rows - 1}`);
  await page.keyboard.press("Escape");

  // Smaller window: fewer cells; everything is still inside and on valid cells.
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect.poll(async () => (await geo()).cols).toBeLessThan(g.cols);
  const small = await geo();
  const seen = new Set<string>();
  for (const id of ["mail", "settings", "vibex", "calculator", "notes"]) {
    const cell = (await cellOf(id))!;
    const [c, r] = cell.split(",").map(Number);
    expect(c).toBeLessThan(small.cols);
    expect(r).toBeLessThan(small.rows);
    seen.add(cell);
  }
  // Each app has its own cell (out-of-range ones took the nearest free cell — the far corner stays occupied).
  expect(seen.size).toBe(5);
  expect(seen.has(`${small.cols - 1},${small.rows - 1}`)).toBe(true);
  await check();
});

// ------------------------------------------------------------------ desktops

test("PC desktops: the primary can't be deleted; a second one is deleted after confirmation, its apps move to the primary, saved on the server", async ({ page }) => {
  test.skip(isMobile(page), "PC desktops");
  await signUpViaApi(page, "Рабочие", "Столы");
  const openDesktops = async () => {
    await page.waitForTimeout(300);
    if (!(await page.getByTestId("dock-desktops-menu").count())) await page.getByTestId("dock-desktops").click();
    await expect(page.getByTestId("dock-desktops-menu")).toBeVisible();
    await page.waitForTimeout(250);
  };
  await openDesktops();
  await page.getByTestId("dock-space-add").click();
  await expect.poll(async () => (await storedLayout(page))?.desktop?.spaces?.length).toBe(2);
  // Move Mail to the second desktop (server-side layout), then reload.
  const l = await layoutFor(page);
  const [primary, second] = l.desktop.spaces;
  const mail = { kind: "app" as const, id: "mail" as const };
  primary!.items = primary!.items.filter((i) => i.id !== "mail");
  second!.items = [mail];
  await saveLayout(page, l);
  await reloadUnlocked(page);
  await expect(page.getByTestId("desktop-grid")).toBeVisible();

  // Primary: no delete entry.
  await openDesktops();
  await page.getByTestId("dock-space-1").click({ button: "right" });
  await expect(page.getByTestId("home-context-menu")).toBeVisible();
  await expect(page.getByTestId("menu-remove-space")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Secondary: delete → Cancel keeps it.
  await openDesktops();
  await page.getByTestId("dock-space-2").click({ button: "right" });
  await page.getByTestId("menu-remove-space").click();
  await expect(page.getByTestId("remove-space-sheet")).toContainText("Удалить рабочий стол?");
  await page.getByTestId("remove-space-cancel").click();
  await expect(page.getByTestId("remove-space-sheet")).toHaveCount(0);
  expect((await storedLayout(page)).desktop.spaces).toHaveLength(2);

  // Confirm: gone; Mail is on the primary desktop.
  await openDesktops();
  await page.getByTestId("dock-space-2").click({ button: "right" });
  await page.getByTestId("menu-remove-space").click();
  await page.getByTestId("remove-space-confirm").click();
  await expect.poll(async () => (await storedLayout(page)).desktop.spaces.length).toBe(1);
  const after = await storedLayout(page);
  expect(after.desktop.spaces[0].id).toBe(primary!.id);
  expect(after.desktop.spaces[0].items).toContainEqual(mail);
  await expect(page.getByTestId("desktop-grid").getByTestId("app-mail")).toBeVisible();
  // After a reload too.
  await reloadUnlocked(page);
  await expect(page.getByTestId("desktop-grid").getByTestId("app-mail")).toBeVisible();
  await openDesktops();
  await expect(page.locator('[data-testid^="dock-space-"][data-space-id]')).toHaveCount(1);
});

// ------------------------------------------------------------------ dock search

test("PC dock search: an opaque field (not glass, also with dock glass on), a search box (no credential key), search works, readable in dark theme", async ({ page }) => {
  test.skip(isMobile(page), "PC dock");
  await signUpViaApi(page, "Поиск", "Дока");
  const field = page.getByTestId("dock-search");
  const input = page.getByTestId("home-search");
  const style = () =>
    field.evaluate((e) => {
      const cs = getComputedStyle(e);
      const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/)!;
      const parts = m[1]!.split(",").map((x) => parseFloat(x));
      return { alpha: parts[3] ?? 1, rgb: parts.slice(0, 3), blur: cs.backdropFilter, glass: e.className.includes("vx-glass") };
    });
  const light = await style();
  expect(light).toMatchObject({ alpha: 1, blur: "none", glass: false });
  expect(light.rgb).toEqual([255, 255, 255]);
  // A search box, not a login field: no credential autofill, so no password-manager key.
  await expect(input).toHaveAttribute("type", "search");
  await expect(input).toHaveAttribute("autocomplete", "off");
  expect(await input.getAttribute("name")).not.toMatch(/user|login|mail|pass/i);
  await input.click();
  await expect(input).toBeFocused();
  expect(await field.evaluate((e) => [...e.querySelectorAll("*")].some((x) => /key/i.test(x.getAttribute("data-testid") ?? "") || getComputedStyle(x).backgroundImage.includes("key")))).toBe(false);
  // Search works from the keyboard.
  await page.keyboard.type("кальк");
  await expect(page.getByTestId("home-search-results")).toContainText("Калькулятор");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="window-calculator"][data-state="open"]')).toBeVisible();

  // Dark theme: a dark field with light text.
  const layout = await layoutFor(page);
  await saveLayout(page, { ...layout, appearance: { ...layout.appearance, theme: "dark", dock: "glass" } });
  await reloadUnlocked(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await style();
  expect(dark).toMatchObject({ alpha: 1, blur: "none", glass: false });
  expect(Math.max(...dark.rgb)).toBeLessThan(80);
  const text = await input.evaluate((e) => getComputedStyle(e).color.match(/\d+/g)!.slice(0, 3).map(Number));
  expect(Math.min(...text)).toBeGreaterThan(180);
});
