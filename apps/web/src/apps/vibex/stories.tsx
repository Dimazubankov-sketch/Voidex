import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  RiAddLine,
  RiArchiveLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiHeart3Fill,
  RiHeart3Line,
  RiPauseFill,
  RiPlayFill,
  RiSendPlane2Fill,
  RiVolumeMuteLine,
  RiVolumeUpLine,
} from "@remixicon/react";
import { VIBEX_MESSAGE_MAX, VIBEX_POST_IMAGE_TYPES, VIBEX_POST_VIDEO_TYPES, VIBEX_STORY_REACTIONS, type VibexStoryDto, type VibexStoryGroupDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Button, EmptyState, Spinner } from "@/ui/controls";
import { ConfirmDialog, Sheet, toast } from "@/ui/overlays";
import { AttachSourceSheet } from "@/os/share/attach-source";
import { checkVibexFile, deleteStory, markStoryViewed, publishStory, reactToStory, replyToStory, useFileUrl, useStories, useStoryArchive, useStoryGroup, useStoryViewers } from "./data";

/** A photo stays this long on screen; a video plays to its end. */
const PHOTO_MS = 5000;
const HOLD_MS = 180;

// ------------------------------------------------------------------ rings

/** An avatar with the story ring: violet gradient while something is unseen, grey once seen. */
export function StoryRing({ group, size = 64, onClick, label, plus, onPlus, testId }: { group: VibexStoryGroupDto | null; size?: number; onClick?: () => void; label?: string; plus?: boolean; onPlus?: () => void; testId?: string }) {
  const me = useSession((s) => s.user)!;
  const person = group?.person ?? { id: me.id, name: `${me.firstName} ${me.lastName}`, avatarVersion: me.avatarVersion };
  const unseen = !!group && !group.seen;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} data-testid={testId}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label ?? person.name}
        className={cx(
          "flex size-full items-center justify-center rounded-full p-[2.5px]",
          group ? (unseen ? STORY_GRADIENT : "bg-[var(--story-seen)]") : "bg-transparent",
        )}
        data-unseen={unseen || undefined}
      >
        <span className="flex size-full items-center justify-center rounded-full bg-surface p-[2px]">
          <Avatar name={person.name} userId={person.id} version={person.avatarVersion} size={size - 9} />
        </span>
      </button>
      {plus && (
        <button
          type="button"
          onClick={onPlus}
          aria-label={label}
          className="absolute -bottom-0.5 -right-0.5 flex size-[22px] items-center justify-center rounded-full border-2 border-surface bg-primary text-white"
          data-testid="story-create"
        >
          <RiAddLine className="size-3.5" />
        </button>
      )}
    </span>
  );
}

/** The violet ring of unseen stories (one look everywhere). */
export const STORY_GRADIENT = "bg-[conic-gradient(from_200deg,#8b7bff,#5b8cff,#c46bff,#8b7bff)]";

/**
 * Step 2.11: the story ring on any avatar (chat list, profile): drawn outside
 * the avatar, so it appears and goes away without moving anything.
 * Step 2.12: violet while the person (me too) has a live story I have not
 * seen, grey once all are seen, none without a live story. The avatar never
 * gives the browser's image menu (no callout / save).
 * `gap` is the color between the ring and the avatar (the surface it sits on).
 */
export function StoryHalo({
  personId,
  children,
  gap = "ring-surface",
  onOpen,
  onNone,
  className,
}: {
  personId: string | null | undefined;
  children: React.ReactNode;
  gap?: string;
  /** A tap while the person has a live story (seen or not). */
  onOpen?: () => void;
  /** Step 2.12: a tap while they have none (the profile opens the photo). */
  onNone?: () => void;
  className?: string;
}) {
  const t = useT();
  const g = useStoryGroup(personId);
  // Step 2.12: violet while unseen, grey once every story was seen (mine too), nothing without a live story.
  const state = g ? (g.seen ? "seen" : "unseen") : null;
  const inner = (
    <>
      {state && <span className={cx("pointer-events-none absolute -inset-[3.5px] rounded-full", state === "unseen" ? STORY_GRADIENT : "bg-[var(--story-seen)]")} aria-hidden data-testid="story-ring" />}
      <span className={cx("relative flex select-none rounded-full [-webkit-touch-callout:none]", state && cx("ring-2", gap))}>{children}</span>
    </>
  );
  const click = g ? onOpen : onNone;
  if (click) {
    return (
      <button
        type="button"
        onClick={click}
        onContextMenu={(e) => e.preventDefault()}
        className={cx("relative inline-flex shrink-0 rounded-full", className)}
        aria-label={g ? t("vibex.stories.of", { name: g.person.name }) : t("vibex.profile.photo")}
        data-story-ring={state ?? undefined}
        data-testid={state ? "story-halo" : "avatar-open"}
      >
        {inner}
      </button>
    );
  }
  return (
    <span className={cx("relative inline-flex shrink-0 rounded-full", className)} data-story-ring={state ?? undefined} data-testid={state ? "story-halo" : undefined}>
      {inner}
    </span>
  );
}

