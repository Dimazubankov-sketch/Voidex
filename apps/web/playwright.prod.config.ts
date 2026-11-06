import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * Release-mode end-to-end tests: the BUILT web client (apps/web/dist) served by the BUILT API server
 * (apps/server/dist) — the same two artifacts the Docker image ships — with the asset archive on. This is where
 * the boot guard, the service worker, update delivery and start-up resilience are exercised for real.
 * The normal suite (playwright.config.ts) runs against the dev server, where none of that exists.
 *
 *   pnpm build && pnpm --filter @voidex/web test:e2e:prod            (Chromium desktop + Pixel 7 + WebKit/iPhone)
 *   pnpm --filter @voidex/web test:e2e:prod --project=webkit-iphone
 *
 * WebKit is Playwright's build of Safari's engine: it catches engine-level problems (syntax, APIs, storage and
 * service-worker behaviour) that Chromium cannot. It is NOT an iPhone: see docs/IPHONE-DIAGNOSTICS.md.
 */
const PORT = Number(process.env.E2E_PROD_PORT ?? 4100);
// Tests talk to the server through e2e-prod/proxy.mjs, which can reset or stall connections on demand.
const PROXY_PORT = Number(process.env.E2E_PROXY_PORT ?? 4101);
const ROOT = join(tmpdir(), "vx-e2e-prod");
export const DIST = join(ROOT, "dist");
export const ARCHIVE = join(ROOT, "archive");

// Prepare a private copy of the build once (workers re-load this file; the env flag stops them re-copying).
if (!process.env.VX_E2E_PROD_PREPARED) {
  const src = fileURLToPath(new URL("./dist", import.meta.url));
  if (!existsSync(join(src, "index.html"))) throw new Error("apps/web/dist is missing: run `pnpm --filter @voidex/web build` first");
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  cpSync(src, DIST, { recursive: true });
  process.env.VX_E2E_PROD_PREPARED = "1";
}
process.env.E2E_PROD_DIST = DIST;

export default defineConfig({
  testDir: "./e2e-prod",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PROXY_PORT}`,
    locale: "ru-RU",
    trace: "off",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "chromium-desktop", use: { viewport: { width: 1440, height: 900 }, browserName: "chromium" } },
    { name: "chromium-android", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    // launchOptions of the chromium override must not leak into WebKit.
    { name: "webkit-iphone", use: { ...devices["iPhone 15"], launchOptions: {} } },
  ],
  webServer: [
    {
      command: "node ../server/dist/index.js",
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://voidex:voidex@localhost:5432/voidex",
        PORT: String(PORT),
        HOST: "127.0.0.1",
        WEB_DIST: DIST,
        ASSET_ARCHIVE_DIR: ARCHIVE,
        VOIDEX_VERSION: "e2e-build-1",
        RATE_LIMIT_SCALE: "50",
      },
    },
    {
      command: "node e2e-prod/proxy.mjs",
      url: `http://127.0.0.1:${PROXY_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { E2E_PROXY_PORT: String(PROXY_PORT), E2E_PROD_PORT: String(PORT) },
    },
  ],
});
