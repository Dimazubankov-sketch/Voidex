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
 *    │                columns, grid / by-category view, manual / by-name order
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
export const APP_LABEL_MAX = 40;

export const WALLPAPER_GRADIENTS = ["dawn", "lavender", "mist", "aurora", "sand", "night"] as const;
export type WallpaperGradient = (typeof WALLPAPER_GRADIENTS)[number];
export const WALLPAPER_PRESETS = ["voidex", "waves", "orbit", "grid"] as const;
export type WallpaperPreset = (typeof WALLPAPER_PRESETS)[number];

const appId = z.enum(APP_IDS as [AppId, ...AppId[]]);
const folderId = z.string().regex(/^f_[a-z0-9]{4,24}$/);
const spaceId = z.string().regex(/^d_[a-z0-9]{1,24}$/);
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
  z.object({ kind: z.literal("preset"), id: z.enum(WALLPAPER_PRESETS) }),
  /** The user's own picture; `version` changes when a new one is uploaded. */
  z.object({ kind: z.literal("image"), version: z.string().max(64) }),
]);
export type Wallpaper = z.infer<typeof WallpaperSchema>;

export const AppearanceSchema = z.object({
  wallpaper: WallpaperSchema,
  /** Icon labels: automatic contrast against the wallpaper, or forced. */
  labelColor: z.enum(["auto", "dark", "light"]),
  labelSize: z.enum(["s", "m", "l"]),
  /** Second line under the app name (e.g. "System", unread count). */
  captions: z.boolean(),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export const DesktopSpaceSchema = z.object({
  id: spaceId,
  name: z.string().max(SPACE_NAME_MAX),
  items: z.array(LayoutItemSchema).max(ITEMS_PER_CONTAINER_MAX),
});
export type DesktopSpace = z.infer<typeof DesktopSpaceSchema>;

export const WorkspaceLayoutSchema = z.object({
  v: z.literal(1),
  folders: z.array(FolderSchema).max(FOLDERS_MAX),
  hidden: z.array(appId).max(ITEMS_PER_CONTAINER_MAX),
  mobile: z.object({
    columns: z.union([z.literal(3), z.literal(4)]),
    pages: z.array(z.array(LayoutItemSchema).max(ITEMS_PER_CONTAINER_MAX)).min(1).max(MOBILE_PAGES_MAX),
  }),
  desktop: z.object({
    columns: z.number().int().min(DESKTOP_COLUMNS_MIN).max(DESKTOP_COLUMNS_MAX),
    density: z.enum(["compact", "normal", "spacious"]),
    view: z.enum(["grid", "categories"]),
    sort: z.enum(["manual", "name"]),
    spaces: z.array(DesktopSpaceSchema).min(1).max(DESKTOP_SPACES_MAX),
  }),
  categories: z.partialRecord(appId, z.enum(APP_CATEGORIES)),
  /** Added after v1 shipped: older stored layouts have no `names`. */
  names: z.partialRecord(appId, z.string().max(APP_LABEL_MAX)).default({}),
  appearance: AppearanceSchema,
});
export type WorkspaceLayout = z.infer<typeof WorkspaceLayoutSchema>;

export const DEFAULT_APPEARANCE: Appearance = { wallpaper: { kind: "default" }, labelColor: "auto", labelSize: "m", captions: true };

export function defaultLayout(apps: AppId[]): WorkspaceLayout {
  const items = apps.map((id) => ({ kind: "app" as const, id }));
  return {
    v: 1,
    folders: [],
    hidden: [],
    mobile: { columns: 3, pages: [items] },
    desktop: { columns: 5, density: "normal", view: "grid", sort: "manual", spaces: [{ id: "d_1", name: "", items }] },
    categories: {},
    names: {},
    appearance: DEFAULT_APPEARANCE,
  };
}

export const sameItem = (a: LayoutItem, b: LayoutItem) => a.kind === b.kind && a.id === b.id;
const itemKey = (i: LayoutItem) => `${i.kind}:${i.id}`;

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

  return {
    v: 1,
    folders,
    hidden,
    mobile: { columns: base.mobile.columns === 4 ? 4 : 3, pages },
    desktop: {
      columns: Math.min(DESKTOP_COLUMNS_MAX, Math.max(DESKTOP_COLUMNS_MIN, Math.round(base.desktop.columns))),
      density: base.desktop.density,
      view: base.desktop.view,
      sort: base.desktop.sort,
      spaces,
    },
    categories,
    names,
    appearance: base.appearance ?? DEFAULT_APPEARANCE,
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
  n.desktop.spaces[i - 1]!.items.push(...gone!.items);
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
