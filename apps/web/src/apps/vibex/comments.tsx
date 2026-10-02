import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiArrowLeftLine, RiChat1Line, RiCloseLine, RiDeleteBinLine, RiSendPlane2Fill } from "@remixicon/react";
import { VIBEX_COMMENT_MAX, type VibexCommentDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { formatRelative, useLanguage, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { IconButton, Skeleton, Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { useAddComment, useComments, useDeleteComment, usePost } from "./data";
import { useVibex } from "./store";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Voyzen's comments screen: back arrow and count on top, the post being
 * discussed, the comments, and the composer pinned to the bottom.
 */
export function CommentsScreen() {
  const postId = useVibex((s) => s.commentsFor);
  if (!postId) return null;
  return <Screen key={postId} postId={postId} />;
}

function Screen({ postId }: { postId: string }) {
  const t = useT();
  const lang = useLanguage();
  const me = useSession((s) => s.user)!;
  const close = useVibex((s) => s.openComments);
  const push = useVibex((s) => s.push);
  const post = usePost(postId);
  const comments = useComments(postId);
  const add = useAddComment(postId);
  const del = useDeleteComment(postId);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; rootId: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const items = comments.data ?? [];
  const roots = items.filter((c) => !c.rootId);
  const repliesOf = (id: string) => items.filter((c) => c.rootId === id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  useEffect(() => {
    if (!replyTo) list.current?.scrollTo({ top: list.current.scrollHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.length]);

  const toggle = (id: string, open?: boolean) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (open ?? !n.has(id)) n.add(id);
      else n.delete(id);
      return n;
    });

  const answer = (c: VibexCommentDto) => {
    setReplyTo({ id: c.id, rootId: c.rootId ?? c.id, name: c.author.name });
    input.current?.focus();
  };

  const send = async () => {
    const v = text.trim();
    if (!v || add.isPending) return;
    try {
      await add.mutateAsync({ text: v, replyToId: replyTo?.id });
      if (replyTo) toggle(replyTo.rootId, true);
      setText("");
      setReplyTo(null);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };

  /** One comment row (top-level or reply); replies are one level deep, TikTok-style. */
  const row = (c: VibexCommentDto, reply: boolean) => (
    <div key={c.id} className={cx("group flex gap-2.5", reply && "pl-11")} data-testid={reply ? "comment-reply" : "comment"} data-comment={c.id}>
      <button type="button" onClick={() => (close(null), push({ kind: "person", id: c.author.id }))} className="shrink-0 self-start rounded-full">
        <Avatar name={c.author.name} userId={c.author.id} version={c.author.avatarVersion} size={reply ? 28 : 34} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-text-secondary">{c.author.name}</p>
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-snug text-text" data-selectable>
          {c.replyTo && c.replyTo.commentId !== c.rootId && (
            <span className="mr-1 font-medium text-primary" data-testid="comment-mention">
              @{c.replyTo.person.name}
            </span>
          )}
          {c.text}
        </p>
        <div className="mt-1 flex items-center gap-3 text-[12px] text-text-tertiary">
          <span>{formatRelative(c.createdAt, lang)}</span>
          <button type="button" onClick={() => answer(c)} className="font-semibold hover:text-text" data-testid="comment-reply-button">
            {t("vibex.comments.reply")}
          </button>
        </div>
      </div>
      {(c.mine || post.data?.mine) && (
        <button
          type="button"
          onClick={() => del.mutate(c.id)}
          aria-label={t("common.remove")}
          className="flex size-8 shrink-0 items-center justify-center self-start rounded-full text-text-tertiary opacity-60 hover:bg-surface-hover hover:text-danger group-hover:opacity-100"
          data-testid="comment-delete"
        >
          <RiDeleteBinLine className="size-4" />
        </button>
      )}
    </div>
  );

  return (
    <motion.div
      className="absolute inset-0 z-[45] flex flex-col bg-surface"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      data-testid="comments-screen"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        <IconButton label={t("common.back")} onClick={() => close(null)} data-testid="comments-back">
          <RiArrowLeftLine className="size-5" />
        </IconButton>
        <h2 className="flex-1 text-[16px] font-bold">{t("vibex.comments.title")}</h2>
        <span className="pr-3 text-[14px] text-text-secondary" data-testid="comments-count">
          {items.length}
        </span>
      </header>

      <div ref={list} className="scroll-area min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[640px]">
          {post.data ? (
            <div className="flex gap-3 border-b p-4">
              <Avatar name={post.data.author.name} userId={post.data.author.id} version={post.data.author.avatarVersion} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{post.data.author.name}</p>
                {post.data.text && (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] text-text" data-selectable>
                    {post.data.text}
                  </p>
                )}
                <p className="mt-1 text-[12px] text-text-tertiary">{formatRelative(post.data.createdAt, lang)}</p>
              </div>
            </div>
          ) : (
            <Skeleton className="m-4 h-16 rounded-2xl" />
          )}

          <div className="flex flex-col gap-3 p-4" data-testid="comments-list">
            {comments.isPending ? (
              <Spinner className="mx-auto text-text-tertiary" />
            ) : roots.length ? (
              roots.map((c) => {
                const replies = repliesOf(c.id);
                const open = expanded.has(c.id);
                return (
                  <div key={c.id} className="flex flex-col gap-2.5" data-testid="comment-thread">
                    {row(c, false)}
                    {replies.length > 0 && (
                      <>
                        <AnimatePresence initial={false}>
                          {open && (
                            <motion.div className="flex flex-col gap-2.5 overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: EASE }}>
                              {replies.map((r) => row(r, true))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <button type="button" onClick={() => toggle(c.id)} className="ml-11 flex items-center gap-2 self-start text-[12.5px] font-semibold text-text-tertiary hover:text-text" data-testid="comment-replies-toggle">
                          <span className="h-px w-6 bg-border-strong" />
                          {open ? t("vibex.comments.hideReplies") : t("vibex.comments.showReplies", { n: replies.length })}
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center gap-2 py-10 text-text-tertiary">
                <RiChat1Line className="size-7" />
                <p className="text-[14px]">{t("vibex.comments.empty")}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <form
        className="shrink-0 border-t bg-surface p-2.5 pb-[max(0.625rem,var(--safe-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {replyTo && (
          <div className="mx-auto mb-2 flex w-full max-w-[640px] items-center gap-2 rounded-xl bg-surface-secondary px-3 py-1.5 text-[13px] text-text-secondary" data-testid="comment-replying">
            <span className="min-w-0 flex-1 truncate">{t("vibex.comments.replyingTo", { name: replyTo.name })}</span>
            <button type="button" onClick={() => setReplyTo(null)} aria-label={t("common.cancel")} className="flex size-6 items-center justify-center rounded-full hover:bg-surface-hover">
              <RiCloseLine className="size-4" />
            </button>
          </div>
        )}
        <div className="mx-auto flex w-full max-w-[640px] items-end gap-2">
          <Avatar name={`${me.firstName} ${me.lastName}`} userId={me.id} version={me.avatarVersion} size={34} />
          <textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={VIBEX_COMMENT_MAX}
            placeholder={t("vibex.comments.placeholder")}
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-[20px] bg-surface-secondary px-4 py-2.5 text-[15px] outline-none placeholder:text-text-tertiary"
            data-testid="comment-input"
          />
          <button
            type="submit"
            disabled={!text.trim() || add.isPending}
            aria-label={t("vibex.chat.send")}
            className={cx("flex size-10 shrink-0 items-center justify-center rounded-full text-white transition", text.trim() ? "bg-primary" : "bg-primary/40")}
            data-testid="comment-send"
          >
            {add.isPending ? <Spinner size={16} /> : <RiSendPlane2Fill className="size-5" />}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
