import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { RiBrushLine, RiCheckLine } from "@remixicon/react";
import { APP_CATEGORIES, layoutItemKey, type LayoutItem, type WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { formatDate, useLanguage, useT } from "@/lib/i18n";
import { IconButton } from "@/ui/controls";
import { Sheet } from "@/ui/overlays";
import { useWM } from "../window-manager";
import { CATEGORY_LABEL, appCategory, appLabel, itemKey, openApp } from "./actions";
import { labelTone, useWallpaperImage, wallpaperStyle, type LabelTone } from "./appearance";
import { AppearanceSheet } from "./appearance-panel";
import { BrushMenu } from "./brush-menu";
import { ContextMenu } from "./context-menu";
import { FolderOverlay } from "./folder-overlay";
import { useHomeGestures } from "./gestures";
import { dockZone } from "./dock";
import { DragGhost, HomeItem, type IconMetrics, type LabelStyle } from "./icons";
import { Launcher } from "./launcher";
import { useWorkspaceLayout } from "./layout";
import { RenameSheet } from "./rename-sheet";
import { MobileSearch } from "./search";
import { DesktopsGlyph, SpacesList, useSpacesTitle } from "./spaces";
import { useHomeUi } from "./ui-store";
import { DesktopWidgets, MobileWidgets, WidgetsPanel } from "./widgets";

const EASE = [0.22, 1, 0.36, 1] as const;

interface Pager {
  move: (dx: number) => void;
  end: (dx: number, vx: number) => void;
}

/**
 * PC scale (Settings → "Scale"): icon, cell and label sizes together. Small is
 * really compact, large only moderately bigger than the standard.
 */
const SCALE: Record<WorkspaceLayout["desktop"]["density"], IconMetrics & { name: number; caption: number }> = {
  compact: { tile: 52, cell: 90, gapX: 6, gapY: 10, name: 12, caption: 11 },
  normal: { tile: 64, cell: 106, gapX: 12, gapY: 16, name: 13, caption: 11.5 },
  spacious: { tile: 74, cell: 120, gapX: 16, gapY: 22, name: 14, caption: 12 },
};

/**
 * The VOIDEX home screen: wallpaper, icons and folders, edit mode, phone pages
 * and PC desktops. One component for both form factors; the arrangement comes
 * from the synced workspace layout, gestures from `useHomeGestures`.
 */
export function HomeScreen({ receded, hidden, launcherBtn }: { receded: boolean; hidden: boolean; launcherBtn: RefObject<HTMLButtonElement | null> }) {
  const t = useT();
  const ff = useFormFactor();
  const { layout, apps, ready } = useWorkspaceLayout();
  const editing = useHomeUi((s) => s.editing);
  const drag = useHomeUi((s) => s.drag);
  const brushBtn = useRef<HTMLButtonElement>(null);
  const image = useWallpaperImage(layout.appearance.wallpaper);
  const wp = wallpaperStyle(layout.appearance.wallpaper, image.data);
  const plain = layout.appearance.wallpaper.kind === "default";
  const tone = labelTone(wp.dark);
  const scale = SCALE[layout.desktop.density];
  const cols4 = layout.mobile.columns === 4;
  // Label sizes follow the scale (PC) or the icons per row (phone) — no separate setting.
  const label: LabelStyle = useMemo(
    () => (ff === "mobile" ? { tone, name: cols4 ? 12 : 13, caption: cols4 ? 10.5 : 11, captions: layout.appearance.captions } : { tone, name: scale.name, caption: scale.caption, captions: layout.appearance.captions }),
    [ff, tone, cols4, scale, layout.appearance.captions],
  );
  const pagerRef = useRef<Pager | null>(null);
  const mobileCategories = ff === "mobile" && layout.mobile.view === "categories";
  const free = layout.desktop.arrange === "free";
  const canArrange = ff === "mobile" ? !mobileCategories : layout.desktop.view === "grid" && (free || layout.desktop.sort === "manual");
  // The icon being dragged leaves an empty slot — but only a drag that started on
  // the home screen: dragging inside the dock never hides the desktop icon.
  const dragKey = drag && !drag.fromFolder && !drag.fromDock ? itemKey(drag.item) : null;

  const gestures = useHomeGestures({
    ff,
    canArrange,
    free: ff === "desktop" && free && layout.desktop.view === "grid",
    pager: ff === "mobile" && !mobileCategories ? { move: (dx) => pagerRef.current?.move(dx), end: (dx, vx) => pagerRef.current?.end(dx, vx) } : undefined,
    onPullDown: ff === "mobile" && !mobileCategories ? () => useHomeUi.getState().setSearch({ open: true, query: "" }) : undefined,
  });

  const onOpen = useCallback((item: LayoutItem, el: HTMLElement) => {
    const ui = useHomeUi.getState();
    if (item.kind === "folder") {
      ui.setOpenFolder({ id: item.id, origin: (el.querySelector("[data-tile]") ?? el).getBoundingClientRect() });
      return;
    }
    if (ui.editing) return; // in edit mode a tap on an app does nothing (like iOS)
    ui.setOpenFolder(null);
    openApp(item.id, el);
  }, []);

  // The glass level is a document-wide material: dock, folders and menus render in portals.
  useEffect(() => {
    document.documentElement.dataset.glass = layout.appearance.glass;
  }, [layout.appearance.glass]);

  // Leaving the home screen (an app comes to the front) ends edit mode.
  useEffect(() => {
    if (hidden || receded) useHomeUi.getState().setEditing(false);
  }, [hidden, receded]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ui = useHomeUi.getState();
      // Escape closes only the top layer: edit mode ends when nothing is open above it.
      // (Dialogs close themselves on the same key and may already be closing.)
      const layerOpen =
        ui.openFolder ||
        ui.menu ||
        ui.appearanceOpen ||
        ui.brushOpen ||
        ui.widgetsOpen ||
        ui.spacesOpen ||
        ui.renaming ||
        ui.launcherOpen ||
        ui.search.open ||
        ui.drag ||
        document.querySelector('[role="dialog"], [role="menu"]');
      if (e.key === "Escape" && ui.brushOpen) ui.setBrushOpen(false);
      if (e.key === "Escape" && ui.editing && !layerOpen) ui.setEditing(false);
      // PC: Ctrl+Alt+← / → switches desktops.
      if (ff === "desktop" && e.ctrlKey && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const spaces = layout.desktop.spaces;
        const i = spaces.findIndex((s) => s.id === useWM.getState().space);
        const next = spaces[Math.max(0, Math.min(spaces.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1)))];
        if (next) useWM.getState().setSpace(next.id);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [ff, layout.desktop.spaces]);

  const glassBtn = plain ? undefined : "vx-glass text-text hover:bg-white/75";
  const brushOpen = useHomeUi((s) => s.brushOpen);

  return (
    <motion.main
      className={cx(
        "absolute flex flex-col overflow-hidden shadow-surface [-webkit-touch-callout:none]",
        plain && "bg-surface",
        ff === "mobile" ? "inset-[10px] top-[max(var(--safe-top),10px)] bottom-[max(var(--safe-bottom),10px)] rounded-[32px]" : "inset-[14px] rounded-[34px]",
      )}
      style={plain ? undefined : wp.style}
      animate={receded ? { opacity: 0.55, scale: 0.985 } : hidden ? { opacity: 0.6, scale: 0.94 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
      aria-hidden={hidden || undefined}
      data-testid="home"
      data-system-ui
      data-editing={editing || undefined}
      onPointerDown={gestures.onPointerDown}
      onClickCapture={gestures.onClickCapture}
      onContextMenu={gestures.onContextMenu}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (useHomeUi.getState().editing && target.closest("[data-home-free]") && !target.closest("[data-home-item], button, input")) useHomeUi.getState().setEditing(false);
      }}
    >
      {plain && (
        <>
          {/* the violet light line from the concept */}
          <div aria-hidden className="pointer-events-none absolute inset-x-[18%] top-0 h-[3px] rounded-b-full bg-gradient-to-r from-transparent via-[#8c7dff] to-transparent animate-glow" />
          <div aria-hidden className="pointer-events-none absolute inset-x-[25%] -top-6 h-12 rounded-full bg-primary/25 blur-2xl" />
        </>
      )}

      <header className="relative z-10 flex h-16 shrink-0 items-center gap-2 px-4 sm:px-6">
        <AnimatePresence mode="popLayout" initial={false}>
          {editing ? (
            <motion.div key="brush" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.16 }}>
              <IconButton
                ref={brushBtn}
                label={t("home.appearance")}
                onClick={() => useHomeUi.getState().setBrushOpen(!useHomeUi.getState().brushOpen)}
                aria-expanded={brushOpen}
                data-testid="home-appearance"
                tone="surface"
                className="text-primary"
              >
                <RiBrushLine className="size-5" />
              </IconButton>
            </motion.div>
          ) : (
            <motion.div key="clock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="pl-1">
              <Clock tone={plain ? "dark" : tone} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex-1" />
        {editing ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.16 }}
            onClick={() => useHomeUi.getState().setEditing(false)}
            aria-label={t("home.done")}
            title={t("home.done")}
            className="pressable flex size-10 items-center justify-center rounded-full bg-primary text-white shadow-glow"
            data-testid="home-done"
          >
            <RiCheckLine className="size-6" />
          </motion.button>
        ) : (
          <IconButton
            ref={launcherBtn}
            label={t("os.launcher")}
            onClick={() => useHomeUi.getState().setLauncherOpen(!useHomeUi.getState().launcherOpen)}
            data-testid="launcher-button"
            className={glassBtn}
          >
            <NineDots />
          </IconButton>
        )}
      </header>

      {!ready ? (
        <div className="flex flex-1 justify-center gap-6 pt-16">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="size-[72px] rounded-[22px] skeleton" />
          ))}
        </div>
      ) : ff === "mobile" ? (
        <MobileHome layout={layout} label={label} editing={editing} dragKey={dragKey} merge={drag?.mergeWith} onOpen={onOpen} pagerRef={pagerRef} />
      ) : (
        <DesktopHome layout={layout} metrics={scale} label={label} editing={editing} dragKey={dragKey} merge={drag?.mergeWith} onOpen={onOpen} />
      )}

      {ff === "desktop" && ready && (
        // Room for the dock (rendered above windows by the workspace).
        <div className="shrink-0" style={{ height: dockZone(layout.desktop.dockScale) - 14 }} aria-hidden />
      )}
      {ff === "mobile" && ready && <MobileSpacesButton glass={!plain} />}

      <BrushMenu anchor={brushBtn} layout={layout} />
      <WidgetsPanel />
      {ff === "mobile" && <MobileSpacesSheet layout={layout} />}
      <Launcher anchor={launcherBtn} apps={apps} layout={layout} />
      <FolderOverlay layout={layout} editing={editing} onOpen={onOpen} tone={tone} />
      <ContextMenu layout={layout} />
      <AppearanceSheet />
      <RenameSheet layout={layout} />
      {ff === "mobile" && <MobileSearch apps={apps} layout={layout} />}
      <DragGhost layout={layout} />
    </motion.main>
  );
}

