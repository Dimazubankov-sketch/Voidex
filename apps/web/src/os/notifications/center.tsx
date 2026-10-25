import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { RiArrowDownSLine, RiCheckDoubleLine, RiCloseLine, RiDeleteBin6Line, RiNotification3Line } from "@remixicon/react";
import { APP_REGISTRY, type NotificationDto } from "@voidex/shared";
import { Avatar, ClockGlyph, MailGlyph, StoreGlyph, VibexGlyph, VoidexMark } from "@/brand/brand";
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
export interface Renderer {
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

export const RENDERERS: Record<NotificationDto["app"], Renderer> = {
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
    // Step 2.11: a system notification opens its section (Settings).
    open: () => useWM.getState().open("settings"),
  },
  // Step 2.12: Appex Store: an update is available, or was installed by itself. A tap opens the Store's updates.
  store: {
    Icon: StoreGlyph,
    appName: () => "Appex Store",
    action: (n, t) => t(n.target.kind === "updated" ? "notifications.store.updated" : "notifications.store.available", { version: n.target.version ?? n.body }),
    open: () => useWM.getState().open("store", { params: { page: "updates" } }),
  },
  // Step 2.14: Clock: an alarm or a timer rang. A tap opens Clock on that alarm / timer.
  clock: {
    Icon: ClockGlyph,
    appName: (lang) => APP_REGISTRY.clock.name[lang as "en"] ?? "Clock",
    action: (n, t) => t(n.type === "clock.timer" ? "notifications.clock.timer" : "notifications.clock.alarm"),
    open: (n) => useWM.getState().open("clock", { params: { tab: n.target.kind === "timer" ? "timers" : "alarm", focus: n.target.id } }),
  },
};

export function timeLabel(iso: string, lang: string, t: TFunction) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return t("notifications.now");
  if (mins < 60) return t("notifications.minutes", { n: mins });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(d);
  return formatDate(d, lang as Parameters<typeof formatDate>[1], { day: "numeric", month: "short" });
}

function NotificationCard({ n, onOpen, more = 0 }: { n: NotificationDto; onOpen: (n: NotificationDto) => void; /** Collapsed group: how many more are stacked under it (a tap opens the stack). */ more?: number }) {
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
        className="vx-nc-card group relative flex items-start gap-3 rounded-[20px] p-3"
      >
        <button
          type="button"
          onClick={() => onOpen(n)}
          className="absolute inset-0 rounded-[20px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={more ? `${r.appName(lang)}: ${t("notifications.more", { n: more })}` : `${r.appName(lang)}: ${main}. ${r.action(n, t)}`}
          aria-expanded={more ? false : undefined}
          data-testid={more ? "notification-group-expand" : "notification-open"}
        />
        <span className="pointer-events-none relative shrink-0">
          {n.actor ? (
            <Avatar name={n.actor.name} userId={n.actor.id} version={n.actor.avatarVersion} size={40} />
          ) : (
            <span className="vx-app-tile flex size-10 items-center justify-center rounded-[12px] bg-white shadow-tile">
              <r.Icon className="size-6" />
            </span>
          )}
          {n.actor && (
            <span className="vx-app-tile absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-[6px] bg-white shadow-sm">
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
          {more > 0 && <span className="mt-1 block text-[12px] font-medium text-text-tertiary" data-testid="notification-more">{t("notifications.more", { n: more })}</span>}
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

/** Step 2.15: notifications of one app, newest first; groups ordered by their newest notification. */
export interface NotificationGroup {
  app: NotificationDto["app"];
  items: NotificationDto[];
}
export function groupBySource(items: NotificationDto[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const n of sorted) {
    const g = groups.get(n.app);
    if (g) g.items.push(n);
    else groups.set(n.app, { app: n.app, items: [n] });
  }
  return [...groups.values()];
}

/**
 * A two-step clear (the reference): a quiet round button; the first tap turns
 * it into «Очистить», the second clears. It folds back by itself after a while.
 */
function ClearButton({ label, confirmLabel, onClear, testId, icon }: { label: string; confirmLabel: string; onClear: () => void; testId: string; icon?: "trash" | "close" }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <motion.button
      type="button"
      layout
      transition={{ duration: 0.18, ease: EASE }}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          setArmed(false);
          onClear();
        } else setArmed(true);
      }}
      aria-label={armed ? confirmLabel : label}
      title={armed ? confirmLabel : label}
      className={cx(
        "vx-nc-chip relative flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[12.5px] font-semibold",
        armed ? "px-3.5 text-danger" : "w-8 text-text-secondary hover:text-text",
      )}
      data-armed={armed || undefined}
      data-testid={armed ? `${testId}-confirm` : testId}
    >
      {armed ? confirmLabel : icon === "trash" ? <RiDeleteBin6Line className="size-[15px]" /> : <RiCloseLine className="size-4" />}
    </motion.button>
  );
}

/**
 * One source. A single notification is just its card. Several: collapsed, the
 * newest card with the others stacked under it; a tap opens the stack. Open:
 * the app's name, «Показать меньше» and a clear for the whole group.
 */
