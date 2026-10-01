import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiEditLine,
  RiFolderAddLine,
  RiFolderOpenLine,
  RiFolderReduceLine,
  RiFolderTransferLine,
  RiLayoutGridLine,
  RiMacbookLine,
  RiPriceTag3Line,
  RiApps2Line,
  RiListUnordered,
  RiShareBoxLine,
  RiPushpinLine,
  RiUnpinLine,
  RiImageLine,
  RiDragMove2Line,
  RiApps2Fill,
} from "@remixicon/react";
import {
  APP_CATEGORIES,
  addSpace,
  moveItem,
  pinToDock,
  removeFromFolder,
  removeSpace,
  removeWidget,
  sameItem,
  setCategory,
  unpinFromDock,
  type AppId,
  type LayoutItem,
  type WorkspaceLayout,
} from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { useWM } from "../window-manager";
import { currentView, setArrange, setView } from "./brush-menu";
import { CATEGORY_LABEL, addToDesktop, addToFolder, appCategory, createFolderWith, openApp, removeFromDesktop, ungroupFolder } from "./actions";
import { updateLayout } from "./layout";
import { useHomeUi, type ContextTarget } from "./ui-store";

const EASE = [0.22, 1, 0.36, 1] as const;
const WIDTH = 256;

interface Entry {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  /** Opens a second level instead of acting. */
  sub?: "folders" | "category" | "spaces" | "view";
  danger?: boolean;
  checked?: boolean;
  /** Applies in place and leaves the menu open (view switches). */
  keepOpen?: boolean;
}

export function spaceLabel(t: ReturnType<typeof useT>, l: WorkspaceLayout, id: string) {
  const i = l.desktop.spaces.findIndex((s) => s.id === id);
  const s = l.desktop.spaces[i];
  return s?.name || t("home.space", { n: i + 1 });
}

/** Removes a PC desktop: its icons and windows move to the previous one. */
export function deleteSpace(l: WorkspaceLayout, id: string) {
  const i = l.desktop.spaces.findIndex((s) => s.id === id);
  if (i <= 0) return;
  const prev = l.desktop.spaces[i - 1]!.id;
  updateLayout((x) => removeSpace(x, id));
  useWM.getState().moveSpaceWindows(id, prev);
}

export function newSpace() {
  let created: string | null = null;
  updateLayout((l) => {
    const r = addSpace(l);
    if (!r) return l;
    created = r.id;
    return r.layout;
  });
  if (created) useWM.getState().setSpace(created);
}

