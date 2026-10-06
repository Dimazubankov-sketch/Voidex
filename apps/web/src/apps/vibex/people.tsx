import { useState } from "react";
import { RiBookmarkLine, RiHeart3Line, RiLockLine, RiUserSearchLine } from "@remixicon/react";
import type { VibexPersonDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { EmptyState, Skeleton, Spinner } from "@/ui/controls";
import { useChats, useHistory, usePeople, usePost, type HistoryKind } from "./data";
import { LoadMore, PostCard, UnavailablePost } from "./posts";
import { useVibex } from "./store";
import { VoidexSearchField } from "@/ui/search-field";

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

export function PeopleSection() {
  const t = useT();
  const [q, setQ] = useState("");
  const query = q.trim();
  const people = usePeople(query);
  const chats = useChats();
  const recent = (chats.data ?? []).flatMap((c) => (c.peer ? [c.peer] : []));
  return (
    <div className="flex flex-col gap-3">
      <VoidexSearchField
        size="lg"
        autoFocus
        value={q}
        onChange={setQ}
        placeholder={t("vibex.people.search")}
        testId="people-search"
        trailing={people.isFetching ? <Spinner size={14} /> : undefined}
      />
      {query ? (
        people.data && !people.data.length ? (
          <EmptyState icon={<RiUserSearchLine className="size-7" />} title={t("vibex.people.empty")} />
        ) : (
          <div className="flex flex-col rounded-2xl border border-border bg-surface p-1.5 shadow-tile" data-testid="people-results">
            {(people.data ?? []).map((p) => (
              <PersonRow key={p.id} person={p} />
            ))}
          </div>
        )
      ) : recent.length ? (
        <>
          <div className="px-2 pt-1 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{t("vibex.people.recent")}</div>
          <div className="flex flex-col rounded-2xl border border-border bg-surface p-1.5 shadow-tile">
            {recent.map((p) => (
              <PersonRow key={p.id} person={p} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState icon={<RiUserSearchLine className="size-7" />} title={t("vibex.people.title")} hint={t("vibex.people.hint")} />
      )}
    </div>
  );
}

export function PostPage({ id }: { id: string }) {
  const post = usePost(id);
  if (post.isPending) return <Skeleton className="h-48 rounded-2xl" />;
  if (!post.data) return <UnavailablePost />;
  return <PostCard post={post.data} />;
}

/** History (posts I liked) or Bookmarks (private) — separate sections of the side menu. */
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