/** Collapsed header: a few story avatars overlapping each other (people with stories, unseen first). */
export function StackedStories({ groups, onClick }: { groups: VibexStoryGroupDto[]; onClick: () => void }) {
  const t = useT();
  const others = groups.filter((g) => !g.mine).slice(0, 3);
  const shown = others.length ? others : groups.slice(0, 1);
  if (!shown.length) return null;
  return (
    <button type="button" onClick={onClick} className="flex shrink-0 items-center" aria-label={t("vibex.stories.title")} data-testid="stories-stack">
      {shown.map((g, i) => (
        <span
          key={g.person.id}
          className={cx("rounded-full p-[2px]", g.seen ? "bg-border" : STORY_GRADIENT)}
          style={{ marginLeft: i ? -10 : 0, zIndex: 10 - i }}
        >
          <span className="block rounded-full bg-surface p-[1.5px]">
            <Avatar name={g.person.name} userId={g.person.id} version={g.person.avatarVersion} size={26} />
          </span>
        </span>
      ))}
    </button>
  );
}

/** Expanded header: «Моя история» (with +) first, then everyone's stories; swipe sideways. */
export function StoriesStrip({ groups, onOpen, onCreate }: { groups: VibexStoryGroupDto[]; onOpen: (personId: string) => void; onCreate: () => void }) {
  const t = useT();
  const mine = groups.find((g) => g.mine) ?? null;
  const others = groups.filter((g) => !g.mine);
  return (
    <div className="scroll-area flex gap-3.5 overflow-x-auto overscroll-x-contain px-3 pb-1 pt-1 [scrollbar-width:none]" role="list" aria-label={t("vibex.stories.title")} data-testid="stories-strip">
      {/* Step 2.12: «Моя история +» always adds a story; once I posted one, my story has its own circle beside it. */}
      <div className="flex w-[70px] shrink-0 flex-col items-center gap-1" role="listitem">
        <StoryRing group={null} size={62} onClick={onCreate} label={t("vibex.stories.add")} plus onPlus={onCreate} testId="story-mine" />
        <span className="w-full truncate text-center text-[12px] text-text-secondary">{t("vibex.stories.mine")}</span>
      </div>
      {mine && (
        <div className="flex w-[70px] shrink-0 flex-col items-center gap-1" role="listitem">
          <StoryRing group={mine} size={62} onClick={() => onOpen(mine.person.id)} label={t("vibex.stories.yours")} testId="story-own" />
          <span className="w-full truncate text-center text-[12px] text-text-secondary">{t("vibex.stories.yours")}</span>
        </div>
      )}
      {others.map((g) => (
        <div key={g.person.id} className="flex w-[70px] shrink-0 flex-col items-center gap-1" role="listitem">
          <StoryRing group={g} size={62} onClick={() => onOpen(g.person.id)} testId="story-person" />
          <span className="w-full truncate text-center text-[12px] text-text-secondary">{g.person.firstName || g.person.name}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- composer

/**
 * New story: pick a photo / video (VOIDEX Media or the device), see it,
 * publish. Nothing is uploaded before «Опубликовать».
 */
export function StoryComposer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The device picker is open (the chooser sheet has closed itself, the composer has not).
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pickingRef = useRef(false);
  const fileRef = useRef<File | null>(null);
  pickingRef.current = picking;
  fileRef.current = file;
  const choose = open && !file && !picking;
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    if (!open) {
      setFile(null);
      setPicking(false);
    }
  }, [open]);
  // A cancelled device picker closes the composer too.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const cancel = () => {
      setPicking(false);
      onClose();
    };
    el.addEventListener("cancel", cancel);
    return () => el.removeEventListener("cancel", cancel);
  }, [onClose]);
  const close = () => {
    setFile(null);
    setPicking(false);
    onClose();
  };
  const take = (f: File | undefined) => {
    setPicking(false);
    if (!f) return close();
    const bad = checkVibexFile(f, "story");
    if (bad) {
      toast({ title: t(`error.${bad}`), body: f.name, tone: "danger" });
      return close();
    }
    setFile(f);
  };
  const publish = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await publishStory(file);
      toast({ title: t("vibex.stories.published") });
      close();
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const video = !!file && file.type.startsWith("video/");
  return (
    <>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={[...VIBEX_POST_IMAGE_TYPES, ...VIBEX_POST_VIDEO_TYPES].join(",")}
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
        data-testid="story-file"
      />
      <AttachSourceSheet
        open={choose}
        // The sheet closes itself before handing over to the device picker: only a plain close ends the composer.
        onClose={() => window.setTimeout(() => !pickingRef.current && !fileRef.current && close(), 0)}
        sources={["media", "device"]}
        onDevice={() => {
          pickingRef.current = true;
          setPicking(true);
          input.current?.click();
        }}
        onPick={(f) => {
          fileRef.current = f[0] ?? null;
          take(f[0]);
        }}
        max={1}
        testId="story-source"
      />
      {createPortal(
        <AnimatePresence>
          {open && file && url && (
            <motion.div
              className="fixed inset-0 z-[270] flex flex-col bg-black"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="dialog"
              aria-modal="true"
              aria-label={t("vibex.stories.new")}
              data-testid="story-preview"
            >
              <div className="relative min-h-0 flex-1">
                {video ? (
                  <video src={url} className="absolute inset-0 size-full object-contain" autoPlay muted loop playsInline />
                ) : (
                  <img src={url} alt="" className="absolute inset-0 size-full object-contain" />
                )}
                <button type="button" onClick={close} aria-label={t("common.close")} className="absolute left-3 top-[max(var(--safe-top),12px)] flex size-11 items-center justify-center rounded-full bg-white/15 text-white">
                  <RiCloseLine className="size-6" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 pb-[max(var(--safe-bottom),16px)] pt-3">
                <button type="button" onClick={() => setFile(null)} className="h-11 rounded-full bg-white/15 px-5 text-[15px] font-medium text-white">
                  {t("vibex.stories.another")}
                </button>
                <Button onClick={publish} loading={busy} data-testid="story-publish">
                  {t("vibex.stories.publish")}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

// ------------------------------------------------------------------ viewer

/** Share of the width at each side where a tap goes to the previous / next story (the middle pauses). */
const EDGE = 0.22;

/**
 * The story viewer: one person after another, their stories in order.
 *   tap in the middle     pause / play (Step 2.11: a tap never closes)
 *   tap at the left/right previous / next story
 *   swipe left / right    next / previous person
 *   press and hold        pause while held
 *   X, Esc                close (swipe down too)
 * Progress bars on top; photos stay 5 s, videos play to the end. Only the
 * story on screen is loaded and decoded. My stories: who saw them (with
 * their reactions), archive, delete. Someone else's: reply and react.
 */
export function StoryViewer({ groups, startPerson, onClose, onArchive }: { groups: VibexStoryGroupDto[]; startPerson: string | null; onClose: () => void; onArchive: () => void }) {
  return createPortal(
    <AnimatePresence>{startPerson && groups.some((g) => g.person.id === startPerson) && <Viewer key="viewer" groups={groups} startPerson={startPerson} onClose={onClose} onArchive={onArchive} />}</AnimatePresence>,
    document.body,
  );
}

function Viewer({ groups, startPerson, onClose, onArchive }: { groups: VibexStoryGroupDto[]; startPerson: string; onClose: () => void; onArchive: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const reduced = useReducedMotion();
  // The groups as they were when the viewer opened (marking "seen" must not reorder under the finger);
  // a story I delete leaves this list at once.
  const [list, setList] = useState(groups);
  const [gi, setGi] = useState(() => Math.max(0, list.findIndex((g) => g.person.id === startPerson)));
  const group = list[gi];
  const [si, setSi] = useState(() => {
    const g = list[gi];
    const firstUnseen = g ? g.stories.findIndex((s) => !s.seen) : -1;
    return firstUnseen >= 0 ? firstUnseen : 0;
  });
  const story = group?.stories[si];
  // The live copy of this story (my reaction, my views) from the stories cache.
  const live = useStories().data?.flatMap((g) => g.stories).find((x) => x.id === story?.id);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [typing, setTyping] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [viewers, setViewers] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const { data: src } = useFileUrl(story?.file.id ?? null);
  // Anything on top of the story (or a finger holding it) stops its clock.
  const stopped = paused || held || typing || viewers || deleting;

  const nextStory = useCallback(() => {
    if (!group) return;
    if (si < group.stories.length - 1) setSi(si + 1);
    else if (gi < list.length - 1) {
      setGi(gi + 1);
      setSi(0);
    } else onClose();
  }, [group, si, gi, list.length, onClose]);
  const prevStory = () => {
    if (si > 0) setSi(si - 1);
    else if (gi > 0) {
      setGi(gi - 1);
      setSi(0);
    } else {
      elapsed.current = 0;
      setProgress(0);
      if (video.current) video.current.currentTime = 0;
    }
  };
  const nextPerson = () => (gi < list.length - 1 ? (setGi(gi + 1), setSi(0)) : onClose());
  const prevPerson = () => gi > 0 && (setGi(gi - 1), setSi(0));

  // Seen as soon as it is on screen; a new story starts playing.
  useEffect(() => {
    if (story) markStoryViewed(story);
    setProgress(0);
    setPaused(false);
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Photos: a 5 s timer (requestAnimationFrame only while open and running). Videos: their own clock.
  const elapsed = useRef(0);
  useEffect(() => {
    elapsed.current = 0;
  }, [story?.id]);
  useEffect(() => {
    if (!story || story.kind !== "photo" || stopped || !src) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const p = Math.min(1, elapsed.current / PHOTO_MS);
      setProgress(p);
      if (p >= 1) nextStory();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [story, stopped, src, nextStory]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (stopped) v.pause();
    else void v.play().catch(() => undefined);
  }, [stopped, src]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Typing a reply: the keys are the field's.
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
      if (deleting || viewers) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") nextStory();
      else if (e.key === "ArrowLeft") prevStory();
      else if (e.key === " ") setPaused((p) => !p);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  // Gestures: tap (middle pauses, edges step), hold to pause, swipe sideways (person) or down (close).
  const g = useRef<{ x: number; y: number; held: boolean; timer: number } | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, textarea, [data-story-ui]")) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    const timer = window.setTimeout(() => {
      if (g.current) {
        g.current.held = true;
        setHeld(true);
      }
    }, HOLD_MS);
    g.current = { x: e.clientX, y: e.clientY, held: false, timer };
  };
  const move = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.hypot(dx, dy) > 10) window.clearTimeout(s.timer);
    setDrag(Math.abs(dx) > Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: Math.max(0, dy) });
  };
  const up = (e: React.PointerEvent) => {
    const s = g.current;
    g.current = null;
    setDrag({ x: 0, y: 0 });
    if (!s) return;
    window.clearTimeout(s.timer);
    setHeld(false);
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.held) return;
    if (dy > 110 && dy > Math.abs(dx)) return onClose();
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? nextPerson() : prevPerson();
    if (Math.hypot(dx, dy) < 12) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const at = (e.clientX - r.left) / r.width;
      if (at < EDGE) prevStory();
      else if (at > 1 - EDGE) nextStory();
      else setPaused((p) => !p);
    }
  };
  const cancel = () => {
    if (g.current) window.clearTimeout(g.current.timer);
    g.current = null;
    setDrag({ x: 0, y: 0 });
    setHeld(false);
  };

  const removeFromList = (id: string) => {
    const left = list.map((x) => ({ ...x, stories: x.stories.filter((st) => st.id !== id) }));
    const here = left[gi]!;
    if (here.stories.length === 0) {
      // That was this person's last story: on to the next person, or close.
      const rest = left.filter((x) => x.stories.length > 0);
      if (!rest.length || gi >= rest.length) return onClose();
      setList(rest);
      setSi(0);
      return;
    }
    setList(left);
    setSi(Math.min(si, here.stories.length - 1));
  };

  if (!group || !story) return null;
  const shownPaused = paused && !held;
  return (
    <motion.div
      className="fixed inset-0 z-[270] flex items-center justify-center bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label={t("vibex.stories.of", { name: group.person.name })}
      data-testid="story-viewer"
      data-story-id={story.id}
      data-paused={stopped || undefined}
    >
      <div
        className="relative flex h-full w-full max-w-[520px] touch-none select-none flex-col overflow-hidden sm:h-[min(92dvh,900px)] sm:rounded-[28px]"
        style={{ transform: `translate(${drag.x}px, ${drag.y}px) scale(${1 - drag.y / 2000})`, transition: g.current ? "none" : "transform 200ms ease" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        data-testid="story-stage"
      >
        {/* The story itself */}
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          {!src ? (
            <Spinner className="text-white" />
          ) : story.kind === "video" ? (
            <video
              ref={video}
              key={story.id}
              src={src}
              className="size-full object-contain"
              autoPlay
              playsInline
              muted={muted}
              preload="auto"
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (Number.isFinite(v.duration) && v.duration > 0) setProgress(v.currentTime / v.duration);
              }}
              onEnded={nextStory}
              data-testid="story-video"
            />
          ) : (
            <img src={src} alt="" className="size-full object-contain" draggable={false} data-testid="story-image" />
          )}
        </div>
        {/* Paused: a quiet sign in the middle (taps go through it) */}
        <AnimatePresence>
          {shownPaused && (
            <motion.span
              className="pointer-events-none absolute left-1/2 top-1/2 z-10 -ml-9 -mt-9 flex size-[72px] items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.16 }}
              aria-hidden
              data-testid="story-paused"
            >
              <RiPlayFill className="size-9" />
            </motion.span>
          )}
        </AnimatePresence>
        {/* Progress + who + controls */}
        <div className="relative z-10 bg-gradient-to-b from-black/55 to-transparent px-3 pb-6 pt-[max(var(--safe-top),10px)]">
          <div className="flex gap-1" aria-hidden>
            {group.stories.map((s, i) => (
              <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
                <span className="block h-full bg-white" style={{ width: `${i < si ? 100 : i > si ? 0 : Math.round(progress * 100)}%` }} />
              </span>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2.5 text-white">
            <Avatar name={group.person.name} userId={group.person.id} version={group.person.avatarVersion} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-semibold">{group.mine ? t("vibex.stories.mine") : group.person.name}</span>
              <span className="block text-[12px] text-white/75">{formatRelative(story.createdAt, lang)}</span>
            </span>
            {story.kind === "video" && (
              <button type="button" onClick={() => setMuted((m) => !m)} aria-label={t(muted ? "vibex.stories.unmute" : "vibex.stories.mute")} className="flex size-10 items-center justify-center rounded-full hover:bg-white/15">
                {muted ? <RiVolumeMuteLine className="size-5" /> : <RiVolumeUpLine className="size-5" />}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex size-10 items-center justify-center rounded-full hover:bg-white/15" data-testid="story-close">
              <RiCloseLine className="size-6" />
            </button>
          </div>
        </div>
        {/* Screen-reader / keyboard navigation (taps and Space do the same) */}
        <button type="button" onClick={prevStory} className="sr-only" aria-label={t("vibex.stories.previous")} data-testid="story-prev">
          <RiArrowLeftSLine />
        </button>
        <button type="button" onClick={() => setPaused((p) => !p)} className="sr-only" aria-label={t(paused ? "vibex.stories.play" : "vibex.stories.pause")} data-testid="story-toggle">
          {paused ? <RiPlayFill /> : <RiPauseFill />}
        </button>
        <button type="button" onClick={nextStory} className="sr-only" aria-label={t("vibex.stories.next")} data-testid="story-next">
          <RiArrowRightSLine />
        </button>
        {group.mine ? (
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/60 to-transparent px-4 pb-[max(var(--safe-bottom),14px)] pt-8 text-white" data-story-ui>
            <button
              type="button"
              onClick={() => setViewers(true)}
              className="flex h-10 items-center gap-3 rounded-full bg-white/15 px-3.5 text-[14px]"
              aria-label={t("vibex.stories.viewers")}
              data-testid="story-views"
            >
              <span className="flex items-center gap-1.5">
                <RiEyeLine className="size-[18px]" /> <span data-testid="story-views-count">{live?.views ?? story.views}</span>
              </span>
              {(live?.reactions ?? story.reactions ?? 0) > 0 && (
                <span className="flex items-center gap-1.5">
                  <RiHeart3Fill className="size-[17px] text-[#ff4d6d]" /> <span data-testid="story-reactions-count">{live?.reactions ?? story.reactions}</span>
                </span>
              )}
            </button>
            <span className="flex-1" />
            <button type="button" onClick={onArchive} aria-label={t("vibex.stories.archive")} title={t("vibex.stories.archive")} className="flex size-10 items-center justify-center rounded-full bg-white/15" data-testid="story-open-archive">
              <RiArchiveLine className="size-5" />
            </button>
            <button type="button" onClick={() => setDeleting(true)} aria-label={t("vibex.stories.delete")} title={t("vibex.stories.delete")} className="flex size-10 items-center justify-center rounded-full bg-white/15" data-testid="story-delete">
              <RiDeleteBinLine className="size-5" />
            </button>
          </div>
        ) : (
          <ReplyBar story={live ?? story} owner={group.person.firstName || group.person.name} onTyping={setTyping} />
        )}
      </div>
      {group.mine && <ViewersSheet story={viewers ? (live ?? story) : null} onClose={() => setViewers(false)} />}
      <ConfirmDialog
        open={deleting}
        top
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          const id = story.id;
          void deleteStory(id)
            .then(() => removeFromList(id))
            .catch((e) => toast({ title: errorMessage(t, e), tone: "danger" }));
        }}
        title={t("vibex.stories.deleteTitle")}
        message={t("vibex.stories.deleteBody")}
        confirmLabel={t("vibex.stories.delete")}
        danger
        testId="story-delete-confirm"
      />
    </motion.div>
  );
}

/**
 * Someone else's story: «Ответить...» (a direct message to its author that
 * refers to the story) and a heart; focusing the field offers the quick
 * reactions. The story waits while the field is in use.
 */
function ReplyBar({ story, owner, onTyping }: { story: VibexStoryDto; owner: string; onTyping: (v: boolean) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const mine = story.myReaction ?? null;
  useEffect(() => onTyping(focused || text.length > 0), [focused, text, onTyping]);
  useEffect(() => () => onTyping(false), [onTyping]);
  useEffect(() => setText(""), [story.id]);
  const react = (r: string) => {
    const next = mine === r ? null : r;
    void reactToStory(story, next).catch((e) => toast({ title: errorMessage(t, e), tone: "danger" }));
  };
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await replyToStory(story.id, body);
      setText("");
      field.current?.blur();
      toast({ title: t("vibex.stories.replySent", { name: owner }) });
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-3 pb-[max(var(--safe-bottom),12px)] pt-10 text-white" data-story-ui data-testid="story-reply-bar">
      <AnimatePresence>
        {focused && !text && (
          <motion.div
            className="mb-3 flex justify-center gap-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16 }}
            data-testid="story-reactions"
          >
            {VIBEX_STORY_REACTIONS.map((r) => (
              <button
                key={r}
                type="button"
                // Keep the field focused: the tap must reach the button, not blur first.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => react(r)}
                className={cx("flex size-11 items-center justify-center rounded-full text-[24px] transition-transform active:scale-90", mine === r ? "bg-white/30" : "bg-white/10")}
                aria-label={r}
                aria-pressed={mine === r}
                data-testid="story-reaction"
                data-reaction={r}
              >
                {r}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t("vibex.stories.reply")}
          maxLength={VIBEX_MESSAGE_MAX}
          enterKeyHint="send"
          className="h-11 min-w-0 flex-1 rounded-full border border-white/45 bg-black/20 px-4 text-[16px] text-white outline-none placeholder:text-white/70 focus:border-white/80"
          data-testid="story-reply"
        />
        {text.trim() ? (
          <button
            type="submit"
            disabled={sending}
            onPointerDown={(e) => e.preventDefault()}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-60"
            aria-label={t("vibex.stories.send")}
            data-testid="story-reply-send"
          >
            {sending ? <Spinner className="size-5 text-white" /> : <RiSendPlane2Fill className="size-5" />}
          </button>
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => react("❤️")}
            className="flex size-11 shrink-0 items-center justify-center rounded-full active:scale-90"
            aria-label={t("vibex.stories.like")}
            aria-pressed={!!mine}
            data-testid="story-like"
            data-reacted={mine ?? undefined}
          >
            {mine && mine !== "❤️" ? <span className="text-[24px]">{mine}</span> : mine ? <RiHeart3Fill className="size-7 text-[#ff4d6d]" /> : <RiHeart3Line className="size-7" />}
          </button>
        )}
      </form>
    </div>
  );
}

/** Who saw my story: views and reactions on top, then each viewer (their reaction on the avatar), reactions first. */
function ViewersSheet({ story, onClose }: { story: VibexStoryDto | null; onClose: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const q = useStoryViewers(story?.id ?? null);
  const rows = [...(q.data ?? [])].sort((a, b) => Number(!!b.reaction) - Number(!!a.reaction));
  const reactions = rows.filter((v) => v.reaction).length;
  return (
    <Sheet open={!!story} onClose={onClose} title={t("vibex.stories.viewers")} width={420} top testId="story-viewers">
      {q.isPending ? (
        <Spinner />
      ) : !rows.length ? (
        <EmptyState icon={<RiEyeLine className="size-7" />} title={t("vibex.stories.noViewers")} />
      ) : (
        <div className="flex flex-col">
          <div className="mb-2 flex items-center gap-4 text-[14px] text-text-secondary" data-testid="story-viewers-summary">
            <span className="flex items-center gap-1.5" title={t("vibex.stories.viewsLabel")}>
              <RiEyeLine className="size-[18px]" /> <b className="font-semibold text-text">{rows.length}</b> {t("vibex.stories.viewsLabel")}
            </span>
            <span className="flex items-center gap-1.5" title={t("vibex.stories.reactionsLabel")}>
              <RiHeart3Fill className="size-[17px] text-[#ff4d6d]" /> <b className="font-semibold text-text">{reactions}</b> {t("vibex.stories.reactionsLabel")}
            </span>
          </div>
          {rows.map((v) => (
            <div key={v.person.id} className="flex items-center gap-3 py-2" data-testid="story-viewer-row" data-reaction={v.reaction ?? undefined}>
              <span className="relative shrink-0">
                <Avatar name={v.person.name} userId={v.person.id} version={v.person.avatarVersion} size={44} />
                {v.reaction && (
                  <span className="absolute -bottom-1 -right-1 flex size-[22px] items-center justify-center rounded-full bg-surface text-[13px] shadow-sm ring-2 ring-surface" aria-label={v.reaction}>
                    {v.reaction}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{v.person.name}</span>
                {v.person.address && <span className="block truncate text-[12.5px] text-text-tertiary">{v.person.address}</span>}
              </span>
              <span className="shrink-0 text-[12.5px] text-text-tertiary">{formatRelative(v.reactedAt ?? v.viewedAt, lang)}</span>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ----------------------------------------------------------------- archive

/** My stories past their 24 hours: only I see them. */
export function StoryArchive({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const q = useStoryArchive(open);
  const [view, setView] = useState<VibexStoryGroupDto | null>(null);
  return (
    <>
      <Sheet open={open} onClose={onClose} title={t("vibex.stories.archive")} width={520} testId="story-archive">
        <p className="mb-3 text-[13px] text-text-secondary">{t("vibex.stories.archiveHint")}</p>
        {q.isPending ? (
          <Spinner />
        ) : !q.data?.length ? (
          <EmptyState icon={<RiArchiveLine className="size-7" />} title={t("vibex.stories.archiveEmpty")} />
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {q.data.map((s) => (
              <ArchiveTile key={s.id} story={s} onOpen={() => setView({ person: s.owner, stories: [s], seen: true, mine: true })} />
            ))}
          </div>
        )}
      </Sheet>
      <StoryViewer groups={view ? [view] : []} startPerson={view?.person.id ?? null} onClose={() => setView(null)} onArchive={() => setView(null)} />
    </>
  );
}

function ArchiveTile({ story, onOpen }: { story: VibexStoryDto; onOpen: () => void }) {
  const lang = useLanguage();
  const { data: src } = useFileUrl(story.file.id);
  return (
    <button type="button" onClick={onOpen} className="relative aspect-[9/14] overflow-hidden rounded-xl bg-surface-secondary" data-testid="archive-story">
      {src && (story.kind === "video" ? <video src={src} muted playsInline preload="metadata" className="size-full object-cover" /> : <img src={src} alt="" className="size-full object-cover" />)}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-4 text-left text-[11.5px] text-white">{formatRelative(story.createdAt, lang)}</span>
    </button>
  );
}
