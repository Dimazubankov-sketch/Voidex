import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { RiCheckDoubleLine, RiCloseLine, RiDeleteBin6Line, RiNotification3Line } from "@remixicon/react";
import { APP_REGISTRY, type NotificationDto } from "@voidex/shared";
import { Avatar, MailGlyph, VibexGlyph, VoidexMark } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { formatDate, useLanguage, useT, type MessageKey, type TFunction } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { dockZone } from "../home/dock";
import { useWorkspaceLayout } from "../home/layout";
import { SYSTEM_BAR_H } from "../metrics";
import { useWM } from "../window-manager";
import { ncPull } from "./gesture";
import { notificationActions, useNotificationCenter, useNotifications } from "./store";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * How each source's notifications look and what a tap opens. A new app
 * registers here (and its types in shared NOTIFICATION_SOURCES).
 */
interface Renderer {
  Icon: (p: { className?: string }) => ReactNode;
  appName: (lang: string) => string;
  /** The action line ("New message", "commented on your post"). */
  action: (n: NotificationDto, t: TFunction) => string;
  open: (n: NotificationDto) => void;
}

const ACTION: Record<string, MessageKey> = {
  "mail.new": "notifications.mail.new",
  "vibex.message": "notifications.vibex.message",
  "vibex.comment": "notifications.vibex.comment",
  "vibex.reply": "notifications.vibex.reply",
  "vibex.like": "notifications.vibex.like",
  "vibex.follow": "notifications.vibex.follow",
  "vibex.group": "notifications.vibex.group",
  "system.update": "notifications.system.update",
};

const RENDERERS: Record<NotificationDto["app"], Renderer> = {
  mail: {
    Icon: MailGlyph,
    appName: (lang) => APP_REGISTRY.mail.name[lang as "en"] ?? "Mail",
    action: (_n, t) => t("notifications.mail.new"),
    open: (n) => useWM.getState().open("mail", { params: { threadId: n.target.threadId } }),
  },
  vibex: {
    Icon: VibexGlyph,
    appName: () => "Vibex",
    action: (n, t) => t(ACTION[n.type] ?? "notifications.vibex.message"),
    open: (n) => {
      const { chatId, postId, userId } = n.target;
      const params = chatId ? { chatId } : postId ? { postId, ...(n.type === "vibex.comment" || n.type === "vibex.reply" ? { comments: n.target.commentId ?? "1" } : {}) } : userId ? { userId } : {};
      useWM.getState().open("vibex", { params });
    },
  },
  system: {
    Icon: VoidexMark,
    appName: () => "VOIDEX",
    action: (_n, t) => t("notifications.system.update"),
    open: () => undefined,
  },
};

function timeLabel(iso: string, lang: string, t: TFunction) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return t("notifications.now");
  if (mins < 60) return t("notifications.minutes", { n: mins });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(d);
  return formatDate(d, lang as Parameters<typeof formatDate>[1], { day: "numeric", month: "short" });
}

