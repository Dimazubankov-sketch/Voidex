import { RiAddLine, RiCheckLine } from "@remixicon/react";
import { DESKTOP_SPACES_MAX, type LayoutItem, type WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { TrimmedLogo } from "@/brand/brand";
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

/**
 * Glyph of the Desktops system app (Step 2.4): the two glass cards from the
 * delivered artwork, cut out without redrawing — shown through TrimmedLogo
 * like every other system icon, so it fills the same box (52% of the tile).
 */
export function DesktopsGlyph({ className = "size-[62%]" }: { className?: string }) {
  return <TrimmedLogo src="/brand/app-desktops.png" className={className} />;
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


