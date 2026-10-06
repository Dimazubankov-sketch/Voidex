import { filterPixels } from "./edit-color";
import type { MediaItem } from "./model";
export type EditSettings = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  grayscale: number;
  rotation: number;
  flip: boolean;
  crop: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  strokes: {
    color: string;
    width: number;
    points: {
      x: number;
      y: number;
    }[];
  }[];
  texts: {
    text: string;
    color: string;
    x: number;
    y: number;
  }[];
};
export const freshEdit = (): EditSettings => ({
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
  grayscale: 0,
  rotation: 0,
  flip: false,
  crop: { x: 0, y: 0, w: 100, h: 100 },
  strokes: [],
  texts: [],
});
export const editFilter = (e: EditSettings) =>
  `brightness(${e.brightness}%) contrast(${e.contrast}%) saturate(${e.saturation}%) sepia(${e.warmth}%) grayscale(${e.grayscale}%)`;
export const filters = [
  ["original", "Оригинал", {}],
  ["voidex", "VOIDEX", { saturation: 110, warmth: 12, contrast: 108 }],
  ["vivid", "Яркий", { saturation: 140, contrast: 115 }],
  ["cinema", "Кино", { saturation: 75, contrast: 120, warmth: 10 }],
  ["mono", "Ч/Б", { grayscale: 100, contrast: 115 }],
  ["soft", "Мягкий", { contrast: 88, saturation: 85, brightness: 108 }],
  ["warm", "Тёплый", { warmth: 30, saturation: 115 }],
  ["cool", "Прохладный", { warmth: 0, saturation: 80, contrast: 112, brightness: 108 }],
  ["sunset", "Закат", { warmth: 45, saturation: 130, contrast: 105 }],
  ["fade", "Плёнка", { contrast: 78, warmth: 15, saturation: 80 }],
  ["noir", "Нуар", { grayscale: 100, contrast: 155, brightness: 90 }],
  ["pearl", "Жемчуг", { saturation: 60, brightness: 118, contrast: 92 }],
  ["forest", "Лес", { saturation: 145, contrast: 110, brightness: 95 }],
] as const;
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось открыть изображение"));
    image.src = src;
  });
}
export async function renderImage(
  item: MediaItem,
  settings: EditSettings,
  max = 4096,
  resolveSrc = (s: string) => s,
): Promise<HTMLCanvasElement> {
  const image = await loadImage(resolveSrc(item.src));
  const r = item.region || { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight, sw: image.naturalWidth, sh: image.naturalHeight };
  const crop = settings.crop;
  const sx = r.x + (r.w * crop.x) / 100,
    sy = r.y + (r.h * crop.y) / 100,
    sw = (r.w * crop.w) / 100,
    sh = (r.h * crop.h) / 100;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale)),
    height = Math.max(1, Math.round(sh * scale));
  const rotated = settings.rotation % 180 !== 0;
  const canvas = document.createElement("canvas");
  canvas.width = rotated ? height : width;
  canvas.height = rotated ? width : height;
  const ctx = canvas.getContext("2d")!;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((settings.rotation * Math.PI) / 180);
  if (settings.flip) ctx.scale(-1, 1);
  ctx.filter = "none";
  ctx.drawImage(image, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
  ctx.restore();
  ctx.filter = "none";
  filterPixels(ctx, settings);
  for (const s of settings.strokes) {
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = (s.width * canvas.width) / 1000;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    s.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x * canvas.width, p.y * canvas.height);
      else ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
    });
    ctx.stroke();
  }
  for (const t of settings.texts) {
    ctx.fillStyle = t.color;
    ctx.font = `600 ${Math.max(16, canvas.width * 0.055)}px system-ui`;
    ctx.fillText(t.text, t.x * canvas.width, t.y * canvas.height);
  }
  return canvas;
}
export function canvasBlob(canvas: HTMLCanvasElement, type = "image/jpeg"): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось сохранить изображение"))), type, 0.93),
  );
}
export async function itemBlob(item: MediaItem, resolveSrc = (s: string) => s): Promise<Blob> {
  if (item.region) return canvasBlob(await renderImage(item, freshEdit(), 4096, resolveSrc));
  const r = await fetch(resolveSrc(item.src));
  if (!r.ok) throw new Error("Не удалось скачать файл");
  return r.blob();
}
export function saveBlob(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1500);
}
export const fileName = (m: MediaItem) =>
  m.name.replace(/[\\/:*?"<>|]/g, "_") +
  (m.kind === "video"
    ? m.mime === "video/webm"
      ? ".webm"
      : m.mime === "video/quicktime"
        ? ".mov"
        : ".mp4"
    : m.region || m.mime === "image/jpeg"
      ? ".jpg"
      : m.mime === "image/png"
        ? ".png"
        : m.mime === "image/webp"
          ? ".webp"
          : ".gif");
export async function shareItems(items: MediaItem[], resolveSrc = (s: string) => s) {
  const files = await Promise.all(
    items.map(async (m) => new File([await itemBlob(m, resolveSrc)], fileName(m), { type: m.region ? "image/jpeg" : m.mime })),
  );
  if (navigator.canShare?.({ files })) {
    await navigator.share({ files, title: "Медиатека Voidex" });
    return "shared";
  }
  if (files.length === 1) saveBlob(files[0]!, files[0]!.name);
  else saveBlob(await zipFiles(files), "Voidex-медиатека.zip");
  return "downloaded";
}
export async function copyImage(m: MediaItem, resolveSrc = (s: string) => s) {
  if (m.kind === "video") throw new Error("Видео можно скачать или отправить через «Поделиться».");
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error("Браузер не поддерживает копирование изображения. Используйте «Скачать».");
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": await canvasBlob(await renderImage(m, freshEdit(), 4096, resolveSrc), "image/png") }),
  ]);
}
export async function readFileMetadata(file: File): Promise<{
  width: number;
  height: number;
  duration?: number;
}> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("video/"))
      return await new Promise((resolve, reject) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => {
          if (Number.isFinite(v.duration)) resolve({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
          else {
            v.onseeked = () =>
              resolve({ width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : v.currentTime });
            v.currentTime = 1e10;
          }
        };
        v.onerror = () => reject(new Error("Браузер не может открыть это видео. Попробуйте MP4 (H.264)."));
        v.src = url;
      });
    const image = await loadImage(url);
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
// ZIP STORE, UTF-8 filenames; no third-party archiver or server file roundtrip.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (a: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of a) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export async function zipFiles(files: File[]): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [i, file] of files.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = new TextEncoder().encode(`${i + 1}-${file.name}`);
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    chunks.push(header, bytes);
    const entry = new Uint8Array(46 + name.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint16(4, 20, true);
    ev.setUint16(6, 20, true);
    ev.setUint16(8, 0x800, true);
    ev.setUint32(16, crc, true);
    ev.setUint32(20, bytes.length, true);
    ev.setUint32(24, bytes.length, true);
    ev.setUint16(28, name.length, true);
    ev.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += header.length + bytes.length;
  }
  const size = central.reduce((n, a) => n + a.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end] as BlobPart[], { type: "application/zip" });
}
