import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  DESKTOP_SPACES_MAX,
  MOBILE_PAGES_MAX,
  WorkspaceLayoutSchema,
  addSpace,
  defaultLayout,
  dissolveFolder,
  dropOnto,
  folderFromApp,
  hideApp,
  moveItem,
  pinToDock,
  unpinFromDock,
  normalizeLayout,
  removeFromFolder,
  removeSpace,
  renameApp,
  renameFolder,
  reorderInFolder,
  showApp,
  placeItem,
  addWidget,
  moveWidget,
  removeWidget,
  placeInCell,
  placementOf,
  gridPlacement,
  categoryOf,
  type LayoutItem,
  type WorkspaceLayout,
} from "./workspace.js";
import type { AppId } from "./apps.js";

const APPS: AppId[] = ["mail", "settings"];
const app = (id: AppId): LayoutItem => ({ kind: "app", id });
const norm = (l: WorkspaceLayout) => normalizeLayout(l, APPS);
const topLevelMobile = (l: WorkspaceLayout) => l.mobile.pages.flat();
const topLevelDesktop = (l: WorkspaceLayout) => l.desktop.spaces.flatMap((s) => s.items);

describe("workspace layout model", () => {
  it("default layout has every app on page 1 and desktop 1, and is schema-valid", () => {
    const l = normalizeLayout(null, APPS);
    expect(l.mobile.pages).toEqual([[app("mail"), app("settings")]]);
    expect(l.desktop.spaces[0]!.items).toEqual([app("mail"), app("settings")]);
    expect(WorkspaceLayoutSchema.safeParse(l).success).toBe(true);
  });

  it("normalize: drops unknown/duplicate items, adds missing ones, is idempotent", () => {
    const raw = defaultLayout(APPS);
    raw.mobile.pages = [[app("mail"), app("mail")], []];
    raw.desktop.spaces[0]!.items = [];
    const l = norm(raw);
    expect(topLevelMobile(l)).toEqual([app("mail"), app("settings")]);
    expect(l.mobile.pages).toHaveLength(1); // empty page removed
    expect(topLevelDesktop(l)).toEqual([app("mail"), app("settings")]);
    expect(norm(l)).toEqual(l);
    // An app that is no longer installed disappears everywhere.
    expect(normalizeLayout(l, ["settings"]).mobile.pages).toEqual([[app("settings")]]);
  });

  it("app onto app creates a folder in its place on phone AND PC", () => {
    const l = norm(dropOnto(norm(defaultLayout(APPS)), "settings", app("mail"), "Work", "f_test1"));
    expect(l.folders).toEqual([{ id: "f_test1", name: "Work", apps: ["mail", "settings"] }]);
    expect(topLevelMobile(l)).toEqual([{ kind: "folder", id: "f_test1" }]);
    expect(topLevelDesktop(l)).toEqual([{ kind: "folder", id: "f_test1" }]);
  });

  it("folder: rename, reorder inside, take an app out, dissolve", () => {
    let l = norm(dropOnto(norm(defaultLayout(APPS)), "settings", app("mail"), "", "f_abcd"));
    l = norm(renameFolder(l, "f_abcd", "  Моя папка  "));
    expect(l.folders[0]!.name).toBe("Моя папка");
    l = norm(reorderInFolder(l, "f_abcd", "settings", 0));
    expect(l.folders[0]!.apps).toEqual(["settings", "mail"]);
    l = norm(removeFromFolder(l, "mail"));
    expect(l.folders[0]!.apps).toEqual(["settings"]);
    expect(topLevelMobile(l)).toEqual([{ kind: "folder", id: "f_abcd" }, app("mail")]);
    l = norm(dissolveFolder(l, "f_abcd"));
    expect(l.folders).toEqual([]);
    expect(topLevelMobile(l).sort((a, b) => a.id.localeCompare(b.id))).toEqual([app("mail"), app("settings")]);
  });

  it("taking the last app out of a folder removes the folder", () => {
    let l = norm(folderFromApp(norm(defaultLayout(APPS)), "mail", "Solo", "f_solo"));
    expect(topLevelMobile(l)).toEqual([{ kind: "folder", id: "f_solo" }, app("settings")]);
    l = norm(removeFromFolder(l, "mail"));
    expect(l.folders).toEqual([]);
    expect(topLevelMobile(l)).toEqual([app("mail"), app("settings")]);
  });

  it("phone pages: move to a new page, max 3 pages, empty pages disappear", () => {
    let l = norm(defaultLayout(APPS));
    l = norm(moveItem(l, app("settings"), { surface: "mobile", page: 1 }, 0));
    expect(l.mobile.pages).toEqual([[app("mail")], [app("settings")]]);
    l = norm(moveItem(l, app("mail"), { surface: "mobile", page: 2 }, 0));
    expect(l.mobile.pages).toEqual([[app("settings")], [app("mail")]]); // page 1 became empty and was removed
    const full = defaultLayout(APPS);
    full.mobile.pages = [[app("mail")], [app("settings")], []];
    expect(moveItem(full, app("mail"), { surface: "mobile", page: MOBILE_PAGES_MAX }, 0)).toBe(full); // no 4th page
  });

  it("reorder keeps order within a page and survives a 3 → 4 column change", () => {
    let l = norm(moveItem(norm(defaultLayout(APPS)), app("settings"), { surface: "mobile", page: 0 }, 0));
    expect(l.mobile.pages[0]).toEqual([app("settings"), app("mail")]);
    l = norm({ ...l, mobile: { ...l.mobile, columns: 4 } });
    expect(l.mobile.pages[0]).toEqual([app("settings"), app("mail")]);
  });

  it("removing from the desktop hides the icon but keeps the app installed; showing restores it", () => {
    let l = norm(hideApp(norm(defaultLayout(APPS)), "mail"));
    expect(l.hidden).toEqual(["mail"]);
    expect(topLevelMobile(l)).toEqual([app("settings")]);
    expect(topLevelDesktop(l)).toEqual([app("settings")]);
    l = norm(showApp(l, "mail"));
    expect(topLevelMobile(l)).toContainEqual(app("mail"));
  });

  it("PC virtual desktops: add (max), move icons, remove moves icons back", () => {
    let l = norm(defaultLayout(APPS));
    const added = addSpace(l, () => 0.5)!;
    l = norm(added.layout);
    expect(l.desktop.spaces).toHaveLength(2);
    l = norm(moveItem(l, app("mail"), { surface: "desktop", space: added.id }, 0));
    expect(l.desktop.spaces[1]!.items).toEqual([app("mail")]);
    expect(l.desktop.spaces[0]!.items).toEqual([app("settings")]);
    // Phone layout untouched by PC moves.
    expect(topLevelMobile(l)).toEqual([app("mail"), app("settings")]);
    l = norm(removeSpace(l, added.id));
    expect(l.desktop.spaces).toHaveLength(1);
    expect(l.desktop.spaces[0]!.items).toEqual([app("settings"), app("mail")]);
    // The first desktop can't be removed; the count is capped.
    expect(removeSpace(l, l.desktop.spaces[0]!.id)).toBe(l);
    let many = l;
    for (let i = 0; i < 10; i++) {
      const r = addSpace(many);
      if (r) many = r.layout;
    }
    expect(many.desktop.spaces).toHaveLength(DESKTOP_SPACES_MAX);
  });

  it("schema rejects malformed input (bad folder id, too many pages, bad colour)", () => {
    const l = norm(defaultLayout(APPS));
    expect(WorkspaceLayoutSchema.safeParse({ ...l, folders: [{ id: "x", name: "", apps: [] }] }).success).toBe(false);
    expect(WorkspaceLayoutSchema.safeParse({ ...l, mobile: { ...l.mobile, pages: [[], [], [], []] } }).success).toBe(false);
    expect(
      WorkspaceLayoutSchema.safeParse({ ...l, appearance: { ...l.appearance, wallpaper: { kind: "color", color: "red;background:url(x)" } } }).success,
    ).toBe(false);
  });

  it("a new first phone page can be created by dragging to the left edge", () => {
    const l = norm(moveItem(norm(defaultLayout(APPS)), app("settings"), { surface: "mobile", page: -1 }, 0));
    expect(l.mobile.pages).toEqual([[app("settings")], [app("mail")]]);
  });

  it("apps can get their own icon label; stored layouts from before labels still parse", () => {
    let l = norm(renameApp(norm(defaultLayout(APPS)), "mail", "  Работа  "));
    expect(l.names).toEqual({ mail: "Работа" });
    l = norm(renameApp(l, "mail", ""));
    expect(l.names).toEqual({});
    const { names: _names, ...legacy } = norm(defaultLayout(APPS));
    const parsed = WorkspaceLayoutSchema.parse(legacy);
    expect(parsed.names).toEqual({});
  });

  it("Step 2 layouts keep working: retired wallpapers map to the new set, glass defaults to on", () => {
    const old = { ...norm(defaultLayout(APPS)) } as Record<string, unknown> & WorkspaceLayout;
    const legacyAppearance = { wallpaper: { kind: "gradient", id: "night" }, labelColor: "auto", labelSize: "m", captions: true };
    const parsed = WorkspaceLayoutSchema.parse({ ...old, appearance: legacyAppearance });
    expect(parsed.appearance.glass).toBe("on");
    const l = norm(parsed);
    expect(l.appearance.wallpaper).toEqual({ kind: "preset", id: "wave-light" });
    expect(norm({ ...l, appearance: { ...l.appearance, wallpaper: { kind: "preset", id: "orbit" } } }).appearance.wallpaper).toEqual({ kind: "preset", id: "wave-light" });
    // Step 2.1 presets retired in Step 2.2
    expect(norm({ ...l, appearance: { ...l.appearance, wallpaper: { kind: "preset", id: "glow" } } }).appearance.wallpaper).toEqual({ kind: "preset", id: "aura" });
    expect(norm({ ...l, appearance: { ...l.appearance, wallpaper: { kind: "preset", id: "wave-violet" } } }).appearance.wallpaper).toEqual({ kind: "preset", id: "wave-light" });
    expect(norm({ ...l, appearance: { ...l.appearance, wallpaper: { kind: "preset", id: "wave-gray-violet" } } }).appearance.wallpaper).toEqual({ kind: "preset", id: "wave-gray-purple" });
    // Retired label settings are reset
    expect(norm({ ...l, appearance: { ...l.appearance, labelColor: "light", labelSize: "l" } }).appearance).toMatchObject({ labelColor: "auto", labelSize: "m" });
    expect(norm({ ...l, appearance: { ...l.appearance, wallpaper: { kind: "preset", id: "unknown-x" } } }).appearance.wallpaper).toEqual({ kind: "default" });
    expect(norm({ ...l, appearance: { ...l.appearance, wallpaper: { kind: "preset", id: "wave-milk" } } }).appearance.wallpaper).toEqual({ kind: "preset", id: "wave-milk" });
    expect(WorkspaceLayoutSchema.safeParse({ ...l, appearance: { ...l.appearance, glass: "max" } }).success).toBe(false);
    expect(WorkspaceLayoutSchema.safeParse({ ...l, appearance: { ...l.appearance, wallpaper: { kind: "preset", id: "<script>" } } }).success).toBe(false);
  });

  it("PC dock: every app pinned by default (and for older layouts), pin / reorder / unpin, empty stays empty", () => {
    let l = norm(defaultLayout(APPS));
    expect(l.desktop.dock).toEqual(["mail", "settings"]);
    const { dock: _dock, ...olderDesktop } = l.desktop;
    expect(norm({ ...l, desktop: olderDesktop }).desktop.dock).toEqual(["mail", "settings"]);
    l = norm(pinToDock(l, "settings", 0));
    expect(l.desktop.dock).toEqual(["settings", "mail"]);
    l = norm(unpinFromDock(unpinFromDock(l, "mail"), "settings"));
    expect(l.desktop.dock).toEqual([]);
    l = norm(pinToDock(l, "mail"));
    expect(l.desktop.dock).toEqual(["mail"]);
    expect(norm({ ...l, desktop: { ...l.desktop, dock: ["mail", "mail", "settings"] } }).desktop.dock).toEqual(["mail", "settings"]);
    expect(normalizeLayout(l, ["settings"]).desktop.dock).toEqual([]); // uninstalled apps leave the dock
  });

  it("Step 2.2: older layouts get dock / free placement / widget defaults", () => {
    const l = norm(defaultLayout(APPS));
    const { dockDesktops: _a, dockScale: _b, arrange: _c, positions: _d, ...olderDesktop } = l.desktop;
    const { widgets: _w, ...older } = l;
    const parsed = WorkspaceLayoutSchema.parse({ ...older, desktop: olderDesktop });
    expect(parsed.widgets).toEqual([]);
    expect(parsed.desktop).toMatchObject({ dockDesktops: true, dockScale: "m", arrange: "grid", positions: {} });
    expect(norm(parsed)).toEqual(l);
  });

  it("free placement: positions are kept for items on a desktop and clamped into the area", () => {
    let l = norm(defaultLayout(APPS));
    l = norm(placeItem(l, app("mail"), { x: 0.5, y: 0.25 }));
    expect(l.desktop.positions).toEqual({ "app:mail": { x: 0.5, y: 0.25 } });
    l = norm({ ...l, desktop: { ...l.desktop, positions: { "app:mail": { x: 3, y: -1 }, "app:ghost": { x: 0.1, y: 0.1 } } } });
    expect(l.desktop.positions).toEqual({ "app:mail": { x: 1, y: 0 } });
    // Hidden apps lose their position; the grid order is untouched.
    expect(norm(hideApp(l, "mail")).desktop.positions).toEqual({});
    expect(l.desktop.spaces[0]!.items).toEqual([app("mail"), app("settings")]);
    expect(WorkspaceLayoutSchema.safeParse({ ...l, desktop: { ...l.desktop, positions: { "app:mail": { x: 2, y: 0 } } } }).success).toBe(false);
  });

  it("widgets: add / move / remove, unknown types dropped, removed desktop moves them", () => {
    let l = norm(defaultLayout(APPS));
    const added = addSpace(l, () => 0.5)!;
    l = norm(added.layout);
    l = norm(addWidget(l, "calculator", { surface: "desktop", space: added.id, x: 0.2, y: 0.3 }, "w_test01"));
    l = norm(addWidget(l, "calculator", { surface: "mobile", page: 0 }, "w_test02"));
    expect(l.widgets.map((w) => [w.id, w.surface, w.container])).toEqual([
      ["w_test01", "desktop", added.id],
      ["w_test02", "mobile", "0"],
    ]);
    l = norm(moveWidget(l, "w_test01", { x: 1.4, y: 0.5 }));
    expect(l.widgets[0]).toMatchObject({ x: 1, y: 0.5 });
    l = norm(removeSpace(l, added.id));
    expect(l.widgets[0]!.container).toBe("d_1");
    l = norm(removeWidget(l, "w_test02"));
    expect(l.widgets.map((w) => w.id)).toEqual(["w_test01"]);
    const bogus = { ...l, widgets: [...l.widgets, { id: "w_test01", type: "calculator", surface: "desktop", container: "d_9", x: 0, y: 0 }] } as WorkspaceLayout;
    expect(norm(bogus).widgets).toHaveLength(1); // duplicate id dropped
    // Unknown / retired widget types (the Step 2.2 "desktops" widget) are accepted in stored data and dropped.
    const legacy = { ...l, widgets: [{ ...l.widgets[0]!, type: "desktops" }] } as WorkspaceLayout;
    expect(WorkspaceLayoutSchema.safeParse(legacy).success).toBe(true);
    expect(norm(legacy).widgets).toEqual([]);
    expect(norm(legacy).desktop.cells).toEqual({});
  });
});

