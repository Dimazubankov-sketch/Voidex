import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { transformWithEsbuild } from "vite";
import type { Plugin } from "vite";

// A1: every build has an id. The client knows its own (__VOIDEX_BUILD__) and compares it with /version.json
// (never cached) to notice a newer deployment while it is running.
const BUILD_ID = (process.env.VOIDEX_VERSION && process.env.VOIDEX_VERSION !== "dev" ? process.env.VOIDEX_VERSION : "") || `local-${Date.now().toString(36)}`;

function buildVersion(): Plugin {
  return {
    name: "voidex-build-version",
    // dev server: serve the guard source directly (the build emits the minified file)
    configureServer(server) {
      server.middlewares.use("/boot-guard.js", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript");
        res.end(readFileSync(fileURLToPath(new URL("./boot/boot-guard.src.js", import.meta.url)), "utf8"));
      });
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
      // P0: the caching service worker of e94bf99 is retired. /sw.js is now a tiny worker that deletes its caches and
      // unregisters itself (browsers that installed the old one fetch it on their next visit).
      this.emitFile({ type: "asset", fileName: "sw.js", source: readFileSync(fileURLToPath(new URL("./sw/sw-retire.js", import.meta.url)), "utf8") });
      // The boot guard is minified (it must fit in one or two packets) and loaded async: see index.html.
      const guard = readFileSync(fileURLToPath(new URL("./boot/boot-guard.src.js", import.meta.url)), "utf8");
      const out = await transformWithEsbuild(guard, "boot-guard.js", { minify: true, target: "es2015" });
      this.emitFile({ type: "asset", fileName: "boot-guard.js", source: out.code });
    },
  };
}

/**
 * The main stylesheet must not block the first paint: on a path where big files stall, a render-blocking <link>
 * leaves the page empty (white or black, depending on the device) with nothing to read. It is loaded as media=print
 * (downloaded, not applied) and applied by main.tsx once it arrived; the inline splash in index.html is shown meanwhile.
 */
function nonBlockingCss(): Plugin {
  return {
    name: "voidex-non-blocking-css",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(/<link rel="stylesheet"([^>]*?)href="([^"]+\.css)"([^>]*)>/g, '<link rel="stylesheet"$1href="$2"$3 media="print" data-vx-css>');
      },
    },
  };
}

// The API runs on :4000 in development; the dev server proxies /api so the
// browser sees a single origin (same-site cookies, no CORS) — exactly like
// production, where the server also serves this build.
export default defineConfig({
  plugins: [react(), tailwindcss(), buildVersion(), nonBlockingCss()],
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
