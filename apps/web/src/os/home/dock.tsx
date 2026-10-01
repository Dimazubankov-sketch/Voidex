import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { pinToDock, unpinFromDock, type AppId, type DockScale, type WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { AppTile, GLYPH_BOX } from "@/brand/brand";
import { useWM } from "../window-manager";
import { appLabel, openApp } from "./actions";
import { DesktopSearchBar } from "./search";
import { AppGlyph, ghost } from "./icons";
import { updateLayout, useWorkspaceLayout } from "./layout";
import { DesktopsGlyph, SpacesList } from "./spaces";
import { useHomeUi } from "./ui-store";

/**
 * The PC dock: ONE floating glass object at the bottom — the pinned apps
 * (synced with the account), the system "Desktops" item and the app search
 * field. Its width follows its content; with nothing in it but the search
 * field the glass disappears and only the field stays.
 *
 * Motion is a system accent, not a show: hover lifts an icon by ~12 % (its
 * neighbours a little), drawn with a transform so the dock's size and height
 * never change and nothing around it moves.
 */

/** Tile edge per dock size — a deliberately small range. */
export const DOCK_TILE: Record<DockScale, number> = { s: 40, m: 46, l: 52 };
const PAD = 8;
const BOTTOM = 14;
const PEAK = 1.12;

/** Height of the dock's glass shell. */
export const dockShellHeight = (scale: DockScale) => DOCK_TILE[scale] + PAD * 2 + 4;
/** Room the dock takes at the bottom of the PC screen; windows end right above it. */
export const dockZone = (scale: DockScale) => BOTTOM + dockShellHeight(scale) + 6;

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

/** Dock apps in display order: while a dock app is dragged, its preview position. */
function displayOrder(apps: AppId[], drag: ReturnType<typeof useHomeUi.getState>["drag"]): AppId[] {
  if (!drag?.fromDock || drag.item.kind !== "app" || drag.dockIndex === undefined || drag.unpin) return apps;
  const id = drag.item.id;
  const rest = apps.filter((a) => a !== id);
  rest.splice(Math.max(0, Math.min(drag.dockIndex, rest.length)), 0, id);
  return rest;
}

export function DesktopDock() {
  const t = useT();
  const { layout, apps: installed, ready } = useWorkspaceLayout();
  const mouseX = useMotionValue(Infinity);
  const drag = useHomeUi((s) => s.drag);
  if (!ready) return null;
  const scale = layout.desktop.dockScale;
  const tile = DOCK_TILE[scale];
  const apps = displayOrder(layout.desktop.dock ?? [], drag);
  const desktops = layout.desktop.dockDesktops;
  // A desktop icon dragged over the dock opens a gap where it would land.
  const gapAt = drag && !drag.fromDock && drag.overDock !== undefined ? drag.overDock : null;
  const glass = apps.length > 0 || desktops;

  return (
    <div className="pointer-events-none absolute inset-x-0 z-[30] flex justify-center px-6" style={{ bottom: BOTTOM }} data-testid="bottom-bar">
      <nav
        aria-label={t("dock.title")}
        data-dock
        data-system-ui
        className={cx("pointer-events-auto flex max-w-full items-center rounded-[26px]", glass && "vx-glass")}
        style={{ height: dockShellHeight(scale), padding: glass ? `0 ${PAD + 2}px` : 0, gap: 8 }}
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        data-testid="dock"
        data-glass-shell={glass || undefined}
      >
        <DesktopSearchBar apps={installed} layout={layout} inDock={glass} height={glass ? Math.max(36, tile - 6) : 44} />
        {glass && <span className="h-[55%] w-px shrink-0 bg-black/10" aria-hidden />}
        {apps.map((id, i) => (
          <DockSlot key={id} gap={gapAt === i} tile={tile}>
            <DockApp id={id} layout={layout} mouseX={mouseX} tile={tile} />
          </DockSlot>
        ))}
        {gapAt !== null && gapAt >= apps.length && <DockSlot gap tile={tile}>{null}</DockSlot>}
        {desktops && <DesktopsItem layout={layout} mouseX={mouseX} tile={tile} />}
      </nav>
    </div>
  );
}

function DockSlot({ gap, tile, children }: { gap: boolean; tile: number; children: ReactNode }) {
  return (
    <motion.div layout="position" className="flex items-center" transition={{ layout: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }}>
      <AnimatePresence initial={false}>
        {gap && (
          <motion.div
            className="mr-2 rounded-[14px] border-2 border-dashed border-primary/40"
            style={{ height: tile }}
            initial={{ width: 0 }}
            animate={{ width: tile }}
            exit={{ width: 0 }}
            transition={{ duration: 0.16 }}
          />
        )}
      </AnimatePresence>
      {children}
    </motion.div>
  );
}

/** Soft hover accent: a transform, so the dock itself never resizes or moves. */
function useMagnify(mouseX: MotionValue<number>, ref: React.RefObject<HTMLElement | null>, tile: number) {
  const reach = tile * 1.7;
  const distance = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect();
    return r ? x - (r.left + r.width / 2) : reach;
  });
  const target = useTransform(distance, [-reach, 0, reach], [1, PEAK, 1], { clamp: true });
  return useSpring(target, { stiffness: 520, damping: 40, mass: 0.35 });
}

