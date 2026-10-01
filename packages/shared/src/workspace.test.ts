import { describe, expect, it } from "vitest";
import {
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
    l = norm(addWidget(l, "desktops", { surface: "desktop", space: added.id, x: 0.2, y: 0.3 }, "w_test01"));
    l = norm(addWidget(l, "desktops", { surface: "mobile", page: 0 }, "w_test02"));
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
    const bogus = { ...l, widgets: [...l.widgets, { id: "w_test01", type: "desktops", surface: "desktop", container: "d_9", x: 0, y: 0 }] } as WorkspaceLayout;
    expect(norm(bogus).widgets).toHaveLength(1); // duplicate id dropped
    expect(WorkspaceLayoutSchema.safeParse({ ...l, widgets: [{ ...l.widgets[0]!, type: "clock" }] }).success).toBe(false);
  });
});
