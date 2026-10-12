import { useEffect, useMemo, useRef } from "react";
import { RiHeart3Line } from "@remixicon/react";
import type { VibexActivityDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { formatRelative, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { EmptyState, Skeleton, Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { openDirect, queryActivityAfterFollow, readActivity, useActivity, useActivityCount, useFileUrl, useFollow } from "./data";
import { useVibex } from "./store";

/**
 * Step 2.10 — the Vibex activity tab («Уведомления», Instagram-like; not the
 * system Notification Center): new followers, likes, reposts, comments,
 * being added to a group, a followed person's new post or story. Grouped by
 * time (Актуальное / Вчера / Последние 7 дней / Более ранние). Opening the
 * tab reads everything on the server (every device sees it), and new items
 * arrive in real time (the "vibex.activity" event, never polled).
 */

type Section = "today" | "yesterday" | "week" | "earlier";
const SECTION_LABEL: Record<Section, MessageKey> = {
  today: "vibex.activity.today",
  yesterday: "vibex.activity.yesterday",
  week: "vibex.activity.week",
  earlier: "vibex.activity.earlier",
};

/** Which time section an item belongs to (by local calendar days). */
export function activitySection(iso: string, now = new Date()): Section {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = new Date(iso).getTime();
  if (at >= day) return "today";
  if (at >= day - 86_400_000) return "yesterday";
  if (at >= day - 7 * 86_400_000) return "week";
  return "earlier";
}

/** Likes and reposts of the same post in the same section read as one line ("A and 2 more …"). */
interface Group {
  key: string;
  items: VibexActivityDto[];
}
function group(items: VibexActivityDto[]): Group[] {
  const out: Group[] = [];
  for (const it of items) {
    const prev = out.at(-1);
    const head = prev?.items[0];
    if (prev && head && (it.type === "like" || it.type === "repost") && head.type === it.type && head.postId === it.postId) prev.items.push(it);
    else out.push({ key: it.id, items: [it] });
  }
  return out;
}

const TEXT: Record<VibexActivityDto["type"], MessageKey> = {
  follow: "vibex.activity.follow",
  like: "vibex.activity.like",
  repost: "vibex.activity.repost",
  comment: "vibex.activity.comment",
  reply: "vibex.activity.reply",
  group: "vibex.activity.group",
  post: "vibex.activity.post",
  story: "vibex.activity.story",
};

export function ActivityScreen() {
  const t = useT();
  const q = useActivity();
  const unread = useActivityCount().data?.unread ?? 0;
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const more = useRef<HTMLDivElement>(null);

  // Open = read (on the server; the badge clears on every device). New items while it is open are read too.
  useEffect(() => {
    if (unread > 0) void readActivity().catch(() => undefined);
  }, [unread]);

  useEffect(() => {
    const el = more.current;
    if (!el || !q.hasNextPage) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && !q.isFetchingNextPage && void q.fetchNextPage(), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage, q]);

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (!items.length) return <EmptyState icon={<RiHeart3Line className="size-7" />} title={t("vibex.activity.empty")} hint={t("vibex.activity.emptyHint")} />;

  const sections = (["today", "yesterday", "week", "earlier"] as Section[])
    .map((s) => ({ s, groups: group(items.filter((it) => activitySection(it.createdAt) === s)) }))
    .filter((x) => x.groups.length);
  return (
    <div className="flex flex-col gap-4" data-testid="activity-screen">
      {sections.map(({ s, groups }) => (
        <section key={s} className="flex flex-col" data-testid="activity-section" data-section={s}>
          <h3 className="px-2 pb-1 text-[15px] font-bold">{t(SECTION_LABEL[s])}</h3>
          {groups.map((g) => (
            <ActivityRow key={g.key} items={g.items} />
          ))}
        </section>
      ))}
      <div ref={more} className="flex justify-center py-2">
        {q.isFetchingNextPage && <Spinner />}
      </div>
    </div>
  );
}

function ActivityRow({ items }: { items: VibexActivityDto[] }) {
  const t = useT();
  const lang = useLanguage();
  const push = useVibex((s) => s.push);
  const openChat = useVibex((s) => s.openChat);
  const openComments = useVibex((s) => s.openComments);
  const it = items[0]!;
  const others = items.length - 1;
  const open = () => {
    if (it.chatId) return openChat(it.chatId);
    if (it.postId) {
      push({ kind: "post", id: it.postId });
      if (it.type === "comment" || it.type === "reply") openComments(it.postId);
      return;
    }
    push({ kind: "person", id: it.actor.id });
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}
      className={cx("flex cursor-pointer items-center gap-3 rounded-[18px] px-2 py-2 hover:bg-surface-hover", !it.read && "bg-primary/[0.06]")}
      data-testid="activity-item"
      data-type={it.type}
      data-read={it.read || undefined}
    >
      <span className={cx("relative shrink-0", others > 0 ? "h-11 w-12" : "size-11")}>
        {others > 0 ? (
          <>
            <span className="absolute left-0 top-0 rounded-full ring-2 ring-surface">
              <Avatar name={items[1]!.actor.name} userId={items[1]!.actor.id} version={items[1]!.actor.avatarVersion} size={32} />
            </span>
            <span className="absolute bottom-0 right-0 rounded-full ring-2 ring-surface">
              <Avatar name={it.actor.name} userId={it.actor.id} version={it.actor.avatarVersion} size={32} />
            </span>
          </>
        ) : (
          <span className={cx("block rounded-full", it.type === "story" && "p-[2px] [background:conic-gradient(from_180deg,#7f72ff,#c06cff,#ff7ab6,#7f72ff)]")}>
            <span className="block rounded-full bg-surface p-[1px]">
              <Avatar name={it.actor.name} userId={it.actor.id} version={it.actor.avatarVersion} size={it.type === "story" ? 38 : 44} />
            </span>
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 text-[14px] leading-snug">
        <span className="font-semibold">{it.actor.name}</span>
        {others > 0 && <span> {t("vibex.activity.andMore", { n: others })}</span>} <span className="text-text">{t(TEXT[it.type], { title: it.chatTitle ?? "" })}</span>
        {(it.type === "comment" || it.type === "reply") && it.postText && <span className="text-text-secondary"> «{it.postText.slice(0, 60)}»</span>}{" "}
        <span className="whitespace-nowrap text-text-tertiary">{formatRelative(it.createdAt, lang)}</span>
      </span>
      {it.type === "follow" ? <FollowBack item={it} /> : it.postMedia ? <Thumb fileId={it.postMedia.fileId} video={it.postMedia.kind === "video"} /> : null}
    </div>
  );
}

/** «Подписаться» for someone who followed me (I don't follow them yet), «Сообщение» once I do. */
function FollowBack({ item }: { item: VibexActivityDto }) {
  const t = useT();
  const follow = useFollow(item.actor.id);
  const openChat = useVibex((s) => s.openChat);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (!item.following) {
    return (
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          follow.mutate(true, { onSuccess: queryActivityAfterFollow, onError: (err) => toast({ title: errorMessage(t, err), tone: "danger" }) });
        }}
        disabled={follow.isPending}
        className="h-9 shrink-0 rounded-[12px] bg-primary px-4 text-[14px] font-semibold text-white disabled:opacity-60"
        data-testid="activity-follow"
      >
        {t("vibex.activity.followBack")}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        void openDirect(item.actor.id).then(
          (c) => openChat(c.id),
          (err) => toast({ title: errorMessage(t, err), tone: "danger" }),
        );
      }}
      className="h-9 shrink-0 rounded-[12px] bg-surface-secondary px-4 text-[14px] font-semibold text-text"
      data-testid="activity-message"
    >
      {t("vibex.activity.message")}
    </button>
  );
}

function Thumb({ fileId, video }: { fileId: string; video: boolean }) {
  const { data: src } = useFileUrl(fileId);
  return (
    <span className="size-11 shrink-0 overflow-hidden rounded-[8px] bg-surface-secondary" data-testid="activity-thumb">
      {src && (video ? <video src={src} muted playsInline preload="metadata" className="size-full object-cover" /> : <img src={src} alt="" loading="lazy" className="size-full object-cover" />)}
    </span>
  );
}