/** Icon / desktop menu: right click on PC, long press on the phone. */
export function ContextMenu({ layout }: { layout: WorkspaceLayout }) {
  const menu = useHomeUi((s) => s.menu);
  const close = () => useHomeUi.getState().closeMenu();
  // Esc closes the menu (a menu that stays open after "View" must still close from the keyboard).
  useEffect(() => {
    if (!menu) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      useHomeUi.getState().closeMenu();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [menu]);
  return createPortal(
    <>
      {menu && (
        <div
          className="fixed inset-0 z-[205]"
          onPointerDown={close}
          onContextMenu={(e) => {
            e.preventDefault();
            close();
          }}
          data-testid="home-context-backdrop"
        />
      )}
      <AnimatePresence>{menu && <MenuPanel key={menu.seq} layout={layout} x={menu.x} y={menu.y} target={menu.target} />}</AnimatePresence>
    </>,
    document.body,
  );
}

function MenuPanel({ layout, x, y, target }: { layout: WorkspaceLayout; x: number; y: number; target: ContextTarget }) {
  const t = useT();
  const ff = useFormFactor();
  const ui = useHomeUi.getState;
  const [sub, setSub] = useState<Entry["sub"] | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const close = () => ui().closeMenu();

  useLayoutEffect(() => {
    const h = panel.current?.offsetHeight ?? 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(ff === "mobile" ? x - WIDTH / 2 : x, vw - WIDTH - 8));
    let top = y;
    if (top + h > vh - 8) top = Math.max(8, ff === "mobile" ? y - h - 110 : vh - h - 8);
    setPos({ left, top: Math.max(8, top) });
  }, [x, y, sub, ff]);

  const entries = buildEntries();

  function buildEntries(): Entry[] {
    const mobile = ff === "mobile";
    switch (target.kind) {
      case "app": {
        const id = target.id;
        if (target.inFolder) {
          return [
            ...(mobile ? [] : [{ id: "open", label: t("home.open"), icon: <RiShareBoxLine />, onSelect: () => openApp(id) }]),
            { id: "take-out", label: t("home.removeFromFolder"), icon: <RiFolderReduceLine />, onSelect: () => updateLayout((l) => removeFromFolder(l, id)) },
            { id: "remove", label: t("home.removeFromDesktop"), icon: <RiDeleteBinLine />, onSelect: () => removeFromDesktop(id), danger: true },
          ];
        }
        const list: Entry[] = [];
        if (!mobile) list.push({ id: "open", label: t("home.open"), icon: <RiShareBoxLine />, onSelect: () => openApp(id) });
        list.push({ id: "remove", label: t("home.removeFromDesktop"), icon: <RiDeleteBinLine />, onSelect: () => removeFromDesktop(id), danger: true });
        list.push({ id: "create-folder", label: t("home.createFolder"), icon: <RiFolderAddLine />, onSelect: () => createFolderWith(id) });
        list.push({ id: "add-to-folder", label: t("home.addToFolder"), icon: <RiFolderTransferLine />, sub: "folders" });
        if (!mobile) {
          list.push(dockEntry(id));
          list.push({ id: "rename", label: t("home.rename"), icon: <RiEditLine />, onSelect: () => ui().setRenaming({ kind: "app", id }) });
          list.push({ id: "category", label: t("home.category"), icon: <RiPriceTag3Line />, sub: "category" });
          if (layout.desktop.spaces.length > 1) list.push({ id: "move-space", label: t("home.moveToSpace"), icon: <RiMacbookLine />, sub: "spaces" });
        }
        return list;
      }
      case "folder": {
        const id = target.id;
        const list: Entry[] = [
          { id: "open", label: t("home.open"), icon: <RiFolderOpenLine />, onSelect: () => ui().setOpenFolder({ id, origin: null }) },
          {
            id: "rename",
            label: t("home.rename"),
            icon: <RiEditLine />,
            onSelect: () => {
              ui().setOpenFolder({ id, origin: null });
              ui().setRenamingFolder(id);
            },
          },
        ];
        if (!mobile && layout.desktop.spaces.length > 1) list.push({ id: "move-space", label: t("home.moveToSpace"), icon: <RiMacbookLine />, sub: "spaces" });
        list.push({ id: "dissolve", label: t("home.dissolveFolder"), icon: <RiFolderReduceLine />, onSelect: () => ungroupFolder(id), danger: true });
        return list;
      }
      case "launcher-app": {
        const id = target.id;
        const hidden = layout.hidden.includes(id);
        return [
          { id: "open", label: t("home.open"), icon: <RiShareBoxLine />, onSelect: () => openApp(id) },
          ...(mobile ? [] : [dockEntry(id)]),
          hidden
            ? { id: "add-to-desktop", label: t("home.addToDesktop"), icon: <RiAddLine />, onSelect: () => addToDesktop(id) }
            : { id: "remove", label: t("home.removeFromDesktop"), icon: <RiDeleteBinLine />, onSelect: () => removeFromDesktop(id), danger: true },
        ];
      }
      case "dock-app": {
        const id = target.id;
        return [
          { id: "open", label: t("home.open"), icon: <RiShareBoxLine />, onSelect: () => openApp(id) },
          { id: "unpin", label: t("dock.unpin"), icon: <RiUnpinLine />, onSelect: () => updateLayout((l) => unpinFromDock(l, id)) },
        ];
      }
      case "dock-desktops":
        return [{ id: "unpin", label: t("dock.unpin"), icon: <RiUnpinLine />, onSelect: () => updateLayout((l) => ({ ...l, desktop: { ...l.desktop, dockDesktops: false } })) }];
      case "widget": {
        const id = target.id;
        return [
          { id: "edit", label: t("home.edit"), icon: <RiApps2Line />, onSelect: () => ui().setEditing(true) },
          { id: "remove-widget", label: t("widgets.remove"), icon: <RiDeleteBinLine />, danger: true, onSelect: () => updateLayout((l) => removeWidget(l, id)) },
        ];
      }
      case "space": {
        const id = target.id;
        const first = layout.desktop.spaces[0]?.id === id;
        return [
          { id: "rename", label: t("home.rename"), icon: <RiEditLine />, onSelect: () => ui().setRenaming({ kind: "space", id }) },
          ...(first ? [] : [{ id: "remove-space", label: t("home.removeSpace"), icon: <RiDeleteBinLine />, onSelect: () => deleteSpace(layout, id), danger: true }]),
        ];
      }
      case "desktop": {
        // Wallpaper · View · Widgets — the same choices as the brush menu.
        const list: Entry[] = [
          { id: "appearance", label: t("home.wallpaper"), icon: <RiImageLine />, onSelect: () => ui().setAppearanceOpen(true) },
          {
            id: "view",
            label: t("home.view"),
            icon: currentView(layout, ff) === "grid" ? <RiLayoutGridLine /> : <RiListUnordered />,
            sub: "view",
          },
          { id: "widgets", label: t("widgets.title"), icon: <RiApps2Fill />, onSelect: () => ui().setWidgetsOpen(true) },
          { id: "edit", label: t("home.edit"), icon: <RiApps2Line />, onSelect: () => ui().setEditing(true) },
        ];
        if (!mobile) {
          if (layout.desktop.spaces.length < 6) list.push({ id: "new-space", label: t("home.newSpace"), icon: <RiAddLine />, onSelect: newSpace });
          if (!layout.desktop.dockDesktops) {
            list.push({
              id: "dock-desktops",
              label: t("dock.showDesktops"),
              icon: <RiPushpinLine />,
              onSelect: () => updateLayout((l) => ({ ...l, desktop: { ...l.desktop, dockDesktops: true } })),
            });
          }
        }
        return list;
      }
    }
  }

  function dockEntry(id: AppId): Entry {
    return (layout.desktop.dock ?? []).includes(id)
      ? { id: "unpin", label: t("dock.unpin"), icon: <RiUnpinLine />, onSelect: () => updateLayout((l) => unpinFromDock(l, id)) }
      : { id: "pin", label: t("dock.pin"), icon: <RiPushpinLine />, onSelect: () => updateLayout((l) => pinToDock(l, id)) };
  }

  function subEntries(): Entry[] {
    if (sub === "view") {
      const view = currentView(layout, ff);
      const list: Entry[] = [
        { id: "view-grid", label: t("home.viewGrid"), icon: <RiLayoutGridLine />, checked: view === "grid", keepOpen: true, onSelect: () => setView(ff, "grid") },
        { id: "view-categories", label: t("home.viewCategories"), icon: <RiListUnordered />, checked: view === "categories", keepOpen: true, onSelect: () => setView(ff, "categories") },
      ];
      if (ff === "desktop" && view === "grid") {
        const free = layout.desktop.arrange === "free";
        list.push({ id: "view-free", label: t("appearance.arrangeFree"), icon: <RiDragMove2Line />, checked: free, keepOpen: true, onSelect: () => setArrange(free ? "grid" : "free") });
      }
      return list;
    }
    if (target.kind !== "app" && target.kind !== "folder") return [];
    const item: LayoutItem = target.kind === "app" ? { kind: "app", id: target.id } : { kind: "folder", id: target.id };
    if (sub === "folders" && target.kind === "app") {
      const id = target.id;
      return [
        ...layout.folders.map((f) => ({ id: `folder-${f.id}`, label: f.name || t("home.folder"), icon: <RiFolderOpenLine />, onSelect: () => addToFolder(id, f.id) })),
        { id: "new-folder", label: t("home.newFolder"), icon: <RiFolderAddLine />, onSelect: () => createFolderWith(id) },
      ];
    }
    if (sub === "category" && target.kind === "app") {
      const id = target.id;
      const current = appCategory(layout, id);
      return APP_CATEGORIES.map((c) => ({ id: `cat-${c}`, label: t(CATEGORY_LABEL[c]), checked: c === current, onSelect: () => updateLayout((l) => setCategory(l, id, c)) }));
    }
    if (sub === "spaces") {
      return layout.desktop.spaces
        .filter((s) => !s.items.some((i) => sameItem(i, item)))
        .map((s) => ({
          id: `space-${s.id}`,
          label: spaceLabel(t, layout, s.id),
          icon: <RiMacbookLine />,
          onSelect: () => updateLayout((l) => moveItem(l, item, { surface: "desktop", space: s.id }, Number.MAX_SAFE_INTEGER)),
        }));
    }
    return [];
  }

  const shown = sub ? subEntries() : entries;
  const subTitle =
    sub === "folders" ? t("home.addToFolder") : sub === "category" ? t("home.category") : sub === "spaces" ? t("home.moveToSpace") : sub === "view" ? t("appearance.view") : "";

  return (
    <motion.div
        ref={panel}
        role="menu"
        className="vx-glass-strong fixed z-[210] overflow-hidden rounded-2xl p-1.5"
        style={{ left: pos.left, top: pos.top, width: WIDTH }}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95, pointerEvents: "none" }}
        transition={{ duration: 0.15, ease: EASE }}
        data-testid="home-context-menu"
      >
        {sub && (
          <button
            type="button"
            className="flex h-10 w-full items-center gap-1 rounded-xl px-2 text-left text-[13px] font-medium text-text-secondary hover:bg-surface-hover"
            onClick={() => setSub(null)}
            data-testid="menu-back"
          >
            <RiArrowLeftSLine className="size-5" />
            {subTitle}
          </button>
        )}
        {shown.map((e) => (
          <button
            key={e.id}
            type="button"
            role={e.checked !== undefined ? "menuitemradio" : "menuitem"}
            aria-checked={e.checked}
            data-testid={`menu-${e.id}`}
            onClick={() => {
              if (e.sub) return setSub(e.sub);
              if (!e.keepOpen) close();
              e.onSelect?.();
            }}
            className={cx(
              "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors [&_svg]:size-[18px]",
              e.danger ? "text-danger hover:bg-danger-soft" : "text-text hover:bg-surface-hover",
            )}
          >
            {e.icon && <span className={cx("flex size-5 items-center justify-center", e.danger ? "text-danger" : "text-text-secondary")}>{e.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{e.label}</span>
            {e.checked && <RiCheckLine className="text-primary" />}
            {e.sub && <RiArrowRightSLine className="text-text-tertiary" />}
          </button>
        ))}
    </motion.div>
  );
}
