import { RiBookmarkLine, RiHeart3Line, RiLockLine, RiUserSearchLine } from "@remixicon/react";
import type { VibexPersonDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { EmptyState, Skeleton } from "@/ui/controls";
import { useHistory, usePeople, usePost, type HistoryKind } from "./data";
import { LoadMore, PostCard, UnavailablePost } from "./posts";
import { useVibex } from "./store";
import { cx } from "@/lib/cx";

function PersonRow({ person }: { person: VibexPersonDto }) {
  const push = useVibex((s) => s.push);
  return (
    <button
      type="button"
      onClick={() => push({ kind: "person", id: person.id })}
      className="pressable flex w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-left hover:bg-surface-hover"
      data-testid="person-row"
    >
      <Avatar name={person.name} userId={person.id} version={person.avatarVersion} size={46} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{person.name}</span>
        <span className="block truncate text-[13px] text-text-tertiary">{person.address}</span>
      </span>
    </button>
  );
}

/** People found by name or @voidops address (Step 2.9: also under the feed's own search). */
export function PeopleResults({ query }: { query: string }) {
  const t = useT();
  const people = usePeople(query);
  if (people.isPending) return <Skeleton className="h-32 rounded-2xl" />;
  if (!people.data?.length) return <EmptyState icon={<RiUserSearchLine className="size-7" />} title={t("vibex.people.empty")} />;
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-1.5 shadow-tile" data-testid="people-results">
      {people.data.map((p) => (
        <PersonRow key={p.id} person={p} />
      ))}
    </div>
  );
}

export function PostPage({ id }: { id: string }) {
  const post = usePost(id);
  if (post.isPending) return <Skeleton className="h-48 rounded-2xl" />;
  if (!post.data) return <UnavailablePost />;
  return <PostCard post={post.data} />;
}

/**
 * Step 2.9 «История»: one screen of my activity with two tabs — «Понравившиеся»
 * (posts I liked) and «Закладки» (private bookmarks; nothing of them was lost,
 * they just moved here from their own side-menu item).
 */
export function HistoryScreen() {
  const t = useT();
  const kind = useVibex((s) => s.historyKind);
  const setKind = useVibex((s) => s.setHistoryKind);
  return (
    <div className="flex flex-col gap-3" data-testid="history-screen" data-kind={kind}>
      <div className="mx-auto flex rounded-full border border-border/60 bg-surface p-1 shadow-tile" role="tablist" aria-label={t("vibex.nav.history")}>
        {(["liked", "bookmarks"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cx("flex h-9 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition", kind === k ? "bg-primary text-white" : "text-text-secondary hover:text-text")}
            data-testid={`history-tab-${k}`}
          >
            {k === "liked" ? <RiHeart3Line className="size-4" /> : <RiBookmarkLine className="size-4" />}
            {t(k === "liked" ? "vibex.history.liked" : "vibex.history.bookmarks")}
          </button>
        ))}
      </div>
      <HistorySection kind={kind} key={kind} />
    </div>
  );
}

/** One tab of «История»: liked posts or private bookmarks. */
export function HistorySection({ kind }: { kind: HistoryKind }) {
  const t = useT();
  const lang = useLanguage();
  const q = useHistory(kind);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-3" data-testid={kind === "liked" ? "history" : "bookmarks"}>
      {kind === "bookmarks" && (
        <div className="flex items-center gap-1.5 px-2 text-[12px] text-text-tertiary">
          <RiLockLine className="size-3.5" /> {t("vibex.history.private")}
        </div>
      )}
      {q.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !items.length ? (
        <EmptyState
          icon={kind === "liked" ? <RiHeart3Line className="size-7" /> : <RiBookmarkLine className="size-7" />}
          title={kind === "liked" ? t("vibex.history.emptyLiked") : t("vibex.history.emptyBookmarks")}
        />
      ) : (
        <div className="flex flex-col gap-3" data-testid="history-list">
          {items.map((i) =>
            i.post ? (
              <PostCard key={`${i.postId}`} post={i.post} />
            ) : (
              <div key={i.postId} className="rounded-2xl border border-border bg-surface p-4 shadow-tile">
                <UnavailablePost />
                <div className="mt-2 text-center text-[12px] text-text-tertiary">{formatRelative(i.at, lang)}</div>
              </div>
            ),
          )}
          <LoadMore active={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => void q.fetchNextPage()} />
        </div>
      )}
    </div>
  );
}
