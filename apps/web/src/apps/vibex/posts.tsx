import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  RiBookmarkFill,
  RiBookmarkLine,
  RiChat1Line,
  RiCloseLine,
  RiDeleteBinLine,
  RiEyeOffLine,
  RiFlagLine,
  RiHeart3Fill,
  RiHeart3Line,
  RiImageAddLine,
  RiLinkM,
  RiMoreFill,
  RiPencilLine,
  RiRepeat2Line,
  RiShareForwardLine,
} from "@remixicon/react";
import { VIBEX_FILES_MAX, VIBEX_POST_IMAGE_TYPES, VIBEX_POST_VIDEO_TYPES, VIBEX_POST_MAX, detectLanguage, type VibexFileDto, type VibexPersonDto, type VibexPostDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Button, EmptyState, IconButton, Skeleton, Spinner } from "@/ui/controls";
import { ConfirmDialog, MenuList, Popover, Sheet, toast, usePopover, type MenuItem } from "@/ui/overlays";
import {
  checkVibexFile,
  filesApi,
  postLink,
  reportPost,
  translatePost,
  useCreatePost,
  useDeletePost,
  useEditPost,
  useHidePost,
  usePostAction,
  useRepost,
} from "./data";
import { MediaGrid, VibexImage, VibexVideoTile } from "./media";
import { useVibex } from "./store";

// ------------------------------------------------------------------ pieces

/** Voyzen header line: avatar, name, then email · time (· edited). */
function PersonLine({ person, at, edited, note, size = 44 }: { person: VibexPersonDto; at: string; edited?: boolean; note?: string; size?: number }) {
  const t = useT();
  const lang = useLanguage();
  const push = useVibex((s) => s.push);
  const open = () => push({ kind: "person", id: person.id });
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <button type="button" onClick={open} className="shrink-0 rounded-full" aria-label={person.name} data-testid="post-author">
        <Avatar name={person.name} userId={person.id} version={person.avatarVersion} size={size} />
      </button>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="flex min-w-0 items-baseline gap-1.5 text-[15px] leading-tight text-text">
          <button type="button" onClick={open} className="truncate font-semibold hover:underline">
            {person.name}
          </button>
          {note && <span className="shrink-0 text-[14px] text-text-secondary">{note}</span>}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-text-secondary" data-testid="post-meta">
          {person.address} · {formatRelative(at, lang)}
          {edited && ` · ${t("vibex.post.edited")}`}
        </p>
      </div>
    </div>
  );
}

