import {
  APP_REGISTRY,
  categoryOf,
  dissolveFolder,
  dropOnto,
  folderFromApp,
  hideApp,
  newFolderId,
  showApp,
  type AppCategory,
  type AppId,
  type LayoutItem,
  type Place,
  type WorkspaceLayout,
} from "@voidex/shared";
import { getFormFactor } from "@/lib/form-factor";
import { t, useI18n, type MessageKey } from "@/lib/i18n";
import { toast } from "@/ui/overlays";
import { useWM, type Rect } from "../window-manager";
import { currentLayout, updateLayout } from "./layout";
import { useHomeUi } from "./ui-store";

/**
 * Home-screen commands, shared by menus, gestures, the launcher and Settings,
 * so every entry point does the same thing.
 */

export const CATEGORY_LABEL: Record<AppCategory, MessageKey> = {
  work: "cat.work",
  communication: "cat.communication",
  media: "cat.media",
  tools: "cat.tools",
  entertainment: "cat.entertainment",
  system: "cat.system",
};

export function appCategory(l: Pick<WorkspaceLayout, "categories">, id: AppId): AppCategory {
  return categoryOf(l, id, APP_REGISTRY[id].category);
}

/** Label under an icon: the user's own, else the app's name. */
export function appLabel(l: Pick<WorkspaceLayout, "names">, id: AppId): string {
  return l.names?.[id] ?? APP_REGISTRY[id].name[useI18n.getState().language];
}

/** Where new things go on this device right now: the visible phone page or PC desktop. */
export function currentPlace(): Place {
  return getFormFactor() === "mobile" ? { surface: "mobile", page: useHomeUi.getState().mobilePage } : { surface: "desktop", space: useWM.getState().space };
}

export function rectOf(el: Element | null | undefined): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export function openApp(id: AppId, from?: Element | null) {
  useHomeUi.getState().setLauncherOpen(false);
  useHomeUi.getState().setEditing(false);
  useWM.getState().open(id, { origin: rectOf(from?.querySelector("[data-tile]") ?? from) });
}

/** A folder name iOS-style: the shared category of its apps, else "Folder". */
function folderName(apps: AppId[]): string {
  const l = currentLayout();
  const cats = new Set(apps.map((a) => appCategory(l, a)));
  return cats.size === 1 ? t(CATEGORY_LABEL[[...cats][0]!]) : t("home.folder");
}

/** Removes an icon from the desktop only; the app stays installed and in the app menu. */
export function removeFromDesktop(id: AppId) {
  const before = currentLayout();
  updateLayout((l) => hideApp(l, id));
  toast({
    title: t("home.removedFromDesktop", { app: appLabel(before, id) }),
    action: { label: t("home.undo"), onClick: () => updateLayout((l) => ({ ...l, hidden: l.hidden.filter((a) => a !== id), mobile: before.mobile, desktop: { ...l.desktop, spaces: before.desktop.spaces } })) },
    duration: 5000,
  });
}

/**
 * Step 2.5: removes several icons from the desktop after the two-step
 * confirmation. Only the icons go: the apps stay installed (app menu, search)
 * and their data is untouched. One "Undo" puts them all back.
 */
export function removeAppsFromDesktop(ids: AppId[]) {
  if (!ids.length) return;
  const before = currentLayout();
  updateLayout((l) => ids.reduce((acc, id) => hideApp(acc, id), l));
  toast({
    title: ids.length === 1 ? t("home.removedFromDesktop", { app: appLabel(before, ids[0]!) }) : t("home.removedManyFromDesktop", { n: ids.length }),
    action: {
      label: t("home.undo"),
      onClick: () =>
        updateLayout((l) => ({ ...l, hidden: l.hidden.filter((a) => !ids.includes(a)), mobile: before.mobile, desktop: { ...l.desktop, spaces: before.desktop.spaces } })),
    },
    duration: 5000,
  });
}

export function addToDesktop(id: AppId) {
  updateLayout((l) => showApp(l, id, currentPlace()));
}

/** "Create folder" on an app: a folder with that app, opened for naming. */
export function createFolderWith(id: AppId) {
  const fid = newFolderId();
  updateLayout((l) => folderFromApp(l, id, folderName([id]), fid));
  useHomeUi.getState().setOpenFolder({ id: fid, origin: null });
  useHomeUi.getState().setRenamingFolder(fid);
}

export function addToFolder(id: AppId, folder: string) {
  updateLayout((l) => dropOnto(l, id, { kind: "folder", id: folder }, ""));
}

/** App dropped onto another icon: joins that folder, or both form a new one. */
export function mergeInto(dragged: AppId, target: LayoutItem) {
  if (target.kind === "folder") return addToFolder(dragged, target.id);
  updateLayout((l) => dropOnto(l, dragged, target, folderName([dragged, target.id])));
}

export function ungroupFolder(id: string) {
  updateLayout((l) => dissolveFolder(l, id));
  const ui = useHomeUi.getState();
  if (ui.openFolder?.id === id) ui.setOpenFolder(null);
}

export function parseItem(key: string | undefined | null): LayoutItem | null {
  if (!key) return null;
  const [kind, id] = key.split(":");
  if (kind === "app" && id && id in APP_REGISTRY) return { kind: "app", id: id as AppId };
  if (kind === "folder" && id) return { kind: "folder", id };
  return null;
}

export const itemKey = (i: LayoutItem) => `${i.kind}:${i.id}`;
