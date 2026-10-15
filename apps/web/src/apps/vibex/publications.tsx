import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { RiArrowLeftLine, RiBookmarkFill, RiBookmarkLine, RiChat1Line, RiHeart3Fill, RiHeart3Line, RiImageFill } from "@remixicon/react";
import type { VibexFileDto, VibexPostDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { EmptyState, IconButton, Skeleton, Spinner } from "@/ui/controls";
import { useFileUrl, usePersonPublications, usePostAction, useVibexMe } from "./data";
import { LoadMore, PostMenu, ShareGlyph } from "./posts";
import { StoryHalo } from "./stories";
import { useVibex } from "./store";
import { usePinch } from "./pinch";

/**
 * Step 2.13: «Публикации», the media-first view of the same posts (no copy of
 * the data): Главная in «Публикации» mode, a profile's grid, and the viewer
 * that opens from it as a continuous feed. A publication is a post with
 * photos / videos; text-only posts live in «Посты».
 */

type Media = VibexFileDto & { kind: "image" | "video" };

/** The post a publication shows (a repost shows its original) and its photos / videos. */
export function publicationOf(post: VibexPostDto): { post: VibexPostDto; media: Media[] } | null {
  const src = post.kind === "repost" ? post.repostOf : post;
  if (!src) return null;
  const media = src.media.filter((m): m is Media => m.kind === "image" || m.kind === "video");
  return media.length ? { post: src, media } : null;
}

const MIN_ASPECT = 0.8; // 4:5, the tallest frame
const MAX_ASPECT = 1.91; // the widest
const clampAspect = (a: number) => Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, a));

// ---------------------------------------------------------------- one item

/** A picture that two fingers zoom (never below the size it opened at, at most 4x); one finger pans it while zoomed. */
function ZoomableImage({ file, onAspect, onZoom }: { file: Media; onAspect?: (a: number) => void; onZoom?: (zoomed: boolean) => void }) {
  const { data: src, isError } = useFileUrl(file.id);
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const pan = useRef<{
    id: number;
    x0: number;
    y0: number;
    sx: number;
    sy: number;
  } | null>(null);
  const bound = (v: number, size: number, z: number) => Math.max((-size * (z - 1)) / 2, Math.min((size * (z - 1)) / 2, v));
  usePinch(box, {
    enabled: true,
    begin: () => zoomRef.current,
    change: (z) => {
      const next = Math.max(1, Math.min(4, z));
      setZoom(next);
      onZoom?.(next > 1.01);
      const el = box.current;
      if (el) {
        x.set(bound(x.get(), el.clientWidth, next));
        y.set(bound(y.get(), el.clientHeight, next));
      }
    },
  });
  useEffect(() => () => onZoom?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      ref={box}
      className="relative size-full touch-pan-y overflow-hidden bg-surface-secondary"
      data-testid="publication-image"
      data-zoom={zoom.toFixed(2)}
      onPointerDown={(e) => {
        if (zoomRef.current <= 1.01 || e.pointerType === "mouse") return;
        e.stopPropagation();
        pan.current = {
          id: e.pointerId,
          x0: e.clientX,
          y0: e.clientY,
          sx: x.get(),
          sy: y.get(),
        };
      }}
      onPointerMove={(e) => {
        const p = pan.current;
        const el = box.current;
        if (!p || p.id !== e.pointerId || !el) return;
        e.stopPropagation();
        x.set(bound(p.sx + e.clientX - p.x0, el.clientWidth, zoomRef.current));
        y.set(bound(p.sy + e.clientY - p.y0, el.clientHeight, zoomRef.current));
      }}
      onPointerUp={() => (pan.current = null)}
      onDoubleClick={() => {
        const next = zoomRef.current > 1.01 ? 1 : 2;
        setZoom(next);
        onZoom?.(next > 1);
        void animate(x, 0, { duration: 0.2 });
        void animate(y, 0, { duration: 0.2 });
      }}
    >
      {src ? (
        <motion.img
          src={src}
          alt=""
          draggable={false}
          className="size-full select-none object-contain"
          style={{ x, y, scale: zoom }}
          onLoad={(e) => onAspect?.(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight))}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-text-tertiary">{isError ? <RiImageFill className="size-6" /> : <Spinner />}</span>
      )}
    </div>
  );
}

