import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  RiBookmarkFill,
  RiBookmarkLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiHeart3Fill,
  RiHeart3Line,
  RiImageAddLine,
  RiLinkM,
  RiMoreFill,
  RiRepeat2Line,
  RiShareForwardLine,
} from "@remixicon/react";
import { VIBEX_FILES_MAX, VIBEX_POST_IMAGE_TYPES, VIBEX_POST_MAX, type VibexFileDto, type VibexPersonDto, type VibexPostDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Button, EmptyState, IconButton, Skeleton, Spinner } from "@/ui/controls";
import { ConfirmDialog, MenuList, Popover, Sheet, toast, usePopover, type MenuItem } from "@/ui/overlays";
import { checkVibexFile, filesApi, postLink, useCreatePost, useDeletePost, usePostAction, useRepost } from "./data";
import { MediaGrid, VibexImage } from "./media";
import { useVibex } from "./store";

// ------------------------------------------------------------------ pieces

function PersonLine({ person, at, note, size = 42 }: { person: VibexPersonDto; at: string; note?: string; size?: number }) {
  const lang = useLanguage();
  const push = useVibex((s) => s.push);
  return (
    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => push({ kind: "person", id: person.id })} data-testid="post-author">
      <Avatar name={person.name} userId={person.id} version={person.avatarVersion} size={size} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[15px] font-semibold text-text">{person.name}</span>
          {note && <span className="shrink-0 text-[14px] text-text-secondary">{note}</span>}
        </span>
        <span className="block truncate text-[13px] text-text-tertiary">
          @{person.handle} · {formatRelative(at, lang)}
        </span>
      </span>
    </button>
  );
}

function PostText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.45] text-text" data-selectable>
      {text}
    </p>
  );
}

function Count({ n }: { n: number }) {
  return n > 0 ? <span className="min-w-3 text-[13px] font-medium tabular-nums">{n}</span> : null;
}

/** Like / share / bookmark — always about the original post. */
function PostActions({ post }: { post: VibexPostDto }) {
  const t = useT();
  const action = usePostAction();
  const share = useVibex((s) => s.share);
  return (
    <div className="-mx-2 flex items-center gap-1 pt-1">
      <button
        type="button"
        onClick={() => action.mutate({ post, action: post.liked ? "unlike" : "like" })}
        className={cx("pressable flex h-9 items-center gap-1.5 rounded-full px-2.5", post.liked ? "text-[#e0457b]" : "text-text-secondary hover:bg-surface-hover")}
        aria-pressed={post.liked}
        aria-label={t("vibex.post.like")}
        title={t("vibex.post.like")}
        data-testid="post-like"
      >
        <motion.span key={String(post.liked)} initial={post.liked ? { scale: 0.6 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 14 }}>
          {post.liked ? <RiHeart3Fill className="size-5" /> : <RiHeart3Line className="size-5" />}
        </motion.span>
        <Count n={post.likes} />
      </button>
      <button
        type="button"
        onClick={() => share(post)}
        className={cx("pressable flex h-9 items-center gap-1.5 rounded-full px-2.5 hover:bg-surface-hover", post.reposted ? "text-primary" : "text-text-secondary")}
        aria-label={t("vibex.post.share")}
        title={t("vibex.post.share")}
        data-testid="post-share"
      >
        <RiShareForwardLine className="size-5" />
        <Count n={post.reposts} />
      </button>
      <span className="flex-1" />
      <IconButton
        label={post.bookmarked ? t("vibex.post.unbookmark") : t("vibex.post.bookmark")}
        size="sm"
        active={post.bookmarked}
        onClick={() => action.mutate({ post, action: post.bookmarked ? "unbookmark" : "bookmark" })}
        data-testid="post-bookmark"
      >
        {post.bookmarked ? <RiBookmarkFill className="size-[18px]" /> : <RiBookmarkLine className="size-[18px]" />}
      </IconButton>
    </div>
  );
}

