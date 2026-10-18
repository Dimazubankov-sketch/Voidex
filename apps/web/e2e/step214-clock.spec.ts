import { expect, test, type Page } from "@playwright/test";
import { addWidget, normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { addWidgetFromPicker, apiAs, openApp, phoneHome, reloadUnlocked, signUpViaApi } from "./helpers";

/**
 * Step 2.14: Clock, a native built-in VOIDEX app (no iframe). Its logo is a
 * system icon only (desktop, dock, Store, Settings, notifications), never
 * inside the app. World clock, alarms on drums, stopwatch, timers, sounds,
 * the ring sheet and a notification of the account.
 */

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
const clock = (page: Page) => page.getByTestId("clock-app");

async function openClock(page: Page) {
  await openApp(page, "clock");
  await expect(clock(page)).toBeVisible();
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="clock-app"]') as HTMLElement;
    const box = root.getBoundingClientRect();
    /** What is visible of an element: its box cut by every ancestor that clips (overflow other than visible). */
    const visible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      let left = r.left;
      let right = r.right;
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== "visible") {
          const pr = p.getBoundingClientRect();
          left = Math.max(left, pr.left);
          right = Math.min(right, pr.right);
        }
      }
      return { left, right, width: right - left };
    };
    const over = [...root.querySelectorAll<HTMLElement>("*")].filter((el) => {
      if (getComputedStyle(el).position === "fixed") return false;
      const v = visible(el);
      return v.width > 0 && (v.right > box.right + 1 || v.left < box.left - 1);
    });
    return { scroll: root.scrollWidth - root.clientWidth, over: over.slice(0, 3).map((el) => `${el.tagName}.${el.className}`) };
  });
}

