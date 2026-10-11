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
  RiPauseFill,
  RiPlayFill,
  RiVolumeMuteLine,
  RiVolumeUpLine,
} from "@remixicon/react";
import { VIBEX_POST_IMAGE_TYPES, VIBEX_POST_VIDEO_TYPES, type VibexStoryDto, type VibexStoryGroupDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Button, EmptyState, Spinner } from "@/ui/controls";
import { ConfirmDialog, Sheet, toast } from "@/ui/overlays";
import { AttachSourceSheet } from "@/os/share/attach-source";
import { checkVibexFile, deleteStory, markStoryViewed, publishStory, useFileUrl, useStoryArchive, useStoryViewers } from "./data";

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
          group ? (unseen ? "bg-[conic-gradient(from_200deg,#8b7bff,#5b8cff,#c46bff,#8b7bff)]" : "bg-border") : "bg-transparent",
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
          className={cx("rounded-full p-[2px]", g.seen ? "bg-border" : "bg-[conic-gradient(from_200deg,#8b7bff,#5b8cff,#c46bff,#8b7bff)]")}
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
      <div className="flex w-[70px] shrink-0 flex-col items-center gap-1" role="listitem">
        <StoryRing group={mine} size={62} onClick={() => (mine ? onOpen(mine.person.id) : onCreate())} label={t("vibex.stories.mine")} plus onPlus={onCreate} testId="story-mine" />
        <span className="w-full truncate text-center text-[12px] text-text-secondary">{t("vibex.stories.mine")}</span>
      </div>
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

