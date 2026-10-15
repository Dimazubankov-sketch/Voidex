import { defineConfig } from "@playwright/test";

/**
 * Step 2.11 (development only): takes the real screenshots Appex Store shows,
 * from the running apps on the local stack, with fresh local test accounts
 * and made-up content (no real account data). Never part of CI or a
 * production deploy; the resulting JPEGs are committed as static files.
 *
 *   pnpm --filter @voidex/web exec playwright test --config playwright.screens.config.ts
 */
export default defineConfig({
  testDir: "./tools/store-screens",
  // One long run per platform through every app (it grew with Step 2.13's scenes).
  timeout: 480_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    locale: "ru-RU",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
