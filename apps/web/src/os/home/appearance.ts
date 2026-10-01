import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Appearance, Wallpaper, WallpaperPreset } from "@voidex/shared";
import { api } from "@/lib/api";

/**
 * Desktop wallpapers. The default stays the white VOIDEX surface; everything
 * else is data (a system preset, a colour from older layouts, or the user's
 * own image), so new kinds can be added without touching stored layouts.
 *
 * The brand waves follow the VOIDEX Mail artwork: two close shades split by
 * one soft organic wave. Calm, flat, no textures — they must carry light and
 * dark icon labels, the dock and folders.
 */

const svg = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s.replace(/\s+/g, " "))}")`;

function wave({ base, a1, a2, echo, echoOpacity = 0.9, glow }: { base: string; a1: string; a2: string; echo: string; echoOpacity?: number; glow: string }) {
  // Anchored top-right so the wave stays in view on portrait phones too.
  return `${svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 1000' preserveAspectRatio='xMaxYMin slice'>
<defs>
<linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a1}'/><stop offset='1' stop-color='${a2}'/></linearGradient>
<filter id='s' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='18'/></filter>
<radialGradient id='r' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='${glow}' stop-opacity='.55'/><stop offset='1' stop-color='${glow}' stop-opacity='0'/></radialGradient>
</defs>
<rect width='1600' height='1000' fill='${base}'/>
<path filter='url(#s)' fill='${echo}' opacity='${echoOpacity}' d='M-40 1040 L-40 610 C 240 520 470 640 700 760 C 900 865 1060 900 1240 1040 Z'/>
<path filter='url(#s)' fill='url(#g)' d='M640 -40 C 760 150 900 300 1110 380 C 1300 452 1460 470 1640 560 L1640 -40 Z'/>
<ellipse cx='1180' cy='120' rx='520' ry='360' fill='url(#r)'/>
</svg>`)} center / cover no-repeat, ${base}`;
}

export const PRESETS: Record<WallpaperPreset, { css: string; dark: boolean }> = {
  white: { css: "#ffffff", dark: false },
  glow: {
    css: "radial-gradient(60% 45% at 50% 0%, rgba(124,108,255,0.24) 0%, rgba(124,108,255,0) 70%), radial-gradient(50% 40% at 100% 100%, rgba(162,102,255,0.14) 0%, rgba(162,102,255,0) 70%), #ffffff",
    dark: false,
  },
  mist: { css: "#f1f1f4", dark: false },
  aura: {
    css: "radial-gradient(70% 55% at 50% -8%, rgba(150,132,255,0.16) 0%, rgba(150,132,255,0) 72%), radial-gradient(45% 40% at 105% 105%, rgba(176,150,255,0.10) 0%, rgba(176,150,255,0) 70%), #fbfbfe",
    dark: false,
  },
  "wave-violet": { css: wave({ base: "#6f5df0", a1: "#9b8cf9", a2: "#8676f6", echo: "#7f6ef4", glow: "#b9adff" }), dark: true },
  "wave-milk": { css: wave({ base: "#f6f5f9", a1: "#ffffff", a2: "#fbfafd", echo: "#ecebf1", glow: "#ffffff" }), dark: false },
  "wave-milk-violet": { css: wave({ base: "#e9e4fb", a1: "#f6f4fe", a2: "#f1eefd", echo: "#f3f1fd", glow: "#ffffff" }), dark: false },
  "wave-gray-violet": { css: wave({ base: "#e8e8ed", a1: "#dcd6f5", a2: "#e3def7", echo: "#eeeef2", glow: "#d4ccf6" }), dark: false },
};

/** What the built-in "VOIDEX" wallpaper looks like (for its swatch). */
export const DEFAULT_SWATCH = "radial-gradient(70% 30% at 50% 0%, rgba(124,108,255,0.30) 0%, rgba(124,108,255,0) 70%), #ffffff";

function hexIsDark(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

/** Background for the home surface and whether it is dark (for label contrast). */
export function wallpaperStyle(w: Wallpaper, imageUrl: string | null | undefined): { style: CSSProperties; dark: boolean; image: boolean } {
  switch (w.kind) {
    case "color":
      return { style: { background: w.color }, dark: hexIsDark(w.color), image: false };
    case "preset": {
      // normalizeLayout maps retired ids; anything else falls back to white.
      const p = PRESETS[w.id as WallpaperPreset] ?? PRESETS.white;
      return { style: { background: p.css }, dark: p.dark, image: false };
    }
    case "image":
      return {
        // One shorthand only: mixing background and backgroundColor confuses React's style diffing.
        style: { background: imageUrl ? `url("${imageUrl}") center / cover no-repeat, var(--surface)` : "var(--surface)" },
        // Photos vary: labels get light text with a soft shadow.
        dark: true,
        image: true,
      };
    default:
      return { style: { background: "var(--surface)" }, dark: false, image: false };
  }
}

/** The user's own wallpaper image (only the owner can fetch it). */
export function useWallpaperImage(w: Wallpaper) {
  const version = w.kind === "image" ? w.version : null;
  return useQuery({
    queryKey: ["wallpaper", version],
    enabled: !!version,
    queryFn: async () => URL.createObjectURL(await api.get<Blob>("/api/account/wallpaper")),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export type LabelTone = "dark" | "light";

export function labelTone(a: Appearance, surfaceDark: boolean): LabelTone {
  if (a.labelColor === "dark") return "dark";
  if (a.labelColor === "light") return "light";
  return surfaceDark ? "light" : "dark";
}

export const LABEL_SIZES: Record<Appearance["labelSize"], { name: number; caption: number }> = {
  s: { name: 12, caption: 11 },
  m: { name: 14, caption: 12 },
  l: { name: 16, caption: 13 },
};

/** Scales a picture down (long side ≤ 2560 px) and re-encodes it before upload. */
export async function prepareWallpaper(file: File, max = 2560): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.86));
}
