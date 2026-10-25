import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Wallpaper, WallpaperPreset } from "@voidex/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { getFormFactor } from "@/lib/form-factor";

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

// ---------------------------------------------------------------------------
// Update 4 · D1: five new wallpapers that go with the new logos — light bases, violet / indigo / lilac
// light, soft blur, almost no small details (icons, labels and widgets stay readable). Each has its own
// composition for a phone (portrait) and a PC (landscape), and a night version for the dark theme.

const cover = (s: string, base: string) => `${svg(s)} center / cover no-repeat, ${base}`;
const box = (m: boolean): [number, number] => (m ? [1000, 2160] : [1600, 1000]);

/** «Сияние»: two large soft orbs, indigo top-right and violet bottom-left. */
function glow(m: boolean, night: boolean) {
  const [vw, vh] = box(m);
  const base = night ? "#13121b" : "#f7f5fd";
  const a = night ? "#3b2f8f" : "#b9a8ff";
  const b = night ? "#2b3a9a" : "#a9b8ff";
  const c = night ? "#4a2f7a" : "#e3d5ff";
  const o = (cx: number, cy: number, r: number, col: string, op: number) => `<circle cx='${cx}' cy='${cy}' r='${r}' fill='${col}' opacity='${op}' filter='url(#f)'/>`;
  return cover(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${vw} ${vh}' preserveAspectRatio='xMidYMid slice'><defs><filter id='f' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='${m ? 150 : 130}'/></filter></defs><rect width='${vw}' height='${vh}' fill='${base}'/>${
      m ? o(880, 260, 420, b, 0.8) + o(120, 1900, 520, a, 0.75) + o(700, 1250, 300, c, 0.7) : o(1420, 150, 420, b, 0.75) + o(180, 920, 460, a, 0.7) + o(900, 560, 260, c, 0.6)
    }</svg>`,
    base,
  );
}

/** «Шёлк»: two wide translucent ribbons sweeping across, like the logos' swirls. */
function silk(m: boolean, night: boolean) {
  const [vw, vh] = box(m);
  const base = night ? "#141320" : "#fbfaff";
  const r1 = night ? ["#4b3bb0", "#2a2f8c"] : ["#c9bbff", "#9fb0ff"];
  const r2 = night ? ["#5a3a9e", "#3a2c78"] : ["#e2d7ff", "#c6b4ff"];
  const p1 = m
    ? "M-200 1500 C 200 1180 520 1560 900 1250 C 1100 1090 1200 1000 1300 900 L1300 1350 C 1100 1500 800 1800 400 1840 C 100 1870 -100 1900 -200 2000 Z"
    : "M-200 760 C 260 520 620 900 1060 620 C 1300 470 1480 420 1800 380 L1800 700 C 1450 760 1260 840 980 960 C 600 1120 200 980 -200 1100 Z";
  const p2 = m
    ? "M-200 700 C 250 520 500 820 820 640 C 1000 540 1120 420 1300 380 L1300 640 C 1050 760 900 900 560 960 C 260 1010 0 900 -200 1000 Z"
    : "M-200 300 C 300 180 640 420 1000 300 C 1240 220 1440 120 1800 90 L1800 300 C 1400 360 1200 480 900 520 C 500 570 200 420 -200 520 Z";
  return cover(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${vw} ${vh}' preserveAspectRatio='xMidYMid slice'><defs>
<linearGradient id='a' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${r1[0]}'/><stop offset='1' stop-color='${r1[1]}'/></linearGradient>
<linearGradient id='b' x1='1' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${r2[0]}'/><stop offset='1' stop-color='${r2[1]}'/></linearGradient>
<filter id='f' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='${m ? 56 : 46}'/></filter>
<filter id='e' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='6'/></filter></defs>
<rect width='${vw}' height='${vh}' fill='${base}'/>
<path d='${p2}' fill='url(#b)' opacity='${night ? 0.7 : 0.75}' filter='url(#f)'/>
<path d='${p1}' fill='url(#a)' opacity='${night ? 0.75 : 0.62}' filter='url(#f)'/>
<path d='${p1.split(" L")[0]}' fill='none' stroke='#ffffff' stroke-opacity='${night ? 0.12 : 0.6}' stroke-width='8' filter='url(#e)'/></svg>`,
    base,
  );
}

