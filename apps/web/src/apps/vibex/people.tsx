import { useState } from "react";
import { RiBookmarkLine, RiChat1Line, RiEditLine, RiHeart3Line, RiLockLine, RiSearchLine, RiUserSearchLine } from "@remixicon/react";
import type { VibexPersonDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { EmptyState, Skeleton, Spinner } from "@/ui/controls";
import { useWM } from "@/os/window-manager";
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
      <label className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-surface px-4 shadow-tile">
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

/** Voyzen profile: cover, avatar over it, actions, name and email, Posts / Reposts. */
function ProfileHeader({ person, posts, me }: { person: VibexPersonDto; posts: number; me: boolean }) {
  const t = useT();
  const openChat = useVibex((s) => s.openChat);
  const [busy, setBusy] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-tile" data-testid="profile-header">
      <div className="h-32 w-full" style={{ background: COVER }} aria-hidden data-system-ui />
      <div className="px-5 pb-4">
        <div className="-mt-10 flex items-end justify-between gap-2">
          <span className="inline-flex rounded-full border-4 border-surface">
            <Avatar name={person.name} userId={person.id} version={person.avatarVersion} size={80} />
          </span>
          <div className="mb-1 flex gap-2">
            {me ? (
              <OutlineButton icon={<RiEditLine className="size-4" />} onClick={() => useWM.getState().open("settings", { params: { section: "account" } })} testId="profile-edit">
                {t("vibex.profile.edit")}
              </OutlineButton>
            ) : (
              <OutlineButton
                icon={busy ? <Spinner size={14} /> : <RiChat1Line className="size-4" />}
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
                testId="person-write"
              >
                {t("vibex.person.write")}
              </OutlineButton>
            )}
          </div>
        </div>
        <div className="mt-3">
          <h1 className="text-[20px] font-bold text-text">{person.name}</h1>
          <p className="text-[14px] text-text-secondary" data-selectable data-testid="profile-email">
            {person.address}
          </p>
        </div>
        <p className="mt-3 text-[14px] text-text-secondary">
          <span className="font-bold text-text">{posts}</span> {t("vibex.profile.postsCount")}
        </p>
      </div>
    </div>
  );
}

/** Soft VOIDEX cover (no stock photos): milk and two violets. */
const COVER = "radial-gradient(80% 120% at 85% 0%, #cbbffb 0%, rgba(203,191,251,0) 60%), radial-gradient(60% 90% at 10% 100%, #e6dffb 0%, rgba(230,223,251,0) 70%), #f6f4fc";

function OutlineButton({ icon, children, onClick, testId }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[14px] font-medium text-text transition hover:bg-surface-hover" data-testid={testId}>
      {icon}
      {children}
    </button>
  );
}

export function PersonPage({ id }: { id: string }) {
  const t = useT();
  const profile = useProfile(id);
  const posts = usePersonPosts(id);
  const [tab, setTab] = useState<"posts" | "reposts">("posts");
  if (profile.isError) return <EmptyState icon={<RiUserSearchLine className="size-7" />} title={t("vibex.person.unavailable")} />;
  const all = posts.data?.pages.flatMap((p) => p.items) ?? [];
  const shown = all.filter((p) => (tab === "posts" ? p.kind === "post" : p.kind === "repost"));
  const filtered = posts.data ? { ...posts, data: { ...posts.data, pages: [{ items: shown, next: null }] } } : posts;
  return (
    <div className="flex flex-col gap-3" data-testid="person-page">
      {profile.data ? <ProfileHeader person={profile.data.person} posts={profile.data.posts} me={profile.data.me} /> : <Skeleton className="h-[260px] rounded-2xl" />}
      <div className="sticky top-0 z-10 flex rounded-2xl border border-border bg-surface/95 backdrop-blur" role="tablist">
        {(["posts", "reposts"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx("relative flex-1 py-3 text-[14px] font-semibold transition", tab === k ? "text-text" : "text-text-secondary hover:text-text")}
            data-testid={`profile-tab-${k}`}
          >
            {t(k === "posts" ? "vibex.profile.posts" : "vibex.profile.reposts")}
            {tab === k && <span className="absolute inset-x-8 bottom-0 h-1 rounded-full bg-primary" />}
          </button>
        ))}
      </div>
      {profile.data?.me && tab === "posts" && <ComposerPrompt />}
      <PostList
        query={{ ...filtered, hasNextPage: posts.hasNextPage, isFetchingNextPage: posts.isFetchingNextPage, fetchNextPage: posts.fetchNextPage }}
        empty={<FeedEmpty mine={profile.data?.me} reposts={tab === "reposts"} />}
      />
    </div>
  );
}

export function MePage() {
  const me = useSession((s) => s.user)!;
  return <PersonPage id={me.id} />;
}

export function PostPage({ id }: { id: string }) {
  const post = usePost(id);
  if (post.isPending) return <Skeleton className="h-48 rounded-2xl" />;
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
      <div className="flex rounded-2xl border border-border bg-surface p-1" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={kind === tab.id}
            onClick={() => setKind(tab.id)}
            className={cx(
              "flex h-10 flex-1 items-center justify-center gap-2 rounded-[14px] text-[14px] font-semibold transition-colors",
              kind === tab.id ? "bg-primary text-white" : "text-text-secondary hover:text-text",
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
