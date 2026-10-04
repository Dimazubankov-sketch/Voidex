import { z } from "zod";
import { APP_CATEGORIES, APP_IDS, type AppCategory, type AppId } from "./apps.js";

/**
 * The VOIDEX desktop — one data model for every device.
 *
 *   Workspace layout (synced per account, stored with the user's preferences)
 *    ├── folders      shared by phone and PC: an app in a folder is in it everywhere
 *    ├── hidden       apps removed from the desktop (still installed, still in the
 *    │                app menu — removing an icon never uninstalls anything)
 *    ├── mobile       pages of icons (max 3) and 3 or 4 icons per row
 *    ├── desktop      virtual desktops, each with its own icons; grid density,
 *    │                columns, grid / by-category view, manual / by-name order;
 *    │                dock: apps pinned to the PC dock, in order
 *    ├── categories   the user's own category for an app (overrides the manifest)
 *    ├── names        the user's own label for an app icon (the app keeps its name)
 *    └── appearance   wallpaper and icon label style
 *
 * Phone and PC arrange the same set of top-level items (apps that are not in a
 * folder, and folders) in their own places. `normalizeLayout` is the single
 * rule that keeps any stored or edited layout consistent with the apps a user
 * actually has installed; the server runs it on every write, the client on
 * every read and edit.
 */

export const MOBILE_PAGES_MAX = 3;
export const DESKTOP_SPACES_MAX = 6;
export const FOLDERS_MAX = 60;
export const FOLDER_NAME_MAX = 40;
export const SPACE_NAME_MAX = 30;
export const ITEMS_PER_CONTAINER_MAX = 120;
export const DESKTOP_COLUMNS_MIN = 3;
export const DESKTOP_COLUMNS_MAX = 8;
export const DOCK_MAX = 16;
export const APP_LABEL_MAX = 40;
export const WIDGETS_MAX = 24;

/**
 * System wallpapers (Step 2.2 set): the neutral built-ins (clean white, white
 * with a soft violet glow, grey) and the VOIDEX wave series — a milky base,
 * two shades split by one soft organic wave, after the VOIDEX Mail artwork.
 * Older layouts may still hold retired presets / Step 2 gradients:
 * `normalizeLayout` maps them to the nearest current one.
 */
export const WALLPAPER_PRESETS = [
  "white",
  "aura",
  "mist",
  "wave-light",
  "wave-milk",
  "wave-milk-violet",
  "wave-gray",
  "wave-gray-purple",
  "wave-milk-gray-purple",
] as const;
export type WallpaperPreset = (typeof WALLPAPER_PRESETS)[number];
/** Step 2 gradients — still accepted in stored data, shown as presets. */
export const WALLPAPER_GRADIENTS = ["dawn", "lavender", "mist", "aurora", "sand", "night"] as const;
export type WallpaperGradient = (typeof WALLPAPER_GRADIENTS)[number];
const LEGACY_WALLPAPER: Record<string, WallpaperPreset> = {
  // Step 2.1 presets retired in Step 2.2
  glow: "aura",
  "wave-violet": "wave-light",
  "wave-gray-violet": "wave-gray-purple",
  // Step 2 presets / gradients
  voidex: "aura",
  waves: "wave-milk-violet",
  orbit: "wave-light",
  grid: "mist",
  dawn: "wave-milk-violet",
  lavender: "wave-milk-violet",
  mist: "mist",
  aurora: "wave-light",
  sand: "wave-milk",
  night: "wave-light",
};

/** Glass material of the desktop's floating UI (dock, folders, menus). */
export const GLASS_LEVELS = ["off", "medium", "on"] as const;
export type GlassLevel = (typeof GLASS_LEVELS)[number];

/**
 * Built-in system widgets (no widget store yet — a catalogue of system ones).
 * Step 2.3: the "desktops" (Workspaces) widget was removed; stored ones are
 * dropped by normalizeLayout. Each widget covers a block of grid cells.
 */
export const WIDGET_TYPES = ["calculator"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
export const WIDGET_CELLS: Record<WidgetType, { w: number; h: number }> = { calculator: { w: 2, h: 2 } };
/** Background of the PC system bar (top): real glass, or none. */
export const SYSTEM_BAR_STYLES = ["glass", "off"] as const;
export type SystemBarStyle = (typeof SYSTEM_BAR_STYLES)[number];
/** Step 2.5: background of the PC dock, set apart from the system bar's. */
export const DOCK_STYLES = ["glass", "off"] as const;
export type DockStyle = (typeof DOCK_STYLES)[number];
/** Step 2.5: colour theme. Accounts from before Step 2.5 stay light. */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const DOCK_SCALES = ["s", "m", "l"] as const;
export type DockScale = (typeof DOCK_SCALES)[number];

const appId = z.enum(APP_IDS as [AppId, ...AppId[]]);
const folderId = z.string().regex(/^f_[a-z0-9]{4,24}$/);
const spaceId = z.string().regex(/^d_[a-z0-9]{1,24}$/);
const widgetId = z.string().regex(/^w_[a-z0-9]{4,24}$/);
/** A position as a fraction of the free area (0..1): adapts to any screen size. */
const fraction = z.number().min(0).max(1);
export const PositionSchema = z.object({ x: fraction, y: fraction });
export type Position = z.infer<typeof PositionSchema>;
/** Step 2.3: a cell of the home grid (column, row), 0-based. */
export const CellSchema = z.object({ c: z.number().int().min(0).max(63), r: z.number().int().min(0).max(255) });
export type Cell = z.infer<typeof CellSchema>;
/** Item key ("app:mail", "folder:f_…", "widget:w_…") → its cell on its page / desktop. */
const cellMap = z.record(z.string().max(40), CellSchema).default({});
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const LayoutItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("app"), id: appId }),
  z.object({ kind: z.literal("folder"), id: folderId }),
]);
export type LayoutItem = z.infer<typeof LayoutItemSchema>;