/** «Рассвет»: calm vertical light, white at the top, a lilac haze at the bottom. */
function dawn(m: boolean, night: boolean) {
  const [vw, vh] = box(m);
  const top = night ? "#121119" : "#ffffff";
  const mid = night ? "#1b1830" : "#f1edff";
  const low = night ? "#2d2463" : "#d9cdff";
  const halo = night ? "#4c3fb8" : "#b8a6ff";
  return cover(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${vw} ${vh}' preserveAspectRatio='xMidYMid slice'><defs>
<linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${top}'/><stop offset='0.55' stop-color='${mid}'/><stop offset='1' stop-color='${low}'/></linearGradient>
<filter id='f' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='${m ? 160 : 140}'/></filter></defs>
<rect width='${vw}' height='${vh}' fill='url(#g)'/>
<ellipse cx='${vw / 2}' cy='${vh * 1.02}' rx='${vw * 0.7}' ry='${vh * (m ? 0.22 : 0.35)}' fill='${halo}' opacity='${night ? 0.55 : 0.5}' filter='url(#f)'/></svg>`,
    top,
  );
}

/** «Орбиты»: soft concentric rings (the Clock logo's discs), off-centre and very light. */
function orbit(m: boolean, night: boolean) {
  const [vw, vh] = box(m);
  const base = night ? "#13121a" : "#f9f8fd";
  const ring = night ? "#3c3378" : "#dcd3ff";
  const ring2 = night ? "#2e3878" : "#cdd5ff";
  const [cx, cy] = m ? [1000, 300] : [1500, 120];
  const rings = [260, 430, 620, 840, 1080].map((r, i) => `<circle cx='${cx}' cy='${cy}' r='${r}' fill='none' stroke='${i % 2 ? ring2 : ring}' stroke-width='${70 - i * 8}' opacity='${((night ? 0.55 : 0.6) - i * 0.08).toFixed(2)}'/>`).join("");
  return cover(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${vw} ${vh}' preserveAspectRatio='xMidYMid slice'><defs><filter id='f' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='22'/></filter>
<radialGradient id='r' cx='${cx / vw}' cy='${cy / vh}' r='0.5'><stop offset='0' stop-color='${night ? "#3f35a0" : "#c7b8ff"}' stop-opacity='0.7'/><stop offset='1' stop-color='${base}' stop-opacity='0'/></radialGradient></defs>
<rect width='${vw}' height='${vh}' fill='${base}'/><rect width='${vw}' height='${vh}' fill='url(#r)'/><g filter='url(#f)'>${rings}</g></svg>`,
    base,
  );
}

