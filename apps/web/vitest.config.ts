import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests of the client's plain logic (api/session/update/recovery). Real-browser behaviour is covered by the
// Playwright suites (e2e/ against the dev server, e2e-prod/ against the release build, Chromium + WebKit).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { __VOIDEX_BUILD__: JSON.stringify("unit-build-1") },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], restoreMocks: true },
});
