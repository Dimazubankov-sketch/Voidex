import { CLOCK_SOUNDS, WHEEL_TICK_FILE } from "@voidex/clock";

/**
 * The bundled URL of every Clock sound (Vite emits the WAVs of
 * packages/clock/assets with hashed names): played from VOIDEX itself, no
 * request to Soundlab or anywhere else. Only the URLs are in the bundle; a
 * sound is fetched the first time it plays.
 */
const files = import.meta.glob("../../../../../packages/clock/assets/audio/**/*.wav", { query: "?url", import: "default", eager: true }) as Record<string, string>;

const byFile = new Map(Object.entries(files).map(([path, url]) => [path.slice(path.indexOf("audio/")), url]));

export function soundUrl(file: string): string {
  const url = byFile.get(file);
  if (!url) throw new Error(`clock sound missing: ${file}`);
  return url;
}

export const WHEEL_TICK_URL = byFile.get(WHEEL_TICK_FILE) ?? "";
export const SOUND_URLS = Object.fromEntries(CLOCK_SOUNDS.map((s) => [s.id, soundUrl(s.file)]));
