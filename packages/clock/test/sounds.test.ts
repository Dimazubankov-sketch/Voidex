import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CLOCK_SOUNDS, DEFAULT_SOUND, WHEEL_TICK_FILE, searchSounds, soundById } from "../src/sounds.ts";

// Ported from Voidex-Clock tests/engine.test.js ("all 13 Soundlab WAV files are intact").
const asset = (file: string) => readFileSync(new URL(`../assets/${file}`, import.meta.url));

test("all 13 Soundlab WAV files are intact; Alert B is first and the default", () => {
  const manifest = JSON.parse(asset("sounds.json").toString()) as { id: string; name: string; file: string; sha256: string; duration: number }[];
  assert.equal(CLOCK_SOUNDS.length, 13);
  assert.equal(manifest.length, 13);
  assert.equal(CLOCK_SOUNDS[0]!.name, "Alert B");
  assert.equal(CLOCK_SOUNDS[0]!.id, DEFAULT_SOUND);
  assert.equal(new Set(CLOCK_SOUNDS.map((s) => s.id)).size, 13);
  for (const sound of CLOCK_SOUNDS) {
    // The catalog the app uses is the Soundlab manifest, entry for entry.
    const m = manifest.find((x) => x.id === sound.id)!;
    assert.ok(m, sound.id);
    assert.equal(m.file, sound.file);
    assert.equal(m.sha256, sound.sha256);
    const bytes = asset(sound.file);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sound.sha256);
    assert.ok(sound.duration > 3);
    assert.ok(bytes.length > 10000);
    assert.equal(sound.waveform.length, 21);
  }
});

test("the wheel tick is its own small UI sound, not one of the alarms", () => {
  const tick = asset(WHEEL_TICK_FILE);
  assert.equal(tick.toString("ascii", 0, 4), "RIFF");
  assert.ok(tick.length < 10000);
  assert.ok(!CLOCK_SOUNDS.some((s) => s.file === WHEEL_TICK_FILE));
});

test("unknown sound ids fall back to Alert B; search by name", () => {
  assert.equal(soundById("nope").name, "Alert B");
  assert.deepEqual(searchSounds("алерт").length, 0);
  assert.deepEqual(searchSounds("alert").map((s) => s.name), ["Alert B", "Alert C", "Alert D", "Alert E", "Alert F", "Alert G"]);
  assert.deepEqual(searchSounds("МАРИ").map((s) => s.id), ["alarm-marimba"]);
  assert.equal(searchSounds("").length, 13);
});
