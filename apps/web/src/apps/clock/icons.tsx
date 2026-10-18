/**
 * Step 2.14: the line icons of Voidex Clock (the Voidex-Clock set, 24 x 24,
 * stroke 1.6). They are interface icons; the Clock logo is never one of them.
 */
const PATHS = {
  world: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 7h14M5 17h14" /></>,
  alarm: <><circle cx="12" cy="13" r="8" /><path d="M12 8v5l3 2M3 4l3-2m12 0 3 2M6 20l-2 2m14-2 2 2" /></>,
  stopwatch: <><circle cx="12" cy="14" r="8" /><path d="M12 10v5m-3-13h6m-3 0v4m6 1 2-2" /></>,
  timers: <path d="M12 3a9 9 0 1 1-7 3M12 3v6l4 3M3 3v5h5" />,
  plus: <path d="M12 4v16M4 12h16" />,
  x: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  back: <path d="m15 5-7 7 7 7" />,
  next: <path d="m9 5 7 7-7 7" />,
  play: <path d="m9 5 11 7-11 7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />,
  sound: <path d="m11 4-5 4H2v8h4l5 4zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />,
  search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" /></>,
  moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z" />,
  reset: <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
} as const;

export type ClockIconName = keyof typeof PATHS;

export function ClockIcon({ name, className }: { name: ClockIconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className ?? "vc-icon"} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
