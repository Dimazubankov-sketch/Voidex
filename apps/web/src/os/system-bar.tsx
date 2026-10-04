import type { RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiLock2Line, RiNotification3Line } from "@remixicon/react";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { useSecurityStatus } from "@/lib/security";
import { lockNow } from "./lock/auto-lock";
import { BrushButton, Clock, DoneButton, NineDots } from "./home/home-screen";
import { useWorkspaceLayout } from "./home/layout";
import { useHomeUi } from "./home/ui-store";
import { useNotificationCenter, useUnreadNotifications } from "./notifications/store";
import { SYSTEM_BAR_H } from "./metrics";
export { SYSTEM_BAR_H };

/**
 * The PC System Bar (Step 2.3): time and date on the left, small utility
 * controls on the right — Notification Center (bell), lock (with a
 * code-password, Step 2.4) and the app menu (nine dots). In edit mode the brush and "Done" take their places. Background:
 * real glass or none (Settings → Desktop → "System bar background"). It sits
 * above every window; app windows never cover it.
 */
export function SystemBar({ launcherBtn, brushBtn }: { launcherBtn: RefObject<HTMLButtonElement | null>; brushBtn: RefObject<HTMLButtonElement | null> }) {
  const t = useT();
  const { layout } = useWorkspaceLayout();
  const editing = useHomeUi((s) => s.editing);
  const launcherOpen = useHomeUi((s) => s.launcherOpen);
  const unread = useUnreadNotifications();
  const ncOpen = useNotificationCenter((s) => s.open);
  const glass = layout.appearance.systemBar !== "off";
  const canLock = !!useSecurityStatus().data?.passcodeEnabled;

  return (
    <header
      className={cx("absolute inset-x-0 top-0 z-[40] flex items-center gap-2 px-4", glass ? "vx-glass rounded-none border-x-0 border-t-0" : "bg-transparent")}
      style={{ height: SYSTEM_BAR_H }}
      data-system-ui
      data-testid="system-bar"
      data-glass={glass || undefined}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {editing ? (
          <motion.div key="brush" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.16 }} className="[&_button]:size-8">
            <BrushButton ref={brushBtn} />
          </motion.div>
        ) : (
          <motion.div key="clock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="pl-1">
            <Clock tone="dark" compact />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex-1" />
      {editing && <DoneButton small />}
      <BarButton
        label={t("notifications.title")}
        active={ncOpen}
        onClick={() => useNotificationCenter.getState().toggle()}
        testId="bell"
      >
        <RiNotification3Line className="size-[17px]" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-primary px-1 text-[9.5px] font-semibold leading-none text-white" data-testid="bell-badge">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </BarButton>
      {canLock && (
        <BarButton label={t("lock.lockNow")} onClick={() => void lockNow()} testId="lock-now">
          <RiLock2Line className="size-[16px]" />
        </BarButton>
      )}
      <BarButton
        ref={launcherBtn}
        label={t("os.launcher")}
        active={launcherOpen}
        onClick={() => useHomeUi.getState().setLauncherOpen(!useHomeUi.getState().launcherOpen)}
        testId="launcher-button"
      >
        <NineDots className="size-[15px]" />
      </BarButton>
    </header>
  );
}

function BarButton({
  ref,
  label,
  active,
  onClick,
  testId,
  children,
}: {
  ref?: RefObject<HTMLButtonElement | null>;
  label: string;
  active?: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        "pressable relative flex size-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/[0.06] hover:text-text",
        active && "bg-black/[0.07] text-text",
      )}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