export const FolderSchema = z.object({
  id: folderId,
  name: z.string().max(FOLDER_NAME_MAX),
  apps: z.array(appId).max(ITEMS_PER_CONTAINER_MAX),
});
export type Folder = z.infer<typeof FolderSchema>;

export const WallpaperSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }),
  z.object({ kind: z.literal("color"), color: hexColor }),
  z.object({ kind: z.literal("gradient"), id: z.enum(WALLPAPER_GRADIENTS) }),
  /** Any short id: unknown / retired ones are mapped or reset by normalizeLayout. */
  z.object({ kind: z.literal("preset"), id: z.string().regex(/^[a-z0-9-]{1,32}$/) }),
  /** The user's own picture; `version` changes when a new one is uploaded. */
  z.object({ kind: z.literal("image"), version: z.string().max(64) }),
]);
export type Wallpaper = z.infer<typeof WallpaperSchema>;

export const AppearanceSchema = z.object({
  wallpaper: WallpaperSchema,
  /**
   * Retired in Step 2.2 (labels follow the wallpaper contrast and the interface
   * scale). Still accepted in stored data; normalizeLayout resets them.
   */
  labelColor: z.enum(["auto", "dark", "light"]).default("auto"),
  labelSize: z.enum(["s", "m", "l"]).default("m"),
  /** Second line under the app name (e.g. "System", unread count). */
  captions: z.boolean(),
  /** Added in Step 2.1; older stored layouts have none (→ "on"). */
  glass: z.enum(GLASS_LEVELS).default("on"),
  /** Step 2.3: app names under desktop icons (search, dock and menus always show names). */
  showLabels: z.boolean().default(true),
  /** Step 2.3: PC system bar background. */
  systemBar: z.enum(SYSTEM_BAR_STYLES).default("glass"),
  /** Step 2.4: the lock screen's own wallpaper; null / absent = the same as the desktop. */
  lockWallpaper: WallpaperSchema.nullable().optional(),
  /** Step 2.5: PC dock background (separate from the system bar). */
  dock: z.enum(DOCK_STYLES).default("glass"),
  /** Step 2.5: light / dark / follow the device. */
  theme: z.enum(THEMES).default("light"),
  /**
   * Step 2.5: wallpapers follow the account on every device (true), or each
   * device keeps its own (false: stored on the device, the account's stay).
   */
  syncWallpapers: z.boolean().default(true),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export const DesktopSpaceSchema = z.object({
  id: spaceId,
  name: z.string().max(SPACE_NAME_MAX),
  items: z.array(LayoutItemSchema).max(ITEMS_PER_CONTAINER_MAX),
});
export type DesktopSpace = z.infer<typeof DesktopSpaceSchema>;

/**
 * A widget on the home screen. PC: free position on one desktop (`x`, `y` are
 * fractions of the free area). Phone: shown at the top of one page, ordered
 * by `y`.
 */
export const WidgetSchema = z.object({
  id: widgetId,
  /** Any short id: retired / unknown types are dropped by normalizeLayout. */
  type: z.string().regex(/^[a-z0-9-]{1,32}$/),
  surface: z.enum(["desktop", "mobile"]),
  /** PC desktop id, or the phone page index as a string. */
  container: z.string().max(32),
  x: fraction,
  y: fraction,
});
export type Widget = z.infer<typeof WidgetSchema>;

export const WorkspaceLayoutSchema = z.object({
  v: z.literal(1),
  folders: z.array(FolderSchema).max(FOLDERS_MAX),
  hidden: z.array(appId).max(ITEMS_PER_CONTAINER_MAX),
  mobile: z.object({
    columns: z.union([z.literal(3), z.literal(4)]),
    pages: z.array(z.array(LayoutItemSchema).max(ITEMS_PER_CONTAINER_MAX)).min(1).max(MOBILE_PAGES_MAX),
    /** Phone: icon pages, or apps grouped by category (Step 2.1; older layouts → grid). */
    view: z.enum(["grid", "categories"]).default("grid"),
    /** Step 2.3: grid cells of items and widgets on their page (missing → first free cell). */
    cells: cellMap,
  }),
  desktop: z.object({
    columns: z.number().int().min(DESKTOP_COLUMNS_MIN).max(DESKTOP_COLUMNS_MAX),
    density: z.enum(["compact", "normal", "spacious"]),
    view: z.enum(["grid", "categories"]),
    sort: z.enum(["manual", "name"]),
    spaces: z.array(DesktopSpaceSchema).min(1).max(DESKTOP_SPACES_MAX),
    /** Pinned apps of the PC dock. Absent in layouts saved before Step 2.1 (→ every app). */
    dock: z.array(appId).max(DOCK_MAX).optional(),
    /** Step 2.2: the "Desktops" system item is in the dock (it can be removed and put back). */
    dockDesktops: z.boolean().default(true),
    /** Step 2.2: dock size — small range only. */
    dockScale: z.enum(DOCK_SCALES).default("m"),
    /** Step 2.2: icons in the grid, or placed freely (positions below). The grid is kept. */
    arrange: z.enum(["grid", "free"]).default("grid"),
    /** Free placement: item key ("app:mail", "folder:f_…") → position on its desktop. */
    positions: z.record(z.string().max(40), PositionSchema).default({}),
    /** Step 2.3: grid cells of items and widgets on their desktop (missing → first free cell). */
    cells: cellMap,
  }),
  categories: z.partialRecord(appId, z.enum(APP_CATEGORIES)),
  /** Added after v1 shipped: older stored layouts have no `names`. */
  names: z.partialRecord(appId, z.string().max(APP_LABEL_MAX)).default({}),
  /** Step 2.2: home-screen widgets (older layouts: none). */
  widgets: z.array(WidgetSchema).max(WIDGETS_MAX).default([]),
  appearance: AppearanceSchema,
});
export type WorkspaceLayout = z.infer<typeof WorkspaceLayoutSchema>;

export const DEFAULT_APPEARANCE: Appearance = { wallpaper: { kind: "default" }, labelColor: "auto", labelSize: "m", captions: true, glass: "on", showLabels: true, systemBar: "glass", lockWallpaper: null, dock: "glass", theme: "light", syncWallpapers: true };

/** Keeps a stored wallpaper renderable: retired presets / gradients map to the current set. */
export function normalizeWallpaper(w: Wallpaper | undefined): Wallpaper {
  if (!w) return { kind: "default" };
  if (w.kind === "gradient") return { kind: "preset", id: LEGACY_WALLPAPER[w.id] ?? "glow" };
  if (w.kind === "preset" && !(WALLPAPER_PRESETS as readonly string[]).includes(w.id)) {
    const mapped = LEGACY_WALLPAPER[w.id];
    return mapped ? { kind: "preset", id: mapped } : { kind: "default" };
  }
  return w;
}

function normalizeAppearance(a: Partial<Appearance> | undefined): Appearance {
  const base = { ...DEFAULT_APPEARANCE, ...(a ?? {}) };
  return {
    wallpaper: normalizeWallpaper(base.wallpaper),
    // No longer user settings (Step 2.2): automatic contrast, size from the scale.
    labelColor: "auto",
    labelSize: "m",
    captions: base.captions,
    glass: (GLASS_LEVELS as readonly string[]).includes(base.glass) ? base.glass : "on",
    showLabels: base.showLabels !== false,
    systemBar: base.systemBar === "off" ? "off" : "glass",
    lockWallpaper: base.lockWallpaper ? normalizeWallpaper(base.lockWallpaper) : null,
    dock: base.dock === "off" ? "off" : "glass",
    theme: (THEMES as readonly string[]).includes(base.theme) ? base.theme : "light",
    syncWallpapers: base.syncWallpapers !== false,
  };
}

export function defaultLayout(apps: AppId[]): WorkspaceLayout {
  const items = apps.map((id) => ({ kind: "app" as const, id }));
  return {
    v: 1,
    folders: [],
    hidden: [],
    mobile: { columns: 3, pages: [items], view: "grid", cells: {} },
    desktop: {
      columns: 5,
      density: "normal",
      view: "grid",
      sort: "manual",
      spaces: [{ id: "d_1", name: "", items }],
      dock: [...apps],
      dockDesktops: true,
      dockScale: "m",
      arrange: "grid",
      positions: {},
      cells: {},
    },
    categories: {},
    names: {},
    widgets: [],
    appearance: DEFAULT_APPEARANCE,
  };
}

export const sameItem = (a: LayoutItem, b: LayoutItem) => a.kind === b.kind && a.id === b.id;
export const layoutItemKey = (i: LayoutItem) => `${i.kind}:${i.id}`;
const itemKey = layoutItemKey;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Makes any layout valid for the apps the user has installed:
 * - unknown / uninstalled apps disappear, hidden apps appear nowhere;
 * - an app lives in at most one folder; empty folders are removed;
 * - every visible top-level item (app outside folders, folder) appears exactly
 *   once on the phone pages and exactly once among the PC desktops — missing
 *   ones are added at the end, duplicates dropped;
 * - empty phone pages are dropped (at least one page always exists).
 * Pure and idempotent.
 */
export function normalizeLayout(input: WorkspaceLayout | null | undefined, installed: AppId[]): WorkspaceLayout {
  const base = input ?? defaultLayout(installed);
  const installedSet = new Set(installed);
  const hidden = [...new Set(base.hidden.filter((a) => installedSet.has(a)))];
  const hiddenSet = new Set(hidden);

  // Folders: unique ids, apps placed once, no hidden/uninstalled apps, no empty folders.
  const inFolder = new Set<AppId>();
  const seenFolders = new Set<string>();
  const folders: Folder[] = [];
  for (const f of base.folders) {
    if (seenFolders.has(f.id)) continue;
    seenFolders.add(f.id);
    const apps = f.apps.filter((a) => installedSet.has(a) && !hiddenSet.has(a) && !inFolder.has(a));
    apps.forEach((a) => inFolder.add(a));
    if (apps.length) folders.push({ id: f.id, name: f.name.slice(0, FOLDER_NAME_MAX), apps });
  }
  const folderIds = new Set(folders.map((f) => f.id));

  const valid = (i: LayoutItem) =>
    i.kind === "app" ? installedSet.has(i.id) && !hiddenSet.has(i.id) && !inFolder.has(i.id) : folderIds.has(i.id);

  // Every top-level item, in a stable order (installed order, then folders).
  const topLevel: LayoutItem[] = [
    ...installed.filter((a) => !hiddenSet.has(a) && !inFolder.has(a)).map((id) => ({ kind: "app" as const, id })),
    ...folders.map((f) => ({ kind: "folder" as const, id: f.id })),
  ];

  /** Keeps valid items, each once across all containers; reports what was placed. */
  const place = (containers: LayoutItem[][]) => {
    const seen = new Set<string>();
    const out = containers.map((c) =>
      c.filter((i) => {
        const k = itemKey(i);
        if (!valid(i) || seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
    );
    return { out, seen };
  };

  // Phone pages.
  const mobile = place(base.mobile.pages.slice(0, MOBILE_PAGES_MAX));
  const pages = mobile.out.filter((p) => p.length > 0);
  if (!pages.length) pages.push([]);
  pages[pages.length - 1]!.push(...topLevel.filter((i) => !mobile.seen.has(itemKey(i))));

  // PC desktops.
  const spaceIds = new Set<string>();
  const spacesIn = base.desktop.spaces.filter((s) => (spaceIds.has(s.id) ? false : (spaceIds.add(s.id), true))).slice(0, DESKTOP_SPACES_MAX);
  if (!spacesIn.length) spacesIn.push({ id: "d_1", name: "", items: [] });
  const desktop = place(spacesIn.map((s) => s.items));
  const spaces: DesktopSpace[] = spacesIn.map((s, i) => ({ id: s.id, name: s.name.slice(0, SPACE_NAME_MAX), items: desktop.out[i]! }));
  spaces[0]!.items.push(...topLevel.filter((i) => !desktop.seen.has(itemKey(i))));

  const categories: Partial<Record<AppId, AppCategory>> = {};
  for (const [id, c] of Object.entries(base.categories ?? {})) if (installedSet.has(id as AppId)) categories[id as AppId] = c;

  const names: Partial<Record<AppId, string>> = {};
  for (const [id, name] of Object.entries(base.names ?? {})) {
    const clean = name.trim().slice(0, APP_LABEL_MAX);
    if (installedSet.has(id as AppId) && clean) names[id as AppId] = clean;
  }

  // Free placement: only items that are on a PC desktop, positions kept inside the area.
  const onDesktop = new Set(spaces.flatMap((sp) => sp.items.map(itemKey)));
  const positions: Record<string, Position> = {};
  for (const [k, p] of Object.entries(base.desktop.positions ?? {})) {
    if (onDesktop.has(k) && p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[k] = { x: clamp01(p.x), y: clamp01(p.y) };
  }

  // Widgets: known types (retired ones such as "desktops" disappear), unique ids, on an existing desktop / page.
  const widgetIds = new Set<string>();
  const widgets: Widget[] = [];
  for (const w of base.widgets ?? []) {
    if (widgets.length >= WIDGETS_MAX || widgetIds.has(w.id) || !(WIDGET_TYPES as readonly string[]).includes(w.type)) continue;
    let container = w.container;
    if (w.surface === "desktop") {
      if (!spaces.some((sp) => sp.id === container)) container = spaces[0]!.id;
    } else {
      const page = Number(container);
      container = String(Number.isInteger(page) ? Math.max(0, Math.min(pages.length - 1, page)) : 0);
    }
    widgetIds.add(w.id);
    widgets.push({ id: w.id, type: w.type, surface: w.surface === "mobile" ? "mobile" : "desktop", container, x: clamp01(w.x), y: clamp01(w.y) });
  }

  // Grid cells: only keys that still exist (items on that surface, widgets of that surface).
  const keepCells = (raw: Record<string, Cell> | undefined, keys: Set<string>) => {
    const out: Record<string, Cell> = {};
    for (const [k, c] of Object.entries(raw ?? {})) {
      if (keys.has(k) && c && Number.isInteger(c.c) && Number.isInteger(c.r) && c.c >= 0 && c.r >= 0) out[k] = { c: Math.min(63, c.c), r: Math.min(255, c.r) };
    }
    return out;
  };
  const widgetKeys = (surface: "mobile" | "desktop") => widgets.filter((w) => w.surface === surface).map((w) => `widget:${w.id}`);
  const mobileCells = keepCells(base.mobile.cells, new Set([...pages.flat().map(itemKey), ...widgetKeys("mobile")]));
  const desktopCells = keepCells(base.desktop.cells, new Set([...onDesktop, ...widgetKeys("desktop")]));

  return {
    v: 1,
    folders,
    hidden,
    mobile: { columns: base.mobile.columns === 4 ? 4 : 3, pages, view: base.mobile.view === "categories" ? "categories" : "grid", cells: mobileCells },
    desktop: {
      columns: Math.min(DESKTOP_COLUMNS_MAX, Math.max(DESKTOP_COLUMNS_MIN, Math.round(base.desktop.columns))),
      density: base.desktop.density,
      view: base.desktop.view,
      sort: base.desktop.sort,
      spaces,
      // Never customised → every installed app; an emptied dock stays empty.
      dock: [...new Set(base.desktop.dock ?? installed)].filter((a) => installedSet.has(a)).slice(0, DOCK_MAX),
      dockDesktops: base.desktop.dockDesktops !== false,
      dockScale: (DOCK_SCALES as readonly string[]).includes(base.desktop.dockScale) ? base.desktop.dockScale : "m",
      // Step 2.3: free (pixel) placement is retired — placement is grid cells.
      arrange: "grid",
      positions,
      cells: desktopCells,
    },
    categories,
    names,
    widgets,
    appearance: normalizeAppearance(base.appearance),
  };
}

// ---------------------------------------------------------------------------
// Edits. Each returns a new layout; callers normalize before saving.

/** Where an item sits: a phone page or a PC desktop. */
export type Place = { surface: "mobile"; page: number } | { surface: "desktop"; space: string };

function containerOf(l: WorkspaceLayout, place: Place): LayoutItem[] | undefined {
  return place.surface === "mobile" ? l.mobile.pages[place.page] : l.desktop.spaces.find((s) => s.id === place.space)?.items;
}

function clone(l: WorkspaceLayout): WorkspaceLayout {
  return structuredClone(l);
}

function removeEverywhere(l: WorkspaceLayout, item: LayoutItem) {
  l.mobile.pages = l.mobile.pages.map((p) => p.filter((i) => !sameItem(i, item)));
  l.desktop.spaces = l.desktop.spaces.map((s) => ({ ...s, items: s.items.filter((i) => !sameItem(i, item)) }));
}

/** Replaces `target` by `replacement` wherever `target` is (phone and PC). */
function replaceEverywhere(l: WorkspaceLayout, target: LayoutItem, replacement: LayoutItem) {
  const swap = (list: LayoutItem[]) => list.map((i) => (sameItem(i, target) ? replacement : i));
  l.mobile.pages = l.mobile.pages.map(swap);
  l.desktop.spaces = l.desktop.spaces.map((s) => ({ ...s, items: swap(s.items) }));
}

/**
 * Moves a top-level item within one surface. `page` may name a phone page that
 * does not exist yet — one past the last, or -1 for a new first page — which
 * is created (up to MOBILE_PAGES_MAX).
 */
export function moveItem(l: WorkspaceLayout, item: LayoutItem, to: Place, index: number): WorkspaceLayout {
  const n = clone(l);
  if (to.surface === "mobile") {
    n.mobile.pages = n.mobile.pages.map((p) => p.filter((i) => !sameItem(i, item)));
    let at = to.page;
    if (at < 0 || at >= n.mobile.pages.length) {
      if (n.mobile.pages.length >= MOBILE_PAGES_MAX) return l;
      if (at < 0) n.mobile.pages.unshift([]);
      else n.mobile.pages.push([]);
      at = at < 0 ? 0 : n.mobile.pages.length - 1;
    }
    const page = n.mobile.pages[at]!;
    page.splice(Math.max(0, Math.min(index, page.length)), 0, item);
  } else {
    n.desktop.spaces = n.desktop.spaces.map((s) => ({ ...s, items: s.items.filter((i) => !sameItem(i, item)) }));
    const space = n.desktop.spaces.find((s) => s.id === to.space);
    if (!space) return l;
    space.items.splice(Math.max(0, Math.min(index, space.items.length)), 0, item);
  }
  return n;
}

export function newFolderId(random: () => number = Math.random): string {
  return `f_${Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, "0")}`;
}

/**
 * Drops app `dragged` onto `target` (an app or a folder). App on app creates a
 * folder where the target was, on phone and PC alike; app on folder adds it.
 */
export function dropOnto(l: WorkspaceLayout, dragged: AppId, target: LayoutItem, name: string, id = newFolderId()): WorkspaceLayout {
  if (target.kind === "app" && target.id === dragged) return l;
  const n = clone(l);
  n.folders = n.folders.map((f) => ({ ...f, apps: f.apps.filter((a) => a !== dragged) }));
  removeEverywhere(n, { kind: "app", id: dragged });
  if (target.kind === "folder") {
    const f = n.folders.find((x) => x.id === target.id);
    if (!f) return l;
    f.apps.push(dragged);
  } else {
    n.folders.push({ id, name, apps: [target.id, dragged] });
    replaceEverywhere(n, target, { kind: "folder", id });
  }
  return n;
}

/** "Create folder" from an app's menu: a folder holding just that app, in its place. */
export function folderFromApp(l: WorkspaceLayout, app: AppId, name: string, id = newFolderId()): WorkspaceLayout {
  const n = clone(l);
  n.folders = n.folders.map((f) => ({ ...f, apps: f.apps.filter((a) => a !== app) }));
  n.folders.push({ id, name, apps: [app] });
  replaceEverywhere(n, { kind: "app", id: app }, { kind: "folder", id });
  return n;
}

/** Takes an app out of its folder and puts it right after the folder. */
export function removeFromFolder(l: WorkspaceLayout, app: AppId): WorkspaceLayout {
  const n = clone(l);
  const folder = n.folders.find((f) => f.apps.includes(app));
  if (!folder) return l;
  folder.apps = folder.apps.filter((a) => a !== app);
  const fItem: LayoutItem = { kind: "folder", id: folder.id };
  const insertAfter = (list: LayoutItem[]) => {
    const i = list.findIndex((x) => sameItem(x, fItem));
    if (i === -1) return list;
    const copy = [...list];
    copy.splice(i + 1, 0, { kind: "app", id: app });
    return copy;
  };
  n.mobile.pages = n.mobile.pages.map(insertAfter);
  n.desktop.spaces = n.desktop.spaces.map((s) => ({ ...s, items: insertAfter(s.items) }));
  if (!folder.apps.length) {
    n.folders = n.folders.filter((f) => f.id !== folder.id);
    removeEverywhere(n, fItem);
  }
  return n;
}

/** Deletes a folder; its apps take its place on the desktop (nothing is lost). */
export function dissolveFolder(l: WorkspaceLayout, folder: string): WorkspaceLayout {
  const n = clone(l);
  const f = n.folders.find((x) => x.id === folder);
  if (!f) return l;
  const expand = (list: LayoutItem[]) => list.flatMap((i) => (i.kind === "folder" && i.id === folder ? f.apps.map((id) => ({ kind: "app" as const, id })) : [i]));
  n.mobile.pages = n.mobile.pages.map(expand);
  n.desktop.spaces = n.desktop.spaces.map((s) => ({ ...s, items: expand(s.items) }));
  n.folders = n.folders.filter((x) => x.id !== folder);
  return n;
}

export function renameFolder(l: WorkspaceLayout, folder: string, name: string): WorkspaceLayout {
  const n = clone(l);
  const f = n.folders.find((x) => x.id === folder);
  if (f) f.name = name.trim().slice(0, FOLDER_NAME_MAX);
  return n;
}

export function reorderInFolder(l: WorkspaceLayout, folder: string, app: AppId, index: number): WorkspaceLayout {
  const n = clone(l);
  const f = n.folders.find((x) => x.id === folder);
  if (!f || !f.apps.includes(app)) return l;
  f.apps = f.apps.filter((a) => a !== app);
  f.apps.splice(Math.max(0, Math.min(index, f.apps.length)), 0, app);
  return n;
}

/** Removes an app from the desktop (not from the system: it stays in the app menu). */
export function hideApp(l: WorkspaceLayout, app: AppId): WorkspaceLayout {
  const n = clone(l);
  if (!n.hidden.includes(app)) n.hidden.push(app);
  return n;
}

/** Puts an app back on the desktop (end of the given phone page / PC desktop). */
export function showApp(l: WorkspaceLayout, app: AppId, place?: Place): WorkspaceLayout {
  const n = clone(l);
  n.hidden = n.hidden.filter((a) => a !== app);
  if (place) {
    removeEverywhere(n, { kind: "app", id: app });
    containerOf(n, place)?.push({ kind: "app", id: app });
  }
  return n;
}

/** The user's own label for an app icon; empty restores the app's name. */
export function renameApp(l: WorkspaceLayout, app: AppId, name: string): WorkspaceLayout {
  const n = clone(l);
  const clean = name.trim().slice(0, APP_LABEL_MAX);
  if (clean) n.names[app] = clean;
  else delete n.names[app];
  return n;
}

/** The PC dock: pinned apps in order. Pinning an already pinned app moves it. */
export function pinToDock(l: WorkspaceLayout, app: AppId, index = Number.MAX_SAFE_INTEGER): WorkspaceLayout {
  const n = clone(l);
  const dock = (n.desktop.dock ?? []).filter((a) => a !== app);
  if (dock.length >= DOCK_MAX) return l;
  dock.splice(Math.max(0, Math.min(index, dock.length)), 0, app);
  n.desktop.dock = dock;
  return n;
}

export function unpinFromDock(l: WorkspaceLayout, app: AppId): WorkspaceLayout {
  const n = clone(l);
  n.desktop.dock = (n.desktop.dock ?? []).filter((a) => a !== app);
  return n;
}

export function setCategory(l: WorkspaceLayout, app: AppId, category: AppCategory | null): WorkspaceLayout {
  const n = clone(l);
  if (category) n.categories[app] = category;
  else delete n.categories[app];
  return n;
}

export function addSpace(l: WorkspaceLayout, random: () => number = Math.random): { layout: WorkspaceLayout; id: string } | null {
  if (l.desktop.spaces.length >= DESKTOP_SPACES_MAX) return null;
  const n = clone(l);
  let id: string;
  do id = `d_${Math.floor(random() * 36 ** 6).toString(36)}`;
  while (n.desktop.spaces.some((s) => s.id === id));
  n.desktop.spaces.push({ id, name: "", items: [] });
  return { layout: n, id };
}

/** Removes a PC desktop; its icons move to the previous one. The first desktop stays. */
export function removeSpace(l: WorkspaceLayout, space: string): WorkspaceLayout {
  const i = l.desktop.spaces.findIndex((s) => s.id === space);
  if (i <= 0) return l;
  const n = clone(l);
  const [gone] = n.desktop.spaces.splice(i, 1);
  const prev = n.desktop.spaces[i - 1]!;
  prev.items.push(...gone!.items);
  for (const w of n.widgets) if (w.surface === "desktop" && w.container === space) w.container = prev.id;
  return n;
}

export function renameSpace(l: WorkspaceLayout, space: string, name: string): WorkspaceLayout {
  const n = clone(l);
  const s = n.desktop.spaces.find((x) => x.id === space);
  if (s) s.name = name.trim().slice(0, SPACE_NAME_MAX);
  return n;
}

/** Category of an app for this user: their own choice, else the manifest default. */
export function categoryOf(l: Pick<WorkspaceLayout, "categories">, app: AppId, fallback: AppCategory): AppCategory {
  return l.categories[app] ?? fallback;
}


// ---------------------------------------------------------------------------
// Step 2.2: free placement and widgets.

/** Free placement: puts an item at a position (fractions of the desktop area). */
export function placeItem(l: WorkspaceLayout, item: LayoutItem, pos: Position): WorkspaceLayout {
  const n = clone(l);
  n.desktop.positions = { ...n.desktop.positions, [itemKey(item)]: { x: clamp01(pos.x), y: clamp01(pos.y) } };
  return n;
}

export function newWidgetId(random: () => number = Math.random): string {
  return `w_${Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, "0")}`;
}

export function addWidget(
  l: WorkspaceLayout,
  type: WidgetType,
  where: { surface: "desktop"; space: string; x?: number; y?: number; cell?: Cell } | { surface: "mobile"; page: number; cell?: Cell },
  id = newWidgetId(),
): WorkspaceLayout {
  if (l.widgets.length >= WIDGETS_MAX) return l;
  const n = clone(l);
  // A new widget goes to the top-left of the grid unless a cell is given; icons there move on.
  const cells = where.surface === "desktop" ? n.desktop.cells : n.mobile.cells;
  cells[`widget:${id}`] = where.cell ?? { c: 0, r: 0 };
  if (where.surface === "desktop") {
    n.widgets.push({ id, type, surface: "desktop", container: where.space, x: clamp01(where.x ?? 0.04), y: clamp01(where.y ?? 0.04) });
  } else {
    const onPage = n.widgets.filter((w) => w.surface === "mobile" && w.container === String(where.page));
    const y = onPage.length ? Math.min(1, Math.max(...onPage.map((w) => w.y)) + 0.01) : 0;
    n.widgets.push({ id, type, surface: "mobile", container: String(where.page), x: 0, y });
  }
  return n;
}

export function removeWidget(l: WorkspaceLayout, id: string): WorkspaceLayout {
  const n = clone(l);
  n.widgets = n.widgets.filter((w) => w.id !== id);
  delete n.desktop.cells[`widget:${id}`];
  delete n.mobile.cells[`widget:${id}`];
  return n;
}

export function moveWidget(l: WorkspaceLayout, id: string, pos: Partial<Position> & { container?: string }): WorkspaceLayout {
  const n = clone(l);
  const w = n.widgets.find((x) => x.id === id);
  if (!w) return l;
  if (pos.x !== undefined) w.x = clamp01(pos.x);
  if (pos.y !== undefined) w.y = clamp01(pos.y);
  if (pos.container !== undefined) w.container = pos.container;
  return n;
}


// ---------------------------------------------------------------------------
// Step 2.3: grid-cell placement (phone pages and PC desktops alike).
//
// Every item and widget of a page / desktop sits in a cell of a grid with the
// surface's column count. Stored cells are kept when they fit and are free;
// everything else (new items, cells that no longer fit after the column count
// changed, collisions) flows into the first free cells in reading order —
// items that had a cell first (in their old reading order), then the rest in
// list order. Empty cells stay empty: the user decides where things go.

export interface GridBlock {
  key: string;
  w: number;
  h: number;
}
export interface PlacedCell extends Cell {
  w: number;
  h: number;
}

export const widgetKey = (id: string) => `widget:${id}`;

/** Places blocks (widgets) and 1×1 items on a grid of `columns`. Pure. */
export function gridPlacement(columns: number, items: string[], cells: Record<string, Cell>, blocks: GridBlock[] = []): Map<string, PlacedCell> {
  const cols = Math.max(1, Math.floor(columns));
  const taken = new Set<string>();
  const out = new Map<string, PlacedCell>();
  const fits = (c: number, r: number, w: number, h: number) => {
    if (c < 0 || r < 0 || c + w > cols) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (taken.has(`${x},${y}`)) return false;
    return true;
  };
  const take = (key: string, c: number, r: number, w: number, h: number) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) taken.add(`${x},${y}`);
    out.set(key, { c, r, w, h });
  };
  const firstFree = (w: number, h: number) => {
    for (let r = 0; ; r++) for (let c = 0; c + w <= cols; c++) if (fits(c, r, w, h)) return { c, r };
  };
  const order = (keys: string[]) => {
    const placed = keys.filter((k) => cells[k]).sort((a, b) => cells[a]!.r - cells[b]!.r || cells[a]!.c - cells[b]!.c);
    return [...placed, ...keys.filter((k) => !cells[k])];
  };

  // Blocks first (widgets are bigger and need room), then items.
  const blockQueue: GridBlock[] = [];
  for (const b of [...blocks].sort((x, y) => (cells[x.key] ? 0 : 1) - (cells[y.key] ? 0 : 1))) {
    const w = Math.min(b.w, cols);
    const c = cells[b.key];
    if (c && fits(c.c, c.r, w, b.h)) take(b.key, c.c, c.r, w, b.h);
    else blockQueue.push({ ...b, w });
  }
  for (const b of blockQueue) {
    const at = firstFree(b.w, b.h)!;
    take(b.key, at.c, at.r, b.w, b.h);
  }
  const queue: string[] = [];
  for (const k of order(items)) {
    const c = cells[k];
    if (c && fits(c.c, c.r, 1, 1)) take(k, c.c, c.r, 1, 1);
    else queue.push(k);
  }
  for (const k of queue) {
    const at = firstFree(1, 1)!;
    take(k, at.c, at.r, 1, 1);
  }
  return out;
}

/** The surface's cells and the item / widget keys of one page (phone) or desktop (PC). */
export function surfaceKeys(l: WorkspaceLayout, place: Place): { items: string[]; blocks: GridBlock[] } {
  const items = (containerOf(l, place) ?? []).map(itemKey);
  const container = place.surface === "mobile" ? String(place.page) : place.space;
  const blocks = l.widgets
    .filter((w) => w.surface === place.surface && w.container === container && (WIDGET_TYPES as readonly string[]).includes(w.type))
    .map((w) => ({ key: widgetKey(w.id), ...WIDGET_CELLS[w.type as WidgetType] }));
  return { items, blocks };
}

const columnsOf = (l: WorkspaceLayout, surface: Place["surface"]) => (surface === "mobile" ? l.mobile.columns : l.desktop.columns);
const cellsOf = (l: WorkspaceLayout, surface: Place["surface"]) => (surface === "mobile" ? l.mobile.cells : l.desktop.cells);

/** Where everything on one page / desktop is right now. */
export function placementOf(l: WorkspaceLayout, place: Place): Map<string, PlacedCell> {
  const { items, blocks } = surfaceKeys(l, place);
  return gridPlacement(columnsOf(l, place.surface), items, cellsOf(l, place.surface), blocks);
}

/** Freezes the current placement of a page / desktop into stored cells (so one move changes only what moves). */
function pin(n: WorkspaceLayout, place: Place) {
  const cells = cellsOf(n, place.surface);
  for (const [k, p] of placementOf(n, place)) cells[k] = { c: p.c, r: p.r };
}

function containerKeyOf(l: WorkspaceLayout, surface: Place["surface"], key: string): Place | null {
  if (key.startsWith("widget:")) {
    const w = l.widgets.find((x) => widgetKey(x.id) === key && x.surface === surface);
    if (!w) return null;
    return surface === "mobile" ? { surface, page: Number(w.container) } : { surface, space: w.container };
  }
  if (surface === "mobile") {
    const page = l.mobile.pages.findIndex((p) => p.some((i) => itemKey(i) === key));
    return page >= 0 ? { surface, page } : null;
  }
  const space = l.desktop.spaces.find((s) => s.items.some((i) => itemKey(i) === key));
  return space ? { surface, space: space.id } : null;
}

/**
 * Drag & drop on the grid: puts an item (or a widget) into a cell of a page /
 * desktop. An empty cell is simply taken; an occupied one swaps (the other
 * item goes where the dragged one was). Moving to another page / desktop
 * carries the item there. Nothing else moves.
 */
export function placeInCell(l: WorkspaceLayout, key: string, to: Place, cell: Cell): WorkspaceLayout {
  const from = containerKeyOf(l, to.surface, key);
  if (!from) return l;
  const n = clone(l);
  const same = JSON.stringify(from) === JSON.stringify(to);
  pin(n, from);
  if (!same) pin(n, to);
  const cells = cellsOf(n, to.surface);
  const old = cells[key];
  const isWidget = key.startsWith("widget:");
  const size = isWidget ? WIDGET_CELLS[(n.widgets.find((w) => widgetKey(w.id) === key)?.type ?? "calculator") as WidgetType] : { w: 1, h: 1 };
  const cols = columnsOf(n, to.surface);
  const c = Math.max(0, Math.min(cols - size.w, cell.c));
  const r = Math.max(0, cell.r);

  // Who is in the target area?
  const placed = placementOf(n, to);
  const occupants = [...placed.entries()].filter(([k, p]) => k !== key && p.c < c + size.w && p.c + p.w > c && p.r < r + size.h && p.r + p.h > r).map(([k]) => k);
  // An icon never pushes a widget away.
  if (!isWidget && occupants.some((k) => k.startsWith("widget:"))) return l;

  // Carry the item / widget to the target container.
  if (!same) {
    if (isWidget) {
      const w = n.widgets.find((x) => widgetKey(x.id) === key)!;
      w.container = to.surface === "mobile" ? String(to.page) : to.space;
    } else {
      const item = (containerOf(n, from) ?? []).find((i) => itemKey(i) === key)!;
      const src = containerOf(n, from)!;
      src.splice(src.indexOf(item), 1);
      containerOf(n, to)?.push(item);
    }
  }
  cells[key] = { c, r };
  // Swap: a single 1×1 occupant takes the dragged item's old cell (same page) or
  // the first free cell; anything a widget lands on flows to free cells.
  for (const k of occupants) {
    if (!isWidget && occupants.length === 1 && same && old) cells[k] = old;
    else delete cells[k];
  }
  return n;
}
