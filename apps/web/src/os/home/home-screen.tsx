import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { RiAddLine, RiBrushLine, RiCheckLine, RiLayoutGridLine, RiListUnordered, RiMoreFill } from "@remixicon/react";
import { APP_CATEGORIES, DESKTOP_SPACES_MAX, type LayoutItem, type WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { formatDate, useLanguage, useT } from "@/lib/i18n";
import { IconButton } from "@/ui/controls";
import { Popover, usePopover } from "@/ui/overlays";
import { WorkspaceMenu } from "../system-menu";
import { useWM } from "../window-manager";
import { CATEGORY_LABEL, appCategory, appLabel, itemKey, openApp } from "./actions";
import { labelTone, useWallpaperImage, wallpaperStyle, type LabelTone } from "./appearance";
import { AppearanceSheet } from "./appearance-panel";
import { ContextMenu, newSpace, spaceLabel } from "./context-menu";
import { FolderOverlay } from "./folder-overlay";
import { useHomeGestures } from "./gestures";
import { DOCK_ZONE } from "./dock";
import { DragGhost, HomeItem, type IconMetrics, type LabelStyle } from "./icons";
import { Launcher } from "./launcher";
import { updateLayout, useWorkspaceLayout } from "./layout";
import { RenameSheet } from "./rename-sheet";
import { MobileSearch } from "./search";
import { useHomeUi } from "./ui-store";

const EASE = [0.22, 1, 0.36, 1] as const;

interface Pager {
  move: (dx: number) => void;
  end: (dx: number, vx: number) => void;
}

const DENSITY: Record<WorkspaceLayout["desktop"]["density"], IconMetrics> = {
  compact: { tile: 60, cell: 100, gapX: 8, gapY: 14 },
  normal: { tile: 72, cell: 118, gapX: 16, gapY: 22 },
  spacious: { tile: 84, cell: 136, gapX: 28, gapY: 32 },
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
  const menu = usePopover();
  const image = useWallpaperImage(layout.appearance.wallpaper);
  const wp = wallpaperStyle(layout.appearance.wallpaper, image.data);
  const plain = layout.appearance.wallpaper.kind === "default";
  const tone = labelTone(layout.appearance, wp.dark);
  const label: LabelStyle = useMemo(() => ({ tone, size: layout.appearance.labelSize, captions: layout.appearance.captions }), [tone, layout.appearance.labelSize, layout.appearance.captions]);
  const pagerRef = useRef<Pager | null>(null);
  const mobileCategories = ff === "mobile" && layout.mobile.view === "categories";
  const canArrange = ff === "mobile" ? !mobileCategories : layout.desktop.view === "grid" && layout.desktop.sort === "manual";

  const gestures = useHomeGestures({
    ff,
    canArrange,
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
        ui.openFolder || ui.menu || ui.appearanceOpen || ui.renaming || ui.launcherOpen || ui.search.open || ui.drag || document.querySelector('[role="dialog"], [role="menu"]');
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
            <motion.div key="brush" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.18 }}>
              <IconButton label={t("home.appearance")} onClick={() => useHomeUi.getState().setAppearanceOpen(true)} data-testid="home-appearance" tone="surface" className="text-primary">
                <RiBrushLine className="size-5" />
              </IconButton>
            </motion.div>
          ) : (
            <motion.div key="clock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="pl-1">
              <Clock tone={plain ? "dark" : tone} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex-1" />
        {ff === "mobile" && !editing && <ViewToggle view={layout.mobile.view} glass={!plain} />}
        {ff === "desktop" && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <SpaceTabs layout={layout} />
          </div>
        )}
        {editing ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18 }}
            onClick={() => useHomeUi.getState().setEditing(false)}
            aria-label={t("home.done")}
            title={t("home.done")}
            className="pressable flex size-10 items-center justify-center rounded-full bg-primary text-white shadow-glow"
            data-testid="home-done"
          >
            <RiCheckLine className="size-6" />
          </motion.button>
        ) : (
          <>
            <IconButton ref={menu.anchor} label={t("os.menu")} onClick={menu.toggle} data-testid="workspace-menu" className={glassBtn}>
              <RiMoreFill className="size-5" />
            </IconButton>
            <IconButton
              ref={launcherBtn}
              label={t("os.launcher")}
              onClick={() => useHomeUi.getState().setLauncherOpen(!useHomeUi.getState().launcherOpen)}
              data-testid="launcher-button"
              className={glassBtn}
            >
              <NineDots />
            </IconButton>
          </>
        )}
      </header>

      {!ready ? (
        <div className="flex flex-1 justify-center gap-6 pt-16">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="size-[72px] rounded-[22px] skeleton" />
          ))}
        </div>
      ) : ff === "mobile" ? (
        <MobileHome layout={layout} label={label} editing={editing} dragKey={drag && !drag.fromFolder ? itemKey(drag.item) : null} merge={drag?.mergeWith} onOpen={onOpen} pagerRef={pagerRef} />
      ) : (
        <DesktopHome layout={layout} label={label} editing={editing} dragKey={drag && !drag.fromFolder ? itemKey(drag.item) : null} merge={drag?.mergeWith} onOpen={onOpen} />
      )}

      {ff === "desktop" && ready && (
        // Room for the PC bottom bar (search + dock, rendered above windows by the workspace).
        <div className="shrink-0" style={{ height: DOCK_ZONE - 14 }} aria-hidden />
      )}

      <Popover open={menu.open} onClose={menu.close} anchor={menu.anchor} width={250} testId="workspace-menu-popover">
        <WorkspaceMenu onDone={menu.close} />
      </Popover>
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
      <div ref={box} className="scroll-area min-h-0 flex-1 touch-pan-y px-2 pb-8 pt-3" data-home-free>
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
    </div>
  );
}

