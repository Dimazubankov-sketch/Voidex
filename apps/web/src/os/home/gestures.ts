import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { MOBILE_PAGES_MAX, moveItem, pinToDock, placeInCell, removeFromFolder, reorderInFolder, sameItem, type LayoutItem, type Place } from "@voidex/shared";
import type { FormFactor } from "@/lib/form-factor";
import { useWM } from "../window-manager";
import { itemKey, mergeInto, parseItem } from "./actions";
import { dockIndexAt } from "./dock";
import { cellAt, placeOfGrid } from "./grid";
import { inTopEdge } from "../metrics";
import { ghost } from "./icons";
import { currentLayout, updateLayout } from "./layout";
import { useHomeUi } from "./ui-store";

/**
 * Pointer gestures of the home screen — one engine for touch and mouse.
 *
 *   tap                       open the app / folder (native click)
 *   long press on an icon     phone: context menu; moving on picks the icon up
 *   long press on free space  edit mode (icons wiggle)
 *   drag (mouse: right away; touch: in edit mode or after a long press)
 *                             drop into any grid cell (empty: taken, occupied: swap) ·
 *                             hold over an icon → folder ·
 *                             hold at a screen edge → other / new page ·
 *                             hold over a PC desktop tab → move there ·
 *                             drag out of an open folder → take it out
 *   horizontal swipe          phone pages
 *   pull down                 phone quick search
 *   right click               PC context menu (icon or free space)
 *
 * Icons carry `data-home-item="app:mail"`, their grids
 * `data-home-container="mobile:0" | "desktop:d_1" | "folder:f_…"`.
 */

const LONG_PRESS_MS = 450;
const SLOP = 8;
const EDGE = 26;

export interface GestureOptions {
  ff: FormFactor;
  /** Icons can be rearranged here (manual order, grid view). Menus work regardless. */
  canArrange: boolean;
  pager?: { move: (dx: number) => void; end: (dx: number, vx: number) => void };
  onPullDown?: () => void;
}

type Mode = "pending" | "armed" | "drag" | "swipe" | "pull" | "done";

function haptic() {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* not supported */
  }
}

function placeOf(container: string): Place | null {
  const [surface, id] = container.split(":");
  if (surface === "mobile") return { surface: "mobile", page: Number(id) };
  if (surface === "desktop" && id) return { surface: "desktop", space: id };
  return null;
}

