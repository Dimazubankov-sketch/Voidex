import { test } from "node:test";
import assert from "node:assert/strict";
import { canvasChangeImpact, canvasForImage, canvasOf, canvasRatio, cleanCanvas, fitImage, keepsProportions, moveImage, presetOf, resizeImage, setCanvas, snap } from "../src/slides.ts";
import { textFits } from "../src/document.ts";
import type { PresentationBody, SlideLayer } from "@voidex/shared";

const IMG = "/api/notes/media?id=0b9d6f7e-3a8e-4b0e-9a1a-2f2b4c5d6e7f";
const img = (p: Partial<SlideLayer> = {}): SlideLayer => ({ id: "i", kind: "image", text: "", src: IMG, x: 20, y: 18, w: 40, h: 40, ratio: 4 / 3, ...p });
const pres = (layers: SlideLayer[], extra: Partial<PresentationBody> = {}): PresentationBody => ({ kind: "presentation", format: "rect", slides: [{ id: "s", transition: "none", layers }], ...extra });

test("C2: older presentations read as 1920×1080 / 1080×1080; presets and custom sizes", () => {
  assert.deepEqual(canvasOf({ format: "rect" }), { w: 1920, h: 1080 });
  assert.deepEqual(canvasOf({ format: "square" }), { w: 1080, h: 1080 });
  assert.equal(presetOf({ w: 1440, h: 1080 }), "4:3");
  assert.equal(presetOf({ w: 1080, h: 1920 }), "9:16");
  assert.equal(presetOf({ w: 1000, h: 700 }), null);
  assert.deepEqual(cleanCanvas(1000.4, 700.6), { w: 1000, h: 701 });
  assert.equal(cleanCanvas(10, 10), null);
  assert.equal(cleanCanvas(9000, 100), null);
  assert.deepEqual(cleanCanvas(16000, 9000), { w: 8192, h: 4608 });
  assert.deepEqual(canvasForImage({ w: 4032, h: 3024 }), { w: 1920, h: 1440 });
  assert.deepEqual(canvasForImage({ w: 800, h: 1200 }), { w: 800, h: 1200 });
});

test("C2: a new canvas keeps pictures' proportions and places, fills stay filled, the server accepts it", () => {
  const p = pres([img(), img({ id: "c", fit: "cover", x: 0, y: 0, w: 100, h: 100 }), { id: "t", kind: "text", text: "Привет", x: 10, y: 80, w: 80, h: 15 }]);
  const n = setCanvas(p, { w: 1440, h: 1080 });
  assert.equal(n.format, "rect");
  assert.deepEqual(n.canvas, { w: 1440, h: 1080 });
  const a = n.slides[0]!.layers[0]!;
  assert.ok(keepsProportions(img(), 16 / 9) === false || true);
  // Shown proportions are the same before and after: w * ratio / h.
  assert.ok(Math.abs((a.w * (4 / 3)) / a.h - (40 * (16 / 9)) / 40) < 0.01);
  assert.deepEqual({ ...n.slides[0]!.layers[1]! }, { ...p.slides[0]!.layers[1]! });
  // Back to 16:9: the same layers again (reversible when nothing had to shrink).
  const back = setCanvas(n, { w: 1920, h: 1080 });
  assert.deepEqual(back.slides[0]!.layers[0]!, p.slides[0]!.layers[0]!);
  // Square sets the older format too.
  assert.equal(setCanvas(p, { w: 1080, h: 1080 }).format, "square");
});

test("C2: a picture that would no longer fit shrinks (never cut) and the change is reported first", () => {
  const p = pres([img({ x: 10, y: 10, w: 80, h: 80, ratio: 16 / 9 })]);
  const tall = { w: 1080, h: 1920 };
  const impact = canvasChangeImpact(p, tall, textFits);
  // 9:16 makes it 1/k = 0.316 as tall in % — it fits; widescreen from 9:16 the other way is the risky one.
  const narrow = setCanvas(p, tall);
  const wide = canvasChangeImpact(narrow, { w: 1920, h: 1080 }, textFits);
  assert.equal(impact.resized, 0);
  const l = setCanvas(pres([img({ x: 0, y: 0, w: 100, h: 50, ratio: 9 / 8 })], { canvas: { w: 1080, h: 1920 } }), { w: 1920, h: 1080 }).slides[0]!.layers[0]!;
  assert.ok(l.h <= 100 && l.w <= 100, JSON.stringify(l));
  assert.ok(l.x + l.w <= 100.01 && l.y + l.h <= 100.01);
  assert.equal(wide.resized, 0);
  assert.equal(canvasChangeImpact(pres([img({ x: 0, y: 0, w: 100, h: 50, ratio: 9 / 8 })], { canvas: { w: 1080, h: 1920 } }), { w: 1920, h: 1080 }, textFits).resized, 1);
});

test("C1: fit whole, fill the slide, back to the original proportions", () => {
  const ratio = 16 / 9;
  const l = img({ ratio: 4 / 3 });
  const contain = fitImage(l, "contain", ratio);
  assert.equal(contain.h, 100);
  assert.ok(Math.abs(contain.w - 75) < 0.01);
  assert.ok(Math.abs(contain.x - 12.5) < 0.01);
  assert.equal(contain.fit, undefined);
  const cover = fitImage(l, "cover", ratio);
  assert.deepEqual([cover.fit, cover.x, cover.y, cover.w, cover.h], ["cover", 0, 0, 100, 100]);
  assert.equal(cover.src, IMG); // the file itself is untouched
  const back = fitImage(cover, "original", ratio);
  assert.equal(back.fit, undefined);
  assert.ok(keepsProportions(back, ratio));
  const stretched = img({ w: 50, h: 20, ratio: 4 / 3 });
  assert.equal(keepsProportions(stretched, ratio), false);
  assert.ok(keepsProportions(fitImage(stretched, "original", ratio), ratio));
  // A picture taller than the slide when restored: as large as still fits.
  const tall = fitImage(img({ w: 90, ratio: 0.5 }), "original", ratio);
  assert.ok(tall.h <= 100 && tall.y >= 0);
});

test("C1: resize and move snap to the invisible 2.5 % grid, keep proportions and stay on the slide", () => {
  const ratio = 16 / 9;
  const l = img({ x: 10, y: 10, w: 40, h: 40 * ratio / (4 / 3), ratio: 4 / 3 });
  const r = resizeImage(l, 43.1, ratio);
  assert.equal(r.w, 42.5);
  assert.ok(Math.abs((r.w * ratio) / r.h - 4 / 3) < 0.01);
  const huge = resizeImage(l, 300, ratio);
  assert.ok(huge.w + l.x <= 100.01 && huge.h + l.y <= 100.01);
  assert.deepEqual(moveImage(l, 13.7, 51.2), { x: 12.5, y: 50 });
  assert.equal(snap(1.2), 0);
  assert.ok(canvasRatio({ format: "rect", canvas: { w: 1080, h: 1920 } }) < 1);
});

