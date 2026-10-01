import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { RiAddLine, RiCheckLine } from "@remixicon/react";
import { DESKTOP_SPACES_MAX, pinToDock, unpinFromDock, type AppId, type WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { AppTile } from "@/brand/brand";
import { useWM } from "../window-manager";
import { appLabel, openApp } from "./actions";
import { wallpaperStyle, useWallpaperImage } from "./appearance";
import { newSpace, spaceLabel } from "./context-menu";
import { DesktopSearchBar } from "./search";
import { AppGlyph, ghost } from "./icons";
import { updateLayout, useWorkspaceLayout } from "./layout";
import { useHomeUi } from "./ui-store";

/**
 * The PC dock: a compact floating glass bar at the bottom with the apps the user
 * pinned (synced with the account) and the system "Desktops" icon. Hovering
 * magnifies icons softly; drag to reorder, drag up and out to unpin, drop an
 * app from the desktop onto it to pin. No pinned apps → no dock at all.
 */

const BASE = 48;
const PEAK = 62;
const REACH = 150;
/** Room the bottom bar (search + dock) takes on PC; windows stay above it. */
export const DOCK_ZONE = 100;

export function useDockVisible() {
  const { layout, ready } = useWorkspaceLayout();
  return ready && (layout.desktop.dock?.length ?? 0) > 0;
}

/**
 * PC bottom bar: the app search field and, next to it, the dock. The search is
 * never inside the dock's glass; with nothing pinned only the search remains.
 */
export function DesktopBottomBar() {
  const { layout, apps, ready } = useWorkspaceLayout();
  if (!ready) return null;
  const dock = (layout.desktop.dock?.length ?? 0) > 0;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[24px] z-[30] flex items-end justify-center gap-3 px-6" data-testid="bottom-bar">
      <div className={cx("pointer-events-auto mb-3 min-w-0", dock ? "w-[min(340px,34vw)] shrink" : "w-full max-w-[440px]")}>
        <DesktopSearchBar apps={apps} layout={layout} />
      </div>
      {dock && <Dock />}
    </div>
  );
}

/** Insertion index for a pointer x among the dock's app icons (excluding `skip`). */
export function dockIndexAt(x: number, skip?: AppId): number {
  const items = [...document.querySelectorAll<HTMLElement>("[data-dock-app]")].filter((el) => el.dataset.dockApp !== skip);
  let i = 0;
  for (const el of items) {
    const r = el.getBoundingClientRect();
    if (x > r.left + r.width / 2) i++;
  }
  return i;
}

export function Dock() {
  const t = useT();
  const { layout, ready } = useWorkspaceLayout();
  const mouseX = useMotionValue(Infinity);
  const drag = useHomeUi((s) => s.drag);
  const apps = layout.desktop.dock ?? [];
  // A desktop icon dragged over the dock opens a gap where it would land.
  const gapAt = drag && !drag.fromDock && drag.overDock !== undefined ? drag.overDock : null;
  if (!ready || !apps.length) return null;

  return (
    <motion.nav
        aria-label={t("dock.title")}
        data-dock
        className="vx-glass pointer-events-auto flex h-[68px] shrink-0 items-end gap-2 rounded-[24px] px-2.5 pb-2"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        data-testid="dock"
      >
        {apps.map((id, i) => (
          <DockSlot key={id} gap={gapAt === i}>
            <DockApp id={id} layout={layout} mouseX={mouseX} />
          </DockSlot>
        ))}
        {gapAt !== null && gapAt >= apps.length && <DockSlot gap>{null}</DockSlot>}
        <div className="mx-0.5 mb-2 h-9 w-px self-end bg-black/10" aria-hidden />
        <DesktopsIcon layout={layout} mouseX={mouseX} />
    </motion.nav>
  );
}

function DockSlot({ gap, children }: { gap: boolean; children: React.ReactNode }) {
  return (
    <motion.div layout className="flex items-end" transition={{ layout: { duration: 0.22 } }}>
      <AnimatePresence initial={false}>
        {gap && <motion.div className="mr-2 h-12 rounded-[14px] border-2 border-dashed border-primary/40" initial={{ width: 0 }} animate={{ width: BASE }} exit={{ width: 0 }} />}
      </AnimatePresence>
      {children}
    </motion.div>
  );
}

