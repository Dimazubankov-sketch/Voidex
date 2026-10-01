import { useState, type ComponentType } from "react";
import {
  RiChat3Line,
  RiCloseLine,
  RiExpandUpDownLine,
  RiHistoryLine,
  RiHome5Line,
  RiLogoutBoxRLine,
  RiSearchLine,
  RiSettings4Line,
  RiSidebarFoldLine,
  RiSidebarUnfoldLine,
} from "@remixicon/react";
import { Avatar, VibexGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useT, type MessageKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useWindow } from "@/os/window-context";
import { useWM } from "@/os/window-manager";
import { ConfirmDialog } from "@/ui/overlays";
import { signOut } from "@/lib/account";
import { AccountSwitcher } from "./auth";
import { useChats } from "./data";
import { useVibex, type VibexSection } from "./store";

/** Width of the expanded rail / drawer (px). */
export const DRAWER_WIDTH = 288;

interface Row {
  key: VibexSection;
  label: MessageKey;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Vibex side menu — the Voyzen structure on VOIDEX: the Vibex mark and name on
 * top, the account card (tap: my profile; arrows: switch account), then Home,
 * Search, Messages and History. History lives only here. Settings opens VOIDEX
 * Settings (one system, one place); there is no dark mode, no Plus / Premium,
 * Support, Analytics, Monetization, calls or games.
 */
export function SidebarPanel({ variant, collapsed = false, onToggle, onClose }: { variant: "rail" | "drawer"; collapsed?: boolean; onToggle?: () => void; onClose?: () => void }) {
  const t = useT();
  const me = useSession((s) => s.user)!;
  const section = useVibex((s) => s.section);
  const stack = useVibex((s) => s.stack);
  const go = useVibex((s) => s.go);
  const unread = (useChats().data ?? []).reduce((n, c) => n + c.unread, 0);
  const [switcher, setSwitcher] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const name = `${me.firstName} ${me.lastName}`;

  const rows: Row[] = [
    { key: "feed", label: "vibex.nav.home", icon: RiHome5Line },
    { key: "people", label: "vibex.nav.search", icon: RiSearchLine },
    { key: "chats", label: "vibex.nav.messages", icon: RiChat3Line },
    { key: "history", label: "vibex.nav.history", icon: RiHistoryLine },
  ];
  const pick = (key: VibexSection) => {
    go(key);
    onClose?.();
  };

  return (
    <aside
      className={cx(
        "flex h-full flex-col justify-between bg-surface transition-[width] duration-300 ease-out",
        variant === "rail" && "shrink-0 border-r",
        collapsed ? "w-[72px] px-3 py-3" : "px-3.5 py-3",
        variant === "drawer" && "w-full shadow-float",
      )}
      style={variant === "rail" && !collapsed ? { width: DRAWER_WIDTH } : undefined}
      data-testid="vibex-sidebar"
    >
      <div className="flex min-h-0 flex-col gap-3">
        {/* Brand row (on PC it is also the window's drag handle) */}
        <BrandRow drag={variant === "rail"} className={cx("flex items-center", collapsed ? "flex-col gap-3 pt-1" : "justify-between")}>
          <div className="flex items-center gap-2.5 pl-1" data-system-ui>
            <VibexGlyph className="size-8" />
            {!collapsed && <span className="text-[19px] font-bold tracking-tight text-text">{t("vibex.title")}</span>}
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
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface-hover hover:text-text"
              data-testid="vibex-sidebar-toggle"
            >
              {collapsed ? <RiSidebarUnfoldLine className="size-5" /> : <RiSidebarFoldLine className="size-5" />}
            </button>
          )}
        </BrandRow>

