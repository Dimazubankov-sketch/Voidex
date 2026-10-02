import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the real stack: API server + PostgreSQL + web client.
 * Start them yourself (pnpm dev) or let Playwright start them. The SMS provider
 * must be the development "console" provider so codes are visible on screen.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    locale: "ru-RU",
    trace: "retain-on-failure",
    launchOptions: {
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      // Without a UTF-8 locale (bare CI containers) Chromium saves non-ASCII
      // download names as "download"; real browsers keep them.
      env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" },
      // Step 2.3: voice messages / video circles are recorded from a fake microphone and camera.
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    permissions: ["microphone", "camera"],
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 }, browserName: "chromium" } },
  ],
  webServer: [
    {
      command: "pnpm --filter @voidex/server dev",
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: "../..",
    },
    {
      command: "pnpm --filter @voidex/web dev --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: "../..",
    },
  ],
});
