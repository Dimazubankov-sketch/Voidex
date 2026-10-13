import type { ReactNode } from "react";
import { RiSearchLine } from "@remixicon/react";
import { VibexGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { useNetworkTrouble } from "@/lib/network-status";
import { Spinner } from "@/ui/controls";
import { WindowHeader } from "@/os/window-context";
import { useVibex } from "./store";

/**
 * Step 2.11: one Vibex header everywhere on phones (Главная, Поиск,
 * Уведомления, Чаты, Профиль), in the look of the «Профиль» header: 60 px,
 * the Vibex mark on the left (opens the side menu), the title centred on the
 * whole header at 19 px, no border. The round search button is only on
 * Главная and Профиль and goes to the Search tab (no field in the header).
 */
export function VibexHeader({ title, search = false, beside, className }: { title: ReactNode; search?: boolean; beside?: ReactNode; className?: string }) {
  const t = useT();
  const setDrawer = useVibex((s) => s.setDrawer);
  return (
    <WindowHeader className={cx("relative h-[60px] gap-3 bg-surface px-4", className)}>
      <button
        type="button"
        onClick={() => setDrawer(true)}
        aria-label={t("vibex.nav.menu")}
        className="relative z-[1] flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-surface shadow-[0_2px_10px_rgba(60,40,140,0.12)]"
        data-testid="vibex-menu"
      >
        <VibexGlyph className="size-[26px]" />
      </button>
      <span className="pointer-events-none absolute inset-x-[72px] top-1/2 flex -translate-y-1/2 items-center justify-center gap-2" data-testid="vibex-header">
        {beside && <span className="pointer-events-auto shrink-0">{beside}</span>}
        <VibexTitle className="text-center">{title}</VibexTitle>
      </span>
      <span className="flex-1" />
      {search ? <VibexSearchButton /> : <span className="size-11 shrink-0" aria-hidden />}
    </WindowHeader>
  );
}

/**
 * The title of a Vibex header. On a real connection problem (offline, the
 * realtime stream lost, requests retried; see useNetworkTrouble) it reads
 * «Обновление...» with a small spinner, like a messenger, and comes back on
 * its own when the connection does.
 */
export function VibexTitle({ children, className }: { children: ReactNode; className?: string }) {
  const t = useT();
  const trouble = useNetworkTrouble();
  return (
    <span className={cx("flex min-w-0 items-center justify-center gap-2 text-[19px] font-bold tracking-tight", className)} data-testid="vibex-header-title" data-updating={trouble || undefined}>
      {trouble ? (
        <>
          <Spinner size={16} />
          <span className="truncate text-text-secondary" data-testid="network-updating">
            {t("net.updating")}
          </span>
        </>
      ) : (
        <span className="truncate">{children}</span>
      )}
    </span>
  );
}

/** The one search button of Vibex: opens the Search tab. */
export function VibexSearchButton({ className }: { className?: string }) {
  const t = useT();
  const go = useVibex((s) => s.go);
  return (
    <button
      type="button"
      onClick={() => go("people")}
      aria-label={t("vibex.nav.search")}
      title={t("vibex.nav.search")}
      className={cx("relative z-[1] flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-text shadow-[0_2px_10px_rgba(60,40,140,0.12)] transition hover:bg-surface-hover", className)}
      data-testid="vibex-search"
    >
      <RiSearchLine className="size-[22px]" />
    </button>
  );
}