/** Where the pointer is among a grid's icons: an insertion index, or an icon to merge with. */
export function slotAt(container: Element, x: number, y: number, dragged: LayoutItem, allowMerge = dragged.kind === "app"): { index: number; merge?: string } {
  const draggedKey = itemKey(dragged);
  const cells = [...container.querySelectorAll<HTMLElement>(":scope > [data-home-item]")].filter((el) => el.dataset.homeItem !== draggedKey);
  if (!cells.length) return { index: 0 };
  let best = 0;
  let bestDist = Infinity;
  cells.forEach((el, i) => {
    const r = (el.querySelector("[data-tile]") ?? el).getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  const cell = cells[best]!;
  const tile = (cell.querySelector("[data-tile]") ?? cell).getBoundingClientRect();
  const inset = tile.width * 0.2;
  if (allowMerge && x > tile.left + inset && x < tile.right - inset && y > tile.top + inset && y < tile.bottom - inset) {
    return { index: best, merge: cell.dataset.homeItem };
  }
  const box = cell.getBoundingClientRect();
  const after = y > box.bottom || (y >= box.top && x > tile.left + tile.width / 2);
  return { index: after ? best + 1 : best };
}

export function useHomeGestures(opts: GestureOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const suppressClick = useRef(false);
  const lastPointer = useRef<string>("mouse");

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    lastPointer.current = e.pointerType;
    suppressClick.current = false;
    if (e.button !== 0) return;
    // A touch from the very top edge belongs to the Notification Center (see notifications/gesture.ts).
    if (optsRef.current.ff === "mobile" && inTopEdge(e.clientY)) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-home-control], input, textarea, select, [data-no-home-gesture]")) return;
    const ui = useHomeUi.getState;
    if (ui().drag) return;
    const itemEl = target.closest<HTMLElement>("[data-home-item]");
    const item = parseItem(itemEl?.dataset.homeItem);
    const folderGrid = itemEl?.closest<HTMLElement>("[data-home-container^='folder:']");
    const inFolder = folderGrid?.dataset.homeContainer?.slice("folder:".length);
    // Only the icons area reacts to empty-space gestures, not the header / bars.
    if (!item && !target.closest("[data-home-free]")) return;

    const touch = e.pointerType !== "mouse";
    const start = { x: e.clientX, y: e.clientY };
    let last = { x: e.clientX, t: performance.now() };
    let vx = 0;
    let mode: Mode = "pending";

    // Dwell timers: an action fires when the pointer rests on the same target.
    let pendingKey: string | null = null;
    let firedKey: string | null = null;
    let dwell: number | undefined;
    const schedule = (key: string, ms: number, fn: () => void) => {
      if (key === pendingKey || key === firedKey) return;
      window.clearTimeout(dwell);
      pendingKey = key;
      dwell = window.setTimeout(() => {
        pendingKey = null;
        firedKey = key;
        fn();
      }, ms);
    };
    const unschedule = () => {
      window.clearTimeout(dwell);
      pendingKey = null;
      firedKey = null;
    };

    const canPick = () => !!item && (optsRef.current.canArrange || !!inFolder);

    const startDrag = (x: number, y: number) => {
      if (!item || !itemEl) return;
      mode = "drag";
      suppressClick.current = true;
      ui().closeMenu();
      if (touch && !ui().editing) ui().setEditing(true);
      const tile = (itemEl.querySelector("[data-tile]") ?? itemEl).getBoundingClientRect();
      ghost.x.set(x);
      ghost.y.set(y);
      ui().setDrag({ item, fromFolder: inFolder, size: tile.width });
      if (!touch) document.body.style.cursor = "grabbing";
    };

    const turnPage = (dir: -1 | 1, dragged: LayoutItem) => {
      const l = currentLayout();
      const page = Math.min(ui().mobilePage, l.mobile.pages.length - 1);
      const alone = (l.mobile.pages[page] ?? []).length <= 1;
      const to = page + dir;
      if (to < 0 || to >= l.mobile.pages.length) {
        if (alone || l.mobile.pages.length >= MOBILE_PAGES_MAX) return;
        updateLayout((x) => moveItem(x, dragged, { surface: "mobile", page: to < 0 ? -1 : x.mobile.pages.length }, 0));
      } else {
        updateLayout((x) => moveItem(x, dragged, { surface: "mobile", page: to }, x.mobile.pages[to]!.length));
      }
      const now = currentLayout().mobile.pages.findIndex((p) => p.some((i) => sameItem(i, dragged)));
      if (now >= 0) ui().setMobilePage(now);
      haptic();
    };

    const dragMove = (x: number, y: number) => {
      ghost.x.set(x);
      ghost.y.set(y);
      const d = ui().drag;
      if (!d) return;
      const els = document.elementsFromPoint(x, y);
      const find = (sel: string) => {
        for (const el of els) {
          const hit = el.closest<HTMLElement>(sel);
          if (hit) return hit;
        }
        return null;
      };

      // Inside an open folder: reorder there; leaving the panel takes the app out.
      if (d.fromFolder) {
        const folder = d.fromFolder;
        const app = d.item.kind === "app" ? d.item.id : null;
        if (!app) return;
        if (!find("[data-folder-panel]")) {
          schedule("leave-folder", 280, () => {
            updateLayout((l) => removeFromFolder(l, app));
            ui().setOpenFolder(null);
            ui().patchDrag({ fromFolder: undefined });
          });
          return;
        }
        const grid = document.querySelector(`[data-home-container="folder:${folder}"]`);
        if (!grid) return;
        const { index } = slotAt(grid, x, y, d.item, false); // no folders inside folders
        schedule(`f:${index}`, 70, () => updateLayout((l) => reorderInFolder(l, folder, app, index)));
        return;
      }

      // PC: an app dragged onto the dock gets pinned there (the desktop icon stays).
      if (optsRef.current.ff === "desktop" && d.item.kind === "app") {
        if (find("[data-dock]")) {
          unschedule();
          const index = dockIndexAt(x);
          if (d.overDock !== index || d.mergeWith) ui().patchDrag({ overDock: index, mergeWith: undefined });
          return;
        }
        if (d.overDock !== undefined) ui().patchDrag({ overDock: undefined });
      }

      // PC: hold over a desktop tab → switch to it and bring the icon along.
      const tab = find("[data-home-space]");
      if (tab) {
        const space = tab.dataset.homeSpace!;
        ui().patchDrag({ mergeWith: undefined });
        schedule(`space:${space}`, 420, () => {
          updateLayout((l) => moveItem(l, d.item, { surface: "desktop", space }, Number.MAX_SAFE_INTEGER));
          useWM.getState().setSpace(space);
          haptic();
        });
        return;
      }

      // Phone: hold at the left / right edge → previous / next (or new) page.
      if (optsRef.current.ff === "mobile") {
        const pager = document.querySelector("[data-home-pager]");
        if (pager) {
          const r = pager.getBoundingClientRect();
          const dir = x < r.left + EDGE ? -1 : x > r.right - EDGE ? 1 : 0;
          if (dir) {
            ui().patchDrag({ mergeWith: undefined });
            schedule(`edge:${dir}:${ui().mobilePage}`, 600, () => turnPage(dir, d.item));
            return;
          }
        }
      }

      // Step 2.3 grid: any cell — an empty one is taken, an occupied one swaps on release.
      // Resting on another icon's centre still makes a folder.
      // Over the grid itself, or anywhere on the page / desktop that hosts it (below the last row).
      const cells = find("[data-home-grid]") ?? find("[data-grid-host]")?.querySelector<HTMLElement>("[data-home-grid]") ?? null;
      if (cells) {
        const draggedKey = itemKey(d.item);
        const over = els.map((el) => el.closest<HTMLElement>("[data-home-item]")).find((el) => el && el.dataset.homeItem !== draggedKey);
        if (over && d.item.kind === "app") {
          const tile = (over.querySelector("[data-tile]") ?? over).getBoundingClientRect();
          const inset = tile.width * 0.2;
          if (x > tile.left + inset && x < tile.right - inset && y > tile.top + inset && y < tile.bottom - inset) {
            const merge = over.dataset.homeItem!;
            if (d.cell) ui().patchDrag({ cell: undefined });
            schedule(`merge:${merge}`, 260, () => {
              ui().patchDrag({ mergeWith: merge });
              haptic();
            });
            return;
          }
        }
        unschedule();
        const at = cellAt(cells, x, y);
        const grid = cells.dataset.homeGrid!;
        if (d.mergeWith || d.cell?.grid !== grid || d.cell.c !== at.c || d.cell.r !== at.r) ui().patchDrag({ mergeWith: undefined, cell: { grid, ...at } });
        return;
      }
      if (d.cell) ui().patchDrag({ cell: undefined });

      const grid = find("[data-home-container]");
      const place = grid ? placeOf(grid.dataset.homeContainer!) : null;
      if (!grid || !place) {
        unschedule();
        ui().patchDrag({ mergeWith: undefined });
        return;
      }
      const slot = slotAt(grid, x, y, d.item);
      if (slot.merge) {
        const merge = slot.merge;
        schedule(`merge:${merge}`, 260, () => {
          ui().patchDrag({ mergeWith: merge });
          haptic();
        });
        return;
      }
      if (d.mergeWith) ui().patchDrag({ mergeWith: undefined });
      schedule(`slot:${grid.dataset.homeContainer}:${slot.index}`, 90, () => updateLayout((l) => moveItem(l, d.item, place, slot.index)));
    };

    const finishDrag = (commit: boolean) => {
      unschedule();
      const d = ui().drag;
      document.body.style.cursor = "";
      if (d && commit && d.item.kind === "app" && d.overDock !== undefined) {
        // Pinning adds the app to the dock; its desktop icon stays where it was.
        const app = d.item.id;
        const index = d.overDock;
        updateLayout((l) => pinToDock(l, app, index));
      } else if (d && commit && d.mergeWith && d.item.kind === "app") {
        const target = parseItem(d.mergeWith);
        if (target) mergeInto(d.item.id, target);
      } else if (d && commit && d.cell) {
        const place = placeOfGrid(d.cell.grid);
        const key = itemKey(d.item);
        const cell = { c: d.cell.c, r: d.cell.r };
        if (place) updateLayout((l) => placeInCell(l, key, place, cell));
      }
      ui().setDrag(null);
    };

    const timer = window.setTimeout(() => {
      if (mode !== "pending") return;
      suppressClick.current = true;
      haptic();
      if (!item || !itemEl) {
        mode = "done";
        ui().setEditing(true);
        return;
      }
      mode = "armed";
      // Phone, outside edit mode: the icon's menu. Moving the finger then picks the icon up.
      if (touch && !ui().editing) {
        const r = (itemEl.querySelector("[data-tile]") ?? itemEl).getBoundingClientRect();
        ui().openMenu({
          x: r.left + r.width / 2,
          y: r.bottom + 8,
          target: item.kind === "app" ? { kind: "app", id: item.id, inFolder } : { kind: "folder", id: item.id },
        });
      }
    }, LONG_PRESS_MS);

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      const now = performance.now();
      vx = ((ev.clientX - last.x) / Math.max(1, now - last.t)) * 1000;
      last = { x: ev.clientX, t: now };
      const o = optsRef.current;
      switch (mode) {
        case "drag":
          dragMove(ev.clientX, ev.clientY);
          return;
        case "swipe":
          o.pager?.move(dx);
          return;
        case "pull":
          if (dy > 64) {
            mode = "done";
            o.onPullDown?.();
          }
          return;
        case "done":
          return;
      }
      if (Math.hypot(dx, dy) < SLOP) return;
      window.clearTimeout(timer);
      if (mode === "armed") {
        if (canPick()) startDrag(ev.clientX, ev.clientY);
        else mode = "done";
        return;
      }
      // Moved before the long press.
      if (canPick() && (!touch || ui().editing)) {
        startDrag(ev.clientX, ev.clientY);
        return;
      }
      if (o.pager && Math.abs(dx) > Math.abs(dy)) {
        mode = "swipe";
        suppressClick.current = true;
        o.pager.move(dx);
        return;
      }
      if (o.onPullDown && dy > 0 && dy > Math.abs(dx) && !ui().editing && !inFolder) {
        mode = "pull";
        return;
      }
      mode = "done";
    };

    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key, true);
      window.clearTimeout(timer);
    };
    const up = (ev: PointerEvent) => {
      detach();
      if (mode === "drag") finishDrag(ev.type === "pointerup");
      else if (mode === "swipe") optsRef.current.pager?.end(ev.clientX - start.x, vx);
    };
    // Esc during a drag cancels it: the pending drop (dock, cell, folder) is dropped.
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || mode !== "drag") return;
      ev.stopPropagation();
      detach();
      mode = "done";
      finishDrag(false);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key, true);
  }, []);

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea")) return;
    e.preventDefault();
    // Touch long presses are handled above (menu or edit mode).
    if (lastPointer.current === "touch") return;
    const itemEl = target.closest<HTMLElement>("[data-home-item]");
    const item = parseItem(itemEl?.dataset.homeItem);
    const inFolder = itemEl?.closest<HTMLElement>("[data-home-container^='folder:']")?.dataset.homeContainer?.slice("folder:".length);
    const ui = useHomeUi.getState();
    if (item) ui.openMenu({ x: e.clientX, y: e.clientY, target: item.kind === "app" ? { kind: "app", id: item.id, inFolder } : { kind: "folder", id: item.id } });
    else if (target.closest("[data-home-free]")) ui.openMenu({ x: e.clientX, y: e.clientY, target: { kind: "desktop" } });
  }, []);

  return { onPointerDown, onClickCapture, onContextMenu };
}
