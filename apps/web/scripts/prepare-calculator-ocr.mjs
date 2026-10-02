// Copies the local OCR runtime of the Calculator (Tesseract worker, wasm core
// and the English model) into public/apps/calculator/ocr/, so it is served
// from VOIDEX itself and only downloaded when a photo is actually recognised.
// Same file list as packages/calculator/scripts/prepare-ocr.mjs (the original
// standalone app); here paths are resolved through pnpm's strict node_modules.
// The output is generated (gitignored) and restored on every dev / build.
import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../", import.meta.url));
const calculator = createRequire(path.join(web, "../../packages/calculator/package.json"));
const tesseract = createRequire(calculator.resolve("tesseract.js/package.json"));
const dir = (req, pkg) => path.dirname(req.resolve(`${pkg}/package.json`));

const tjs = dir(calculator, "tesseract.js");
const core = dir(tesseract, "tesseract.js-core");
const eng = dir(calculator, "@tesseract.js-data/eng");
const files = [
  [path.join(tjs, "dist/worker.min.js"), "worker.min.js"],
  [path.join(tjs, "dist/worker.min.js.LICENSE.txt"), "worker.min.js.LICENSE.txt"],
  [path.join(core, "tesseract-core-lstm.wasm.js"), "tesseract-core-lstm.wasm.js"],
  [path.join(core, "tesseract-core-lstm.wasm"), "tesseract-core-lstm.wasm"],
  [path.join(core, "tesseract-core-simd-lstm.wasm.js"), "tesseract-core-simd-lstm.wasm.js"],
  [path.join(core, "tesseract-core-simd-lstm.wasm"), "tesseract-core-simd-lstm.wasm"],
  [path.join(eng, "4.0.0/eng.traineddata.gz"), "eng.traineddata.gz"],
];

const target = path.join(web, "public/apps/calculator/ocr");
await mkdir(target, { recursive: true });
let copied = 0;
for (const [from, name] of files) {
  const to = path.join(target, name);
  const [a, b] = await Promise.all([stat(from), stat(to).catch(() => null)]);
  if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
  await copyFile(from, to);
  copied++;
}
console.log(`Calculator OCR: ${files.length} files ready in public/apps/calculator/ocr (${copied} copied).`);
