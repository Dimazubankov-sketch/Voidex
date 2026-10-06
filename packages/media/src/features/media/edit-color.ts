export type ColorSettings = { brightness: number; contrast: number; saturation: number; warmth: number; grayscale: number };
/** Identical pixel pipeline for previews and exports, including Safari without Canvas.filter. */
export function applyColor(data: Uint8ClampedArray, s: ColorSettings) {
  const b = s.brightness / 100,
    c = s.contrast / 100,
    sat = s.saturation / 100,
    w = s.warmth / 100,
    g = s.grayscale / 100;
  if (b === 1 && c === 1 && sat === 1 && w === 0 && g === 0) return;
  for (let i = 0; i < data.length; i += 4) {
    let r = (data[i]! * b - 127.5) * c + 127.5,
      green = (data[i + 1]! * b - 127.5) * c + 127.5,
      blue = (data[i + 2]! * b - 127.5) * c + 127.5;
    const lum = 0.2126 * r + 0.7152 * green + 0.0722 * blue;
    r = lum + (r - lum) * sat;
    green = lum + (green - lum) * sat;
    blue = lum + (blue - lum) * sat;
    const sr = 0.393 * r + 0.769 * green + 0.189 * blue,
      sg = 0.349 * r + 0.686 * green + 0.168 * blue,
      sb = 0.272 * r + 0.534 * green + 0.131 * blue;
    r = r * (1 - w) + sr * w;
    green = green * (1 - w) + sg * w;
    blue = blue * (1 - w) + sb * w;
    const mono = 0.2126 * r + 0.7152 * green + 0.0722 * blue;
    data[i] = r * (1 - g) + mono * g;
    data[i + 1] = green * (1 - g) + mono * g;
    data[i + 2] = blue * (1 - g) + mono * g;
  }
}
export function filterPixels(ctx: CanvasRenderingContext2D, s: ColorSettings) {
  const image = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  applyColor(image.data, s);
  ctx.putImageData(image, 0, 0);
}