function NotificationCard({ n, onOpen }: { n: NotificationDto; onOpen: (n: NotificationDto) => void }) {
  const t = useT();
  const lang = useLanguage();
  const ff = useFormFactor();
  const preview = useSession((s) => s.user?.preferences.notifications.showPreview ?? true);
  const r = RENDERERS[n.app];
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-180, 0, 180], [0, 1, 0]);
  const body = n.app === "system" || preview ? n.body : "";
  const main = n.app === "system" ? n.title : `${n.title}`;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 110 || Math.abs(info.velocity.x) > 700) {
      void animate(x, info.offset.x > 0 ? 420 : -420, { duration: 0.18 }).then(() => notificationActions.remove(n.id));
    } else void animate(x, 0, { duration: 0.2 });
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="list-none"
      data-testid="notification"
      data-type={n.type}
      data-read={n.read || undefined}
    >
      <motion.div
        style={{ x, opacity }}
        drag={ff === "mobile" ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.9}
        onDragEnd={onDragEnd}
        className="group relative flex items-start gap-3 rounded-[20px] bg-white/55 p-3 shadow-[0_1px_2px_rgba(20,20,40,0.06)] transition-colors hover:bg-white/75"
      >
        <button type="button" onClick={() => onOpen(n)} className="absolute inset-0 rounded-[20px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`${r.appName(lang)}: ${main}. ${r.action(n, t)}`} data-testid="notification-open" />
        <span className="pointer-events-none relative shrink-0">
          {n.actor ? (
            <Avatar name={n.actor.name} userId={n.actor.id} version={n.actor.avatarVersion} size={40} />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-[12px] bg-white shadow-tile">
              <r.Icon className="size-6" />
            </span>
          )}
          {n.actor && (
            <span className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-[6px] bg-white shadow-sm">
              <r.Icon className="size-3" />
            </span>
          )}
        </span>
        <span className="pointer-events-none min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[11.5px] text-text-tertiary">
            <span className="font-medium uppercase tracking-wide">{r.appName(lang)}</span>
            <span aria-hidden>·</span>
            <span>{timeLabel(n.createdAt, lang, t)}</span>
          </span>
          <span className="mt-0.5 block truncate text-[14px] font-semibold text-text">{main}</span>
          <span className="block text-[13px] text-text-secondary">{r.action(n, t)}</span>
          {body && <span className="mt-0.5 line-clamp-2 block text-[13px] text-text">{body}</span>}
        </span>
        {!n.read && <span className="pointer-events-none mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label={t("notifications.unread")} data-testid="notification-unread" />}
        <button
          type="button"
          onClick={() => notificationActions.remove(n.id)}
          aria-label={t("notifications.clearOne")}
          title={t("notifications.clearOne")}
          className={cx(
            "relative -mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-text-tertiary transition hover:bg-black/[0.06] hover:text-text",
            ff === "desktop" && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
          )}
          data-testid="notification-clear"
        >
          <RiCloseLine className="size-4" />
        </button>
      </motion.div>
    </motion.li>
  );
}