/** Phone: how apps are shown — icon pages or by category. Saved with the account. */
function ViewToggle({ view, glass }: { view: "grid" | "categories"; glass: boolean }) {
  const t = useT();
  const set = (v: "grid" | "categories") => updateLayout((l) => ({ ...l, mobile: { ...l.mobile, view: v } }));
  return (
    <div
      className={cx("flex items-center rounded-full p-0.5", glass ? "vx-glass" : "bg-surface-secondary")}
      role="radiogroup"
      aria-label={t("appearance.view")}
      data-home-control
      data-testid="home-view"
    >
      {(
        [
          ["grid", RiLayoutGridLine, "home.viewGrid"],
          ["categories", RiListUnordered, "home.viewCategories"],
        ] as const
      ).map(([v, Icon, key]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          aria-label={t(key)}
          title={t(key)}
          onClick={() => set(v)}
          className={cx("pressable flex size-8 items-center justify-center rounded-full", view === v ? "bg-surface text-text shadow-sm" : "text-text-secondary")}
          data-testid={`home-view-${v}`}
        >
          <Icon className="size-[17px]" />
        </button>
      ))}
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

function DesktopHome({ layout, label, editing, dragKey, merge, onOpen }: SurfaceProps) {
  const t = useT();
  const lang = useLanguage();
  const space = useWM((s) => s.space);
  const current = layout.desktop.spaces.find((s) => s.id === space) ?? layout.desktop.spaces[0]!;
  const m = DENSITY[layout.desktop.density];
  const cols = layout.desktop.columns;
  const manual = layout.desktop.sort === "manual";

  // The desktop this device was on was removed elsewhere: fall back to the first.
  useEffect(() => {
    if (current.id !== space) useWM.getState().setSpace(current.id);
  }, [current.id, space]);

  const nameOf = useCallback(
    (i: LayoutItem) => (i.kind === "app" ? appLabel(layout, i.id) : (layout.folders.find((f) => f.id === i.id)?.name ?? "")),
    [layout],
  );
  const items = useMemo(
    () => (manual ? current.items : [...current.items].sort((a, b) => nameOf(a).localeCompare(nameOf(b), lang))),
    [manual, current.items, nameOf, lang],
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
    <div className="scroll-area relative min-h-0 flex-1 px-8 pb-6 pt-[3vh]" data-home-free>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={current.id}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -30 }}
          transition={{ duration: 0.24, ease: EASE }}
          className="min-h-full"
          data-home-free
        >
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
        </motion.div>
      </AnimatePresence>
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

/** PC virtual desktops: tabs in the header. Drag an icon onto a tab to move it there. */
function SpaceTabs({ layout }: { layout: WorkspaceLayout }) {
  const t = useT();
  const space = useWM((s) => s.space);
  const setSpace = useWM((s) => s.setSpace);
  const dragging = useHomeUi((s) => !!s.drag);
  const spaces = layout.desktop.spaces;
  return (
    <div
      className={cx(
        "vx-glass flex items-center gap-1 rounded-full p-1 transition-transform",
        dragging && "scale-105",
      )}
      role="tablist"
      aria-label={t("home.spaces")}
      data-testid="space-tabs"
    >
      {spaces.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={s.id === space}
          data-home-space={s.id}
          data-home-control
          onClick={() => setSpace(s.id)}
          onDoubleClick={() => useHomeUi.getState().setRenaming({ kind: "space", id: s.id })}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            useHomeUi.getState().openMenu({ x: e.clientX, y: e.clientY, target: { kind: "space", id: s.id } });
          }}
          title={spaceLabel(t, layout, s.id)}
          className={cx(
            "pressable h-8 min-w-8 max-w-[140px] truncate rounded-full px-3 text-[13px] font-semibold",
            s.id === space ? "bg-primary text-white shadow-glow" : "text-text-secondary hover:bg-surface-hover hover:text-text",
          )}
          data-testid={`space-${i + 1}`}
        >
          {s.name || i + 1}
        </button>
      ))}
      {spaces.length < DESKTOP_SPACES_MAX && (
        <button
          type="button"
          onClick={newSpace}
          aria-label={t("home.newSpace")}
          title={t("home.newSpace")}
          data-home-control
          className="pressable flex size-8 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text"
          data-testid="space-add"
        >
          <RiAddLine className="size-[18px]" />
        </button>
      )}
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