function PostMenu({ post, wrapper }: { post: VibexPostDto; wrapper?: VibexPostDto }) {
  const t = useT();
  const pop = usePopover();
  const del = useDeletePost();
  const repost = useRepost();
  const [confirm, setConfirm] = useState(false);
  const items: MenuItem[] = [
    {
      id: "copy-link",
      label: t("vibex.share.copyLink"),
      icon: <RiLinkM className="size-5" />,
      onSelect: () => {
        void navigator.clipboard?.writeText(postLink(post.id)).catch(() => undefined);
        toast({ title: t("vibex.share.copied"), tone: "success" });
      },
    },
  ];
  if (wrapper?.mine) {
    items.push({
      id: "unrepost",
      label: t("vibex.post.undoRepost"),
      icon: <RiRepeat2Line className="size-5" />,
      onSelect: () => repost.mutate({ id: post.id, on: false }),
    });
  } else if (post.mine) {
    items.push({ id: "delete-post", label: t("vibex.post.delete"), icon: <RiDeleteBinLine className="size-5" />, danger: true, onSelect: () => setConfirm(true) });
  }
  return (
    <>
      <IconButton ref={pop.anchor} label={t("vibex.post.more")} size="sm" onClick={pop.toggle} data-testid="post-menu">
        <RiMoreFill className="size-5" />
      </IconButton>
      <Popover open={pop.open} onClose={pop.close} anchor={pop.anchor} width={250}>
        <MenuList items={items} onDone={pop.close} />
      </Popover>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("vibex.post.deleteConfirm")}
        message={t("vibex.post.deleteHint")}
        confirmLabel={t("common.remove")}
        danger
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(post.id);
            setConfirm(false);
            toast({ title: t("vibex.post.deleted") });
          } catch (e) {
            toast({ title: errorMessage(t, e), tone: "danger" });
          }
        }}
      />
    </>
  );
}

export function UnavailablePost({ className }: { className?: string }) {
  const t = useT();
  return (
    <div className={cx("rounded-2xl border border-dashed border-border-strong px-4 py-5 text-center", className)} data-testid="post-unavailable">
      <div className="text-[15px] font-semibold text-text-secondary">{t("vibex.post.unavailable")}</div>
      <div className="mt-0.5 text-[13px] text-text-tertiary">{t("vibex.post.unavailableHint")}</div>
    </div>
  );
}

/** The original inside a repost or a chat message: compact, keeps the original id. */
export function NestedPost({ post, actions }: { post: VibexPostDto; actions?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-surface px-4 py-3" data-testid="nested-post" data-post-id={post.id}>
      <div className="flex items-center gap-2">
        <PersonLine person={post.author} at={post.createdAt} size={34} />
        {actions && <PostMenu post={post} />}
      </div>
      <PostText text={post.text} />
      <MediaGrid media={post.media} />
    </div>
  );
}

export function PostCard({ post }: { post: VibexPostDto }) {
  const t = useT();
  const shell = "flex flex-col gap-3 rounded-[24px] bg-surface px-4 pb-2 pt-4 shadow-tile sm:px-5";
  if (post.kind === "repost") {
    const orig = post.repostOf;
    return (
      <article className={shell} data-testid="post-card" data-kind="repost" data-post-id={post.id}>
        <div className="flex items-center gap-2">
          <PersonLine person={post.author} at={post.createdAt} note={t("vibex.post.sharedBy")} />
          {orig && <PostMenu post={orig} wrapper={post} />}
        </div>
        {orig ? <NestedPost post={orig} /> : <UnavailablePost />}
        {orig ? <PostActions post={orig} /> : <div className="h-2" />}
      </article>
    );
  }
  return (
    <article className={shell} data-testid="post-card" data-kind="post" data-post-id={post.id}>
      <div className="flex items-center gap-2">
        <PersonLine person={post.author} at={post.createdAt} />
        <PostMenu post={post} />
      </div>
      <PostText text={post.text} />
      <MediaGrid media={post.media} />
      <PostActions post={post} />
    </article>
  );
}

// ------------------------------------------------------------------- lists

