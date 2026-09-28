import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";

export function VoidexMark({ className }: { className?: string }) {
  return <img src="/brand/voidex-mark.png" alt="VOIDEX" draggable={false} className={cx("select-none object-contain", className)} />;
}

export function VoidexWordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <VoidexMark className="size-8" />
      <span className="text-[22px] font-bold tracking-[0.18em] text-text">VOIDEX</span>
    </span>
  );
}

/** Settings — hexagonal shutter (after the provided reference). */
export function SettingsGlyph({ className }: { className?: string }) {
  const id = useId();
  // Six segments between an outer and inner hexagon, three alternating tones.
  const R = 44;
  const r = 20;
  const pt = (rad: number, i: number) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return [50 + rad * Math.cos(a), 50 + rad * Math.sin(a)] as const;
  };
  const tones = [`url(#${id}a)`, `url(#${id}b)`, `url(#${id}c)`];
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7b5cff" />
          <stop offset="1" stopColor="#5a3cf0" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a58cff" />
          <stop offset="1" stopColor="#8a6cfa" />
        </linearGradient>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c7b6ff" />
          <stop offset="1" stopColor="#ab95fc" />
        </linearGradient>
      </defs>
      {Array.from({ length: 6 }, (_, i) => {
        // Each blade is offset by half a side, which gives the folded "shutter" look.
        const o1 = pt(R, i);
        const o2 = pt(R, i + 1);
        const i2 = pt(r, i + 1.5);
        const i1 = pt(r, i + 0.5);
        return (
          <path
            key={i}
            d={`M${o1.join(",")} L${o2.join(",")} L${i2.join(",")} L${i1.join(",")} Z`}
            fill={tones[i % 3]}
            stroke="white"
            strokeOpacity="0.35"
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

/** Mail — folded envelope of three triangles (after the provided reference). */
export function MailGlyph({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8a64ff" />
          <stop offset="1" stopColor="#5b2cf2" />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9b8ff" />
          <stop offset="1" stopColor="#b39cfb" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#9a74ff" />
          <stop offset="1" stopColor="#8358fb" />
        </linearGradient>
      </defs>
      <g strokeLinejoin="round">
        <path d="M14 18 L50 52 L14 84 Z" fill={`url(#${id}l)`} stroke={`url(#${id}l)`} strokeWidth="5" />
        <path d="M86 18 L86 84 L50 52 Z" fill={`url(#${id}r)`} stroke={`url(#${id}r)`} strokeWidth="5" />
        <path d="M14 84 L50 52 L86 84 Z" fill={`url(#${id}b)`} stroke={`url(#${id}b)`} strokeWidth="5" />
      </g>
    </svg>
  );
}

/** Rounded white tile with a soft glow — the VOIDEX app icon container. */
export function AppTile({ children, size = 72, className, glow }: { children: React.ReactNode; size?: number; className?: string; glow?: boolean }) {
  return (
    <span
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
