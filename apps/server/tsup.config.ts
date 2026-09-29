import { defineConfig } from "tsup";

// Bundles the server, @voidex/shared and every npm dependency into
// self-contained ESM files: the production image needs no node_modules.
// pg-native (optional native driver) and pino-pretty (dev-only log
// formatter) are never loaded in production and stay external.
export default defineConfig({
  entry: ["src/index.ts", "src/db/migrate-cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  splitting: true,
  noExternal: [/.*/],
  external: ["pg-native", "pino-pretty"],
  // Bundled CommonJS deps call require()/__dirname; give ESM output a real require.
  banner: {
    js: [
      'import { createRequire as __voidexCreateRequire } from "node:module";',
      'import { fileURLToPath as __voidexFileURLToPath } from "node:url";',
      'import { dirname as __voidexDirname } from "node:path";',
      "const require = __voidexCreateRequire(import.meta.url);",
      "const __filename = __voidexFileURLToPath(import.meta.url);",
      "const __dirname = __voidexDirname(__filename);",
    ].join("\n"),
  },
});
