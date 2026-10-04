import { useId } from "react";
import { motion } from "motion/react";
import { cx } from "@/lib/cx";

export type FaceState = "idle" | "scanning" | "success" | "error";

/**
 * The VOIDEX Face ID symbol — deliberately not the iPhone glyph (no corner
 * brackets, no eyes / nose / smile): a rounded VOIDEX hexagon holding a
 * wireframe bust — the head as the 3D mesh a face scan builds — crossed by a
 * scan beam while it works. Success fills it and adds a check; failure turns
 * it rose with a cross.
 */
export function FaceGlyph({ state, className }: { state: FaceState; className?: string }) {
  const id = useId().replace(/:/g, "");
  const error = state === "error";
  const ok = state === "success";
  const stroke = error ? `url(#fe-${id})` : `url(#fg-${id})`;
  return (
    <motion.svg
      viewBox="0 0 64 64"
      className={cx("overflow-visible", className)}
      aria-hidden
      data-face-state={state}
      animate={error ? { x: [0, -4, 4, -3, 3, 0] } : { x: 0 }}
      transition={{ duration: 0.42 }}
    >
      <defs>
        <linearGradient id={`fg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a996ff" />
          <stop offset="1" stopColor="#6a4df5" />
        </linearGradient>
        <linearGradient id={`fe-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f59ab4" />
          <stop offset="1" stopColor="#e0446f" />
        </linearGradient>
        <linearGradient id={`fb-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8f78ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#8f78ff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#8f78ff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`ff-${id}`} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#b9a9ff" stopOpacity="0.55" />
        </radialGradient>
        <clipPath id={`fc-${id}`}>
          <path d={HEX} />
        </clipPath>
      </defs>

      {/* The VOIDEX hexagon frame */}
      <path d={HEX} fill="none" stroke={stroke} strokeWidth="2.6" strokeLinejoin="round" />

      <g clipPath={`url(#fc-${id})`}>
        {/* A wireframe bust: the head as a scan mesh (outline, meridian, two parallels) and the shoulders */}
        <motion.g
          fill="none"
          stroke={stroke}
          strokeLinecap="round"
          animate={state === "scanning" ? { opacity: [0.55, 1, 0.55] } : { opacity: 1 }}
          transition={state === "scanning" ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        >
          <ellipse cx="32" cy="27" rx="10" ry="12.5" strokeWidth="2.4" fill={ok ? `url(#ff-${id})` : "none"} />
          <ellipse cx="32" cy="27" rx="4.4" ry="12.5" strokeWidth="1.4" strokeOpacity="0.7" />
          <path d="M22.4 23 Q32 26.2 41.6 23" strokeWidth="1.4" strokeOpacity="0.7" />
          <path d="M22.6 31.5 Q32 34.7 41.4 31.5" strokeWidth="1.4" strokeOpacity="0.7" />
          <path d="M14.5 54 C 16.5 45.5 23 42 32 42 C 41 42 47.5 45.5 49.5 54" strokeWidth="2.4" fill={ok ? `url(#ff-${id})` : "none"} />
        </motion.g>
        {/* The scan beam */}
        {state === "scanning" && (
          <motion.rect
            x="8"
            width="48"
            height="2.6"
            rx="1.3"
            fill={`url(#fb-${id})`}
            initial={{ y: 12 }}
            animate={{ y: [12, 52, 12] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </g>

      {/* Result badge */}
      {(ok || error) && (
        <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} style={{ originX: "50px", originY: "50px" }}>
          <circle cx="50" cy="50" r="8.5" fill={error ? "#e0446f" : "#6a4df5"} stroke="#fff" strokeWidth="2.2" />
          {ok ? (
            <path d="M46.2 50.2 l2.6 2.6 l5-5.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M47 47 l6 6 M53 47 l-6 6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          )}
        </motion.g>
      )}
    </motion.svg>
  );
}

/** A rounded hexagon (pointy top), the VOIDEX shape. */
const HEX = "M32 5.5 Q34 4.4 36 5.5 L54.6 16.3 Q56.6 17.4 56.6 19.7 L56.6 44.3 Q56.6 46.6 54.6 47.7 L36 58.5 Q34 59.6 32 58.5 L32 58.5 Q30 59.6 28 58.5 L9.4 47.7 Q7.4 46.6 7.4 44.3 L7.4 19.7 Q7.4 17.4 9.4 16.3 L28 5.5 Q30 4.4 32 5.5 Z";

/**
 * The round "lens" around the symbol (lock screen, setup, confirmation):
 * a milky disc with a violet ring; the ring sweeps while scanning and shows
 * the progress during setup.
 */
export function FaceLens({ state, size = 120, progress, className }: { state: FaceState; size?: number; progress?: number; className?: string }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const error = state === "error";
  const sweep = progress ?? (state === "scanning" ? 0.28 : state === "success" ? 1 : error ? 0.3 : 0);
  return (
    <div className={cx("relative grid place-items-center rounded-full", className)} style={{ width: size, height: size }} data-testid="face-lens" data-face-state={state}>
      <div className="absolute inset-[7%] rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffffff_0%,#f6f3ff_55%,#ebe5ff_100%)] shadow-[inset_0_1px_0_#fff,0_10px_30px_-10px_rgba(106,77,245,0.45)]" />
      <motion.svg
        viewBox="0 0 100 100"
        className="absolute inset-0"
        animate={state === "scanning" && progress === undefined ? { rotate: 360 } : { rotate: 0 }}
        transition={state === "scanning" && progress === undefined ? { duration: 1.6, repeat: Infinity, ease: "linear" } : { duration: 0.3 }}
      >
        <circle cx="50" cy="50" r={r} fill="none" stroke={error ? "rgba(224,68,111,0.18)" : "rgba(124,108,255,0.16)"} strokeWidth="2.5" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={error ? "#e0446f" : "#7c6cff"}
          strokeWidth="3"
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          strokeDasharray={c}
          animate={{ strokeDashoffset: c * (1 - sweep) }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      </motion.svg>
      <div className="relative" style={{ width: size * 0.5, height: size * 0.5 }}>
        <FaceGlyph state={state} className="size-full" />
      </div>
    </div>
  );
}
