import { useState } from "react";
import { RiBookmarkLine, RiChat3Line, RiHeart3Line, RiLockLine, RiSearchLine, RiUserSearchLine } from "@remixicon/react";
import type { VibexPersonDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Button, EmptyState, Skeleton, Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { openDirect, useChats, useHistory, usePeople, usePersonPosts, usePost, useProfile, type HistoryKind } from "./data";
import { ComposerPrompt, FeedEmpty, LoadMore, PostCard, PostList, UnavailablePost } from "./posts";
import { useVibex } from "./store";

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
  const recent = (chats.data ?? []).map((c) => c.peer);
  return (
    <div className="flex flex-col gap-3">
      <label className="vx-glass-strong flex h-12 items-center gap-2 rounded-[18px] px-4">
        <RiSearchLine className="size-5 shrink-0 text-text-tertiary" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("vibex.people.search")}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-tertiary"
          data-testid="people-search"
        />
        {people.isFetching && <Spinner size={14} />}
      </label>
      {query ? (
        people.data && !people.data.length ? (
          <EmptyState icon={<RiUserSearchLine className="size-7" />} title={t("vibex.people.empty")} />
        ) : (
          <div className="flex flex-col rounded-[24px] bg-surface p-1.5 shadow-tile" data-testid="people-results">
            {(people.data ?? []).map((p) => (
              <PersonRow key={p.id} person={p} />
            ))}
          </div>
        )
      ) : recent.length ? (
        <>
          <div className="px-2 pt-1 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{t("vibex.people.recent")}</div>
          <div className="flex flex-col rounded-[24px] bg-surface p-1.5 shadow-tile">
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

function ProfileHeader({ person, posts, me }: { person: VibexPersonDto; posts: number; me: boolean }) {
  const t = useT();
  const openChat = useVibex((s) => s.openChat);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3 rounded-[28px] bg-surface px-5 pb-5 pt-6 text-center shadow-tile" data-testid="profile-header">
      <Avatar name={person.name} userId={person.id} version={person.avatarVersion} size={92} />
      <div className="min-w-0">
        <div className="text-[21px] font-semibold tracking-tight">{person.name}</div>
        <div className="text-[14px] text-text-tertiary" data-selectable>
          {person.address}
        </div>
      </div>
      <div className="text-[13px] text-text-secondary">{t("vibex.person.posts", { count: posts })}</div>
      {!me && (
        <Button
          icon={<RiChat3Line className="size-5" />}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const chat = await openDirect(person.id);
              openChat(chat.id);
            } catch (e) {
              toast({ title: errorMessage(t, e), tone: "danger" });
            } finally {
              setBusy(false);
            }
          }}
          data-testid="person-write"
        >
          {t("vibex.person.write")}
        </Button>
      )}
    </div>
  );
}

export function PersonPage({ id }: { id: string }) {
  const t = useT();
  const profile = useProfile(id);
  const posts = usePersonPosts(id);
  if (profile.isError) return <EmptyState icon={<RiUserSearchLine className="size-7" />} title={t("vibex.person.unavailable")} />;
  return (
    <div className="flex flex-col gap-3" data-testid="person-page">
      {profile.data ? <ProfileHeader person={profile.data.person} posts={profile.data.posts} me={profile.data.me} /> : <Skeleton className="h-[230px] rounded-[28px]" />}
      {profile.data?.me && <ComposerPrompt />}
      <PostList query={posts} empty={<FeedEmpty mine={profile.data?.me} />} />
    </div>
  );
}

export function MePage() {
  const me = useSession((s) => s.user)!;
  return <PersonPage id={me.id} />;
}

export function PostPage({ id }: { id: string }) {
  const post = usePost(id);
  if (post.isPending) return <Skeleton className="h-48 rounded-[24px]" />;
  if (!post.data) return <UnavailablePost />;
  return <PostCard post={post.data} />;
}

export function HistorySection() {
  const t = useT();
  const lang = useLanguage();
  const kind = useVibex((s) => s.historyKind);
  const setKind = useVibex((s) => s.setHistoryKind);
  const q = useHistory(kind);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const tabs: { id: HistoryKind; label: string; icon: React.ReactNode }[] = [
    { id: "liked", label: t("vibex.history.liked"), icon: <RiHeart3Line className="size-[18px]" /> },
    { id: "bookmarks", label: t("vibex.history.bookmarks"), icon: <RiBookmarkLine className="size-[18px]" /> },
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="history">
      <div className="vx-glass-strong flex rounded-[18px] p-1" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={kind === tab.id}
            onClick={() => setKind(tab.id)}
            className={cx(
              "flex h-10 flex-1 items-center justify-center gap-2 rounded-[14px] text-[14px] font-semibold transition-colors",
              kind === tab.id ? "bg-surface text-text shadow-tile" : "text-text-secondary hover:text-text",
            )}
            data-testid={`history-${tab.id}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      {kind === "bookmarks" && (
        <div className="flex items-center gap-1.5 px-2 text-[12px] text-text-tertiary">
          <RiLockLine className="size-3.5" /> {t("vibex.history.private")}
        </div>
      )}
      {q.isPending ? (
        <Skeleton className="h-40 rounded-[24px]" />
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
              <div key={i.postId} className="rounded-[24px] bg-surface p-4 shadow-tile">
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