/** Text with Voyzen's "Translate" link — only when the post isn't in my language already. */
function PostText({ post }: { post: VibexPostDto }) {
  const t = useT();
  const lang = useLanguage();
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!post.text) return null;
  const source = detectLanguage(post.text);
  const canTranslate = source !== lang;
  const toggle = async () => {
    if (shown !== null) return setShown(null);
    setBusy(true);
    try {
      const r = await translatePost(post.id);
      setShown(r.text);
    } catch (e) {
      toast({ title: t("vibex.post.translateFailed"), body: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-4 pb-3">
      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text" data-selectable data-testid="post-text">
        {shown ?? post.text}
      </p>
      {canTranslate && (
        <button type="button" onClick={toggle} disabled={busy} className="mt-1 text-[14px] font-medium text-primary hover:underline disabled:opacity-60" data-testid="post-translate">
          {busy ? t("vibex.post.translating") : shown !== null ? t("vibex.post.showOriginal") : t("vibex.post.translate")}
        </button>
      )}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  aria,
  count,
  onClick,
  active,
  activeClass = "text-primary",
  testId,
  pressed,
  wide,
}: {
  icon: ReactNode;
  label: string;
  aria?: string;
  count?: number;
  onClick: () => void;
  active?: boolean;
  activeClass?: string;
  testId: string;
  pressed?: boolean;
  /** The text button ("Share"): a bit more room than the icon + counter ones. */
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={aria}
      title={aria}
      className={cx(
        "flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-xl px-1.5 text-[14px] font-medium leading-none transition-colors hover:bg-surface-secondary active:bg-surface-hover",
        wide && "flex-[1.6]",
        active ? activeClass : "text-text-secondary",
      )}
      data-testid={testId}
    >
      <span className="flex shrink-0">{icon}</span>
      {/* Very narrow cards keep the icon only (the button keeps its accessible name). */}
      {label && <span className={cx("min-w-0 truncate", wide && "@max-[260px]:hidden")}>{label}</span>}
      {!!count && <span className="shrink-0 text-[13px] tabular-nums text-text-tertiary">{count}</span>}
    </button>
  );
}

/** Voyzen's action row: ❤ · 💬 · Share — always about the original post. */
function PostActions({ post }: { post: VibexPostDto }) {
  const t = useT();
  const action = usePostAction();
  const share = useVibex((s) => s.share);
  const comment = useVibex((s) => s.openComments);
  return (
    // Inside the card, under the divider: a padded row of fixed height, so the buttons (and
    // their hover background) never leave the card, whatever the width or the label length.
    <div className="@container flex h-[52px] items-center gap-1 border-t px-2" data-testid="post-actions">
      <ActionButton
        icon={
          <motion.span key={String(post.liked)} initial={post.liked ? { scale: 0.6 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 16 }} className="flex">
            {post.liked ? <RiHeart3Fill className="size-5" /> : <RiHeart3Line className="size-5" />}
          </motion.span>
        }
        label={post.likes ? String(post.likes) : ""}
        aria={t("vibex.post.like")}
        active={post.liked}
        activeClass="text-[#e0457b]"
        pressed={post.liked}
        onClick={() => action.mutate({ post, action: post.liked ? "unlike" : "like" })}
        testId="post-like"
      />
      <ActionButton
        icon={<RiChat1Line className="size-5" />}
        label={post.comments ? String(post.comments) : ""}
        aria={t("vibex.post.comment")}
        onClick={() => comment(post.id)}
        testId="post-comment"
      />
      <ActionButton
        icon={<RiShareForwardLine className="size-5" />}
        label={t("vibex.post.share")}
        aria={t("vibex.post.share")}
        wide
        count={post.reposts}
        active={post.reposted}
        onClick={() => share(post)}
        testId="post-share"
      />
    </div>
  );
}

/**
 * "…" on a post — Voyzen's set: copy link; mine: edit, delete; someone
 * else's: not interested, report. Plus bookmarks (VOIDEX history) and, on my
 * repost, taking it off my page.
 */
function PostMenu({ post, wrapper }: { post: VibexPostDto; wrapper?: VibexPostDto }) {
  const t = useT();
  const pop = usePopover();
  const del = useDeletePost();
  const repost = useRepost();
  const hide = useHidePost();
  const action = usePostAction();
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
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
    {
      id: "bookmark",
      label: post.bookmarked ? t("vibex.post.unbookmark") : t("vibex.post.bookmark"),
      icon: post.bookmarked ? <RiBookmarkFill className="size-5" /> : <RiBookmarkLine className="size-5" />,
      onSelect: () => action.mutate({ post, action: post.bookmarked ? "unbookmark" : "bookmark" }),
    },
  ];
  if (wrapper?.mine) {
    items.push({ id: "unrepost", label: t("vibex.post.undoRepost"), icon: <RiRepeat2Line className="size-5" />, onSelect: () => repost.mutate({ id: post.id, on: false }) });
  } else if (post.mine) {
    items.push({ id: "edit-post", label: t("vibex.post.edit"), icon: <RiPencilLine className="size-5" />, onSelect: () => setEditing(true) });
    items.push({ id: "delete-post", label: t("vibex.post.delete"), icon: <RiDeleteBinLine className="size-5" />, danger: true, onSelect: () => setConfirm(true) });
  }
  if (!post.mine) {
    items.push({
      id: "not-interested",
      label: t("vibex.post.notInterested"),
      icon: <RiEyeOffLine className="size-5" />,
      onSelect: () => hide.mutate(post.id, { onSuccess: () => toast({ title: t("vibex.post.hidden") }) }),
    });
    items.push({ id: "report", label: t("vibex.post.report"), icon: <RiFlagLine className="size-5" />, danger: true, onSelect: () => setReporting(true) });
  }
  return (
    <>
      <IconButton ref={pop.anchor} label={t("vibex.post.more")} size="sm" onClick={pop.toggle} data-testid="post-menu" className="text-text-tertiary">
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
      {editing && <EditPostSheet post={post} onClose={() => setEditing(false)} />}
      <ReportSheet postId={post.id} open={reporting} onClose={() => setReporting(false)} />
    </>
  );
}

function EditPostSheet({ post, onClose }: { post: VibexPostDto; onClose: () => void }) {
  const t = useT();
  const edit = useEditPost();
  const [text, setText] = useState(post.text);
  const can = (text.trim().length > 0 || post.media.length > 0) && text !== post.text && !edit.isPending;
  const save = async () => {
    try {
      await edit.mutateAsync({ id: post.id, text });
      onClose();
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={t("vibex.post.edit")}
      width={560}
      testId="post-edit"
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={!can} loading={edit.isPending} data-testid="post-edit-save">
            {t("common.save")}
          </Button>
        </>
      }
    >
      <textarea
        autoFocus
        value={text}
        maxLength={VIBEX_POST_MAX}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[140px] w-full resize-none bg-transparent text-[16px] leading-[1.45] outline-none"
        data-testid="post-edit-text"
      />
    </Sheet>
  );
}

function ReportSheet({ postId, open, onClose }: { postId: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const send = async (reason: "spam" | "abuse" | "other") => {
    try {
      await reportPost(postId, reason);
      toast({ title: t("vibex.post.reportThanks"), tone: "success" });
      onClose();
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t("vibex.post.report")} width={420} testId="post-report">
      <div className="overflow-hidden rounded-2xl border border-border">
        {(["spam", "abuse", "other"] as const).map((r) => (
          <button key={r} type="button" onClick={() => void send(r)} className="flex h-12 w-full items-center px-4 text-left text-[15px] hover:bg-surface-secondary [&:not(:last-child)]:border-b" data-testid={`report-${r}`}>
            {t(`vibex.report.${r}`)}
          </button>
        ))}
      </div>
    </Sheet>
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

/** The original inside a repost or a chat message (Voyzen's quoted post). */
export function NestedPost({ post, actions }: { post: VibexPostDto; actions?: boolean }) {
  const lang = useLanguage();
  const push = useVibex((s) => s.push);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface" data-testid="nested-post" data-post-id={post.id}>
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" onClick={() => push({ kind: "person", id: post.author.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Avatar name={post.author.name} userId={post.author.id} version={post.author.avatarVersion} size={24} />
          <span className="truncate text-[13px] font-semibold text-text">{post.author.name}</span>
          <span className="shrink-0 text-[12px] text-text-tertiary">· {formatRelative(post.createdAt, lang)}</span>
        </button>
        {actions && <PostMenu post={post} />}
      </div>
      {post.text && (
        <p className="whitespace-pre-wrap break-words px-3 pb-2 pt-1.5 text-[14px] leading-relaxed text-text" data-selectable>
          {post.text}
        </p>
      )}
      {post.media.length > 0 && (
        <div className="px-3 pb-3">
          <MediaGrid media={post.media} />
        </div>
      )}
    </div>
  );
}

/** A post in the Voyzen layout: header, text (+ translate), media, ❤ · 💬 · Share. */
export function PostCard({ post }: { post: VibexPostDto }) {
  const t = useT();
  const shell = "overflow-hidden rounded-2xl border border-border bg-surface shadow-tile";
  if (post.kind === "repost") {
    const orig = post.repostOf;
    return (
      <article className={shell} data-testid="post-card" data-kind="repost" data-post-id={post.id}>
        <div className="flex items-start gap-2 p-4 pb-3">
          <PersonLine person={post.author} at={post.createdAt} note={t("vibex.post.sharedBy")} />
          {orig && <PostMenu post={orig} wrapper={post} />}
        </div>
        <div className="px-4 pb-3">{orig ? <NestedPost post={orig} /> : <UnavailablePost />}</div>
        {orig && <PostActions post={orig} />}
      </article>
    );
  }
  return (
    <article className={shell} data-testid="post-card" data-kind="post" data-post-id={post.id}>
      <div className="flex items-start gap-2 p-4 pb-3">
        <PersonLine person={post.author} at={post.createdAt} edited={!!post.editedAt} />
        <PostMenu post={post} />
      </div>
      <PostText post={post} />
      {post.media.length > 0 && (
        <div className="px-4 pb-3">
          <MediaGrid media={post.media} />
        </div>
      )}
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
          <Skeleton key={i} className="h-40 rounded-2xl" />
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
      className="pressable flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left shadow-tile"
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
            accept={[...VIBEX_POST_IMAGE_TYPES, ...VIBEX_POST_VIDEO_TYPES].join(",")}
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
                {m.kind === "video" ? <VibexVideoTile file={m} className="aspect-square w-full rounded-2xl" /> : <VibexImage file={m} className="aspect-square w-full rounded-2xl" />}
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

export function FeedEmpty({ mine, reposts }: { mine?: boolean; reposts?: boolean }) {
  const t = useT();
  if (reposts) return <EmptyState icon={<RiRepeat2Line className="size-7" />} title={t("vibex.profile.noReposts")} />;
  return (
    <EmptyState
      icon={<RiImageAddLine className="size-7" />}
      title={mine ? t("vibex.me.noPosts") : t("vibex.feed.empty")}
      hint={mine ? undefined : t("vibex.feed.emptyHint")}
    />
  );
}
