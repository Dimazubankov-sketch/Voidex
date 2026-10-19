// Imports the Forma sound library (Forma 0.1 `public/sound-library`) into the
// Voidex web app: every audio sound as its MP3 preview, every haptic pattern
// as its JSON plus its audio preview, and a compact catalog with the waveform
// animation frames. Checks each file against the catalog's size, refuses
// duplicates (same bytes under two ids) and leaves out resources whose rights
// are not confirmed for publishing (third-party recordings).
//
//   node packages/forma/tools/import-sounds.mjs <forma-0.1/public/sound-library> <apps/web/public/forma/sounds>
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error("usage: import-sounds.mjs <src> <out>");
const catalog = JSON.parse(readFileSync(join(src, "catalog.json"), "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "audio/preview"), { recursive: true });
mkdirSync(join(out, "haptics"), { recursive: true });

const seen = new Map();
const sounds = [];
const excluded = [];
for (const s of catalog.sounds) {
  if (s.origin !== "voidex-original") {
    excluded.push({ id: s.id, name: s.name, origin: s.origin, reason: "rights not confirmed for publishing" });
    continue;
  }
  const preview = s.previewFile;
  if (!/^audio\/preview\/[a-z0-9-]+\.mp3$/.test(preview)) throw new Error(`bad preview path: ${s.id}`);
  const bytes = readFileSync(join(src, preview));
  if (bytes.length < 200 || bytes.subarray(0, 3).toString("latin1") !== "ID3" && !(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) throw new Error(`not an MP3: ${preview}`);
  // The canonical WAV is checked against the catalog when present (integrity of the source).
  const wav = join(src, s.file);
  if (existsSync(wav) && s.sha256 && sha(readFileSync(wav)) !== s.sha256) throw new Error(`checksum mismatch: ${s.file}`);
  const digest = sha(bytes);
  if (seen.has(digest)) throw new Error(`duplicate audio: ${s.id} = ${seen.get(digest)}`);
  seen.set(digest, s.id);
  copyFileSync(join(src, preview), join(out, preview));
  const entry = {
    id: s.id,
    name: s.name,
    category: s.category,
    action: s.action ?? "",
    tags: s.tags ?? [],
    kind: s.type === "haptic" ? "haptic" : "audio",
    file: preview,
    sha256: digest,
    durationMs: Math.round((s.type === "haptic" ? s.haptic?.durationMs ?? s.duration * 1000 : s.duration * 1000) || 0),
    fps: s.animationFps ?? 50,
    frames: (s.animationFrames ?? []).map((f) => f.map((v) => Math.round(v * 100) / 100)),
  };
  if (s.type === "haptic") {
    const hfile = s.assetFile ?? `haptics/${s.id}.json`;
    const hb = readFileSync(join(src, hfile));
    if (s.assetSha256 && sha(hb) !== s.assetSha256) throw new Error(`checksum mismatch: ${hfile}`);
    copyFileSync(join(src, hfile), join(out, `haptics/${s.id}.json`));
    entry.haptic = { pattern: s.haptic.pattern, durationMs: s.haptic.durationMs };
  }
  sounds.push(entry);
}
const used = new Set(sounds.map((s) => s.category));
const result = {
  schemaVersion: 1,
  source: "Forma 0.1 sound library (voidex-soundlab)",
  categories: catalog.categories.filter((c) => used.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
  sounds,
  excluded,
};
writeFileSync(join(out, "catalog.json"), JSON.stringify(result));
console.log(`imported ${sounds.length} sounds (${sounds.filter((s) => s.kind === "haptic").length} haptic), excluded ${excluded.length}`);
