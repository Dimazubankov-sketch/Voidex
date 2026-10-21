import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// A1: every build has an id. The client knows its own (__VOIDEX_BUILD__) and compares it with /version.json
// (never cached) to notice a newer deployment while it is running.
const BUILD_ID = (process.env.VOIDEX_VERSION && process.env.VOIDEX_VERSION !== "dev" ? process.env.VOIDEX_VERSION : "") || `local-${Date.now().toString(36)}`;

function buildVersion(): Plugin {
  return {
    name: "voidex-build-version",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

// The API runs on :4000 in development; the dev server proxies /api so the
// browser sees a single origin (same-site cookies, no CORS) — exactly like
// production, where the server also serves this build.
export default defineConfig({
  plugins: [react(), tailwindcss(), buildVersion()],
  define: { __VOIDEX_BUILD__: JSON.stringify(BUILD_ID) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: false } },
  },
  preview: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: false } },
  },
  build: {
    // A1: older iPhones (Safari 15–16.3) cannot parse class static blocks that es2022 output keeps; one such
    // chunk is enough for a blank screen there, so syntax is lowered for them.
    target: ["es2020", "safari15", "chrome100", "firefox100"],
    sourcemap: true,
    // Step 2.14: Clock fetches its sounds; the CSP allows fetch from 'self' and blob:, not data:, so a small WAV
    // (the wheel tick) must stay a file instead of being inlined as a data: URL.
    assetsInlineLimit: (file) => (file.endsWith(".wav") ? false : undefined),
  },
});