test("registry: Clock is installed with its own logo on the desktop, opens natively (no iframe), and draws no logo inside", async ({ page }) => {
  await signUpViaApi(page, "Часовщик", "Первый");
  const icon = page.getByTestId("app-clock");
  await expect(icon).toBeVisible();
  await expect(icon.locator('[data-logo="/brand/app-clock.png"]')).toHaveCount(1);
  // Optically normalised like the other marks.
  expect(Number(await icon.locator("[data-optical]").getAttribute("data-optical"))).toBeGreaterThan(1);
  const apps = (await apiAs(page, "GET", "/api/apps")).body as { id: string; manifest: { name: { ru: string }; category: string } }[];
  const entry = apps.filter((a) => a.id === "clock");
  expect(entry).toHaveLength(1);
  expect(entry[0]!.manifest.name.ru).toBe("Часы");
  expect(entry[0]!.manifest.category).toBe("tools");

  await openClock(page);
  await expect(page.locator('[data-testid="window-clock"] iframe')).toHaveCount(0);
  // No logo anywhere inside the Clock window (header, sections, dialogs).
  const win = page.locator('[data-testid="window-clock"]');
  await expect(win.locator('[data-logo], img[src*="app-clock"], image[href*="app-clock"]')).toHaveCount(0);
  await clock(page).getByTestId("clock-add").click();
  await expect(page.getByTestId("clock-city-picker")).toBeVisible();
  await expect(win.locator('[data-logo], img[src*="app-clock"], image[href*="app-clock"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("clock-city-picker")).toHaveCount(0);
  for (const tab of ["alarm", "stopwatch", "timers", "world"]) {
    await clock(page).getByTestId(`clock-tab-${tab}`).click();
    await expect(clock(page)).toHaveAttribute("data-tab", tab);
    await expect(win.locator('[data-logo], img[src*="app-clock"], image[href*="app-clock"]')).toHaveCount(0);
  }
  // Phone: navigation at the bottom; PC: a sidebar.
  if (isMobile(page)) {
    await expect(clock(page)).toHaveAttribute("data-layout", "phone");
    const nav = (await page.getByTestId("clock-bottom-nav").boundingBox())!;
    const bar = (await page.locator('section[data-state="open"] [data-testid="home-indicator"]').boundingBox())!;
    expect(nav.y + nav.height).toBeLessThanOrEqual(bar.y + 1);
  } else {
    await expect(clock(page)).toHaveAttribute("data-layout", "desktop");
    await expect(page.getByTestId("clock-sidebar")).toBeVisible();
  }
});

test("world clock: add a city with search, its difference from Moscow, delete only through the trash", async ({ page }) => {
  await signUpViaApi(page, "Мировое", "Время");
  await openClock(page);
  const cities = clock(page).getByTestId("clock-city");
  await expect(cities).toHaveCount(4);
  await clock(page).getByTestId("clock-add").click();
  await page.getByTestId("clock-city-search").fill("токио");
  await expect(page.getByTestId("clock-city-option")).toHaveCount(1);
  await page.getByTestId("clock-city-option").click();
  await expect(cities).toHaveCount(5);
  const tokyo = cities.filter({ hasText: "Токио" });
  await expect(tokyo.getByTestId("clock-city-offset")).toHaveText("+6 ч к Москве");
  await expect(cities.filter({ hasText: "Москва" }).getByTestId("clock-city-offset")).toHaveText("Как в Москве");
  // Already added: disabled in the picker.
  await clock(page).getByTestId("clock-add").click();
  await page.getByTestId("clock-city-search").fill("tokyo");
  await expect(page.getByTestId("clock-city-option")).toBeDisabled();
  await page.getByTestId("clock-sheet-close").click();

  if (isMobile(page)) {
    // A tap on the row deletes nothing; a swipe reveals the trash; only the trash deletes.
    await tokyo.click();
    await expect(cities).toHaveCount(5);
    const box = (await tokyo.boundingBox())!;
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width - 20 - i * 14, box.y + box.height / 2);
    await page.mouse.up();
    await expect(tokyo).toHaveAttribute("data-swipe-open", "true");
    await expect(cities).toHaveCount(5);
    await tokyo.getByTestId("clock-swipe-delete").click();
  } else {
    // Keyboard: Delete reveals and focuses the trash, Enter presses it.
    await tokyo.focus();
    await page.keyboard.press("Delete");
    await expect(tokyo).toHaveAttribute("data-swipe-open", "true");
    await expect(tokyo.getByTestId("clock-swipe-delete")).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(cities).toHaveCount(4);
  await expect(cities.filter({ hasText: "Токио" })).toHaveCount(0);
});

test("alarms: no made-up alarm; a new one is set on the drums, saved on, toggled, kept after reload, deleted", async ({ page }) => {
  await signUpViaApi(page, "Будильник", "Новый");
  await openClock(page);
  await clock(page).getByTestId("clock-tab-alarm").click();
  await expect(clock(page).getByTestId("clock-alarm")).toHaveCount(0);
  await expect(clock(page).getByTestId("clock-alarm-hero")).toHaveAttribute("data-state", "none");
  await expect(clock(page).getByTestId("clock-alarm-hero")).not.toContainText("07:00");

  await clock(page).getByTestId("clock-add").click();
  const editor = page.getByTestId("clock-alarm-editor");
  await expect(editor).toBeVisible();
  // No native time input: two spinbutton drums.
  await expect(editor.locator('input[type="time"]')).toHaveCount(0);
  const hours = editor.getByTestId("clock-wheel-alarm-hours");
  const minutes = editor.getByTestId("clock-wheel-alarm-minutes");
  await expect(hours).toHaveAttribute("role", "spinbutton");
  await expect(hours).toHaveAttribute("aria-valuenow", "7");
  // Keyboard: 07 → 09, 00 → 58 (cyclic).
  await hours.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await minutes.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(minutes).toHaveAttribute("aria-valuenow", "58");
  await expect(hours).toHaveAttribute("aria-valuenow", "9");
  // Step 2.15: a new alarm has no day chosen (it rings once); days make it repeat: only Saturday.
  await expect(editor.getByTestId("clock-repeat-label")).toHaveText("Один раз");
  await expect(editor.locator('[data-testid="clock-day"][aria-pressed="true"]')).toHaveCount(0);
  await editor.locator('[data-testid="clock-day"][data-day="6"]').click();
  await expect(editor.getByTestId("clock-repeat-label")).toHaveText("Сб");
  await editor.getByTestId("clock-alarm-name").fill("Пробежка");
  await editor.getByTestId("clock-alarm-interval").selectOption("5");
  await editor.getByTestId("clock-sheet-save").click();
  await expect(editor).toHaveCount(0);

  const card = clock(page).getByTestId("clock-alarm");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("09:58");
  await expect(card).toContainText("Пробежка");
  await expect(card).toContainText("Alert B");
  await expect(card.locator("article")).toHaveAttribute("data-enabled", "true");
  await expect(clock(page).getByTestId("clock-alarm-hero")).toHaveAttribute("data-state", "next");

  await card.getByTestId("clock-alarm-toggle").click();
  await expect(card.locator("article")).toHaveAttribute("data-enabled", "false");
  await expect(card.getByTestId("clock-alarm-toggle")).toHaveAttribute("aria-checked", "false");

  // Kept on the device.
  await page.reload();
  await page.waitForLoadState("networkidle");
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("voidex-clock-v1:")).map((k) => JSON.parse(localStorage.getItem(k)!)));
  expect(stored).toHaveLength(1);
  expect(stored[0].alarms).toHaveLength(1);
  expect(stored[0].alarms[0]).toMatchObject({ time: "09:58", name: "Пробежка", days: [6], enabled: false, interval: 5, sound: "reference-alert-b" });
});