/** Infinite list of posts with skeletons, an empty state and "load more" on scroll. */
export function PostList({
  query,
  empty,
}: {
  query: { data?: { pages: { items: VibexPostDto[] }[] }; isPending: boolean; isError: boolean; hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown; refetch: () => unknown };
  empty: ReactNode;
}) {
  const t = useT();
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 rounded-[24px]" />
        ))}
      </div>
    );
  }
  if (query.isError && !items.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-text-secondary">
        {t("error.generic")}
        <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  if (!items.length) return <>{empty}</>;
  return (
    <div className="flex flex-col gap-3" data-testid="post-list">
      {items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      <LoadMore active={query.hasNextPage} loading={query.isFetchingNextPage} onMore={() => query.fetchNextPage()} />
    </div>
  );
}

export function LoadMore({ active, loading, onMore }: { active: boolean; loading: boolean; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && onMore(), { rootMargin: "400px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [active, onMore]);
  if (!active && !loading) return null;
  return (
    <div ref={ref} className="flex justify-center py-4 text-text-tertiary">
      <Spinner />
    </div>
  );
}

// ---------------------------------------------------------------- composer

type Pending = { key: string; file: File };

/** Inline "What's new?" box at the top of the feed / my page; opens the composer. */
export function ComposerPrompt() {
  const t = useT();
  const me = useSession((s) => s.user)!;
  const compose = useVibex((s) => s.compose);
  return (
    <button
      type="button"
      onClick={() => compose(true)}
      className="pressable flex items-center gap-3 rounded-[24px] bg-surface px-4 py-3 text-left shadow-tile"
      data-testid="composer-prompt"
    >
      <Avatar name={`${me.firstName} ${me.lastName}`} userId={me.id} version={me.avatarVersion} size={40} />
      <span className="flex-1 text-[15px] text-text-tertiary">{t("vibex.composer.placeholder")}</span>
      <RiImageAddLine className="size-5 text-text-tertiary" />
    </button>
  );
}

export function PostComposer() {
  const t = useT();
  const open = useVibex((s) => s.composing);
  const compose = useVibex((s) => s.compose);
  const me = useSession((s) => s.user)!;
  const create = useCreatePost();
  const [text, setText] = useState("");
  const [media, setMedia] = useState<VibexFileDto[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setText("");
    setMedia([]);
    setPending([]);
  };
  const close = () => {
    // Pictures uploaded but not published are discarded.
    for (const m of media) void filesApi.discard(m.id).catch(() => undefined);
    reset();
    compose(false);
  };

  const add = async (files: FileList | null) => {
    if (!files) return;
    const list = [...files].slice(0, Math.max(0, VIBEX_FILES_MAX - media.length - pending.length));
    for (const file of list) {
      const bad = checkVibexFile(file, "post");
      if (bad) {
        toast({ title: t(`error.${bad}`), body: file.name, tone: "danger" });
        continue;
      }
      const key = `${file.name}-${Math.random()}`;
      setPending((p) => [...p, { key, file }]);
      try {
        const dto = await filesApi.upload(file, "post");
        setMedia((m) => [...m, dto]);
      } catch (e) {
        toast({ title: errorMessage(t, e), body: file.name, tone: "danger" });
      } finally {
        setPending((p) => p.filter((x) => x.key !== key));
      }
    }
  };

  const canPublish = (text.trim().length > 0 || media.length > 0) && !pending.length && !create.isPending;
  const publish = async () => {
    try {
      await create.mutateAsync({ text, mediaIds: media.map((m) => m.id) });
      reset();
      compose(false);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t("vibex.newPost")}
      width={560}
      testId="post-composer"
      footer={
        <>
          <input
            ref={input}
            type="file"
            className="hidden"
            multiple
            accept={VIBEX_POST_IMAGE_TYPES.join(",")}
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = "";
            }}
            data-testid="composer-file"
          />
          <IconButton label={t("vibex.composer.addPhoto")} onClick={() => input.current?.click()} disabled={media.length + pending.length >= VIBEX_FILES_MAX}>
            <RiImageAddLine className="size-5" />
          </IconButton>
          <span className="flex-1 self-center text-[12px] tabular-nums text-text-tertiary">
            {text.length > VIBEX_POST_MAX - 200 ? `${text.length} / ${VIBEX_POST_MAX}` : ""}
          </span>
          <Button onClick={publish} disabled={!canPublish} loading={create.isPending} data-testid="composer-publish">
            {t("vibex.composer.publish")}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <Avatar name={`${me.firstName} ${me.lastName}`} userId={me.id} version={me.avatarVersion} size={40} />
        <textarea
          autoFocus
          value={text}
          maxLength={VIBEX_POST_MAX}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canPublish) void publish();
          }}
          placeholder={t("vibex.composer.placeholder")}
          className="min-h-[120px] flex-1 resize-none bg-transparent pt-2 text-[16px] leading-[1.45] outline-none placeholder:text-text-tertiary"
          data-testid="composer-text"
        />
      </div>
      <AnimatePresence initial={false}>
        {(media.length > 0 || pending.length > 0) && (
          <motion.div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {media.map((m) => (
              <div key={m.id} className="relative">
                <VibexImage file={m} className="aspect-square w-full rounded-2xl" />
                <button
                  type="button"
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-[rgba(20,20,30,0.6)] text-white"
                  aria-label={t("common.remove")}
                  onClick={() => {
                    setMedia((x) => x.filter((y) => y.id !== m.id));
                    void filesApi.discard(m.id).catch(() => undefined);
                  }}
                >
                  <RiCloseLine className="size-4" />
                </button>
              </div>
            ))}
            {pending.map((p) => (
              <div key={p.key} className="flex aspect-square items-center justify-center rounded-2xl bg-surface-secondary text-text-tertiary">
                <Spinner />
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

export function FeedEmpty({ mine }: { mine?: boolean }) {
  const t = useT();
  return (
    <EmptyState
      icon={<RiImageAddLine className="size-7" />}
      title={mine ? t("vibex.me.noPosts") : t("vibex.feed.empty")}
      hint={mine ? undefined : t("vibex.feed.emptyHint")}
    />
  );
}
