import { useLayoutEffect, useRef } from "react";
import { motion, useTransform, type MotionValue } from "motion/react";
import { RiLock2Line } from "@remixicon/react";
import { create } from "zustand";
import { APP_REGISTRY } from "@voidex/shared";
import { AppTile } from "@/brand/brand";
import { useLanguage } from "@/lib/i18n";
import { CLIENT_APPS } from "./app-registry";
import { barDrag, dragRadius, dragScale } from "./gesture-bar";
import { isPrivateApp, mountSnapshot, snapshotOf, useSnapshots } from "./snapshots";
import { foregroundId, useWM, type AppWindow } from "./window-manager";

const GAP = 16;

/** Step 2.9: the gesture bar is being dragged (and along which axis). */
export const useGesturePeek = create<{ active: boolean; axis: "x" | "y" | null }>(() => ({ active: false, axis: null }));

/**
 * The last screen of an app (see ./snapshots), drawn at `w`×`h` (the size it
 * had) — callers scale it. Protected apps and apps without a picture yet show
 * their icon on the app's background instead.
 */
export function SnapshotView({ win, className }: { win: AppWindow; className?: string }) {
  const lang = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const version = useSnapshots((s) => s.version);
  const snap = snapshotOf(win.id);
  const locked = isPrivateApp(win.appId);
  useLayoutEffect(() => {
    if (host.current && snap && !locked) mountSnapshot(host.current, snap);
    else host.current?.replaceChildren();
  }, [snap, version, locked]);
  const { Icon } = CLIENT_APPS[win.appId];
  return (
    <div className={className} data-snapshot={snap && !locked ? "live" : locked ? "locked" : "none"}>
      <div ref={host} className="vx-app pointer-events-none flex size-full flex-col overflow-hidden" aria-hidden />
      {(!snap || locked) && (
        <div className="vx-app absolute inset-0 flex flex-col items-center justify-center gap-3">
          <AppTile size={84} glow>
            <Icon className="size-12" />
          </AppTile>
          <span className="flex items-center gap-1.5 text-[16px] font-semibold">
            {locked && <RiLock2Line className="size-4 text-text-secondary" />}
            {APP_REGISTRY[win.appId].name[lang]}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * While the gesture bar is dragged: a soft backdrop and the neighbouring open
 * apps beside the one under the finger (they move and shrink with it), so the
 * drag turns into the app switcher in one motion. Below the windows, above
 * the home screen; never takes a touch.
 */
export function GesturePeek() {
  const active = useGesturePeek((s) => s.active);
  const axis = useGesturePeek((s) => s.axis);
  const wm = useWM();
  const { w, h } = wm.bounds;
  const fg = foregroundId(wm);
  const list = Object.values(wm.windows).sort((a, b) => a.openedAt - b.openedAt || a.id.localeCompare(b.id));
  const i = list.findIndex((x) => x.id === fg);
  const prev = i > 0 ? list[i - 1] : undefined;
  const next = i >= 0 ? list[i + 1] : undefined;
  const backdrop = useTransform(barDrag.y, (y) => Math.min(1, Math.max(0, (-y - 10) / 140)));
  if (!active || !fg) return null;
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 5 }} aria-hidden data-testid="gesture-peek" data-axis={axis ?? ""}>
      {/* Step 2.11 (the reference video): the home screen shows through behind the card, blurred and a little dimmed. */}
      {axis === "y" && <motion.div className="absolute inset-0 bg-black/[0.12] backdrop-blur-[22px] backdrop-saturate-[1.35]" style={{ opacity: backdrop }} data-testid="gesture-backdrop" />}
      {prev && (axis === "y" || axis === "x") && <Neighbour win={prev} side={-1} w={w} h={h} axis={axis} />}
      {next && (axis === "y" || axis === "x") && <Neighbour win={next} side={1} w={w} h={h} axis={axis} />}
    </div>
  );
}

function Neighbour({ win, side, w, h, axis }: { win: AppWindow; side: -1 | 1; w: number; h: number; axis: "x" | "y" | null }) {
  const scale = useTransform(barDrag.y, (y) => dragScale(-y, h));
  // The same corners as the card under the finger.
  const radius = useTransform(barDrag.y, (y) => Math.max(30, dragRadius(-y)));
  const x = useTransform([barDrag.x, scale] as MotionValue<number>[], ([bx, s]) => (bx as number) + side * (w * (s as number) + GAP));
  const opacity = useTransform([barDrag.x, barDrag.y] as MotionValue<number>[], ([bx, by]) =>
    axis === "x" ? (Math.sign(bx as number) === -side ? 1 : 0) : Math.min(1, Math.max(0, (-(by as number) - 30) / 110)),
  );
  return (
    <motion.div
      className="absolute left-0 top-0 overflow-hidden shadow-window"
      style={{ width: w, height: h, x, y: barDrag.y, scale, opacity, transformOrigin: "50% 100%", borderRadius: radius }}
      data-testid={`gesture-peek-${win.appId}`}
    >
      <SnapshotView win={win} className="relative size-full" />
    </motion.div>
  );
}