/** A video in its own proportions with the player's controls; it plays only while most of it is on screen. */
function FullVideo({ file, onAspect }: { file: Media; onAspect?: (a: number) => void }) {
  const { data: src } = useFileUrl(file.id);
  const ref = useRef<HTMLVideoElement>(null);
  const autoplay = useVibexMe().data?.settings.media.autoplay ?? true;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        if (e.intersectionRatio >= 0.6) {
          if (autoplay) void v.play().catch(() => undefined);
        } else v.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [src, autoplay]);
  return (
    <div className="relative size-full bg-black" data-testid="publication-video">
      {src ? (
        <video
          ref={ref}
          src={src}
          className="size-full object-contain"
          controls
          muted
          playsInline
          loop
          preload="metadata"
          onLoadedMetadata={(e) => onAspect?.(e.currentTarget.videoWidth / Math.max(1, e.currentTarget.videoHeight))}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-white/70">
          <Spinner className="text-white" />
        </span>
      )}
    </div>
  );
}

/** The publication's photos / videos at full width: one, or swiped one by one (dots and a counter), in the first one's proportions. */
function PublicationMedia({ media }: { media: Media[] }) {
  const t = useT();
  const [aspect, setAspect] = useState(1);
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const n = media.length;
  return (
    <div className="relative w-full" style={{ aspectRatio: String(clampAspect(aspect)) }} data-testid="publication-media" data-count={n}>
      <div
        ref={strip}
        className={cx("flex size-full snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", zoomed ? "overflow-hidden" : "overflow-x-auto")}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        data-gesture-owner
      >
        {media.map((m, i) => (
          <div key={m.id} className="size-full shrink-0 snap-center" aria-label={n > 1 ? t("vibex.publications.media", { i: i + 1, n }) : undefined}>
            {m.kind === "video" ? <FullVideo file={m} onAspect={i === 0 ? setAspect : undefined} /> : <ZoomableImage file={m} onAspect={i === 0 ? setAspect : undefined} onZoom={setZoomed} />}
          </div>
        ))}
      </div>
      {n > 1 && (
        <>
          <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-[12px] font-medium tabular-nums text-white" data-testid="publication-counter">
            {index + 1}/{n}
          </span>
          <div className="pointer-events-none absolute inset-x-0 -bottom-5 flex justify-center gap-1" aria-hidden>
            {media.map((m, i) => (
              <span key={m.id} className={cx("size-1.5 rounded-full transition", i === index ? "bg-primary" : "bg-text-tertiary/40")} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Action({ label, onClick, pressed, children, testId }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode; testId: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={pressed} className="flex items-center gap-1.5 rounded-full p-1.5 text-text active:scale-90" data-testid={testId}>
      {children}
    </button>
  );
}

const count = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K` : String(n));

/**
 * One publication, Instagram-like and without a card: the author (with the
 * story ring), the media at full width, ❤ 💬 ↻ … 🔖, the caption after the
 * author's name and the time.
 */
export function PublicationItem({ post, wrapper }: { post: VibexPostDto; wrapper?: VibexPostDto }) {
  const t = useT();
  const lang = useLanguage();
  const push = useVibex((s) => s.push);
  const share = useVibex((s) => s.share);
  const comment = useVibex((s) => s.openComments);
  const action = usePostAction();
  const media = post.media.filter((m): m is Media => m.kind === "image" || m.kind === "video");
  const [more, setMore] = useState(false);
  const long = post.text.length > 140;
  return (
    <article className="flex flex-col" data-testid="publication-item" data-post-id={post.id}>
      <header className="flex items-center gap-3 px-3 py-2.5">
        <StoryHalo personId={post.author.id} onNone={() => push({ kind: "person", id: post.author.id })}>
          <Avatar name={post.author.name} userId={post.author.id} version={post.author.avatarVersion} size={34} />
        </StoryHalo>
        <button type="button" onClick={() => push({ kind: "person", id: post.author.id })} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[14.5px] font-semibold leading-tight text-text">{post.author.name}</span>
          {wrapper && (
            <span className="block truncate text-[12px] text-text-secondary">
              {t("vibex.post.sharedBy")} {wrapper.author.name}
            </span>
          )}
        </button>
        <PostMenu post={post} wrapper={wrapper} />
      </header>
      <PublicationMedia media={media} />
      <div className={cx("flex items-center gap-1 px-2", media.length > 1 ? "pt-6" : "pt-2")}>
        <Action label={t("vibex.post.like")} pressed={post.liked} onClick={() => action.mutate({ post, action: post.liked ? "unlike" : "like" })} testId="publication-like">
          {post.liked ? <RiHeart3Fill className="size-[26px] text-[#e0457b]" /> : <RiHeart3Line className="size-[26px]" />}
          {post.likes > 0 && <span className="text-[14px] font-semibold tabular-nums">{count(post.likes)}</span>}
        </Action>
        <Action label={t("vibex.post.comment")} onClick={() => comment(post.id)} testId="publication-comment">
          <RiChat1Line className="size-[25px]" />
          {post.comments > 0 && <span className="text-[14px] font-semibold tabular-nums">{count(post.comments)}</span>}
        </Action>
        <Action label={t("vibex.post.share")} onClick={() => share(post)} testId="publication-share">
          <ShareGlyph className="size-[24px]" />
          {(post.shares ?? post.reposts) > 0 && <span className="text-[14px] font-semibold tabular-nums">{count(post.shares ?? post.reposts)}</span>}
        </Action>
        <span className="flex-1" />
        <Action
          label={post.bookmarked ? t("vibex.post.unbookmark") : t("vibex.post.bookmark")}
          pressed={post.bookmarked}
          onClick={() =>
            action.mutate({
              post,
              action: post.bookmarked ? "unbookmark" : "bookmark",
            })
          }
          testId="publication-bookmark"
        >
          {post.bookmarked ? <RiBookmarkFill className="size-[25px]" /> : <RiBookmarkLine className="size-[25px]" />}
        </Action>
      </div>
      <div className="px-3.5 pb-1">
        {post.text.trim() && (
          <p className={cx("whitespace-pre-wrap break-words text-[14.5px] leading-snug text-text", !more && long && "line-clamp-2")} data-selectable data-testid="publication-caption">
            <span className="mr-1.5 font-semibold">{post.author.name}</span>
            {post.text}
          </p>
        )}
        {long && !more && (
          <button type="button" onClick={() => setMore(true)} className="text-[14px] text-text-secondary">
            {t("vibex.profile.showText")}
          </button>
        )}
        <p className="mt-1 text-[12.5px] text-text-tertiary">{formatRelative(post.createdAt, lang)}</p>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- lists

type PostsQuery = {
  data?: { pages: { items: VibexPostDto[] }[] };
  isPending: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

/** Publications one after another (no cards, a quiet gap between them), loading more on scroll. */
export function PublicationsList({ query, empty }: { query: PostsQuery; empty?: ReactNode }) {
  const t = useT();
  const items = (query.data?.pages.flatMap((p) => p.items) ?? []).flatMap((p) => {
    const pub = publicationOf(p);
    return pub
      ? [
          {
            key: p.id,
            post: pub.post,
            wrapper: p.kind === "repost" ? p : undefined,
          },
        ]
      : [];
  });
  if (query.isPending) return <Skeleton className="aspect-square w-full rounded-none" />;
  if (!items.length && !query.hasNextPage)
    return <>{empty ?? <EmptyState icon={<RiImageFill className="size-7" />} title={t("vibex.feed.noPublications")} hint={t("vibex.feed.noPublicationsHint")} />}</>;
  return (
    <div className="-mx-3 flex flex-col gap-5 sm:-mx-4" data-testid="publications-list">
      {items.map((i) => (
        <PublicationItem key={i.key} post={i.post} wrapper={i.wrapper} />
      ))}
      <LoadMore active={query.hasNextPage} loading={query.isFetchingNextPage} onMore={() => query.fetchNextPage()} />
    </div>
  );
}

// ---------------------------------------------------------------- grid

/** Instagram-style type marks, white (a soft shadow keeps them readable on light pictures). */
function TypeMark({ kind }: { kind: "photo" | "album" | "video" }) {
  const t = useT();
  return (
    <span
      className="pointer-events-none absolute right-1.5 top-1.5 text-white [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.45))]"
      aria-label={t(kind === "video" ? "vibex.profile.videoMark" : kind === "album" ? "vibex.publications.carouselMark" : "vibex.profile.photoMark")}
      data-testid="publication-mark"
      data-mark={kind}
    >
      {kind === "video" ? (
        <svg viewBox="0 0 24 24" className="size-[19px]" fill="none" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2" />
          <path d="M3.5 8.5h17M9 3.5l3 5M15 3.5l3 5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M10.2 11.6v5.3l4.6-2.65-4.6-2.65Z" fill="currentColor" />
        </svg>
      ) : kind === "album" ? (
        <svg viewBox="0 0 24 24" className="size-[19px]" fill="currentColor" aria-hidden>
          <path d="M8 2.5h9.5A4 4 0 0 1 21.5 6.5V16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4.5a2 2 0 0 1 2-2Z" />
          <path d="M3.5 7.5v10A3.5 3.5 0 0 0 7 21h10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      ) : (
        <RiImageFill className="size-[18px]" aria-hidden />
      )}
    </span>
  );
}

function GridThumb({ file }: { file: Media }) {
  const { data: src } = useFileUrl(file.id);
  if (!src) return <span className="absolute inset-0 bg-surface-secondary" />;
  return file.kind === "video" ? (
    <video src={src} className="absolute inset-0 size-full object-cover" muted playsInline preload="metadata" />
  ) : (
    <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 size-full object-cover" />
  );
}

/**
 * A profile's «Публикации»: equal cells (3:4), three in a row, hairline gaps,
 * inside the same content width as the profile card and the tabs. A tap opens
 * the viewer on that publication.
 */
export function PublicationsGrid({ query, onOpen }: { query: PostsQuery; onOpen: (postId: string) => void }) {
  const items = (query.data?.pages.flatMap((p) => p.items) ?? []).flatMap((p) => {
    const pub = publicationOf(p);
    return pub ? [{ id: p.id, ...pub }] : [];
  });
  return (
    <div className="grid grid-cols-3 gap-[2px] overflow-hidden rounded-[14px]" data-testid="profile-media-grid">
      {items.map(({ id, media }) => {
        const first = media[0]!;
        const kind = first.kind === "video" ? "video" : media.length > 1 ? "album" : "photo";
        return (
          <button
            key={id}
            type="button"
            onClick={() => onOpen(id)}
            className="relative aspect-[3/4] w-full overflow-hidden bg-surface-secondary"
            data-testid="publication-tile"
            data-post-id={id}
            data-kind={first.kind}
          >
            <GridThumb file={first} />
            <TypeMark kind={kind} />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- viewer

/**
 * The viewer that opens from the grid: the person's publications as one feed,
 * starting at the one tapped (scrolled to before the first frame), the rest
 * above and below it. Back returns to the grid where it was (the grid stays
 * mounted underneath).
 */
export function PublicationViewer({ query, startId, title, onClose }: { query: PostsQuery; startId: string; title: string; onClose: () => void }) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-testid="publication-item"][data-post-id="${CSS.escape(startId)}"]`);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - 4;
  }, [startId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <motion.div
      className="vx-app-bg absolute inset-0 z-[45] flex flex-col"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      data-testid="publication-viewer"
      data-start={startId}
    >
      <header className="flex h-[56px] shrink-0 items-center gap-2 px-2">
        <IconButton label={t("common.back")} onClick={onClose} data-testid="publication-viewer-back">
          <RiArrowLeftLine className="size-5" />
        </IconButton>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[16px] font-bold leading-tight">{t("vibex.publications.title")}</p>
          <p className="truncate text-[12px] text-text-secondary">{title}</p>
        </div>
        <span className="size-10" />
      </header>
      <div ref={scroller} className="scroll-area relative flex-1 overflow-y-auto pb-24">
        <div className="mx-auto w-full max-w-[640px] px-3 sm:px-4">
          <PublicationsList query={query} />
        </div>
      </div>
    </motion.div>
  );
}

/** The viewer for the whole Vibex window (over the tabs and pages), opened from a profile's grid. */
export function PublicationViewerHost() {
  const pub = useVibex((s) => s.publication);
  const close = useVibex((s) => s.openPublication);
  return <AnimatePresence>{pub && <ViewerFor key={`${pub.userId}:${pub.postId}`} {...pub} onClose={() => close(null)} />}</AnimatePresence>;
}

function ViewerFor({ userId, postId, title, onClose }: { userId: string; postId: string; title: string; onClose: () => void }) {
  const q = usePersonPublications(userId);
  return <PublicationViewer query={q} startId={postId} title={title} onClose={onClose} />;
}