function GroupView({ g, expanded, onToggle, onOpen }: { g: NotificationGroup; expanded: boolean; onToggle: () => void; onOpen: (n: NotificationDto) => void }) {
  const t = useT();
  const lang = useLanguage();
  const r = RENDERERS[g.app];
  if (g.items.length === 1) return <NotificationCard n={g.items[0]!} onOpen={onOpen} />;
  const [first, ...rest] = g.items;
  return (
    <motion.li layout="position" className="list-none" transition={{ duration: 0.24, ease: EASE }} data-testid="notification-group" data-app={g.app} data-count={g.items.length} data-expanded={expanded || undefined}>
      <AnimatePresence initial={false} mode="popLayout">
        {expanded ? (
          <motion.div key="open" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }}>
            <div className="flex items-center gap-2 px-1 pb-2 pt-1">
              <h3 className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-tight text-text">{r.appName(lang)}</h3>
              <button type="button" onClick={onToggle} className="vx-nc-chip flex h-8 items-center gap-1 rounded-full px-3 text-[12.5px] font-semibold text-text-secondary hover:text-text" data-testid="notification-group-collapse">
                <RiArrowDownSLine className="size-4 rotate-180" /> {t("notifications.showLess")}
              </button>
              <ClearButton label={t("notifications.clearGroup", { app: r.appName(lang) })} confirmLabel={t("notifications.clearConfirm")} onClear={() => g.items.forEach((n) => notificationActions.remove(n.id))} testId="notification-group-clear" />
            </div>
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {g.items.map((n) => (
                  <NotificationCard key={n.id} n={n} onOpen={onOpen} />
                ))}
              </AnimatePresence>
            </ul>
          </motion.div>
        ) : (
          <motion.div key="stack" className="relative pb-[14px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {/* The others, stacked under the newest one. */}
            <span aria-hidden className="vx-nc-card pointer-events-none absolute inset-x-4 bottom-0 top-3 rounded-[20px] opacity-60" />
            {rest.length > 1 && <span aria-hidden className="vx-nc-card pointer-events-none absolute inset-x-2 bottom-[7px] top-2 rounded-[20px] opacity-80" />}
            <ul className="relative">
              <NotificationCard n={first!} onOpen={onToggle} more={rest.length} />
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function Body({ onClose, titleId, closeButton, phone }: { onClose: () => void; titleId: string; closeButton?: boolean; phone?: boolean }) {
  const t = useT();
  const q = useNotifications();
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const unread = q.data?.unread ?? 0;
  const groups = useMemo(() => groupBySource(items), [items]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const open = (n: NotificationDto) => {
    notificationActions.markRead(n.id);
    onClose();
    RENDERERS[n.app].open(n);
  };
  const toggle = (app: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(app)) next.delete(app);
      else next.add(app);
      return next;
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {phone && <PhoneClock />}
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
        <h2 id={titleId} className="flex-1 text-[19px] font-bold tracking-tight text-text">
          {t("notifications.title")}
        </h2>
        {unread > 0 && (
          <button type="button" onClick={notificationActions.markAllRead} className="flex h-8 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-primary hover:bg-primary/10" data-testid="notifications-read-all">
            <RiCheckDoubleLine className="size-4" /> {t("notifications.readAll")}
          </button>
        )}
        {items.length > 0 && <ClearButton label={t("notifications.clearAll")} confirmLabel={t("notifications.clearConfirm")} onClear={notificationActions.clear} testId="notifications-clear-all" icon="trash" />}
        {closeButton && (
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="vx-nc-chip grid size-9 shrink-0 place-items-center rounded-full text-text-secondary" data-testid="notifications-close">
            <RiCloseLine className="size-5" />
          </button>
        )}
      </div>
      <div className="scroll-area min-h-0 flex-1 overscroll-contain px-3 pb-3" data-testid="notifications-scroll">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center text-text-tertiary" data-testid="notifications-empty">
            <RiNotification3Line className="size-9 opacity-60" />
            <span className="text-[14px]">{t("notifications.empty")}</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5" aria-label={t("notifications.title")}>
            <AnimatePresence initial={false}>
              {groups.map((g) => (
                <GroupView key={g.app} g={g} expanded={expanded.has(g.app)} onToggle={() => toggle(g.app)} onOpen={open} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

/** Phone: the time and the date above the notifications (like the lock screen). */
function PhoneClock() {
  const lang = useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 10_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="shrink-0 px-4 pt-4 text-center" data-testid="notifications-clock">
      <div className="text-[15px] font-medium text-text-secondary" data-testid="notifications-date">
        {formatDate(now, lang as Parameters<typeof formatDate>[1], { weekday: "short", day: "numeric", month: "short" })}
      </div>
      <div className="text-[64px] font-semibold leading-none tracking-tight tabular-nums text-text" data-testid="notifications-time">
        {new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(now)}
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
 * Step 2.15 (the reference video): notifications are grouped by app; a group
 * opens and folds back; one, a group or everything can be cleared (a second
 * tap confirms); the list scrolls; the phone shows the time and the date.
 * The surface is the system glass (one token for every glass element).
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
        <Body onClose={close} titleId="nc-title-m" closeButton phone />
        <motion.div className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center" onPan={onPan} onPanEnd={onPanEnd} data-testid="notification-handle">
          <span className="h-[5px] w-10 rounded-full bg-text/35" />
        </motion.div>
      </motion.div>
    </div>
  );
}
