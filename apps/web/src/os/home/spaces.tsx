import { RiAddLine, RiCheckLine } from "@remixicon/react";
import { DESKTOP_SPACES_MAX, type LayoutItem, type WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { useWM } from "../window-manager";
import { DEFAULT_SWATCH, useWallpaperImage, wallpaperStyle } from "./appearance";
import { newSpace, spaceLabel } from "./context-menu";
import { useHomeUi } from "./ui-store";

/**
 * The "Desktops" system app — one component behind the dock item, the
 * "Desktops" widget and the phone's round button. PC: virtual desktops
 * (switch, add). Phone: the home-screen pages.
 */

/** Glyph of the Desktops system app: two layered screens. */
export function DesktopsGlyph({ className = "size-[62%]" }: { className?: string }) {
  return (
    <svg viewBox="5 6 38 38" className={className} aria-hidden data-system-ui>
      <defs>
        <linearGradient id="vx-desk-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9a8cff" />
          <stop offset="1" stopColor="#6c5cff" />
        </linearGradient>
      </defs>
      <rect x="13" y="7" width="29" height="22" rx="6" fill="#c9c2ff" />
      <rect x="6" y="15" width="29" height="22" rx="6" fill="url(#vx-desk-a)" />
      <rect x="12" y="40" width="17" height="3" rx="1.5" fill="#b9b0ff" />
    </svg>
  );
}

interface Entry {
  key: string;
  label: string;
  items: LayoutItem[];
  active: boolean;
  select: () => void;
}

function useEntries(layout: WorkspaceLayout): { entries: Entry[]; canAdd: boolean; add: () => void } {
  const t = useT();
  const ff = useFormFactor();
  const space = useWM((s) => s.space);
  const page = useHomeUi((s) => s.mobilePage);
  if (ff === "mobile") {
    const pages = layout.mobile.pages;
    return {
      entries: pages.map((items, i) => ({
        key: String(i),
        label: t("home.page", { n: i + 1 }),
        items,
        active: i === Math.min(page, pages.length - 1),
        select: () => useHomeUi.getState().setMobilePage(i),
      })),
      // New phone pages are made by dragging an icon to the screen edge (they can't be empty).
      canAdd: false,
      add: () => undefined,
    };
  }
  return {
    entries: layout.desktop.spaces.map((s) => ({
      key: s.id,
      label: spaceLabel(t, layout, s.id),
      items: s.items,
      active: s.id === space,
      select: () => useWM.getState().setSpace(s.id),
    })),
    canAdd: layout.desktop.spaces.length < DESKTOP_SPACES_MAX,
    add: newSpace,
  };
}

/**
 * Thumbnails of the desktops (PC) or pages (phone): the current one marked,
 * tap to switch. `compact` is the widget size.
 */
export function SpacesList({ layout, onPicked, compact, testPrefix = "dock-space" }: { layout: WorkspaceLayout; onPicked?: () => void; compact?: boolean; testPrefix?: string }) {
  const t = useT();
  const { entries, canAdd, add } = useEntries(layout);
  const image = useWallpaperImage(layout.appearance.wallpaper);
  const wp = layout.appearance.wallpaper.kind === "default" ? { background: DEFAULT_SWATCH } : wallpaperStyle(layout.appearance.wallpaper, image.data).style;
  const w = compact ? 72 : 100;
  const h = compact ? 46 : 62;

  return (
    <div className={cx("flex gap-2.5 overflow-x-auto pb-0.5 [scrollbar-width:none]", compact && "gap-2")} data-system-ui>
      {entries.map((e, i) => (
        <button
          key={e.key}
          type="button"
          role="menuitemradio"
          aria-checked={e.active}
          onClick={() => {
            e.select();
            onPicked?.();
          }}
          className="pressable flex shrink-0 flex-col items-center gap-1.5"
          style={{ width: w + 4 }}
          data-testid={`${testPrefix}-${i + 1}`}
        >
          <span
            className={cx("relative block overflow-hidden rounded-[12px] border border-black/10", e.active && "ring-[2.5px] ring-primary ring-offset-2 ring-offset-transparent")}
            style={{ ...wp, width: w, height: h }}
          >
            <span className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
              {e.items.slice(0, 5).map((it) => (
                <span key={`${it.kind}:${it.id}`} className="size-2.5 rounded-[3px] bg-white/90 shadow-sm" />
              ))}
            </span>
            {e.active && (
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-white">
                <RiCheckLine className="size-3" />
              </span>
            )}
          </span>
          <span className={cx("w-full truncate text-center text-[12px]", e.active ? "font-semibold text-text" : "text-text-secondary")}>{e.label}</span>
        </button>
      ))}
      {canAdd && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            add();
            onPicked?.();
          }}
          className="pressable flex shrink-0 flex-col items-center gap-1.5"
          style={{ width: w + 4 }}
          data-testid={`${testPrefix}-add`}
        >
          <span className="flex items-center justify-center rounded-[12px] border-2 border-dashed border-black/15 text-text-secondary hover:border-primary/50 hover:text-primary" style={{ width: w, height: h }}>
            <RiAddLine className="size-6" />
          </span>
          <span className="text-[12px] text-text-secondary">{t("home.newSpace")}</span>
        </button>
      )}
    </div>
  );
}