test("alarm editor: the sound picker previews once per tap, a second tap on the same sound is blocked, leaving stops it", async ({ page }) => {
  await signUpViaApi(page, "Мелодия", "Будильника");
  await openClock(page);
  await clock(page).getByTestId("clock-tab-alarm").click();
  await clock(page).getByTestId("clock-alarm-create").click();
  await page.getByTestId("clock-alarm-sound").click();
  const picker = page.getByTestId("clock-sound-picker");
  await expect(picker.getByTestId("clock-sound-row")).toHaveCount(13);
  await expect(picker.getByTestId("clock-sound-row").first()).toHaveAttribute("data-sound", "reference-alert-b");
  await expect(picker.getByTestId("clock-sound-row").first()).toHaveClass(/chosen/);
  const sonar = picker.locator('[data-testid="clock-sound-row"][data-sound="alarm-sonar"]');
  await sonar.getByTestId("clock-sound-preview").click();
  // While it plays the same button cannot start it again.
  await expect(sonar.getByTestId("clock-sound-preview")).toBeDisabled();
  await expect(picker.getByTestId("clock-sound-featured")).toHaveText("Сонар");
  // Another sound takes over.
  const bells = picker.locator('[data-testid="clock-sound-row"][data-sound="alarm-bells"]');
  await bells.getByTestId("clock-sound-preview").click();
  await expect(bells.getByTestId("clock-sound-preview")).toBeDisabled();
  await expect(sonar.getByTestId("clock-sound-preview")).toBeEnabled();
  // Step 2.15: choosing a melody plays it (the previous preview stops) and keeps the list open; back shows the choice.
  const drop = picker.locator('[data-testid="clock-sound-row"][data-sound="alarm-drop"]');
  await drop.getByTestId("clock-sound-choose").click();
  await expect(drop).toHaveClass(/chosen/);
  await expect(drop.getByTestId("clock-sound-preview")).toBeDisabled();
  await expect(bells.getByTestId("clock-sound-preview")).toBeEnabled();
  await bells.getByTestId("clock-sound-choose").click();
  await expect(bells).toHaveClass(/chosen/);
  await expect(picker.getByTestId("clock-sound-featured")).toHaveText("Колокола");
  await page.getByTestId("clock-sheet-back").click();
  await expect(page.getByTestId("clock-alarm-sound")).toContainText("Колокола");
  // Back to the list, preview, then leave: nothing keeps playing (every preview button enabled again on return).
  await page.getByTestId("clock-alarm-sound").click();
  await picker.locator('[data-testid="clock-sound-row"][data-sound="alarm-drop"]').getByTestId("clock-sound-preview").click();
  await page.getByTestId("clock-sheet-back").click();
  await page.getByTestId("clock-alarm-sound").click();
  await expect(picker.locator('[data-testid="clock-sound-preview"]:disabled')).toHaveCount(0);
});