describe("step 2.3: grid cells, labels, system bar", () => {
  const MANY: AppId[] = ["mail", "settings", "vibex"];
  const n3 = (l: WorkspaceLayout) => normalizeLayout(l, MANY);
  const key = (id: AppId) => `app:${id}`;
  const desk = { surface: "desktop" as const, space: "d_1" };

  it("older layouts get the new defaults; free arrange is retired to the grid", () => {
    const old = n3(defaultLayout(MANY));
    const raw = JSON.parse(JSON.stringify(old));
    delete raw.appearance.showLabels;
    delete raw.appearance.systemBar;
    delete raw.desktop.cells;
    delete raw.mobile.cells;
    raw.desktop.arrange = "free";
    const parsed = WorkspaceLayoutSchema.parse(raw);
    const l = n3(parsed);
    expect(l.appearance).toMatchObject({ showLabels: true, systemBar: "glass" });
    expect(l.desktop.arrange).toBe("grid");
    expect(l.desktop.cells).toEqual({});
  });

  it("without stored cells items flow in reading order", () => {
    const l = n3(defaultLayout(MANY));
    const p = placementOf(l, desk);
    expect([key("mail"), key("settings"), key("vibex")].map((k) => [p.get(k)!.c, p.get(k)!.r])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it("an item dropped on an empty cell takes it; nothing else moves; empty cells stay empty", () => {
    let l = n3(defaultLayout(MANY));
    l = n3(placeInCell(l, key("vibex"), desk, { c: 3, r: 2 }));
    const p = placementOf(l, desk);
    expect(p.get(key("vibex"))).toMatchObject({ c: 3, r: 2 });
    expect(p.get(key("mail"))).toMatchObject({ c: 0, r: 0 });
    expect(p.get(key("settings"))).toMatchObject({ c: 1, r: 0 });
    // [2,0] is empty now and stays empty.
    expect([...p.values()].some((x) => x.c === 2 && x.r === 0)).toBe(false);
    // Down, left, up.
    l = n3(placeInCell(l, key("vibex"), desk, { c: 0, r: 4 }));
    expect(placementOf(l, desk).get(key("vibex"))).toMatchObject({ c: 0, r: 4 });
  });

  it("an item dropped on an occupied cell swaps with it", () => {
    let l = n3(defaultLayout(MANY));
    l = n3(placeInCell(l, key("vibex"), desk, { c: 0, r: 0 }));
    const p = placementOf(l, desk);
    expect(p.get(key("vibex"))).toMatchObject({ c: 0, r: 0 });
    expect(p.get(key("mail"))).toMatchObject({ c: 2, r: 0 });
  });

  it("phone: moving to another page carries the item there", () => {
    let l = n3(defaultLayout(MANY));
    l = n3(moveItem(l, app("mail"), { surface: "mobile", page: 1 }, 0)); // creates page 2
    expect(l.mobile.pages).toHaveLength(2);
    l = n3(placeInCell(l, key("vibex"), { surface: "mobile", page: 1 }, { c: 2, r: 3 }));
    expect(l.mobile.pages[1]!.map((i) => i.id)).toEqual(["mail", "vibex"]);
    expect(placementOf(l, { surface: "mobile", page: 1 }).get(key("vibex"))).toMatchObject({ c: 2, r: 3 });
  });

  it("fewer columns: cells that no longer fit re-flow into free cells in their old order, nothing is lost", () => {
    let l = n3(defaultLayout(MANY));
    l = n3({ ...l, desktop: { ...l.desktop, columns: 8 } });
    l = n3(placeInCell(l, key("vibex"), desk, { c: 7, r: 0 }));
    expect(placementOf(l, desk).get(key("vibex"))).toMatchObject({ c: 7, r: 0 });
    l = n3({ ...l, desktop: { ...l.desktop, columns: 3 } });
    const p = placementOf(l, desk);
    expect(p.size).toBe(3);
    expect(p.get(key("vibex"))).toMatchObject({ c: 2, r: 0 });
  });

  it("a 2×2 widget takes four cells; icons flow around it and never push it", () => {
    let l = n3(defaultLayout(MANY));
    l = n3(addWidget(l, "calculator", { surface: "desktop", space: "d_1" }, "w_calc01"));
    const p = placementOf(l, desk);
    expect(p.get("widget:w_calc01")).toMatchObject({ c: 0, r: 0, w: 2, h: 2 });
    for (const k of [key("mail"), key("settings"), key("vibex")]) {
      const c = p.get(k)!;
      expect(c.c >= 2 || c.r >= 2).toBe(true);
    }
    // An icon dropped onto the widget is refused.
    expect(placeInCell(l, key("mail"), desk, { c: 1, r: 1 })).toBe(l);
    // Removing the widget forgets its cells.
    expect(n3(removeWidget(l, "w_calc01")).desktop.cells["widget:w_calc01"]).toBeUndefined();
  });

  it("labels and system bar settings are kept", () => {
    const l = n3({ ...defaultLayout(MANY), appearance: { ...defaultLayout(MANY).appearance, showLabels: false, systemBar: "off" } });
    expect(l.appearance).toMatchObject({ showLabels: false, systemBar: "off" });
  });
});

describe("Step 2.5 appearance: dock glass, theme, wallpaper sync", () => {
  const MANY: AppId[] = ["mail", "settings", "vibex", "notes"];
  it("older layouts get light theme, glass dock and synced wallpapers", () => {
    const old = { ...defaultLayout(MANY), appearance: { wallpaper: { kind: "default" }, captions: true } } as unknown as WorkspaceLayout;
    expect(normalizeLayout(old, MANY).appearance).toMatchObject({ dock: "glass", theme: "light", syncWallpapers: true, systemBar: "glass" });
  });
  it("keeps the dock and the system bar apart; unknown values fall back", () => {
    const l = normalizeLayout({ ...defaultLayout(MANY), appearance: { ...DEFAULT_APPEARANCE, dock: "off", systemBar: "glass", theme: "dark", syncWallpapers: false } }, MANY);
    expect(l.appearance).toMatchObject({ dock: "off", systemBar: "glass", theme: "dark", syncWallpapers: false });
    const bad = normalizeLayout({ ...defaultLayout(MANY), appearance: { ...DEFAULT_APPEARANCE, theme: "neon" as "dark" } }, MANY);
    expect(bad.appearance.theme).toBe("light");
  });
});

describe("Step 2.7: search background and the Files / Media apps", () => {
  const ALL: AppId[] = ["mail", "settings", "vibex", "notes", "files", "media"];
  it("older layouts get the system search background; white is kept; unknown falls back", () => {
    const old = { ...defaultLayout(ALL), appearance: { wallpaper: { kind: "default" }, captions: true } } as unknown as WorkspaceLayout;
    expect(normalizeLayout(old, ALL).appearance.searchAppearance).toBe("system");
    const white = normalizeLayout({ ...defaultLayout(ALL), appearance: { ...DEFAULT_APPEARANCE, searchAppearance: "white" } }, ALL);
    expect(white.appearance.searchAppearance).toBe("white");
    expect(WorkspaceLayoutSchema.safeParse(white).success).toBe(true);
    const bad = normalizeLayout({ ...defaultLayout(ALL), appearance: { ...DEFAULT_APPEARANCE, searchAppearance: "glass" as "white" } }, ALL);
    expect(bad.appearance.searchAppearance).toBe("system");
    // Step 2.8: «Вид приложений» — media by default, any of the four kept, anything else back to media.
    expect(normalizeLayout(old, ALL).appearance.appLook).toBe("media");
    for (const look of ["media", "notes", "mail", "dark"] as const) {
      expect(normalizeLayout({ ...defaultLayout(ALL), appearance: { ...DEFAULT_APPEARANCE, appLook: look } }, ALL).appearance.appLook).toBe(look);
    }
    expect(normalizeLayout({ ...defaultLayout(ALL), appearance: { ...DEFAULT_APPEARANCE, appLook: "neon" as "dark" } }, ALL).appearance.appLook).toBe("media");
  });
  it("an existing customized layout gets Files and Media without its dock being rewritten", () => {
    const before: AppId[] = ["mail", "settings", "vibex", "notes"];
    const l = defaultLayout(before);
    l.desktop.dock = ["vibex", "mail"];
    const after = normalizeLayout(l, ALL);
    expect(after.desktop.dock).toEqual(["vibex", "mail"]);
    const onDesktop = after.desktop.spaces.flatMap((s) => s.items).filter((i) => i.kind === "app").map((i) => i.id);
    expect(onDesktop).toEqual(expect.arrayContaining(["files", "media"]));
    const onPhone = after.mobile.pages.flat().filter((i) => i.kind === "app").map((i) => i.id);
    expect(onPhone).toEqual(expect.arrayContaining(["files", "media"]));
  });
});

describe("Step 2.5.1: bounded PC desktop grid", () => {
  it("keeps valid stored cells and moves out-of-bounds ones to the nearest free cell", () => {
    const p = gridPlacement(6, ["a", "b", "c", "d"], { a: { c: 0, r: 0 }, b: { c: 12, r: 1 }, c: { c: 3, r: 20 }, d: { c: 5, r: 3 } }, [], 4);
    expect(p.get("a")).toMatchObject({ c: 0, r: 0 });
    expect(p.get("d")).toMatchObject({ c: 5, r: 3 });
    // b: column 12 does not exist → the last column of its row.
    expect(p.get("b")).toMatchObject({ c: 5, r: 1 });
    // c: row 20 does not exist → the last row, same column.
    expect(p.get("c")).toMatchObject({ c: 3, r: 3 });
    for (const cell of p.values()) {
      expect(cell.c + cell.w).toBeLessThanOrEqual(6);
      expect(cell.r + cell.h).toBeLessThanOrEqual(4);
    }
  });

  it("a clamped cell that is taken goes to the nearest free one; a valid stored cell keeps priority", () => {
    const p = gridPlacement(3, ["x", "y"], { x: { c: 9, r: 9 }, y: { c: 2, r: 1 } }, [], 2);
    expect(p.get("y")).toMatchObject({ c: 2, r: 1 });
    // x wanted the bottom-right corner (taken by y): the nearest free cell.
    const x = p.get("x")!;
    expect(Math.abs(x.c - 2) + Math.abs(x.r - 1)).toBe(1);
  });

  it("new items fill the area in reading order and only spill past the last row when it is full", () => {
    const keys = Array.from({ length: 7 }, (_, i) => `k${i}`);
    const p = gridPlacement(3, keys, {}, [], 2);
    expect([...p.values()].filter((c) => c.r < 2)).toHaveLength(6);
    expect(p.get("k6")).toMatchObject({ c: 0, r: 2 });
  });

  it("widgets are clamped too (a 2×2 block never hangs outside)", () => {
    const p = gridPlacement(4, ["a"], { "widget:w": { c: 3, r: 5 } }, [{ key: "widget:w", w: 2, h: 2 }], 3);
    expect(p.get("widget:w")).toMatchObject({ c: 2, r: 1, w: 2, h: 2 });
  });

  it("placeInCell uses the screen geometry for PC desktops (drop in the far corner stays inside)", () => {
    const l = norm(defaultLayout(APPS));
    const space = l.desktop.spaces[0]!.id;
    const g = { cols: 10, rows: 5 };
    const n = placeInCell(l, "app:mail", { surface: "desktop", space }, { c: 40, r: 40 }, g);
    expect(placementOf(n, { surface: "desktop", space }, g).get("app:mail")).toMatchObject({ c: 9, r: 4 });
    // The phone layout is never bounded by it.
    expect(placementOf(n, { surface: "mobile", page: 0 }, g).size).toBe(placementOf(n, { surface: "mobile", page: 0 }).size);
  });

  it("an app's category is always its manifest category (old manual overrides are dropped)", () => {
    const l = norm({ ...defaultLayout(APPS), categories: { mail: "tools" } } as WorkspaceLayout);
    expect(l.categories).toEqual({});
    expect(categoryOf({ categories: { mail: "tools" } } as WorkspaceLayout, "mail", "communication")).toBe("communication");
  });
});

describe("Step 2.5.1: deleting a PC desktop", () => {
  it("moves its apps and widgets to the primary desktop (not the previous one) and drops their old cells", () => {
    let l = norm(defaultLayout(APPS));
    const primary = l.desktop.spaces[0]!.id;
    const second = addSpace(l)!;
    l = second.layout;
    const third = addSpace(l)!;
    l = third.layout;
    l = norm(moveItem(l, app("mail"), { surface: "desktop", space: third.id }, 0));
    l = addWidget(l, "calculator", { surface: "desktop", space: third.id });
    const wid = l.widgets.find((w) => w.surface === "desktop")!.id;
    l = { ...l, desktop: { ...l.desktop, cells: { ...l.desktop.cells, "app:mail": { c: 7, r: 3 }, [`widget:${wid}`]: { c: 2, r: 2 } } } };
    const n = norm(removeSpace(l, third.id));
    expect(n.desktop.spaces.map((s) => s.id)).toEqual([primary, second.id]);
    expect(n.desktop.spaces[0]!.items).toContainEqual(app("mail"));
    expect(n.widgets.find((w) => w.id === wid)!.container).toBe(primary);
    expect(n.desktop.cells["app:mail"]).toBeUndefined();
    // Everything on the primary desktop has its own cell inside a 6×3 screen.
    const placed = placementOf(n, { surface: "desktop", space: primary }, { cols: 6, rows: 3 });
    const cells = [...placed.values()].flatMap((p) => Array.from({ length: p.w * p.h }, (_, k) => `${p.c + (k % p.w)},${p.r + Math.floor(k / p.w)}`));
    expect(new Set(cells).size).toBe(cells.length);
    for (const p of placed.values()) expect(p.r + p.h).toBeLessThanOrEqual(3);
  });

  it("never removes the primary desktop", () => {
    const l = norm(defaultLayout(APPS));
    expect(removeSpace(l, l.desktop.spaces[0]!.id)).toBe(l);
  });
});
