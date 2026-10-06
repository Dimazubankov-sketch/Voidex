import type { ComponentType } from "react";
import { animate, motion, motionValue, useTransform, type PanInfo } from "motion/react";
import {
  RiBookmarkLine,
  RiChat3Line,
  RiCloseLine,
  RiHeart3Line,
  RiHome5Line,
  RiSearchLine,
  RiSettings4Line,
  RiSidebarFoldLine,
  RiSidebarUnfoldLine,
  RiUser3Line,
} from "@remixicon/react";
import { useEffect } from "react";
import { Avatar, VibexGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useT, type MessageKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useWindow } from "@/os/window-context";
import { useChats } from "./data";
import { useVibex, type VibexSection } from "./store";

/** Width of the phone drawer (px). */
export const DRAWER_WIDTH = 272;
/** The PC rail (Step 2.7: a little larger than 2.5.1's compact rail; the phone drawer keeps its touch sizes). */
export const RAIL_WIDTH = 252;
export const RAIL_COLLAPSED = 60;

interface Row {
  key: VibexSection;
  label: MessageKey;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Vibex side menu (Step 2.3): dense and structured. The Vibex mark on top,
 * the account card (my page), then the sections, a divider and Settings —
 * Vibex's OWN settings screen. Identity is the VOIDEX account: no account
 * switching and no separate sign-out here.
 */
const MAIN: Row[] = [
  { key: "me", label: "vibex.nav.myPage", icon: RiUser3Line },
  { key: "feed", label: "vibex.nav.home", icon: RiHome5Line },
  { key: "chats", label: "vibex.nav.messages", icon: RiChat3Line },
  { key: "people", label: "vibex.nav.search", icon: RiSearchLine },
  { key: "bookmarks", label: "vibex.nav.bookmarks", icon: RiBookmarkLine },
  { key: "history", label: "vibex.nav.history", icon: RiHeart3Line },
];

export function SidebarPanel({ variant, collapsed = false, onToggle, onClose }: { variant: "rail" | "drawer"; collapsed?: boolean; onToggle?: () => void; onClose?: () => void }) {
  const t = useT();
  const me = useSession((s) => s.user)!;
  const section = useVibex((s) => s.section);
  const stack = useVibex((s) => s.stack);
  const go = useVibex((s) => s.go);
  const unread = (useChats().data ?? []).reduce((n, c) => n + c.unread, 0);
  const name = `${me.firstName} ${me.lastName}`;
  const rail = variant === "rail";
  const pick = (key: VibexSection) => {
    go(key);
    onClose?.();
  };

  const item = (row: Row) => {
    const selected = row.key === section && !stack.length;
    const Icon = row.icon;
    const badge = row.key === "chats" ? unread : 0;
    return (
      <button
        key={row.key}
        type="button"
        onClick={() => pick(row.key)}
        aria-current={selected ? "page" : undefined}
        title={collapsed ? t(row.label) : undefined}
        className={cx(
          "relative flex items-center text-left font-medium transition",
          rail ? "h-10 rounded-[11px] text-[14px]" : "h-10 rounded-xl text-[14px]",
          collapsed ? "justify-center" : rail ? "gap-2.5 px-2.5" : "gap-3 px-3",
          selected ? "bg-primary/10 text-primary" : "text-text hover:bg-surface-hover",
        )}
        data-testid={`vibex-nav-${row.key}`}
      >
        <Icon className={cx(rail ? "size-[18px]" : "size-[19px]", "shrink-0", selected ? "text-primary" : "text-text-secondary")} />
        {!collapsed && <span className="flex-1 truncate">{t(row.label)}</span>}
        {badge > 0 && (
          <span
            className={cx("flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white", collapsed && "absolute -right-0.5 -top-0.5 min-w-4 px-1 text-[10px]")}
            data-testid="vibex-unread"
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside
      className={cx(
        "flex h-full flex-col bg-surface transition-[width] duration-300 ease-out",
        variant === "rail" && "shrink-0 border-r",
        collapsed ? "px-2 py-3" : rail ? "px-2.5 py-2.5" : "px-3 py-3",
        variant === "drawer" && "w-full shadow-float",
      )}
      style={rail ? { width: collapsed ? RAIL_COLLAPSED : RAIL_WIDTH } : undefined}
      data-testid="vibex-sidebar"
    >
      <BrandRow drag={variant === "rail"} className={cx("flex items-center pb-2", collapsed ? "flex-col gap-2 pt-1" : "justify-between pl-1.5")}>
        <div className="flex items-center gap-2" data-system-ui>
          <VibexGlyph className={rail ? "size-[26px]" : "size-7"} />
          {!collapsed && <span className={cx("font-bold tracking-tight text-text", rail ? "text-[17px]" : "text-[18px]")}>{t("vibex.title")}</span>}
        </div>
        {variant === "drawer" ? (
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex size-9 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover">
            <RiCloseLine className="size-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? t("vibex.nav.expand") : t("vibex.nav.collapse")}
            title={collapsed ? t("vibex.nav.expand") : t("vibex.nav.collapse")}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface-hover hover:text-text"
            data-testid="vibex-sidebar-toggle"
          >
            {collapsed ? <RiSidebarUnfoldLine className="size-[18px]" /> : <RiSidebarFoldLine className="size-[18px]" />}
          </button>
        )}
      </BrandRow>

      {/* My page: the account card (VOIDEX identity). */}
      <button
        type="button"
        onClick={() => pick("me")}
        title={collapsed ? name : undefined}
        className={cx("mb-2 flex items-center transition hover:bg-surface-hover", rail ? "rounded-xl" : "rounded-2xl", collapsed ? "justify-center p-1" : rail ? "gap-2 bg-surface-secondary/70 p-1.5" : "gap-2.5 bg-surface-secondary/70 p-2")}
        data-testid="vibex-me"
      >
        <Avatar name={name} userId={me.id} version={me.avatarVersion} size={collapsed ? 34 : rail ? 32 : 36} />
        {!collapsed && (
          <span className="min-w-0 flex-1 text-left">
            <span className={cx("block truncate font-semibold text-text", rail ? "text-[13.5px]" : "text-[13.5px]")}>{name}</span>
            <span className={cx("block truncate text-text-tertiary", rail ? "text-[11.5px]" : "text-[11.5px]")}>{me.mailAddress}</span>
          </span>
        )}
      </button>

      <nav className="flex flex-col gap-0.5" data-testid="vibex-nav">
        {MAIN.map(item)}
      </nav>
      <div className="my-2 h-px bg-border" aria-hidden />
      <div className="flex flex-col gap-0.5">{item({ key: "settings", label: "vibex.nav.settings", icon: RiSettings4Line })}</div>
    </aside>
  );
}

/** On PC the brand row also moves the window (drag) and maximizes it (double click), like a title bar. */
function BrandRow({ drag, className, children }: { drag: boolean; className: string; children: React.ReactNode }) {
  const win = useWindow();
  const own = (e: React.PointerEvent | React.MouseEvent) => !(e.target as HTMLElement).closest("button, a, input");
  return (
    <div
      className={cx(className, drag && "min-h-11")}
      onPointerDown={drag ? (e) => own(e) && win.startDrag?.(e) : undefined}
      onDoubleClick={drag ? (e) => own(e) && win.toggleMaximize() : undefined}
    >
      {children}
    </div>
  );
}

/** Drawer position shared with the left-edge swipe: 0 closed … 1 open (Vibex is a single window). */
export const drawerProgress = motionValue(0);

/**
 * Phones: the same panel as a drawer from the left. It follows the finger —
 * opened by a swipe from the left edge (useEdgeSwipe), closed by a swipe to
 * the left or a tap outside.
 */
export function SidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const progress = drawerProgress;
  const x = useTransform(progress, (p) => `${(p - 1) * 100}%`);
  const scrim = useTransform(progress, [0, 1], [0, 1]);

  useEffect(() => {
    void animate(progress, open ? 1 : 0, { type: "spring", stiffness: 420, damping: 42 });
  }, [open, progress]);

  const onPan = (_: unknown, info: PanInfo) => {
    if (info.offset.x < 0) progress.set(Math.max(0, 1 + info.offset.x / DRAWER_WIDTH));
  };
  const onPanEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -DRAWER_WIDTH * 0.3 || info.velocity.x < -500) onClose();
    else void animate(progress, 1, { type: "spring", stiffness: 420, damping: 42 });
  };

  return (
    <div className={cx("absolute inset-0 z-40", !open && "pointer-events-none")} aria-hidden={!open}>
      <motion.button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
        style={{ opacity: scrim }}
        tabIndex={open ? 0 : -1}
      />
      <motion.div className="absolute inset-y-0 left-0 touch-pan-y" style={{ width: DRAWER_WIDTH, maxWidth: "86%", x }} onPan={onPan} onPanEnd={onPanEnd} data-testid="vibex-drawer" data-open={open || undefined}>
        <SidebarPanel variant="drawer" onClose={onClose} />
      </motion.div>
    </div>
  );
}