test("stopwatch: Start / Pause / Reset only, no laps", async ({ page }) => {
  await signUpViaApi(page, "Секунд", "Омер");
  await openClock(page);
  await clock(page).getByTestId("clock-tab-stopwatch").click();
  const sw = clock(page).getByTestId("clock-stopwatch");
  await expect(sw.getByTestId("clock-stopwatch-time")).toHaveText("00:00.00");
  await expect(sw.getByText(/круг/i)).toHaveCount(0);
  await sw.getByTestId("clock-stopwatch-toggle").click();
  await expect(sw).toHaveAttribute("data-running", "true");
  await page.waitForTimeout(700);
  await sw.getByTestId("clock-stopwatch-toggle").click();
  await expect(sw).toHaveAttribute("data-running", "false");
  const stopped = await sw.getByTestId("clock-stopwatch-time").innerText();
  expect(stopped).not.toBe("00:00.00");
  await page.waitForTimeout(500);
  await expect(sw.getByTestId("clock-stopwatch-time")).toHaveText(stopped);
  await expect(sw.getByTestId("clock-stopwatch-toggle")).toContainText("Продолжить");
  await sw.getByTestId("clock-stopwatch-reset").click();
  await expect(sw.getByTestId("clock-stopwatch-time")).toHaveText("00:00.00");
});

test("timers: the drums are the page (no +, no presets); a short timer pauses, resumes and rings: sheet, notification, Stop", async ({ page }) => {
  await signUpViaApi(page, "Тайм", "Ер");
  await openClock(page);
  await clock(page).getByTestId("clock-tab-timers").click();
  await expect(clock(page).getByTestId("clock-add")).toHaveCount(0);
  const composer = clock(page).getByTestId("clock-timer-composer");
  await expect(composer.getByTestId("clock-wheel-minutes")).toHaveAttribute("aria-valuenow", "25");
  // 0 h 0 min 3 s.
  await composer.getByTestId("clock-timer-clear").click();
  await expect(composer.getByTestId("clock-wheel-minutes")).toHaveAttribute("aria-valuenow", "0");
  await composer.getByTestId("clock-wheel-seconds").focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await expect(composer.getByTestId("clock-wheel-seconds")).toHaveAttribute("aria-valuenow", "3");
  await composer.getByTestId("clock-timer-name").fill("Чай");
  await composer.getByTestId("clock-timer-start").click();

  const timer = clock(page).getByTestId("clock-timer");
  await expect(timer).toHaveCount(1);
  await expect(timer.locator("article")).toHaveAttribute("data-running", "true");
  await timer.getByTestId("clock-timer-toggle").click();
  await expect(timer.locator("article")).toHaveAttribute("data-running", "false");
  const left = await timer.getByTestId("clock-timer-left").innerText();
  await page.waitForTimeout(1500);
  await expect(timer.getByTestId("clock-timer-left")).toHaveText(left);
  await timer.getByTestId("clock-timer-toggle").click();
  await expect(clock(page).getByTestId("clock-timers-recent")).toContainText("Чай");

  // Leave Clock: the ring still comes (it is the shell's), over the home screen.
  if (isMobile(page)) await phoneHome(page);
  const ring = page.getByTestId("clock-ring");
  await expect(ring).toBeVisible({ timeout: 8000 });
  await expect(ring).toHaveAttribute("data-kind", "timer");
  await expect(page.getByTestId("clock-ring-name")).toHaveText("Чай");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  // Step 2.15: no «Включить звук» in the UX: the sound starts by itself (the start tap unlocked it).
  await expect(page.getByTestId("clock-ring-enable")).toHaveCount(0);
  await expect(ring).toHaveAttribute("data-sound-on", "true", { timeout: 5000 });
  // A system overlay in the middle of the screen, over whatever is open (Clock does not open full screen).
  const vp = page.viewportSize()!;
  const card = (await page.getByRole("alertdialog").boundingBox())!;
  expect(Math.abs(card.x + card.width / 2 - vp.width / 2)).toBeLessThan(4);
  expect(Math.abs(card.y + card.height / 2 - vp.height / 2)).toBeLessThan(40);
  // A timer has no snooze.
  await expect(page.getByTestId("clock-ring-snooze")).toHaveCount(0);
  await page.getByTestId("clock-ring-stop").click();
  await expect(ring).toHaveCount(0);
  await expect(clock(page).getByTestId("clock-timer")).toHaveCount(0);

  // The ring is an entry of the account's Notification Center.
  await expect
    .poll(async () => ((await apiAs(page, "GET", "/api/notifications")).body.items as { app: string; type: string; title: string }[]).filter((n) => n.app === "clock").map((n) => `${n.type}:${n.title}`))
    .toEqual(["clock.timer:Чай"]);
});

