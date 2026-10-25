import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { RiCloseLine } from "@remixicon/react";
import type { NotificationDto } from "@voidex/shared";
import { create } from "zustand";
import { Avatar } from "@/brand/brand";
import { getFormFactor, useFormFactor } from "@/lib/form-factor";
import { useLanguage, useT } from "@/lib/i18n";
import { playNotificationSound, preloadNotificationSound } from "@/lib/notification-sounds";
import { useSession } from "@/lib/session";
import { foregroundId, useWM } from "../window-manager";
import { RENDERERS, timeLabel } from "./center";
import { notificationActions } from "./store";
import { clockDeviceId } from "@/apps/clock/device";

/**
 * Step 2.11: system pop-up notifications (VOIDEX's own banners), built from
 * the same notifications the Notification Center lists (one source: the
 * "notification.new" event), so a tap reads it there too.
 *
 *   phone  a banner from the top: slides down, goes away by itself; a swipe
 *          up or sideways dismisses it; a tap opens what it is about
 *   PC     a card at the bottom right with an X; goes away by itself (not
 *          while the pointer is on it)
 *
 * The app's icon and name, the title, a preview (if previews are on) and the
 * sender's avatar. One at a time on phones, up to three on a PC; the rest
 * wait in a queue. A short VOIDEX chime, at most once every 1.5 s, only with
 * sound on. A tap opens: a Vibex message its chat, an activity its post or
 * person, a letter its thread, a system notice its section.
 */

const SHOW_MS = 5000;
const SOUND_GAP_MS = 1500;
const MAX_QUEUE = 20;

interface PopupState {
  shown: NotificationDto[];
  queue: NotificationDto[];
  push: (n: NotificationDto, max: number) => void;
  dismiss: (id: string, max: number) => void;
  /** Step 2.12: an app came to the front: its banners (shown or waiting) go away. */
  dropApp: (app: string, max: number) => void;
}

export const usePopups = create<PopupState>((set, get) => ({
  shown: [],
  queue: [],
  push: (n, max) => {
    const { shown, queue } = get();
    // The same notification again (a chat's collapsed notification): it replaces the one waiting or shown.
    const s = shown.filter((x) => x.id !== n.id);
    const q = queue.filter((x) => x.id !== n.id);
    if (s.length < max) set({ shown: [...s, n], queue: q });
    else set({ shown: s, queue: [...q, n].slice(-MAX_QUEUE) });
  },
  dismiss: (id, max) => {
    const { shown, queue } = get();
    const s = shown.filter((x) => x.id !== id);
    const room = Math.max(0, max - s.length);
    set({ shown: [...s, ...queue.slice(0, room)], queue: queue.slice(room) });
  },
  dropApp: (app, max) => {
    const { shown, queue } = get();
    if (!shown.some((x) => x.app === app) && !queue.some((x) => x.app === app)) return;
    const s = shown.filter((x) => x.app !== app);
    const q = queue.filter((x) => x.app !== app);
    const room = Math.max(0, max - s.length);
    set({ shown: [...s, ...q.slice(0, room)], queue: q.slice(room) });
  },
}));

let lastSound = 0;
const seen = new Set<string>();

/**
 * A notification arrived over the event stream: pop it up (unless that is
 * off, or it is about what is already on screen) and chime.
 */
/**
 * Step 2.12: the app the person is using right now (from the window manager,
 * not a guess from a route): the front window of this desktop on a PC, the
 * open app on a phone; none on the home screen, in the app switcher or while
 * VOIDEX itself is in the background.
 */
export function activeApp(): string | null {
  if (document.visibilityState !== "visible") return null;
  const wm = useWM.getState();
  if (getFormFactor() === "mobile" && wm.switcherOpen) return null;
  const id = getFormFactor() === "desktop" ? foregroundId(wm, wm.space) : foregroundId(wm);
  return (id && wm.windows[id]?.appId) || null;
}

export function popupNotification(n: NotificationDto, opts: { onScreen?: boolean } = {}) {
  const key = `${n.id}:${n.createdAt}`;
  if (n.read || seen.has(key)) return;
  seen.add(key);
  const prefs = useSession.getState().user?.preferences;
  // Settings → Apps → <app> → Notifications off: the Notification Center still lists it, no pop-up, no sound.
  if (n.app !== "system" && prefs?.apps?.[n.app]?.notifications === false) return;
  if (opts.onScreen) return;
  // Step 2.12: no banner (and no chime) over the app it comes from while that app is in front: the app shows
  // it itself (badges, lists); the Notification Center still keeps it. Other apps' banners still show.
  if (n.app !== "system" && activeApp() === n.app) return;
  // Step 2.14: a Clock ring pops up only on the device it rang on (the other devices just list it).
  if (n.app === "clock" && n.target.device && n.target.device !== clockDeviceId()) return;
  if (prefs?.notifications.newMailBanner !== false) {
    const max = window.matchMedia?.("(min-width: 900px)").matches ? 3 : 1;
    usePopups.getState().push(n, max);
  }
  if (prefs?.notifications.sound && Date.now() - lastSound > SOUND_GAP_MS) {
    lastSound = Date.now();
    playNotificationSound(prefs.notifications.soundId);
  }
}

