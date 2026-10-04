import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";

export function VoidexMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/voidex-mark.png"
      alt="VOIDEX"
      draggable={false}
      data-system-asset
      onContextMenu={(e) => e.preventDefault()}
      className={cx("select-none object-contain", className)}
    />
  );
}

// ---------------------------------------------------------------------------
// App icon normalisation. Logos are never redrawn; each one is shown through
// its own content box (transparent margins trimmed), so every logo fills the
// same visual box inside the tile — one icon set, whatever padding the source
// files have.

const trimmed = new Map<string, { x: number; y: number; w: number; h: number; nw: number; nh: number }>();

/** Bounding box of the non-transparent pixels of a raster logo (measured once per file). */
function useContentBox(src: string) {
  const [box, setBox] = useState(() => trimmed.get(src) ?? null);
  useEffect(() => {
    if (trimmed.has(src)) return setBox(trimmed.get(src)!);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
        let x0 = width, y0 = height, x1 = -1, y1 = -1;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++)
            if (data[(y * width + x) * 4 + 3]! > 8) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
        const b = { ...(x1 < 0 ? { x: 0, y: 0, w: width, h: height } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }), nw: width, nh: height };
        trimmed.set(src, b);
        setBox(b);
      } catch {
        /* unreadable: show the file as it is */
      }
    };
    img.src = src;
  }, [src]);
  return box;
}

/**
 * A raster logo scaled to its content box: an SVG whose viewBox is the trimmed
 * box, so the visible mark fills the element (aspect kept, centred).
 */
export function TrimmedLogo({ src, className }: { src: string; className?: string }) {
  const box = useContentBox(src);
  const vb = box ?? { x: 0, y: 0, w: 1, h: 1 };
  return (
    <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className={className} aria-hidden data-system-ui preserveAspectRatio="xMidYMid meet">
      {box && <image href={src} x={0} y={0} width={box.nw} height={box.nh} />}
    </svg>
  );
}

export function VoidexWordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <VoidexMark className="size-8" />
      <span className="text-[22px] font-bold tracking-[0.18em] text-text">VOIDEX</span>
    </span>
  );
}

/*
 * App logos (Step 2.2 set): the provided artwork, used as is — only the white
 * tile, glow and page background of the source images were cut away. Shown
 * through TrimmedLogo so every mark fills the same box in its tile.
 */

/** Settings — hexagonal shutter. */
export function SettingsGlyph({ className }: { className?: string }) {
  return <TrimmedLogo src="/brand/app-settings.png" className={className} />;
}

/** Mail — the envelope. */
export function MailGlyph({ className }: { className?: string }) {
  return <TrimmedLogo src="/brand/app-mail.png" className={className} />;
}

/** Vibex — the speech-bubble mark. */
export function VibexGlyph({ className }: { className?: string }) {
  return <TrimmedLogo src="/brand/app-vibex.png" className={className} />;
}

/** Calculator: the user's logo (Step 2.3), extracted from the delivered artwork without redrawing. */
export function CalculatorGlyph({ className }: { className?: string }) {
  return <TrimmedLogo src="/brand/app-calculator.png" className={className} />;
}

/** Notes: the user's Voidex Notes logo (Step 2.5), cut out of the delivered artwork without redrawing. */
export function NotesGlyph({ className }: { className?: string }) {
  return <TrimmedLogo src="/brand/app-notes.png" className={className} />;
}

/** Share of the tile the logo's content box fills — the same for every app. */
export const GLYPH_BOX = "52%";

/** Rounded white tile with a soft glow — the VOIDEX app icon container. */
export function AppTile({ children, size = 72, className, glow }: { children: React.ReactNode; size?: number; className?: string; glow?: boolean }) {
  return (
    <span
      data-system-ui
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      className={cx("relative inline-flex shrink-0 items-center justify-center bg-surface shadow-tile", className)}
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
    >
      {glow && <span className="absolute inset-2 -z-10 rounded-[inherit] bg-primary/30 blur-xl" />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------

const AVATAR_TONES = ["#7c6cff", "#4b6bff", "#a266ff", "#2f9bff", "#e0669c", "#16a37a", "#f08c2e"];

function tone(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length]!;
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** Avatar image is fetched with the access token (it isn't public), then shown from a blob URL. */
export function Avatar({
  name,
  userId,
  version = 0,
  size = 40,
  className,
}: {
  name: string;
  userId?: string;
  version?: number;
  size?: number;
  className?: string;
}) {
  const { data: src } = useQuery({
    queryKey: ["avatar", userId, version],
    enabled: !!userId && version > 0,
    staleTime: Infinity,
    queryFn: async () => URL.createObjectURL(await api.get<Blob>(`/api/users/${userId}/avatar`)),
  });
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, background: src ? undefined : tone(name), fontSize: size * 0.38 }}
      aria-hidden
    >
      {src ? <img src={src} alt="" className="size-full object-cover" draggable={false} /> : initials(name)}
    </span>
  );
}