function Tooltip({ label, show }: { label: string; show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          className="vx-glass-strong pointer-events-none absolute -top-11 left-1/2 whitespace-nowrap rounded-xl px-2.5 py-1 text-[12px] font-medium text-text"
          initial={{ opacity: 0, x: "-50%" }}
          animate={{ opacity: 1, x: "-50%" }}
          exit={{ opacity: 0, x: "-50%" }}
          transition={{ duration: 0.12 }}
        >
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function DockApp({ id, layout, mouseX, tile }: { id: AppId; layout: WorkspaceLayout; mouseX: MotionValue<number>; tile: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const scale = useMagnify(mouseX, ref, tile);
  const running = useWM((s) => Object.values(s.windows).some((w) => w.appId === id));
  const dragging = useHomeUi((s) => s.drag?.fromDock && s.drag.item.kind === "app" && s.drag.item.id === id);
  const [hover, setHover] = useState(false);
  const moved = useRef(false);
  const label = appLabel(layout, id);

  /**
   * Mouse drag: reorder inside the dock, drag up and out to unpin. While
   * dragging only a preview changes; the account's layout is written once, on
   * drop. Esc (or a cancelled pointer) leaves everything as it was. The app's
   * desktop icon is never touched — the dock is a separate view of the app.
   */
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || e.pointerType !== "mouse") return;
    const start = { x: e.clientX, y: e.clientY };
    moved.current = false;
    const dockTop = (e.currentTarget.closest("[data-dock]") as HTMLElement).getBoundingClientRect().top;
    const ui = useHomeUi.getState;
    const move = (ev: PointerEvent) => {
      if (!moved.current) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        moved.current = true;
        ui().setDrag({ item: { kind: "app", id }, size: tile, fromDock: true, dockIndex: (layout.desktop.dock ?? []).indexOf(id) });
        document.body.style.cursor = "grabbing";
      }
      ghost.x.set(ev.clientX);
      ghost.y.set(ev.clientY);
      const out = ev.clientY < dockTop - 60;
      const index = out ? ui().drag?.dockIndex : dockIndexAt(ev.clientX, id);
      if (ui().drag?.unpin !== out || ui().drag?.dockIndex !== index) ui().patchDrag({ unpin: out, dockIndex: index });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      document.body.style.cursor = "";
      const d = ui().drag;
      if (moved.current && commit && d) {
        if (d.unpin) updateLayout((l) => unpinFromDock(l, id));
        else if (d.dockIndex !== undefined) updateLayout((l) => pinToDock(l, id, d.dockIndex));
      }
      if (moved.current) ui().setDrag(null);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !moved.current) return;
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  };

  return (
    <button
      ref={ref}
      type="button"
      data-dock-app={id}
      className={cx("relative flex flex-col items-center outline-none", dragging && "opacity-0")}
      style={{ width: tile }}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragStart={(e) => e.preventDefault()}
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
      <motion.span data-tile className="block" style={{ width: tile, height: tile, scale, originY: 1 }}>
        <AppTile size={tile} className="!shadow-[0_2px_8px_rgba(20,20,40,0.12)]">
          <AppGlyph id={id} />
        </AppTile>
      </motion.span>
      <span className={cx("absolute -bottom-[7px] size-1 rounded-full", running ? "bg-primary" : "bg-transparent")} />
    </button>
  );
}

/** The "Desktops" system item: hover (or click) for the desktops. */
function DesktopsItem({ layout, mouseX, tile }: { layout: WorkspaceLayout; mouseX: MotionValue<number>; tile: number }) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const scale = useMagnify(mouseX, ref, tile);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const openTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => (window.clearTimeout(closeTimer.current), window.clearTimeout(openTimer.current)), []);
  const enter = () => {
    window.clearTimeout(closeTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), 140);
  };
  const leave = () => {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 260);
  };

  return (
    <div className="relative flex items-center" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        ref={ref}
        type="button"
        className="relative flex flex-col items-center outline-none"
        style={{ width: tile }}
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          useHomeUi.getState().openMenu({ x: e.clientX, y: e.clientY - 8, target: { kind: "dock-desktops" } });
        }}
        aria-label={t("home.spaces")}
        aria-expanded={open}
        data-testid="dock-desktops"
      >
        <motion.span className="block" style={{ width: tile, height: tile, scale, originY: 1 }}>
          <AppTile size={tile} className="!shadow-[0_2px_8px_rgba(20,20,40,0.12)]">
            <span className="flex items-center justify-center" style={{ width: GLYPH_BOX, height: GLYPH_BOX }}>
              <DesktopsGlyph className="size-full" />
            </span>
          </AppTile>
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="vx-glass-strong absolute bottom-[calc(100%+18px)] right-0 w-max max-w-[min(560px,calc(100vw-32px))] rounded-[22px] p-3"
            style={{ transformOrigin: "bottom right" }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.14 }}
            role="menu"
            data-testid="dock-desktops-menu"
          >
            <div className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{t("home.spaces")}</div>
            <SpacesList layout={layout} onPicked={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