        {/* Account card: profile + account switch */}
        {collapsed ? (
          <button type="button" onClick={() => pick("me")} title={name} className="mx-auto rounded-full" data-testid="vibex-me">
            <Avatar name={name} userId={me.id} version={me.avatarVersion} size={40} />
          </button>
        ) : (
          <div className={cx("flex items-center gap-1 rounded-2xl bg-surface-secondary p-1.5", section === "me" && !stack.length && "ring-1 ring-border-strong")}>
            <button type="button" onClick={() => pick("me")} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left transition hover:bg-surface-hover" data-testid="vibex-me">
              <Avatar name={name} userId={me.id} version={me.avatarVersion} size={42} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-text">{name}</span>
                <span className="block truncate text-[12px] text-text-secondary">{me.mailAddress}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSwitcher(true)}
              aria-label={t("vibex.account.switch")}
              title={t("vibex.account.switch")}
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-text-secondary transition hover:bg-surface-hover hover:text-text"
              data-testid="vibex-switch-account"
            >
              <RiExpandUpDownLine className="size-5" />
            </button>
          </div>
        )}

        <nav className="flex flex-col gap-1" data-testid="vibex-nav">
          {rows.map((row) => {
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
                  "relative flex items-center rounded-xl text-left text-[14px] font-medium transition",
                  collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5",
                  selected ? "bg-primary text-white shadow-tile" : "text-text hover:bg-surface-hover",
                )}
                data-testid={`vibex-nav-${row.key}`}
              >
                <Icon className={cx("size-5 shrink-0", selected ? "text-white" : "text-text-secondary")} />
                {!collapsed && <span className="flex-1">{t(row.label)}</span>}
                {badge > 0 && (
                  <span
                    className={cx(
                      "flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
                      collapsed && "absolute -right-0.5 -top-0.5 min-w-4 px-1 text-[10px]",
                      selected ? "bg-white/25 text-white" : "bg-primary text-white",
                    )}
                    data-testid="vibex-unread"
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => {
            useWM.getState().open("settings");
            onClose?.();
          }}
          title={collapsed ? t("vibex.nav.settings") : undefined}
          className={cx("flex items-center rounded-xl text-left text-[14px] font-medium text-text transition hover:bg-surface-hover", collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5")}
          data-testid="vibex-settings"
        >
          <RiSettings4Line className="size-5 shrink-0 text-text-secondary" />
          {!collapsed && t("vibex.nav.settings")}
        </button>
        <button
          type="button"
          onClick={() => setConfirmOut(true)}
          title={collapsed ? t("settings.signOut") : undefined}
          className={cx("flex items-center rounded-xl text-left text-[14px] font-medium text-danger transition hover:bg-danger-soft", collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5")}
          data-testid="vibex-sign-out"
        >
          <RiLogoutBoxRLine className="size-5 shrink-0" />
          {!collapsed && t("settings.signOut")}
        </button>
      </div>

      <AccountSwitcher open={switcher} onClose={() => setSwitcher(false)} />
      <ConfirmDialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        title={t("settings.signOut")}
        message={t("vibex.account.signOutHint")}
        confirmLabel={t("settings.signOut")}
        danger
        onConfirm={() => {
          setConfirmOut(false);
          void signOut();
        }}
      />
    </aside>
  );
}

/** On PC the brand row also moves the window (drag) and maximizes it (double click), like a title bar. */
function BrandRow({ drag, className, children }: { drag: boolean; className: string; children: React.ReactNode }) {
  const win = useWindow();
  const own = (e: React.PointerEvent | React.MouseEvent) => !(e.target as HTMLElement).closest("button, a, input");
  return (
    <div
      className={cx(className, drag && "min-h-12")}
      onPointerDown={drag ? (e) => own(e) && win.startDrag?.(e) : undefined}
      onDoubleClick={drag ? (e) => own(e) && win.toggleMaximize() : undefined}
    >
      {children}
    </div>
  );
}

/** Phones: the same panel as a drawer from the left. */
export function SidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <div className={cx("absolute inset-0 z-40", !open && "pointer-events-none")} aria-hidden={!open}>
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="absolute inset-0 bg-black/30 transition-opacity duration-300"
        style={{ opacity: open ? 1 : 0 }}
        tabIndex={open ? 0 : -1}
      />
      <div
        className="absolute inset-y-0 left-0 transition-transform duration-300 ease-out"
        style={{ width: DRAWER_WIDTH, maxWidth: "88%", transform: `translateX(${open ? 0 : -100}%)` }}
        data-testid="vibex-drawer"
      >
        <SidebarPanel variant="drawer" onClose={onClose} />
      </div>
    </div>
  );
}