test("Settings → Applications → Часы: lock, notifications (Clock sends them), storage on this device", async ({ page }) => {
  await signUpViaApi(page, "Настройки", "Часов");
  await openApp(page, "settings");
  await page.getByTestId("settings-nav-apps").last().click();
  await page.getByTestId("settings-app-clock").last().click();
  await expect(page.getByTestId("settings-app-page").last()).toHaveAttribute("data-app", "clock");
  await expect(page.getByTestId("settings-app-name").last()).toHaveText("Часы");
  await expect(page.getByTestId("settings-app-lock").last()).toBeVisible();
  await expect(page.getByTestId("settings-app-notifications").last()).toBeVisible();
  await expect(page.getByTestId("settings-app-no-notifications")).toHaveCount(0);
  await expect(page.getByTestId("settings-app-offload").last()).toBeVisible();
  await expect(page.getByTestId("settings-app-page").last().locator('[data-logo="/brand/app-clock.png"]')).toHaveCount(1);
});

test("Appex Store lists Clock with its logo, words, version and screenshots for both platforms", async ({ page }) => {
  await signUpViaApi(page, "Магазин", "Часов");
  if (isMobile(page)) await page.getByTestId("app-store").click();
  else await page.getByTestId("dock-app-store").click();
  await expect(page.getByTestId("store-home")).toBeVisible();
  await page.getByTestId("store-see-all").first().click();
  const row = page.locator('[data-testid="store-row"][data-app="clock"]');
  await expect(row).toBeVisible();
  await expect(row.locator('[data-logo="/brand/app-clock.png"]')).toHaveCount(1);
  await row.getByTestId("store-row-open").click();
  const app = page.getByTestId("store-app-page");
  await expect(app).toHaveAttribute("data-app", "clock");
  await expect(app).toContainText("Часы");
  await expect(app).toContainText("Мировое время, будильники и таймеры");
  await expect(app).toContainText("1.0.0");
  for (const kind of ["phone", "desktop"])
    for (const n of [1, 2, 3]) {
      const r = await page.request.get(`/store/screens/clock-${kind}-${n}.jpg`);
      expect(r.status()).toBe(200);
      expect(r.headers()["content-type"]).toContain("image");
    }
});

test("responsive: no horizontal overflow at phone, tablet and PC widths, in the dark look too", async ({ page }) => {
  await signUpViaApi(page, "Ширина", "Экрана");
  const widths = isMobile(page) ? [320, 390, 430] : [820, 1180, 1440, 1920];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: isMobile(page) ? 844 : 900 });
    if (!(await clock(page).isVisible())) await openClock(page);
    if (!isMobile(page)) {
      // A maximised window: the whole width of the screen for Clock (double-click on its title bar).
      if ((await page.locator('[data-testid="window-clock"]').getAttribute("data-window-state")) !== "maximized") await page.locator(".vc-titlebar").dblclick({ position: { x: 260, y: 20 } });
      await expect(page.locator('[data-testid="window-clock"]')).toHaveAttribute("data-window-state", "maximized");
      await expect.poll(async () => (await page.locator('[data-testid="window-clock"]').boundingBox())!.width).toBeGreaterThan(w - 80);
    }
    for (const tab of ["world", "alarm", "stopwatch", "timers"]) {
      await clock(page).getByTestId(`clock-tab-${tab}`).click();
      await page.waitForTimeout(200);
      const o = await horizontalOverflow(page);
      expect(o.scroll, `${w}px ${tab} ${o.over.join(" | ")}`).toBeLessThanOrEqual(0);
      expect(o.over, `${w}px ${tab}`).toEqual([]);
    }
  }
  // The dark theme: the app background follows the tokens (no white page).
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const bg = await clock(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe("rgb(255, 255, 255)");
});

