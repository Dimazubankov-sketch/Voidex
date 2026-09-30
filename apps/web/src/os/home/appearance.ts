import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Appearance, Wallpaper, WallpaperGradient, WallpaperPreset } from "@voidex/shared";
import { api } from "@/lib/api";

/**
 * Desktop wallpapers. The default stays the white VOIDEX surface; everything
 * else is data (a colour, a named gradient / preset, or the user's own image)
 * so new kinds can be added without touching stored layouts.
 */

export const WALLPAPER_COLORS = ["#ffffff", "#f4f3f8", "#ede9fe", "#e0f2fe", "#dcfce7", "#fef3c7", "#fde2e7", "#1f1d2b", "#0f172a"];

export const GRADIENTS: Record<WallpaperGradient, { css: string; dark: boolean }> = {
  dawn: { css: "linear-gradient(160deg, #fff7ed 0%, #fde2e7 45%, #ede9fe 100%)", dark: false },
  lavender: { css: "linear-gradient(160deg, #f5f3ff 0%, #ddd6fe 55%, #c4b5fd 100%)", dark: false },
  mist: { css: "linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)", dark: false },
  aurora: { css: "linear-gradient(135deg, #a5f3fc 0%, #c4b5fd 50%, #f0abfc 100%)", dark: false },
  sand: { css: "linear-gradient(160deg, #fefce8 0%, #fde68a 100%)", dark: false },
  night: { css: "linear-gradient(160deg, #1e1b4b 0%, #312e81 55%, #4c1d95 100%)", dark: true },
};

export const PRESETS: Record<WallpaperPreset, { css: string; dark: boolean }> = {
  voidex: {
    css: "radial-gradient(60% 45% at 50% 0%, rgba(124,108,255,0.28) 0%, rgba(124,108,255,0) 70%), radial-gradient(50% 40% at 100% 100%, rgba(162,102,255,0.18) 0%, rgba(162,102,255,0) 70%), #ffffff",
    dark: false,
  },
  waves: {
    css: "radial-gradient(120% 60% at 0% 100%, rgba(79,70,229,0.18) 0%, transparent 60%), radial-gradient(120% 60% at 100% 0%, rgba(14,165,233,0.16) 0%, transparent 60%), linear-gradient(180deg, #f8faff 0%, #eef2ff 100%)",
    dark: false,
  },
  orbit: {
    css: "radial-gradient(circle at 50% 40%, rgba(176,160,255,0.55) 0, rgba(124,108,255,0.18) 7%, transparent 16%), radial-gradient(circle at 50% 40%, transparent 0 24%, rgba(124,108,255,0.28) 24.2% 24.5%, transparent 24.8%), radial-gradient(circle at 50% 40%, transparent 0 38%, rgba(124,108,255,0.18) 38.2% 38.5%, transparent 38.8%), linear-gradient(180deg, #151326 0%, #231d45 100%)",
    dark: true,
  },
  grid: {
    css: "linear-gradient(rgba(124,108,255,0.08) 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, rgba(124,108,255,0.08) 1px, transparent 1px) 0 0 / 28px 28px, #fbfbfe",
    dark: false,
  },
};

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
    case "gradient":
      return { style: { background: GRADIENTS[w.id].css }, dark: GRADIENTS[w.id].dark, image: false };
    case "preset":
      return { style: { background: PRESETS[w.id].css }, dark: PRESETS[w.id].dark, image: false };
    case "image":
      return {
        style: imageUrl ? { backgroundImage: `url("${imageUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : {},
        // Photos vary: labels get light text with a soft shadow.
        dark: true,
        image: true,
      };
    default:
      return { style: {}, dark: false, image: false };
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