/** Soft magnification: icons grow with the cursor's distance, neighbours a little. */
function useMagnify(mouseX: MotionValue<number>, ref: React.RefObject<HTMLElement | null>) {
  const distance = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect();
    return r ? x - (r.left + r.width / 2) : REACH;
  });
  const target = useTransform(distance, [-REACH, 0, REACH], [BASE, PEAK, BASE], { clamp: true });
  return useSpring(target, { stiffness: 380, damping: 28, mass: 0.4 });
}

function Tooltip({ label, show }: { label: string; show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          className="vx-glass-strong pointer-events-none absolute -top-10 left-1/2 whitespace-nowrap rounded-xl px-2.5 py-1 text-[12px] font-medium text-text"
          initial={{ opacity: 0, y: 4, x: "-50%" }}
          animate={{ opacity: 1, y: 0, x: "-50%" }}
          exit={{ opacity: 0, x: "-50%" }}
          transition={{ duration: 0.12 }}
        >
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function DockApp({ id, layout, mouseX }: { id: AppId; layout: WorkspaceLayout; mouseX: MotionValue<number> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const size = useMagnify(mouseX, ref);
  const running = useWM((s) => Object.values(s.windows).some((w) => w.appId === id));
  const dragging = useHomeUi((s) => s.drag?.fromDock && s.drag.item.kind === "app" && s.drag.item.id === id);
  const [hover, setHover] = useState(false);
  const moved = useRef(false);
  const label = appLabel(layout, id);

  // Mouse drag: reorder inside the dock, drag up and out to unpin.
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || e.pointerType !== "mouse") return;
    const start = { x: e.clientX, y: e.clientY };
    moved.current = false;
    const dockTop = (e.currentTarget.closest("[data-dock]") as HTMLElement).getBoundingClientRect().top;
    let lastIndex = -1;
    const move = (ev: PointerEvent) => {
      if (!moved.current) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        moved.current = true;
        useHomeUi.getState().setDrag({ item: { kind: "app", id }, size: BASE, fromDock: true });
        document.body.style.cursor = "grabbing";
      }
      ghost.x.set(ev.clientX);
      ghost.y.set(ev.clientY);
      const out = ev.clientY < dockTop - 60;
      useHomeUi.getState().patchDrag({ unpin: out });
      if (!out) {
        const index = dockIndexAt(ev.clientX, id);
        if (index !== lastIndex) {
          lastIndex = index;
          updateLayout((l) => pinToDock(l, id, index));
        }
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      const d = useHomeUi.getState().drag;
      if (moved.current && d?.unpin) updateLayout((l) => unpinFromDock(l, id));
      if (moved.current) useHomeUi.getState().setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      layout
      data-dock-app={id}
      className={cx("relative flex flex-col items-center outline-none", dragging && "opacity-0")}
      style={{ width: size }}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        if (moved.current) return;
        openApp(id, e.currentTarget);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        useHomeUi.getState().openMenu({ x: e.clientX, y: e.clientY - 8, target: { kind: "dock-app", id } });
      }}
      aria-label={label}
      data-testid={`dock-app-${id}`}
    >
      <Tooltip label={label} show={hover && !dragging} />
      <motion.span data-tile className="block" style={{ width: size, height: size }}>
        <DockTile size={size}>
          <AppGlyph id={id} />
        </DockTile>
      </motion.span>
      <span className={cx("absolute -bottom-1.5 size-1 rounded-full", running ? "bg-primary" : "bg-transparent")} />
    </motion.button>
  );
}

/** An AppTile that follows a motion value size. */
function DockTile({ size, children }: { size: MotionValue<number>; children: React.ReactNode }) {
  const [px, setPx] = useState(BASE);
  useEffect(() => size.on("change", (v) => setPx(Math.round(v))), [size]);
  return (
    <AppTile size={px} className="!shadow-[0_2px_8px_rgba(20,20,40,0.12)]">
      {children}
    </AppTile>
  );
}

