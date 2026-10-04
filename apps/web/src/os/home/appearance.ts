import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Wallpaper, WallpaperPreset } from "@voidex/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Desktop wallpapers. The default stays the white VOIDEX surface; everything
 * else is data (a system preset, a colour from older layouts, or the user's
 * own image), so new kinds can be added without touching stored layouts.
 *
 * The VOIDEX wave series follows the VOIDEX Mail artwork: a milky base and
 * two close shades split by one soft organic wave. Calm, light, no textures,
 * no text — they must carry icon labels, the dock and folders.
 */

const svg = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s.replace(/\s+/g, " "))}")`;

/**
 * One VOIDEX wave: a milky base, a soft lower band and the main wave falling
 * from the top-right corner in two close shades, with a faint light edge where
 * they meet. Anchored top-right so the wave stays in view on portrait phones.
 */
function wave({ base, band, a1, a2, edge = "#ffffff", edgeOpacity = 0.55 }: { base: string; band: string; a1: string; a2: string; edge?: string; edgeOpacity?: number }) {
  return `${svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 1000' preserveAspectRatio='xMaxYMin slice'>
<defs>
<linearGradient id='g' x1='0.15' y1='0' x2='0.85' y2='1'><stop offset='0' stop-color='${a1}'/><stop offset='1' stop-color='${a2}'/></linearGradient>
<linearGradient id='b' x1='0' y1='1' x2='1' y2='0'><stop offset='0' stop-color='${band}'/><stop offset='1' stop-color='${band}' stop-opacity='0'/></linearGradient>
<filter id='s' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='14'/></filter>
<filter id='e' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='5'/></filter>
</defs>
<rect width='1600' height='1000' fill='${base}'/>
<path filter='url(#s)' fill='url(#b)' d='M-60 1060 L-60 700 C 220 600 520 700 760 820 C 960 920 1120 960 1300 1060 Z'/>
<path filter='url(#s)' fill='url(#g)' d='M560 -60 C 690 160 860 330 1080 420 C 1290 505 1450 520 1660 640 L1660 -60 Z'/>
<path filter='url(#e)' fill='none' stroke='${edge}' stroke-opacity='${edgeOpacity}' stroke-width='10' d='M560 -60 C 690 160 860 330 1080 420 C 1290 505 1450 520 1660 640'/>
</svg>`)} center / cover no-repeat, ${base}`;
}

export const PRESETS: Record<WallpaperPreset, { css: string; dark: boolean }> = {
  // Neutral built-ins
  white: { css: "#ffffff", dark: false },
  aura: {
    css: "radial-gradient(70% 55% at 50% -8%, rgba(150,132,255,0.18) 0%, rgba(150,132,255,0) 72%), radial-gradient(45% 40% at 105% 105%, rgba(176,150,255,0.10) 0%, rgba(176,150,255,0) 70%), #fbfbfe",
    dark: false,
  },
  mist: { css: "#f0f0f3", dark: false },
  // VOIDEX wave series
  "wave-light": { css: wave({ base: "#f6f4fc", band: "#ece7fb", a1: "#cbbffb", a2: "#b2a2f6" }), dark: false },
  "wave-milk": { css: wave({ base: "#faf8f4", band: "#f2efe9", a1: "#ffffff", a2: "#f6f4f0", edge: "#e9e5de", edgeOpacity: 0.6 }), dark: false },
  "wave-milk-violet": { css: wave({ base: "#f8f6f2", band: "#efebf8", a1: "#e6dffb", a2: "#d7ccf9" }), dark: false },
  "wave-gray": { css: wave({ base: "#eeeef1", band: "#e6e6ea", a1: "#f8f8fa", a2: "#e9e9ed" }), dark: false },
  "wave-gray-purple": { css: wave({ base: "#ececef", band: "#e3e3e8", a1: "#ddd6f7", a2: "#cbc0f3" }), dark: false },
  "wave-milk-gray-purple": { css: wave({ base: "#f8f6f2", band: "#e7e7ec", a1: "#e1d9fa", a2: "#cfc4f6" }), dark: false },
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

export type WallpaperSlot = "desktop" | "lock";

/** The user's own wallpaper image (only the owner can fetch it); the lock screen has its own slot. */
export function useWallpaperImage(w: Wallpaper | null, slot: WallpaperSlot = "desktop") {
  const version = w?.kind === "image" ? w.version : null;
  const userId = useSession((s) => s.user?.id ?? "");
  return useQuery({
    queryKey: ["wallpaper", slot, version, userId],
    enabled: !!version,
    queryFn: async () => {
      // Step 2.5: a picture kept on this device (wallpaper sync off).
      if (version!.startsWith("local:")) {
        const { readLocalImage } = await import("./wallpapers");
        const blob = await readLocalImage(userId, slot);
        if (!blob) throw new Error("missing local wallpaper");
        return URL.createObjectURL(blob);
      }
      return URL.createObjectURL(await api.get<Blob>(`/api/account/wallpaper${slot === "lock" ? "?slot=lock" : ""}`));
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export type LabelTone = "dark" | "light";

/** Icon labels contrast with the wallpaper automatically. */
export function labelTone(surfaceDark: boolean): LabelTone {
  return surfaceDark ? "light" : "dark";
}

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
