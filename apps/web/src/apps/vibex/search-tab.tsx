import { useEffect, useRef, useState } from "react";
import { RiImageLine, RiPlayFill, RiSearchLine, RiStackLine } from "@remixicon/react";
import type { VibexPersonDto, VibexPostDto, VibexSearchDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { useT } from "@/lib/i18n";
import { EmptyState, Skeleton, Spinner } from "@/ui/controls";
import { VoidexSearchField } from "@/ui/search-field";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { toast } from "@/ui/overlays";
import { useExplore, useFileUrl, useFollow, useVibexSearch } from "./data";
import { useVibex } from "./store";

/**
 * Step 2.10 / 2.11: the Search tab (Instagram-like, in Vibex's look).
 *
 * A large field on top. Empty: a grid of everyone's public photos and videos
 * (real posts, newest first, loaded as it scrolls). Typing: people only (an
 * exact @username / address on top, then names), each with its follow
 * button. Cleared: the grid again. A tap opens the person / the post.
 */
export function SearchScreen() {
  const t = useT();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 220);
    return () => window.clearTimeout(id);
  }, [q]);
  return (
    <div className="flex flex-col gap-3" data-testid="search-screen">
      <VoidexSearchField size="lg" value={q} onChange={setQ} placeholder={t("vibex.search.placeholder")} testId="people-search" />
      {debounced ? <SearchResults q={debounced} /> : <ExploreGrid />}
    </div>
  );
}

/** Step 2.11: while typing, only people (avatar, name, @voidops address, follow state); no posts. */
function SearchResults({ q }: { q: string }) {
  const t = useT();
  const res = useVibexSearch(q);
  if (res.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 rounded-2xl" />
        ))}
      </div>
    );
  }
  const people = res.data?.people ?? [];
  const following = new Set(res.data?.following ?? []);
  if (!people.length) return <EmptyState icon={<RiSearchLine className="size-7" />} title={t("vibex.people.empty")} />;
  return (
    <section className="flex flex-col" data-testid="search-results">
      <div className="flex flex-col" data-testid="search-people">
        {people.map((p) => (
          <PersonResult key={p.id} person={p} q={q} followed={following.has(p.id)} />
        ))}
      </div>
    </section>
  );
}

function PersonResult({ person: p, q, followed }: { person: VibexPersonDto; q: string; followed: boolean }) {
  const t = useT();
  const me = useSession((s) => s.user?.id);
  const push = useVibex((s) => s.push);
  const follow = useFollow(p.id);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const on = !followed;
    // Optimistic: the button changes at once; the list keeps the server's answer.
    const key = ["vibex", "search", q] as const;
    const set = (v: boolean) =>
      queryClient.setQueryData<VibexSearchDto>(key, (d) => d && { ...d, following: v ? [...new Set([...(d.following ?? []), p.id])] : (d.following ?? []).filter((x) => x !== p.id) });
    set(on);
    follow.mutate(on, { onError: (err) => (set(!on), toast({ title: errorMessage(t, err), tone: "danger" })) });
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => push({ kind: "person", id: p.id })}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), push({ kind: "person", id: p.id }))}
      className="pressable flex w-full cursor-pointer items-center gap-3 rounded-[20px] px-2 py-2 text-left hover:bg-surface-hover"
      data-testid="person-row"
      data-person-id={p.id}
      data-following={followed || undefined}
    >
      <Avatar name={p.name} userId={p.id} version={p.avatarVersion} size={48} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{p.name}</span>
        <span className="block truncate text-[13px] text-text-secondary">{p.address}</span>
      </span>
      {p.id !== me && (
        <button
          type="button"
          onClick={toggle}
          disabled={follow.isPending}
          className={cx(
            "h-9 shrink-0 rounded-[12px] px-4 text-[14px] font-semibold transition-colors disabled:opacity-60",
            followed ? "bg-surface-secondary text-text" : "bg-primary text-white",
          )}
          data-testid="person-follow"
        >
          {t(followed ? "vibex.search.followingShort" : "vibex.profile.follow")}
        </button>
      )}
    </div>
  );
}

/** Everyone's public photos and videos (real posts), three to a row, loaded as it scrolls. */
function ExploreGrid() {
  const t = useT();
  const q = useExplore();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || !q.hasNextPage) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && !q.isFetchingNextPage && void q.fetchNextPage(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage, q]);
  if (q.isPending) {
    return (
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-[6px]" />
        ))}
      </div>
    );
  }
  if (!items.length) return <EmptyState icon={<RiImageLine className="size-7" />} title={t("vibex.search.exploreEmpty")} hint={t("vibex.search.exploreHint")} />;
  return (
    <>
      <div className="grid grid-cols-3 gap-1" data-testid="explore-grid">
        {items.map((p) => (
          <PostTile key={p.id} post={p} />
        ))}
      </div>
      <div ref={more} className="flex justify-center py-3">
        {q.isFetchingNextPage && <Spinner />}
      </div>
    </>
  );
}

/** One post in a grid: its first picture / video (lazy, metadata only), or its text. */
function PostTile({ post }: { post: VibexPostDto }) {
  const push = useVibex((s) => s.push);
  const first = post.media.find((f) => f.kind === "image" || f.kind === "video");
  const box = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const { data: src } = useFileUrl(near && first ? first.id : null);
  return (
    <button
      ref={box}
      type="button"
      onClick={() => push({ kind: "post", id: post.id })}
      className="relative aspect-square overflow-hidden rounded-[6px] bg-surface-secondary"
      aria-label={post.text.slice(0, 80) || post.author.name}
      data-testid="explore-tile"
      data-post-id={post.id}
    >
      {first ? (
        src ? (
          first.kind === "video" ? (
            <video src={src} muted playsInline preload="metadata" className="size-full object-cover" />
          ) : (
            <img src={src} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
          )
        ) : null
      ) : (
        <span className="line-clamp-5 p-2 text-left text-[12px] leading-snug text-text-secondary">{post.text}</span>
      )}
      {first?.kind === "video" && <RiPlayFill className="absolute right-1.5 top-1.5 size-5 text-white drop-shadow" aria-hidden />}
      {post.media.length > 1 && <RiStackLine className="absolute right-1.5 top-1.5 size-4 text-white drop-shadow" aria-hidden />}
    </button>
  );
}