/**
 * Phone: the round glass "Desktops" button at the bottom centre — the same
 * system app as the PC dock item; it opens the pages overview.
 */
function MobileSpacesButton({ glass }: { glass: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => useHomeUi.getState().setSpacesOpen(true)}
      aria-label={t("home.pages")}
      title={t("home.pages")}
      data-home-control
      className={cx(
        "pressable absolute bottom-3 left-1/2 z-10 flex size-[54px] -translate-x-1/2 items-center justify-center rounded-full",
        glass ? "vx-glass" : "vx-glass bg-surface-secondary",
      )}
      data-testid="mobile-spaces"
    >
      <DesktopsGlyph className="size-7" />
    </button>
  );
}

function MobileSpacesSheet({ layout }: { layout: WorkspaceLayout }) {
  const open = useHomeUi((s) => s.spacesOpen);
  const title = useSpacesTitle();
  const close = () => useHomeUi.getState().setSpacesOpen(false);
  return (
    <Sheet open={open} onClose={close} title={title} width={480} testId="mobile-spaces-sheet">
      <SpacesList layout={layout} onPicked={close} testPrefix="mobile-page" />
    </Sheet>
  );
}

interface SurfaceProps {
  layout: WorkspaceLayout;
  label: LabelStyle;
  editing: boolean;
  /** Item being dragged (its slot stays empty). */
  dragKey: string | null;
  merge: string | undefined;
  onOpen: (item: LayoutItem, el: HTMLElement) => void;
}