/** System icon of the dock: switch between PC desktops, create a new one. */
function DesktopsIcon({ layout, mouseX }: { layout: WorkspaceLayout; mouseX: MotionValue<number> }) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const size = useMagnify(mouseX, ref);
  const space = useWM((s) => s.space);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const openTimer = useRef<number | undefined>(undefined);
  const enter = () => {
    window.clearTimeout(closeTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), 120);
  };
  const leave = () => {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 260);
  };
  const spaces = layout.desktop.spaces;
  const image = useWallpaperImage(layout.appearance.wallpaper);
  const wp = layout.appearance.wallpaper.kind === "default" ? { background: "var(--surface)" } : wallpaperStyle(layout.appearance.wallpaper, image.data).style;

  return (
    <div className="relative flex items-end" onMouseEnter={enter} onMouseLeave={leave}>
      <motion.button
        ref={ref}
        type="button"
        className="relative flex flex-col items-center outline-none"
        style={{ width: size }}
        onClick={() => setOpen((o) => !o)}
        aria-label={t("home.spaces")}
        aria-expanded={open}
        data-testid="dock-desktops"
      >
        <motion.span className="block" style={{ width: size, height: size }}>
          <DockTile size={size}>
            <DesktopsGlyph />
          </DockTile>
        </motion.span>
        <span className="absolute -bottom-1.5 size-1 rounded-full bg-transparent" />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="vx-glass-strong absolute bottom-[calc(100%+14px)] right-0 w-max max-w-[min(560px,calc(100vw-32px))] rounded-[22px] p-3"
            style={{ transformOrigin: "bottom right" }}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            role="menu"
            data-testid="dock-desktops-menu"
          >
            <div className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{t("home.spaces")}</div>
            <div className="flex gap-2.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
              {spaces.map((s, i) => {
                const active = s.id === space;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      useWM.getState().setSpace(s.id);
                      setOpen(false);
                    }}
                    className="pressable flex w-[104px] shrink-0 flex-col items-center gap-1.5"
                    data-testid={`dock-space-${i + 1}`}
                  >
                    <span
                      className={cx("relative block h-[62px] w-[100px] overflow-hidden rounded-[12px] border border-black/10", active && "ring-[3px] ring-primary ring-offset-2 ring-offset-transparent")}
                      style={wp}
                    >
                      <span className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
                        {s.items.slice(0, 5).map((it) => (
                          <span key={`${it.kind}:${it.id}`} className="size-2.5 rounded-[3px] bg-white/90 shadow-sm" />
                        ))}
                      </span>
                      {active && (
                        <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-white">
                          <RiCheckLine className="size-3" />
                        </span>
                      )}
                    </span>
                    <span className={cx("w-full truncate text-center text-[12px]", active ? "font-semibold text-text" : "text-text-secondary")}>{spaceLabel(t, layout, s.id)}</span>
                  </button>
                );
              })}
              {spaces.length < DESKTOP_SPACES_MAX && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    newSpace();
                    setOpen(false);
                  }}
                  className="pressable flex w-[104px] shrink-0 flex-col items-center gap-1.5"
                  data-testid="dock-space-add"
                >
                  <span className="flex h-[62px] w-[100px] items-center justify-center rounded-[12px] border-2 border-dashed border-black/15 text-text-secondary hover:border-primary/50 hover:text-primary">
                    <RiAddLine className="size-6" />
                  </span>
                  <span className="text-[12px] text-text-secondary">{t("home.newSpace")}</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Glyph of the Desktops system app: two layered screens. */
function DesktopsGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="size-[62%]" aria-hidden>
      <defs>
        <linearGradient id="vx-desk-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9a8cff" />
          <stop offset="1" stopColor="#6c5cff" />
        </linearGradient>
      </defs>
      <rect x="13" y="7" width="29" height="22" rx="6" fill="#c9c2ff" />
      <rect x="6" y="15" width="29" height="22" rx="6" fill="url(#vx-desk-a)" />
      <rect x="12" y="40" width="17" height="3" rx="1.5" fill="#b9b0ff" />
    </svg>
  );
}