/**
 * The story viewer: one person after another, their stories in order.
 *   tap right / left    next / previous story
 *   swipe left / right  next / previous person
 *   swipe down, X, Esc  close
 *   press and hold      pause (also Space)
 * Progress bars on top; photos stay 5 s, videos play to the end. Only the
 * story on screen is loaded and decoded.
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
  // The groups as they were when the viewer opened (marking "seen" must not reorder under the finger).
  const [list] = useState(groups);
  const [gi, setGi] = useState(() => Math.max(0, list.findIndex((g) => g.person.id === startPerson)));
  const group = list[gi];
  const [si, setSi] = useState(() => {
    const g = list[gi];
    const firstUnseen = g ? g.stories.findIndex((s) => !s.seen) : -1;
    return firstUnseen >= 0 ? firstUnseen : 0;
  });
  const story = group?.stories[si];
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [viewers, setViewers] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const { data: src } = useFileUrl(story?.file.id ?? null);

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
    } else setProgress(0);
  };
  const nextPerson = () => (gi < list.length - 1 ? (setGi(gi + 1), setSi(0)) : onClose());
  const prevPerson = () => gi > 0 && (setGi(gi - 1), setSi(0));

  // Seen as soon as it is on screen.
  useEffect(() => {
    if (story) markStoryViewed(story);
    setProgress(0);
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Photos: a 5 s timer (requestAnimationFrame only while open and not paused). Videos: their own clock.
  const elapsed = useRef(0);
  useEffect(() => {
    elapsed.current = 0;
  }, [story?.id]);
  useEffect(() => {
    if (!story || story.kind !== "photo" || paused || !src || viewers || deleting) return;
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
  }, [story, paused, src, nextStory, viewers, deleting]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (paused || viewers || deleting) v.pause();
    else void v.play().catch(() => undefined);
  }, [paused, src, viewers, deleting]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
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

  // Gestures: tap halves, hold to pause, swipe sideways (person) or down (close).
  const g = useRef<{ x: number; y: number; t: number; held: boolean; timer: number } | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const timer = window.setTimeout(() => {
      if (g.current) {
        g.current.held = true;
        setPaused(true);
      }
    }, HOLD_MS);
    g.current = { x: e.clientX, y: e.clientY, t: performance.now(), held: false, timer };
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
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.held) return setPaused(false);
    if (dy > 110 && dy > Math.abs(dx)) return onClose();
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? nextPerson() : prevPerson();
    if (Math.hypot(dx, dy) < 12) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (e.clientX - r.left < r.width / 3) prevStory();
      else nextStory();
    }
  };
  const cancel = () => {
    if (g.current) window.clearTimeout(g.current.timer);
    g.current = null;
    setDrag({ x: 0, y: 0 });
    setPaused(false);
  };

  if (!group || !story) return null;
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
      data-paused={paused || undefined}
    >
      <div
        className="relative flex h-full w-full max-w-[520px] touch-none select-none flex-col overflow-hidden sm:h-[min(92dvh,900px)] sm:rounded-[28px]"
        style={{ transform: `translate(${drag.x}px, ${drag.y}px) scale(${1 - drag.y / 2000})`, transition: g.current ? "none" : "transform 200ms ease" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
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
            <button type="button" onClick={() => setPaused((p) => !p)} aria-label={t(paused ? "vibex.stories.play" : "vibex.stories.pause")} className="flex size-10 items-center justify-center rounded-full hover:bg-white/15" data-testid="story-pause">
              {paused ? <RiPlayFill className="size-5" /> : <RiPauseFill className="size-5" />}
            </button>
            <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex size-10 items-center justify-center rounded-full hover:bg-white/15" data-testid="story-close">
              <RiCloseLine className="size-6" />
            </button>
          </div>
        </div>
        {/* Screen-reader / keyboard navigation (taps do the same) */}
        <button type="button" onClick={prevStory} className="sr-only" aria-label={t("vibex.stories.previous")} data-testid="story-prev">
          <RiArrowLeftSLine />
        </button>
        <button type="button" onClick={nextStory} className="sr-only" aria-label={t("vibex.stories.next")} data-testid="story-next">
          <RiArrowRightSLine />
        </button>
        {group.mine && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/60 to-transparent px-4 pb-[max(var(--safe-bottom),14px)] pt-8 text-white">
            <button type="button" onClick={() => setViewers(true)} className="flex h-10 items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-[14px]" data-testid="story-views">
              <RiEyeLine className="size-[18px]" /> {story.views}
            </button>
            <span className="flex-1" />
            <button type="button" onClick={onArchive} aria-label={t("vibex.stories.archive")} title={t("vibex.stories.archive")} className="flex size-10 items-center justify-center rounded-full bg-white/15" data-testid="story-open-archive">
              <RiArchiveLine className="size-5" />
            </button>
            <button type="button" onClick={() => setDeleting(true)} aria-label={t("vibex.stories.delete")} title={t("vibex.stories.delete")} className="flex size-10 items-center justify-center rounded-full bg-white/15" data-testid="story-delete">
              <RiDeleteBinLine className="size-5" />
            </button>
          </div>
        )}
      </div>
      {group.mine && <ViewersSheet story={viewers ? story : null} onClose={() => setViewers(false)} />}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          void deleteStory(story.id)
            .then(() => (group.stories.length > 1 ? nextStory() : onClose()))
            .catch((e) => toast({ title: errorMessage(t, e), tone: "danger" }));
        }}
        title={t("vibex.stories.deleteTitle")}
        message={t("vibex.stories.deleteBody")}
        confirmLabel={t("vibex.stories.delete")}
        danger
      />
    </motion.div>
  );
}

function ViewersSheet({ story, onClose }: { story: VibexStoryDto | null; onClose: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const q = useStoryViewers(story?.id ?? null);
  return (
    <Sheet open={!!story} onClose={onClose} title={t("vibex.stories.viewers")} width={420} testId="story-viewers">
      {q.isPending ? (
        <Spinner />
      ) : !q.data?.length ? (
        <EmptyState icon={<RiEyeLine className="size-7" />} title={t("vibex.stories.noViewers")} />
      ) : (
        <div className="flex flex-col">
          {q.data.map((v) => (
            <div key={v.person.id} className="flex items-center gap-3 py-2">
              <Avatar name={v.person.name} userId={v.person.id} version={v.person.avatarVersion} size={40} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{v.person.name}</span>
              <span className="text-[12.5px] text-text-tertiary">{formatRelative(v.viewedAt, lang)}</span>
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
