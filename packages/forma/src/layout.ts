import type { Device, Layout, Rect, Size } from "./types.js";

/** The invisible editor grid: positions and sizes snap to it. */
export const GRID = 8;

const snap = (n: number) => Math.round(n / GRID) * GRID;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Moves or resizes a rect by a pointer delta (in design pixels), snapped to
 * the grid and kept inside the frame (Forma 0.1 behaviour, extended with the
 * component's minimum size).
 */
export function snapRect(rect: Rect, dx: number, dy: number, mode: "move" | "resize", frame: Size, min: Size = { width: 24, height: 16 }): Rect {
  if (mode === "move") {
    return { ...rect, x: clamp(snap(rect.x + dx), 0, Math.max(0, frame.width - rect.width)), y: clamp(snap(rect.y + dy), 0, Math.max(0, frame.height - rect.height)) };
  }
  return {
    ...rect,
    width: clamp(snap(rect.width + dx), Math.min(min.width, frame.width - rect.x), frame.width - rect.x),
    height: clamp(snap(rect.height + dy), Math.min(min.height, frame.height - rect.y), frame.height - rect.y),
  };
}

/** Which design profile a running app uses for a viewport width. */
export function profileFor(viewportWidth: number): Device {
  return viewportWidth >= 700 ? "desktop" : "phone";
}

/** Preview sizes offered by the editor (the design sizes are 390 x 844 and 1280 x 800). */
export const PREVIEW_SIZES: Record<Device, { id: string; label: string; width: number; height: number }[]> = {
  phone: [
    { id: "phone-s", label: "360 × 780", width: 360, height: 780 },
    { id: "phone", label: "390 × 844", width: 390, height: 844 },
    { id: "phone-l", label: "430 × 932", width: 430, height: 932 },
  ],
  desktop: [
    { id: "desktop-s", label: "1024 × 700", width: 1024, height: 700 },
    { id: "desktop", label: "1280 × 800", width: 1280, height: 800 },
    { id: "desktop-l", label: "1440 × 900", width: 1440, height: 900 },
  ],
};

/**
 * Where an element is drawn on a viewport that differs from the design frame:
 *
 *   left / top      keeps its distance to the left / top edge
 *   right / bottom  keeps its distance to the right / bottom edge
 *   center          keeps its offset from the centre
 *   stretch         keeps both distances (grows with the screen)
 *   scale           position and size follow the screen proportionally
 *
 * Width is then held between minWidth and maxWidth (re-anchored by the same
 * rule). `content` is the screen's content height (scrolling screens are
 * taller than the frame); the viewport adds its extra height to it.
 */
export function resolveLayout(l: Layout, design: Size, viewport: Size, contentHeight = design.height): Rect {
  const dw = viewport.width - design.width;
  const dh = viewport.height - design.height;
  const sx = viewport.width / design.width;
  const sy = viewport.height / design.height;

  let x = l.x;
  let width = l.width;
  switch (l.h) {
    case "right":
      x = l.x + dw;
      break;
    case "center":
      x = l.x + dw / 2;
      break;
    case "stretch":
      width = Math.max(1, l.width + dw);
      break;
    case "scale":
      x = l.x * sx;
      width = l.width * sx;
      break;
    default:
      break;
  }
  const bounded = clamp(width, l.minWidth ?? 1, l.maxWidth ?? Number.POSITIVE_INFINITY);
  if (bounded !== width) {
    // Re-anchor the bounded width on the side the element follows.
    if (l.h === "right") x += width - bounded;
    else if (l.h === "center" || l.h === "stretch" || l.h === "scale") x += (width - bounded) / 2;
    width = bounded;
  }

  let y = l.y;
  let height = l.height;
  const extra = contentHeight > design.height ? 0 : dh;
  switch (l.v) {
    case "bottom":
      y = l.y + extra;
      break;
    case "center":
      y = l.y + extra / 2;
      break;
    case "stretch":
      height = Math.max(1, l.height + extra);
      break;
    case "scale":
      y = l.y * sy;
      height = l.height * sy;
      break;
    default:
      break;
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