export function SystemPopups() {
  const ff = useFormFactor();
  // Step 2.16: the chosen notification sound is decoded ahead, so the first one plays at once.
  const sound = useSession((st) => st.user?.preferences.notifications);
  useEffect(() => {
    if (sound?.sound) preloadNotificationSound(sound.soundId);
  }, [sound?.sound, sound?.soundId]);
  const shown = usePopups((s) => s.shown);
  const max = ff === "desktop" ? 3 : 1;
  const phone = ff !== "desktop";
  // Step 2.12: banners that arrived before their app was opened leave once it is in front.
  useEffect(() => {
    const check = () => {
      const app = activeApp();
      if (app) usePopups.getState().dropApp(app, max);
    };
    check();
    const offWm = useWM.subscribe(check);
    const offPopups = usePopups.subscribe(check);
    return () => {
      offWm();
      offPopups();
    };
  }, [max]);
  return createPortal(
    <div
      className={
        phone
          ? "pointer-events-none fixed inset-x-0 top-0 z-[310] flex flex-col items-center gap-2 px-2.5 pt-[max(var(--safe-top),8px)]"
          : "pointer-events-none fixed bottom-[96px] right-4 z-[310] flex w-[360px] flex-col-reverse gap-2.5"
      }
      aria-live="polite"
      data-testid="system-popups"
      data-placement={phone ? "top" : "bottom-right"}
    >
      <AnimatePresence initial={false}>
        {shown.map((n) => (
          <Popup key={n.id} n={n} phone={phone} onDone={() => usePopups.getState().dismiss(n.id, max)} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function Popup({ n, phone, onDone }: { n: NotificationDto; phone: boolean; onDone: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const preview = useSession((s) => s.user?.preferences.notifications.showPreview ?? true);
  const r = RENDERERS[n.app];
  const [hover, setHover] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  // Goes away by itself (the timer waits while a PC pointer rests on it).
  useEffect(() => {
    if (hover) return;
    const id = window.setTimeout(() => done.current(), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [hover, n.createdAt]);
  const open = () => {
    notificationActions.markRead(n.id);
    r.open(n);
    onDone();
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y < -24 || info.velocity.y < -400 || Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 600) onDone();
  };
  const body = n.app === "system" || preview ? n.body : "";
  const Icon = r.Icon;
  return (
    <motion.div
      layout
      initial={phone ? { opacity: 0, y: -90 } : { opacity: 0, x: 40, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      exit={phone ? { opacity: 0, y: -80, transition: { duration: 0.22 } } : { opacity: 0, x: 60, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      drag={phone ? true : false}
      dragSnapToOrigin
      dragElastic={{ top: 0.9, bottom: 0.1, left: 0.9, right: 0.9 }}
      dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
      onDragEnd={onDragEnd}
      // PC only: the timer waits while the pointer rests on it (phones have no hover).
      onHoverStart={() => !phone && setHover(true)}
      onHoverEnd={() => !phone && setHover(false)}
      className="vx-glass pointer-events-auto relative flex w-full max-w-[440px] cursor-pointer items-start gap-3 rounded-[22px] px-3.5 py-3 shadow-float"
      onClick={open}
      role="alert"
      aria-label={`${r.appName(lang)}: ${n.title}`}
      data-testid="system-popup"
      data-app={n.app}
      data-type={n.type}
    >
      <span className="relative shrink-0">
        {n.actor ? (
          <>
            <Avatar name={n.actor.name} userId={n.actor.id} version={n.actor.avatarVersion} size={42} />
            <span className="vx-app-tile absolute -bottom-1 -right-1 flex size-[20px] items-center justify-center rounded-[7px] bg-white shadow-tile">
              <Icon className="size-[14px]" />
            </span>
          </>
        ) : (
          <span className="vx-app-tile flex size-[42px] items-center justify-center rounded-[13px] bg-white shadow-tile">
            <Icon className="size-6" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[12px] text-text-secondary">
          <span className="truncate font-medium" data-testid="system-popup-app">
            {r.appName(lang)}
          </span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{timeLabel(n.createdAt, lang, t)}</span>
        </span>
        <span className="block truncate text-[14.5px] font-semibold text-text" data-testid="system-popup-title">
          {n.title}
        </span>
        <span className="line-clamp-2 text-[13.5px] leading-snug text-text-secondary" data-testid="system-popup-body">
          {body || r.action(n, t)}
        </span>
      </span>
      {!phone && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDone();
          }}
          className="-mr-1 -mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-text-tertiary hover:bg-black/5 hover:text-text"
          aria-label={t("common.close")}
          data-testid="system-popup-close"
        >
          <RiCloseLine className="size-4" />
        </button>
      )}
    </motion.div>
  );
}