/** «Призма»: broad diagonal pastel bands — lavender, white, periwinkle — softly blurred. */
function prism(m: boolean, night: boolean) {
  const [vw, vh] = box(m);
  const base = night ? "#14131c" : "#f8f6ff";
  const cols = night ? ["#32297a", "#1c1a2c", "#26357e", "#3a2a6e"] : ["#e4dbff", "#ffffff", "#d6defe", "#ece4ff"];
  const k = m ? 2.4 : 1;
  const band = (i: number, col: string) => `<rect x='${-600 + i * 520}' y='-800' width='420' height='${3000 * k}' fill='${col}' transform='rotate(${m ? 22 : 32} ${vw / 2} ${vh / 2})'/>`;
  return cover(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${vw} ${vh}' preserveAspectRatio='xMidYMid slice'><defs><filter id='f' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='${m ? 70 : 60}'/></filter></defs>
<rect width='${vw}' height='${vh}' fill='${base}'/><g filter='url(#f)' opacity='0.95'>${cols.map((c, i) => band(i, c)).join("")}${band(4, cols[0]!)}</g></svg>`,
    base,
  );
}

const fresh = (f: (m: boolean, night: boolean) => string) => ({ css: f(false, false), night: f(false, true), mobile: f(true, false), mobileNight: f(true, true), dark: false });

/** A preset: its desktop look and night version; Update 4 · D1: a phone composition of its own (optional). */
export interface WallpaperLook {
  css: string;
  dark: boolean;
  night: string;
  mobile?: string;
  mobileNight?: string;
}

export const PRESETS: Record<WallpaperPreset, WallpaperLook> = {
  // Neutral built-ins
  white: { css: "#ffffff", dark: false, night: "#16161d" },
  aura: {
    css: "radial-gradient(70% 55% at 50% -8%, rgba(150,132,255,0.18) 0%, rgba(150,132,255,0) 72%), radial-gradient(45% 40% at 105% 105%, rgba(176,150,255,0.10) 0%, rgba(176,150,255,0) 70%), #fbfbfe",
    dark: false,
    night: "radial-gradient(70% 55% at 50% -8%, rgba(127,114,255,0.22) 0%, rgba(127,114,255,0) 72%), radial-gradient(45% 40% at 105% 105%, rgba(150,120,255,0.12) 0%, rgba(150,120,255,0) 70%), #14141b",
  },
  mist: { css: "#f0f0f3", dark: false, night: "#18181e" },
  // VOIDEX wave series (Step 2.15: each with a night version for the dark theme)
  "wave-light": { css: wave({ base: "#f6f4fc", band: "#ece7fb", a1: "#cbbffb", a2: "#b2a2f6" }), dark: false, night: wave({ base: "#15131d", band: "#1d1a2a", a1: "#3a3070", a2: "#4b3d92", edge: "#a597ff", edgeOpacity: 0.25 }) },
  "wave-milk": { css: wave({ base: "#faf8f4", band: "#f2efe9", a1: "#ffffff", a2: "#f6f4f0", edge: "#e9e5de", edgeOpacity: 0.6 }), dark: false, night: wave({ base: "#17161a", band: "#1d1c21", a1: "#28272d", a2: "#201f25", edge: "#3a3940", edgeOpacity: 0.5 }) },
  "wave-milk-violet": { css: wave({ base: "#f8f6f2", band: "#efebf8", a1: "#e6dffb", a2: "#d7ccf9" }), dark: false, night: wave({ base: "#16151b", band: "#1d1a27", a1: "#2d2748", a2: "#382e5e", edge: "#9d8fff", edgeOpacity: 0.22 }) },
  "wave-gray": { css: wave({ base: "#eeeef1", band: "#e6e6ea", a1: "#f8f8fa", a2: "#e9e9ed" }), dark: false, night: wave({ base: "#17171c", band: "#1d1d23", a1: "#27272e", a2: "#202026", edge: "#3a3a44", edgeOpacity: 0.5 }) },
  "wave-gray-purple": { css: wave({ base: "#ececef", band: "#e3e3e8", a1: "#ddd6f7", a2: "#cbc0f3" }), dark: false, night: wave({ base: "#16161b", band: "#1d1d24", a1: "#2b2646", a2: "#352c58", edge: "#9d8fff", edgeOpacity: 0.2 }) },
  "wave-milk-gray-purple": { css: wave({ base: "#f8f6f2", band: "#e7e7ec", a1: "#e1d9fa", a2: "#cfc4f6" }), dark: false, night: wave({ base: "#17161b", band: "#1e1e25", a1: "#2c2748", a2: "#372e5c", edge: "#9d8fff", edgeOpacity: 0.2 }) },
  // Update 4 · D1
  "v-glow": fresh(glow),
  "v-silk": fresh(silk),
  "v-dawn": fresh(dawn),
  "v-orbit": fresh(orbit),
  "v-prism": fresh(prism),
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

/**
 * Background for the home surface and whether it is dark (for label contrast).
 * Step 2.15: with the dark theme (`night`) the built-in wallpapers switch to
 * their night version, so the desktop is dark too; own colours and pictures stay.
 */
export function wallpaperStyle(w: Wallpaper, imageUrl: string | null | undefined, night = false, mobile = getFormFactor() === "mobile"): { style: CSSProperties; dark: boolean; image: boolean } {
  switch (w.kind) {
    case "color":
      return { style: { background: w.color }, dark: hexIsDark(w.color), image: false };
    case "preset": {
      // normalizeLayout maps retired ids; anything else falls back to white.
      const p = PRESETS[w.id as WallpaperPreset] ?? PRESETS.white;
      // Update 4 · D1: a phone shows the preset's own portrait composition when it has one.
      return night
        ? { style: { background: (mobile && p.mobileNight) || p.night }, dark: true, image: false }
        : { style: { background: (mobile && p.mobile) || p.css }, dark: p.dark, image: false };
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