// ---------------------------------------------------------------------------
// Phone: pages of icons, swipe between them.

function MobileHome({ layout, label, editing, dragKey, merge, onOpen, pagerRef }: SurfaceProps & { pagerRef: MutableRefObject<Pager | null> }) {
  const pages = layout.mobile.pages;
  const stored = useHomeUi((s) => s.mobilePage);
  const page = Math.max(0, Math.min(stored, pages.length - 1));
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const x = useMotionValue(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => el.isConnected && setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
    // The measured box changes with the view (pages ↔ categories).
  }, [layout.mobile.view]);

  useEffect(() => {
    if (stored !== page) useHomeUi.getState().setMobilePage(page);
  }, [stored, page]);

  useEffect(() => {
    const c = animate(x, -page * width, { duration: 0.36, ease: EASE });
    return () => c.stop();
  }, [page, width, x]);

  pagerRef.current = {
    move: (dx) => {
      const edge = (page === 0 && dx > 0) || (page === pages.length - 1 && dx < 0);
      x.set(-page * width + (edge ? dx * 0.3 : dx));
    },
    end: (dx, vx) => {
      let next = page;
      if (dx < -width * 0.2 || vx < -500) next = page + 1;
      else if (dx > width * 0.2 || vx > 500) next = page - 1;
      next = Math.max(0, Math.min(pages.length - 1, next));
      if (next === page) animate(x, -page * width, { duration: 0.3, ease: EASE });
      else useHomeUi.getState().setMobilePage(next);
    },
  };

  const cols = layout.mobile.columns;
  const cell = width ? (width - 16) / cols : 0;
  const metrics: IconMetrics = { tile: Math.round(Math.min(cols === 3 ? 72 : 62, cell * (cols === 3 ? 0.64 : 0.72))), cell, gapX: 0, gapY: cols === 3 ? 22 : 16 };

  if (layout.mobile.view === "categories") {
    // Apps grouped by category, scrolling vertically (arranging happens in the grid view).
    return (
      <div ref={box} className="scroll-area min-h-0 flex-1 touch-pan-y px-2 pb-24 pt-3" data-home-free>
        {width > 0 && (
          <CategoryView
            layout={layout}
            items={pages.flat()}
            maxWidth={width}
            tone={label.tone}
            columns={{ count: cols, cell, gapY: metrics.gapY }}
            testId="home-categories"
            render={(item, j) => (
              <HomeItem key={itemKey(item)} item={item} layout={layout} metrics={metrics} label={label} index={j} editing={editing} onOpen={onOpen} />
            )}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 touch-none flex-col">
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden" data-home-pager data-home-free>
        {width > 0 && (
          <motion.div className="flex h-full" style={{ x }}>
            {pages.map((items, i) => (
              <div key={i} className="h-full shrink-0 overflow-hidden px-2 pt-3" style={{ width }} data-home-free data-testid={`home-page-${i}`}>
                <MobileWidgets layout={layout} page={i} editing={editing} />
                <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)`, rowGap: metrics.gapY }} data-home-container={`mobile:${i}`}>
                  {items.map((item, j) => (
                    <HomeItem
                      key={itemKey(item)}
                      item={item}
                      layout={layout}
                      metrics={metrics}
                      label={label}
                      index={j}
                      editing={editing}
                      placeholder={dragKey === itemKey(item)}
                      mergeTarget={merge === itemKey(item)}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </div>
      <PageDots count={pages.length} page={page} tone={label.tone} />
      {/* room for the round Desktops button */}
      <div className="h-[66px] shrink-0" aria-hidden />
    </div>
  );
}

function PageDots({ count, page, tone }: { count: number; page: number; tone: LabelTone }) {
  const t = useT();
  if (count < 2) return <div className="h-7 shrink-0" />;
  return (
    <div className="flex h-7 shrink-0 items-center justify-center gap-2" role="tablist" data-testid="page-dots" data-home-control>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={i === page}
          aria-label={t("home.pageOf", { n: i + 1, total: count })}
          onClick={() => useHomeUi.getState().setMobilePage(i)}
          className={cx(
            "h-[7px] rounded-full transition-all duration-300",
            i === page ? "w-[18px]" : "w-[7px] opacity-40",
            tone === "light" ? "bg-white" : "bg-text",
          )}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PC: centred grid (or categories) on the current virtual desktop.

function DesktopHome({ layout, metrics: m, label, editing, dragKey, merge, onOpen }: SurfaceProps & { metrics: IconMetrics }) {
  const t = useT();
  const lang = useLanguage();
  const space = useWM((s) => s.space);
  const current = layout.desktop.spaces.find((s) => s.id === space) ?? layout.desktop.spaces[0]!;
  const cols = layout.desktop.columns;
  const manual = layout.desktop.sort === "manual";
  const free = layout.desktop.arrange === "free" && layout.desktop.view === "grid";

  // The desktop this device was on was removed elsewhere: fall back to the first.
  useEffect(() => {
    if (current.id !== space) useWM.getState().setSpace(current.id);
  }, [current.id, space]);

  const nameOf = useCallback(
    (i: LayoutItem) => (i.kind === "app" ? appLabel(layout, i.id) : (layout.folders.find((f) => f.id === i.id)?.name ?? "")),
    [layout],
  );
  const items = useMemo(
    () => (manual || free ? current.items : [...current.items].sort((a, b) => nameOf(a).localeCompare(nameOf(b), lang))),
    [manual, free, current.items, nameOf, lang],
  );

  const item = (i: LayoutItem, j: number) => (
    <HomeItem
      key={itemKey(i)}
      item={i}
      layout={layout}
      metrics={m}
      label={label}
      index={j}
      editing={editing}
      placeholder={dragKey === itemKey(i)}
      mergeTarget={merge === itemKey(i)}
      onOpen={onOpen}
    />
  );

  return (
    <div className="relative min-h-0 flex-1">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={current.id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="absolute inset-0"
          data-home-free
          data-testid="desktop-space"
          data-space={layout.desktop.spaces.findIndex((s) => s.id === current.id) + 1}
        >
          {free ? (
            <FreeArea layout={layout} items={items} metrics={m} label={label} render={item} spaceId={current.id} />
          ) : (
            <div className="scroll-area absolute inset-0 px-8 pb-6 pt-[3vh]" data-home-free>
              {layout.desktop.view === "categories" ? (
                <CategoryView layout={layout} items={items} maxWidth={cols * m.cell + (cols - 1) * m.gapX} tone={label.tone} render={item} />
              ) : (
                <div
                  className="mx-auto flex flex-wrap justify-center pt-[3vh]"
                  style={{ maxWidth: cols * m.cell + (cols - 1) * m.gapX + 1, columnGap: m.gapX, rowGap: m.gapY }}
                  data-home-container={manual ? `desktop:${current.id}` : undefined}
                  data-home-free
                  data-testid="desktop-grid"
                >
                  {items.map(item)}
                </div>
              )}
              {!items.length && (
                <p className={cx("mx-auto mt-10 max-w-[360px] text-center text-[14px]", label.tone === "light" ? "text-white/85" : "text-text-secondary")}>{t("home.empty")}</p>
              )}
            </div>
          )}
          <DesktopWidgets layout={layout} space={current.id} editing={editing} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Height of one icon cell (tile + label lines) in the free area. */
const cellHeight = (m: IconMetrics, label: LabelStyle) => m.tile + Math.round(label.name * 1.3) + (label.captions ? Math.round(label.caption * 1.3) : 0) + 22;

/**
 * Free placement: every icon at its own spot. Positions are fractions of the
 * free area (minus one cell), so any position stays on screen at any window
 * size; icons never placed yet flow in a grid from the top-left.
 */
function FreeArea({ layout, items, metrics: m, label, render, spaceId }: { layout: WorkspaceLayout; items: LayoutItem[]; metrics: IconMetrics; label: LabelStyle; render: (i: LayoutItem, j: number) => ReactNode; spaceId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => el.isConnected && setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const ch = cellHeight(m, label);
  const freeW = Math.max(1, size.w - m.cell);
  const freeH = Math.max(1, size.h - ch);
  const perCol = Math.max(1, Math.floor(size.h / (ch + 4)));

  return (
    <div ref={box} className="absolute inset-x-4 bottom-2 top-2" data-home-free data-home-freearea={spaceId} data-testid="desktop-free">
      {size.w > 0 &&
        items.map((it, j) => {
          const stored = layout.desktop.positions[layoutItemKey(it)];
          // Not placed yet: columns from the top-left, like a classic desktop.
          const auto = { x: (Math.floor(j / perCol) * (m.cell + m.gapX)) / freeW, y: ((j % perCol) * (ch + 4)) / freeH };
          const p = stored ?? { x: Math.min(1, auto.x), y: Math.min(1, auto.y) };
          return (
            <div key={layoutItemKey(it)} className="absolute" style={{ left: Math.round(p.x * freeW), top: Math.round(p.y * freeH), width: m.cell }} data-free-item>
              {render(it, j)}
            </div>
          );
        })}
    </div>
  );
}

function CategoryView({
  layout,
  items,
  maxWidth,
  tone,
  render,
  columns,
  testId = "desktop-categories",
}: {
  layout: WorkspaceLayout;
  items: LayoutItem[];
  maxWidth: number;
  tone: LabelTone;
  render: (i: LayoutItem, j: number) => ReactNode;
  /** Phone: a fixed grid like the home pages. */
  columns?: { count: number; cell: number; gapY: number };
  testId?: string;
}) {
  const t = useT();
  const groups = [
    ...APP_CATEGORIES.map((c) => ({ key: c, title: t(CATEGORY_LABEL[c]), items: items.filter((i) => i.kind === "app" && appCategory(layout, i.id) === c) })),
    { key: "folders", title: t("home.folders"), items: items.filter((i) => i.kind === "folder") },
  ].filter((g) => g.items.length);
  let n = 0;
  return (
    <div className="mx-auto space-y-6" style={{ maxWidth }} data-home-free data-testid={testId}>
      {groups.map((g) => (
        <section key={g.key} data-testid={`category-${g.key}`}>
          <h3 className={cx("mb-3 px-1 text-[13px] font-semibold uppercase tracking-wide", tone === "light" ? "text-white/85" : "text-text-tertiary")}>{g.title}</h3>
          {columns ? (
            <div className="grid" style={{ gridTemplateColumns: `repeat(${columns.count}, ${columns.cell}px)`, rowGap: columns.gapY }} data-home-free>
              {g.items.map((i) => render(i, n++))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-x-2 gap-y-4" data-home-free>
              {g.items.map((i) => render(i, n++))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function Clock({ tone }: { tone: LabelTone }) {
  const lang = useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className={cx("flex items-baseline gap-2", tone === "light" ? "text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,0.35)]" : "text-text-secondary")}>
      <span className={cx("text-[15px] font-semibold tabular-nums", tone === "light" ? "text-white" : "text-text")}>
        {new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(now)}
      </span>
      <span className="hidden text-[13px] sm:inline">{formatDate(now, lang, { weekday: "short", day: "numeric", month: "long" })}</span>
    </div>
  );
}

function NineDots() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
      {[3.5, 10, 16.5].flatMap((y) => [3.5, 10, 16.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.9" fill="currentColor" />))}
    </svg>
  );
}

