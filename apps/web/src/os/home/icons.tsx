import { memo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { motion, motionValue } from "motion/react";
import { RiSubtractLine } from "@remixicon/react";
import { APP_REGISTRY, removeFromFolder, type AppId, type Folder, type LayoutItem, type WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useLanguage, useT } from "@/lib/i18n";
import { useMailSummary } from "@/lib/mail-summary";
import { AppTile, GLYPH_BOX } from "@/brand/brand";
import { CLIENT_APPS } from "../app-registry";
import { useWM } from "../window-manager";
import { appLabel, itemKey, removeFromDesktop, ungroupFolder } from "./actions";
import type { LabelTone } from "./appearance";
import { updateLayout } from "./layout";
import { useHomeUi } from "./ui-store";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Pointer position of the current drag (motion values: no re-render per move). */
export const ghost = { x: motionValue(0), y: motionValue(0) };

export interface IconMetrics {
  /** Tile edge in px. */
  tile: number;
  /** Cell width (tile + room for the label). */
  cell: number;
  gapX: number;
  gapY: number;
}

export interface LabelStyle {
  tone: LabelTone;
  /** Font sizes follow the interface scale (PC) or icons per row (phone). */
  name: number;
  caption: number;
  captions: boolean;
  /** Step 2.3: app names under desktop icons (off: icons only; the name stays the accessible label). */
  show?: boolean;
}

function labelClass(tone: LabelTone) {
  return tone === "light" ? "text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.45)]" : "text-text";
}
function captionClass(tone: LabelTone) {
  return tone === "light" ? "text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]" : "text-text-tertiary";
}

function UnreadBadge({ n }: { n: number }) {
  return (
    <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-[12px] font-semibold text-white shadow-glow animate-pop">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function RemoveBadge({ label, onRemove }: { label: string; onRemove: () => void }) {
  // A span, not a <button>: it sits inside the icon's button.
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      data-home-control
      data-testid="home-remove-badge"
      className="absolute -left-2 -top-2 z-10 flex size-[22px] items-center justify-center rounded-full border border-white/70 bg-[rgba(60,60,72,0.72)] text-white shadow-md backdrop-blur-md animate-pop"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onRemove();
      }}
    >
      <RiSubtractLine className="size-4" />
    </span>
  );
}

/** The glass folder tile: frosted square with up to 9 mini icons. */
export function FolderTile({ folder, size, highlight }: { folder: Folder; size: number; highlight?: boolean }) {
  const mini = Math.round(size * 0.24);
  return (
    <span
      className={cx(
        "vx-glass-tile relative grid shrink-0 grid-cols-3 content-start justify-center gap-[5%] p-[12%] transition-transform duration-200",
        highlight && "scale-110 ring-4 ring-primary/30",
      )}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
      }}
    >
      {folder.apps.slice(0, 9).map((id) => {
        const { Icon } = CLIENT_APPS[id];
        return (
          <span key={id} className="flex items-center justify-center bg-surface shadow-[0_1px_2px_rgba(20,20,40,0.12)]" style={{ width: mini, height: mini, borderRadius: mini * 0.3 }}>
            <Icon className="size-[72%]" />
          </span>
        );
      })}
    </span>
  );
}

function AppCaption({ id }: { id: AppId }) {
  const lang = useLanguage();
  const t = useT();
  const unread = useMailSummary(id === "mail").data?.unread.inbox ?? 0;
  if (id === "mail" && unread) return <span className="font-medium text-primary">{t("os.unread", { n: unread })}</span>;
  return <>{APP_REGISTRY[id].caption[lang]}</>;
}

interface ItemProps {
  item: LayoutItem;
  layout: WorkspaceLayout;
  metrics: IconMetrics;
  label: LabelStyle;
  index: number;
  editing: boolean;
  /** Being dragged: the slot stays as a placeholder. */
  placeholder?: boolean;
  mergeTarget?: boolean;
  /** Shown inside this open folder: the edit badge takes the app out of it. */
  inFolder?: string;
  /** Tap (not in edit mode): open the app / folder. */
  onOpen: (item: LayoutItem, el: HTMLElement) => void;
}

