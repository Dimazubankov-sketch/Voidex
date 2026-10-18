import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// The API runs on :4000 in development; the dev server proxies /api so the
// browser sees a single origin (same-site cookies, no CORS) — exactly like
// production, where the server also serves this build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    target: "es2022",
    sourcemap: true,
    // Step 2.14: Clock fetches its sounds; the CSP allows fetch from 'self' and blob:, not data:, so a small WAV
    // (the wheel tick) must stay a file instead of being inlined as a data: URL.
    assetsInlineLimit: (file) => (file.endsWith(".wav") ? false : undefined),
  },
});
