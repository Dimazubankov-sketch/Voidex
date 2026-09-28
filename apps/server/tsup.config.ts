import { defineConfig } from "tsup";

// Bundles the server (and the workspace-only @voidex/shared sources) into one
// ESM file; npm dependencies stay external and are installed in production.
export default defineConfig({
  entry: ["src/index.ts", "src/db/migrate-cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [/^@voidex\/shared/],
});
