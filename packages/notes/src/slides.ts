/**
 * Stage C — the presentation canvas and pictures on slides. Pure functions (no React, no DOM).
 *
 * Layers are placed in % of the slide, so a slide of any proportions shows them in the same logical place.
 * The canvas has a size in pixels (16:9, 4:3, 9:16, 1:1, custom, or a picture's own proportions). Changing it:
 *  - pictures keep their own proportions (their height in % is rescaled) and stay on the slide;
 *  - a picture that fills the slide keeps filling it;
 *  - text boxes keep their box (the text rewraps; the editor warns when it no longer fits).
 * `canvasChangeImpact` tells what would be cropped or moved, so the UI can ask before changing anything.
 */
import type { PresentationBody, Slide, SlideLayer } from "@voidex/shared";

// The same limits the server checks (CANVAS_MIN / CANVAS_MAX in @voidex/shared; this package imports types only).
const CANVAS_MIN = 64;
const CANVAS_MAX = 8192;

export interface Canvas {
  w: number;
  h: number;
}

export const CANVAS_PRESETS = {
  "16:9": { w: 1920, h: 1080 },
  "4:3": { w: 1440, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
} as const satisfies Record<string, Canvas>;
export type CanvasPreset = keyof typeof CANVAS_PRESETS;

/** The canvas of a presentation (older ones: from their format). */
export function canvasOf(p: Pick<PresentationBody, "format" | "canvas">): Canvas {
  if (p.canvas && p.canvas.w > 0 && p.canvas.h > 0) return { w: p.canvas.w, h: p.canvas.h };
  return p.format === "square" ? { ...CANVAS_PRESETS["1:1"] } : { ...CANVAS_PRESETS["16:9"] };
}

/** Width / height of the slides of a presentation. */
export const canvasRatio = (p: Pick<PresentationBody, "format" | "canvas">) => {
  const c = canvasOf(p);
  return c.w / c.h;
};

/** The preset a canvas is (same proportions), or null for a custom one. */
export function presetOf(c: Canvas): CanvasPreset | null {
  for (const [k, v] of Object.entries(CANVAS_PRESETS)) if (Math.abs(v.w / v.h - c.w / c.h) < 0.002) return k as CanvasPreset;
  return null;
}

/** A valid canvas from any numbers (whole pixels, inside the limits, never more than 8:1). */
export function cleanCanvas(w: number, h: number): Canvas | null {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  let W = Math.round(w);
  let H = Math.round(h);
  const big = Math.max(W, H);
  if (big > CANVAS_MAX) {
    W = Math.round((W * CANVAS_MAX) / big);
    H = Math.round((H * CANVAS_MAX) / big);
  }
  if (W < CANVAS_MIN || H < CANVAS_MIN) return null;
  if (W / H > 8 || H / W > 8) return null;
  return { w: W, h: H };
}

/** A canvas with a picture's proportions: its long side 1920 px (smaller pictures keep their size). */
export function canvasForImage(px: Canvas): Canvas | null {
  const long = Math.max(px.w, px.h);
  const k = long > 1920 ? 1920 / long : 1;
  return cleanCanvas(px.w * k, px.h * k);
}

const round = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** The invisible grid pictures snap to while moved or resized: 40 steps across and down (2.5 %). */
export const SLIDE_GRID = 2.5;
export const snap = (v: number, step = SLIDE_GRID) => round(Math.round(v / step) * step);

export type ImageFit = "contain" | "cover" | "original";

/**
 * A picture placed on a slide of `slideRatio` (width / height):
 *  - "contain": the whole picture as large as the slide allows, centred (nothing cropped);
 *  - "cover": it fills the slide; what sticks out is cropped on screen only (the file stays whole);
 *  - "original": back to its own proportions, keeping its width and place (as large as still fits).
 */
export function fitImage(l: SlideLayer, mode: ImageFit, slideRatio: number, imageRatio = l.ratio): SlideLayer {
  const r = imageRatio && imageRatio > 0 ? imageRatio : slideRatio;
  // `fit: undefined` (not a missing key): the result is merged over the stored layer, which may say "cover".
  const base: SlideLayer = { ...l, fit: undefined };
  if (mode === "cover") return { ...base, fit: "cover", x: 0, y: 0, w: 100, h: 100 };
  // Height in % of the slide for a width in % of the slide, at the picture's own proportions.
  const hFor = (w: number) => (w * slideRatio) / r;
  if (mode === "contain") {
    let w = 100;
    let h = hFor(w);
    if (h > 100) {
      h = 100;
      w = (100 * r) / slideRatio;
    }
    return { ...base, w: round(w), h: round(h), x: round((100 - w) / 2), y: round((100 - h) / 2) };
  }
  // original
  let w = l.fit === "cover" ? 60 : clamp(l.w, 5, 100);
  let h = hFor(w);
  if (h > 100) {
    h = 100;
    w = (100 * r) / slideRatio;
  }
  const x = l.fit === "cover" ? (100 - w) / 2 : clamp(l.x, 0, 100 - w);
  const y = l.fit === "cover" ? (100 - h) / 2 : clamp(l.y, 0, 100 - h);
  return { ...base, w: round(w), h: round(h), x: round(x), y: round(y) };
}

/** Does the picture show at its own proportions in its box (within 1 %)? */
export function keepsProportions(l: SlideLayer, slideRatio: number): boolean {
  if (l.kind !== "image" || !l.ratio || l.fit === "cover") return true;
  const shown = (l.w * slideRatio) / l.h;
  return Math.abs(shown / l.ratio - 1) < 0.01;
}

/**
 * Resizing a picture by its corner: the box follows the pointer, snaps to the invisible grid and keeps
 * the picture's proportions (width decides), never leaving the slide.
 */
export function resizeImage(l: SlideLayer, w: number, slideRatio: number): Pick<SlideLayer, "w" | "h"> {
  const r = l.ratio && l.ratio > 0 ? l.ratio : (l.w * slideRatio) / Math.max(1, l.h);
  let W = clamp(snap(w), SLIDE_GRID * 2, 100 - l.x);
  let H = (W * slideRatio) / r;
  if (l.y + H > 100) {
    H = 100 - l.y;
    W = (H * r) / slideRatio;
  }
  return { w: round(W), h: round(H) };
}

/** Moving a picture: snapped to the grid, kept (at least partly) on the slide. */
export function moveImage(l: SlideLayer, x: number, y: number): Pick<SlideLayer, "x" | "y"> {
  return { x: clamp(snap(x), -l.w + 5, 95), y: clamp(snap(y), -l.h + 5, 95) };
}

/** A layer as it is on a slide of the new proportions (see the module comment). */
function adaptLayer(l: SlideLayer, k: number): SlideLayer {
  // k = old ratio / new ratio: > 1 the slide gets taller relative to its width.
  if (l.kind === "image") {
    if (l.fit === "cover") return l;
    let w = l.w;
    let h = l.h / k;
    // Too tall now: shrink both (proportions kept) instead of cutting it.
    if (h > 100) {
      w = (w * 100) / h;
      h = 100;
    }
    if (w > 100) {
      h = (h * 100) / w;
      w = 100;
    }
    // A picture that hung over an edge on purpose keeps doing so; otherwise it stays whole on the slide.
    const x = l.x < 0 ? l.x : Math.min(l.x, 100 - w);
    const y = l.y < 0 ? l.y : Math.min(l.y, 100 - h);
    return { ...l, w: round(w), h: round(h), x: round(x), y: round(y) };
  }
  const y = Math.min(l.y, 96);
  const h = Math.min(l.h, 100 - y);
  return { ...l, y, h: Math.max(4, h) };
}

/** The presentation on another canvas (format kept in step for older apps). */
export function setCanvas(p: PresentationBody, next: Canvas): PresentationBody {
  const from = canvasRatio(p);
  const to = next.w / next.h;
  const k = from / to;
  const format = next.w === next.h ? "square" : "rect";
  const same = Math.abs(k - 1) < 1e-6;
  return {
    ...p,
    format,
    canvas: { w: next.w, h: next.h },
    slides: same ? p.slides : p.slides.map((s) => ({ ...s, layers: s.layers.map((l) => adaptLayer(l, k)) })),
  };
}

export interface CanvasImpact {
  /** Pictures that would get smaller or move to stay whole on the slide. */
  resized: number;
  /** Slides whose text would no longer fit its box. */
  textOverflow: number;
}

/**
 * What changing the canvas would do beyond a plain re-proportioning (the UI asks first when anything
 * would be resized, moved or no longer fit). Nothing is ever cut: pictures shrink, text boxes keep
 * their text.
 */
export function canvasChangeImpact(p: PresentationBody, next: Canvas, textFits: (l: SlideLayer, ratio: number) => boolean): CanvasImpact {
  const after = setCanvas(p, next);
  const ratio = next.w / next.h;
  let resized = 0;
  let textOverflow = 0;
  after.slides.forEach((s: Slide, i) => {
    const before = p.slides[i]!;
    const k = canvasRatio(p) / ratio;
    s.layers.forEach((l, j) => {
      const o = before.layers[j]!;
      if (l.kind === "image" && o.fit !== "cover") {
        const plainH = o.h / k;
        if (Math.abs(l.w - o.w) > 0.05 || Math.abs(l.h - plainH) > 0.05 || Math.abs(l.x - o.x) > 0.05 || Math.abs(l.y - o.y) > 0.05) resized++;
      }
    });
    if (s.layers.some((l) => !l.hidden && l.kind !== "image" && !textFits(l, ratio))) textOverflow++;
  });
  return { resized, textOverflow };
}