/** One icon on the desktop — an app or a folder. Gestures are handled by the surface. */
export const HomeItem = memo(function HomeItem({ item, layout, metrics, label, index, editing, placeholder, mergeTarget, inFolder, onOpen }: ItemProps) {
  const t = useT();
  const running = useWM((s) => item.kind === "app" && Object.values(s.windows).some((w) => w.appId === item.id));
  const unread = useMailSummary(item.kind === "app" && item.id === "mail").data?.unread.inbox ?? 0;
  const folder = item.kind === "folder" ? layout.folders.find((f) => f.id === item.id) : undefined;
  if (item.kind === "folder" && !folder) return null;
  const name = item.kind === "app" ? appLabel(layout, item.id) : folder!.name || t("home.folder");
  const wiggle: CSSProperties | undefined = editing ? { animationDelay: `${-((index * 137) % 300)}ms` } : undefined;

  return (
    <motion.div
      layout
      layoutId={`home-${itemKey(item)}`}
      transition={{ layout: { duration: 0.28, ease: EASE } }}
      // The browser must not take a finger on an icon for scrolling, or it
      // cancels the drag (pointercancel). Free space still scrolls.
      className="flex touch-none justify-center"
      style={{ width: metrics.cell }}
      data-home-item={itemKey(item)}
      data-index={index}
    >
      <button
        type="button"
        className={cx("group relative flex flex-col items-center gap-1.5 rounded-3xl py-1 outline-none", placeholder && "opacity-0")}
        style={{ width: metrics.cell }}
        onClick={(e) => onOpen(item, e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            useHomeUi.getState().openMenu({ x: r.left + r.width / 2, y: r.bottom, target: item.kind === "app" ? { kind: "app", id: item.id } : { kind: "folder", id: item.id } });
          }
        }}
        aria-label={name}
        data-testid={item.kind === "app" ? `app-${item.id}` : `folder-${item.id}`}
      >
        <span data-tile className={cx("relative block", editing && "vx-wiggle")} style={wiggle}>
          {item.kind === "app" ? (
            <AppTile
              size={metrics.tile}
              className={cx(
                "transition-transform duration-200 group-focus-visible:ring-4 group-focus-visible:ring-primary/30",
                !editing && "group-hover:-translate-y-0.5",
                mergeTarget && "scale-110 ring-4 ring-primary/30",
              )}
            >
              <AppGlyph id={item.id} />
            </AppTile>
          ) : (
            <FolderTile folder={folder!} size={metrics.tile} highlight={mergeTarget} />
          )}
          {item.kind === "app" && item.id === "mail" && unread > 0 && !editing && <UnreadBadge n={unread} />}
          {editing && (
            <RemoveBadge
              label={inFolder ? t("home.removeFromFolder") : item.kind === "app" ? t("home.removeFromDesktop") : t("home.dissolveFolder")}
              onRemove={() =>
                item.kind === "folder" ? ungroupFolder(item.id) : inFolder ? updateLayout((l) => removeFromFolder(l, item.id)) : removeFromDesktop(item.id)
              }
            />
          )}
        </span>
        {label.show !== false && (
          <span className={cx("max-w-full truncate px-0.5 font-semibold leading-tight", labelClass(label.tone))} style={{ fontSize: label.name }} data-testid="home-label">
            {name}
          </span>
        )}
        {label.show !== false && label.captions && item.kind === "app" && (
          <span className={cx("-mt-1 max-w-full truncate leading-tight", captionClass(label.tone))} style={{ fontSize: label.caption }}>
            <AppCaption id={item.id} />
          </span>
        )}
        <span className={cx("-mt-0.5 size-1.5 rounded-full transition-opacity", running ? "bg-primary opacity-100" : "opacity-0")} />
      </button>
    </motion.div>
  );
});

/** An app's logo at the standard size inside its tile (see GLYPH_BOX). */
export function AppGlyph({ id }: { id: AppId }) {
  const { Icon } = CLIENT_APPS[id];
  return (
    <span className="flex items-center justify-center" style={{ width: GLYPH_BOX, height: GLYPH_BOX }}>
      <Icon className="size-full" />
    </span>
  );
}

/** Floating copy of the icon under the finger / cursor while dragging. */
export function DragGhost({ layout }: { layout: WorkspaceLayout }) {
  const drag = useHomeUi((s) => s.drag);
  if (!drag || drag.widget) return null;
  const folder = drag.item.kind === "folder" ? layout.folders.find((f) => f.id === drag.item.id) : undefined;
  return createPortal(
    <motion.div
      className={cx("pointer-events-none fixed left-0 top-0 z-[260] transition-opacity", drag.unpin && "opacity-50")}
      style={{ x: ghost.x, y: ghost.y, marginLeft: -drag.size / 2, marginTop: -drag.size / 2 }}
      data-testid="drag-ghost"
    >
      <div className="scale-110 drop-shadow-2xl">
        {drag.item.kind === "app" ? (
          <AppTile size={drag.size}>
            <AppGlyph id={drag.item.id} />
          </AppTile>
        ) : folder ? (
          <FolderTile folder={folder} size={drag.size} />
        ) : null}
      </div>
    </motion.div>,
    document.body,
  );
}