function Body({ onClose, titleId, closeButton }: { onClose: () => void; titleId: string; closeButton?: boolean }) {
  const t = useT();
  const q = useNotifications();
  const items = q.data?.items ?? [];
  const unread = q.data?.unread ?? 0;
  const open = (n: NotificationDto) => {
    notificationActions.markRead(n.id);
    onClose();
    RENDERERS[n.app].open(n);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
        <h2 id={titleId} className="flex-1 text-[19px] font-bold tracking-tight text-text">
          {t("notifications.title")}
        </h2>
        {unread > 0 && (
          <button type="button" onClick={notificationActions.markAllRead} className="flex h-8 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-primary hover:bg-primary/10" data-testid="notifications-read-all">
            <RiCheckDoubleLine className="size-4" /> {t("notifications.readAll")}
          </button>
        )}
        {items.length > 0 && (
          <button type="button" onClick={notificationActions.clear} className="flex h-8 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-text-secondary hover:bg-black/[0.06]" data-testid="notifications-clear-all">
            <RiDeleteBin6Line className="size-4" /> {t("notifications.clearAll")}
          </button>
        )}
        {closeButton && (
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="grid size-9 shrink-0 place-items-center rounded-full bg-black/[0.06] text-text-secondary" data-testid="notifications-close">
            <RiCloseLine className="size-5" />
          </button>
        )}
      </div>
      <div className="scroll-area min-h-0 flex-1 overscroll-contain px-3 pb-3">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center text-text-tertiary" data-testid="notifications-empty">
            <RiNotification3Line className="size-9 opacity-60" />
            <span className="text-[14px]">{t("notifications.empty")}</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t("notifications.title")}>
            <AnimatePresence initial={false}>
              {items.map((n) => (
                <NotificationCard key={n.id} n={n} onOpen={open} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

/** Keeps Tab inside the panel while it is open; Esc closes. */
function useDialogKeys(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // The panel itself takes focus (no ring on a button); Tab moves into it.
    const id = window.setTimeout(() => ref.current?.focus({ preventScroll: true }), 60);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", key, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, ref]);
}

/**
 * The VOIDEX Notification Center — a system overlay above every app.
 *   phone  a glass sheet pulled down from the top edge (follows the finger)
 *   PC     a glass panel sliding in from the right, between the system bar and the dock
 */
export function NotificationCenter() {
  const ff = useFormFactor();
  return ff === "mobile" ? <MobileCenter /> : <DesktopCenter />;
}

function DesktopCenter() {
  const open = useNotificationCenter((s) => s.open);
  const setOpen = useNotificationCenter((s) => s.setOpen);
  const { layout } = useWorkspaceLayout();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(() => setOpen(false)).current;
  useDialogKeys(ref, open, close);
  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-[44]" onPointerDown={close} data-testid="notifications-backdrop" />
          <motion.aside
            ref={ref}
            role="dialog"
            aria-modal="false"
            aria-labelledby="nc-title"
            tabIndex={-1}
            className="vx-glass fixed outline-none right-3 z-[45] flex flex-col overflow-hidden rounded-[26px]"
            style={{ top: SYSTEM_BAR_H + 8, bottom: dockZone(layout.desktop.dockScale), width: "min(400px, calc(100vw - 24px))" }}
            initial={{ x: 440, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 440, opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            data-system-ui
            data-testid="notification-center"
          >
            <Body onClose={close} titleId="nc-title" />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function MobileCenter() {
  const open = useNotificationCenter((s) => s.open);
  const setOpen = useNotificationCenter((s) => s.setOpen);
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(() => setOpen(false)).current;
  useDialogKeys(ref, open, close);
  // 0 = hidden above the screen, 1 = fully open; the top-edge gesture drives it while pulling.
  const y = useTransform(ncPull, (p) => `${(p - 1) * 100}%`);
  const scrim = useTransform(ncPull, [0, 1], [0, 1]);
  // Step 2.7: always the whole screen (no half state). Up on the handle, or the close button, closes it.
  useEffect(() => {
    void animate(ncPull, open ? 1 : 0, { type: "spring", stiffness: 380, damping: 38 });
  }, [open]);

  const onPan = (_: unknown, info: PanInfo) => {
    if (info.offset.y < 0) ncPull.set(Math.max(0, 1 + info.offset.y / (window.innerHeight * 0.8)));
  };
  const onPanEnd = (_: unknown, info: PanInfo) => {
    const up = info.offset.y < -90 || info.velocity.y < -600;
    if (up) {
      setOpen(false);
      void animate(ncPull, 0, { type: "spring", stiffness: 380, damping: 38 });
      return;
    }
    void animate(ncPull, 1, { type: "spring", stiffness: 380, damping: 38 });
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[230]" aria-hidden={!open} data-testid="notification-layer">
      <motion.div className={cx("vx-glass-scrim absolute inset-0", open && "pointer-events-auto")} style={{ opacity: scrim }} onClick={close} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nc-title-m"
        tabIndex={-1}
        className={cx(
          "vx-glass absolute inset-x-0 top-0 flex h-[100dvh] flex-col rounded-none border-t-0 pb-[var(--safe-bottom)] pt-[var(--safe-top)] outline-none",
          open && "pointer-events-auto",
        )}
        style={{ y }}
        data-system-ui
        data-full
        data-testid={open ? "notification-center" : undefined}
      >
        <Body onClose={close} titleId="nc-title-m" closeButton />
        <motion.div className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center" onPan={onPan} onPanEnd={onPanEnd} data-testid="notification-handle">
          <span className="h-[5px] w-10 rounded-full bg-text/35" />
        </motion.div>
      </motion.div>
    </div>
  );
}