/** Places widgets through the account's layout (the same call the widgets panel makes). */
async function placeWidgets(page: Page, types: ("clock" | "calculator")[]) {
  const me = (await apiAs(page, "GET", "/api/me")).body as { preferences: { workspace: { layout?: WorkspaceLayout } } };
  const apps = ((await apiAs(page, "GET", "/api/apps")).body as { id: string }[]).map((a) => a.id) as never[];
  let l = normalizeLayout(me.preferences.workspace.layout ?? null, apps);
  types.forEach((type, i) => {
    l = addWidget(l, type, isMobile(page) ? { surface: "mobile", page: 0, cell: { c: i * 2, r: 0 } } : { surface: "desktop", space: l.desktop.spaces[0]!.id, cell: { c: i * 2, r: 0 } }, `w_${type}0${i}x`);
  });
  expect((await apiAs(page, "PATCH", "/api/preferences", { workspace: { layout: l } })).status).toBe(200);
  await reloadUnlocked(page);
}

test("Clock widget (phone): in the widget catalogue, added from the panel onto the home screen", async ({ page }) => {
  test.skip(!isMobile(page), "phone path to the panel");
  await signUpViaApi(page, "Виджет", "Часов");
  const pg = (await page.getByTestId("home-page-0").boundingBox())!;
  await page.mouse.move(pg.x + 30, pg.y + pg.height - 30);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.getByTestId("home-appearance").click();
  await page.getByTestId("brush-widgets").click();
  await page.getByTestId("widgets-search").fill("часы");
  const card = page.getByTestId("widget-card-clock");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("clock-widget")).toBeVisible();
  await addWidgetFromPicker(page, "clock");
  await page.getByTestId("home-done").click();
  await expect(page.getByTestId("home-page-0").getByTestId("widget-clock")).toBeVisible();
  const layout = ((await apiAs(page, "GET", "/api/me")).body as { preferences: { workspace: { layout: WorkspaceLayout } } }).preferences.workspace.layout;
  expect(layout.widgets.filter((w) => w.type === "clock")).toHaveLength(1);
});

test("Clock widget: 2 x 2 like the Calculator widget, the time of now, ticking, no logo, opens Clock; light and dark", async ({ page }) => {
  await signUpViaApi(page, "Время", "Виджета");
  await placeWidgets(page, ["clock", "calculator"]);
  const w = page.getByTestId("widget-clock");
  const calc = page.getByTestId("widget-calculator");
  await expect(w).toBeVisible();
  await expect(calc).toBeVisible();
  // The place of four icons: the same 2 x 2 block as the Calculator widget, square.
  const a = (await w.boundingBox())!;
  const b = (await calc.boundingBox())!;
  expect(Math.abs(a.width - b.width)).toBeLessThan(2);
  expect(Math.abs(a.height - b.height)).toBeLessThan(2);
  // On a phone the 2 x 2 block is square (PC grid cells are wider than tall, the dial stays round inside).
  if (isMobile(page)) expect(Math.abs(a.width - a.height)).toBeLessThan(a.width * 0.15);
  // An icon tile is about a quarter of it.
  const tile = (await page.locator('[data-testid="app-mail"] [data-tile]').first().boundingBox())!;
  expect(a.width).toBeGreaterThan(tile.width * 1.7);
  // No logo inside.
  await expect(w.locator('[data-logo], img, image')).toHaveCount(0);
  // The time of now on this device, and the second hand moves.
  const label = await w.getByTestId("clock-widget").getAttribute("data-time");
  const local = await page.evaluate(() => new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.now()));
  expect([local]).toContain(label);
  const sec = w.getByTestId("clock-widget-second");
  const first = await sec.getAttribute("data-angle");
  await expect.poll(() => sec.getAttribute("data-angle"), { timeout: 4000 }).not.toBe(first);
  // Its colours come from the theme: a light face, then a dark one.
  const face = () => w.locator("svg circle").first().evaluate((el) => getComputedStyle(el).fill);
  const light = await face();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const dark = await face();
  expect(dark).not.toBe(light);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.screenshot({ path: test.info().outputPath("clock-widget.png") });
  // A tap opens Clock on the world clock.
  await w.getByTestId("clock-widget").click();
  await expect(page.locator('[data-testid="window-clock"][data-state="open"]')).toBeVisible();
  await expect(clock(page)).toHaveAttribute("data-tab", "world");
});
