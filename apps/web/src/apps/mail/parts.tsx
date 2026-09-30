import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  RiAttachment2,
  RiArchiveLine,
  RiArrowGoBackLine,
  RiDeleteBin6Line,
  RiDraftLine,
  RiInboxArchiveLine,
  RiInboxLine,
  RiMailLine,
  RiMailOpenLine,
  RiPencilLine,
  RiReplyAllLine,
  RiReplyLine,
  RiSendPlaneLine,
  RiShareForwardLine,
  RiStarFill,
  RiStarLine,
  RiCheckLine,
  RiSearchLine,
} from "@remixicon/react";
import { quoteStartLine, type MailMessageDto, type MailView, type ThreadSummaryDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatShortDate, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Avatar } from "@/brand/brand";
import { Button, EmptyState, IconButton, Notice, Skeleton } from "@/ui/controls";
import { ConfirmDialog, toast } from "@/ui/overlays";
import { useMailSummary } from "@/lib/mail-summary";
import { draftsApi, fetchComposeDefaults, useThread, useThreadAction, useThreadList, type ThreadAction } from "./data";
import { MessageAttachments } from "./attachments";
import { useMail } from "./store";

export const FOLDERS: { view: MailView; label: MessageKey; icon: typeof RiInboxLine }[] = [
  { view: "inbox", label: "mail.inbox", icon: RiInboxLine },
  { view: "starred", label: "mail.starred", icon: RiStarLine },
  { view: "sent", label: "mail.sent", icon: RiSendPlaneLine },
  { view: "drafts", label: "mail.drafts", icon: RiDraftLine },
  { view: "archive", label: "mail.archive", icon: RiArchiveLine },
  { view: "trash", label: "mail.trash", icon: RiDeleteBin6Line },
];

// ---------------------------------------------------------------------------
// Folders

export function FolderNav() {
  const t = useT();
  const view = useMail((s) => s.view);
  const setView = useMail((s) => s.setView);
  const summary = useMailSummary().data;
  const count = (v: MailView) =>
    v === "inbox" ? summary?.unread.inbox : v === "starred" ? summary?.unread.starred : v === "drafts" ? summary?.totals.drafts : v === "archive" ? summary?.unread.archive : 0;
  return (
    <nav className="flex flex-col gap-0.5" aria-label={t("mail.folders")}>
      {FOLDERS.map((f) => {
        const n = count(f.view) ?? 0;
        const active = view === f.view;
        return (
          <button
            key={f.view}
            onClick={() => setView(f.view)}
            data-testid={`folder-${f.view}`}
            className={cx(
              "flex h-11 items-center gap-3 rounded-2xl px-3.5 text-left text-[15px] transition-colors",
              active ? "bg-primary-soft font-semibold text-primary-strong" : "text-text hover:bg-surface-hover",
            )}
          >
            <f.icon className={cx("size-[19px]", active ? "text-primary" : "text-text-secondary")} />
            <span className="flex-1">{t(f.label)}</span>
            {n > 0 && (
              <span className={cx("min-w-6 rounded-full px-2 py-0.5 text-center text-[12px] font-semibold tabular-nums", active || f.view === "inbox" ? "bg-primary text-white" : "bg-surface-secondary text-text-secondary")} data-testid={`count-${f.view}`}>
                {n}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function ComposeButton({ className }: { className?: string }) {
  const t = useT();
  const compose = useMail((s) => s.compose);
  return (
    <Button size="lg" block className={className} icon={<RiPencilLine className="size-5" />} onClick={() => compose()} data-testid="compose">
      {t("mail.compose")}
    </Button>
  );
}

export function MailSearch({ autoFocus }: { autoFocus?: boolean }) {
  const t = useT();
  const query = useMail((s) => s.query);
  const setQuery = useMail((s) => s.setQuery);
  const [text, setText] = useState(query);
  useEffect(() => setText(query), [query]);
  useEffect(() => {
    const id = window.setTimeout(() => text !== query && setQuery(text.trim()), 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <label className="flex h-10 w-full max-w-[520px] items-center gap-2 rounded-2xl bg-surface-secondary px-3.5 focus-within:bg-surface focus-within:shadow-[0_0_0_2px_var(--primary)]" data-no-drag>
      <RiSearchLine className="size-[18px] text-text-tertiary" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("mail.search")}
        className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-tertiary"
        autoFocus={autoFocus}
        type="search"
        data-testid="mail-search"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Thread list

const EMPTY: Record<MailView, MessageKey> = {
  inbox: "mail.empty.inbox",
  sent: "mail.empty.sent",
  drafts: "mail.empty.drafts",
  archive: "mail.empty.archive",
  trash: "mail.empty.trash",
  starred: "mail.empty.starred",
};

export function ThreadList() {
  const t = useT();
  const view = useMail((s) => s.view);
  const query = useMail((s) => s.query);
  const list = useThreadList(view, query);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage());
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  if (list.isLoading)
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[76px] w-full rounded-2xl" />
        ))}
      </div>
    );
  if (list.error)
    return (
      <div className="p-4">
        <Notice tone="danger">{errorMessage(t, list.error)}</Notice>
        <Button variant="secondary" className="mt-3" onClick={() => list.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  if (!items.length)
    return (
      <EmptyState
        icon={query ? <RiSearchLine className="size-7" /> : <RiMailLine className="size-7" />}
        title={query ? t("mail.empty.search") : t(EMPTY[view])}
        hint={!query && view === "inbox" ? t("mail.empty.inboxHint") : undefined}
      />
    );

  return (
    <div className="flex flex-col gap-1 p-2" data-testid="thread-list">
      {query && <div className="px-3 pb-1 pt-1 text-[13px] text-text-secondary">{t("mail.searchResults", { q: query })}</div>}
      {items.map((th) => (
        <ThreadRow key={`${th.id}-${th.draftId ?? ""}`} thread={th} />
      ))}
      <div ref={sentinel} className="h-6" />
    </div>
  );
}

function ThreadRow({ thread }: { thread: ThreadSummaryDto }) {
  const t = useT();
  const lang = useLanguage();
  const view = useMail((s) => s.view);
  const activeId = useMail((s) => s.threadId);
  const selection = useMail((s) => s.selection);
  const openThread = useMail((s) => s.openThread);
  const toggle = useMail((s) => s.toggleSelect);
  const compose = useMail((s) => s.compose);
  const action = useThreadAction();
  const selected = selection.includes(thread.id);
  const active = activeId === thread.id && !thread.draftId;
  const myAddress = useSession((s) => s.user!.mailAddress);
  const ordered = [...thread.participants.filter((p) => p.address !== myAddress), ...thread.participants.filter((p) => p.address === myAddress)];
  const names = ordered.map((p) => (p.address === myAddress ? t("mail.me") : p.name ?? (p.address.split("@")[0] ?? p.address)));
  const avatarOf = ordered[0];
  const who = view === "sent" || view === "drafts" ? `${t("mail.to")}: ${names.join(", ") || "—"}` : names.join(", ") || t("mail.me");

  const open = async () => {
    if (thread.draftId) {
      const d = await draftsApi.get(thread.draftId);
      compose({ draftId: d.id, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body: d.body, replyToMessageId: d.replyToMessageId ?? undefined, forwardOfMessageId: d.forwardOfMessageId ?? undefined, attachments: d.attachments });
      return;
    }
    openThread(thread.id);
    if (thread.unread) action.mutate({ threadIds: [thread.id], action: "read", view });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      data-testid="thread-row"
      data-unread={thread.unread || undefined}
      className={cx(
        "group relative flex cursor-default gap-3 rounded-2xl px-3 py-3 outline-none transition-colors",
        active ? "bg-primary-soft" : selected ? "bg-surface-hover" : "hover:bg-surface-hover focus-visible:bg-surface-hover",
      )}
    >
      {thread.unread && <span className="absolute left-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggle(thread.id);
        }}
        className="relative shrink-0"
        aria-label="select"
      >
        <span className={cx("transition-opacity", selected && "opacity-0")}>
          <Avatar name={avatarOf?.name ?? avatarOf?.address ?? "?"} size={40} />
        </span>
        <span className={cx("absolute inset-0 flex items-center justify-center rounded-full bg-primary text-white transition-all", selected ? "scale-100 opacity-100" : "scale-75 opacity-0")}>
          <RiCheckLine className="size-5" />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cx("min-w-0 flex-1 truncate text-[15px]", thread.unread ? "font-semibold text-text" : "text-text")}>{who}</span>
          {thread.messageCount > 1 && <span className="text-[12px] text-text-tertiary">{thread.messageCount}</span>}
          <span className={cx("shrink-0 text-[12px] tabular-nums", thread.unread ? "font-semibold text-primary" : "text-text-tertiary")}>{formatShortDate(thread.lastMessageAt, lang)}</span>
        </div>
        <div className={cx("truncate text-[14px]", thread.unread ? "font-semibold text-text" : "text-text")}>
          {thread.draftId && <span className="mr-1.5 text-danger">{t("mail.draft")}</span>}
          {thread.subject || t("mail.noSubject")}
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">{thread.snippet}</span>
          {thread.hasAttachments && <RiAttachment2 className="size-4 shrink-0 text-text-tertiary" aria-label={t("mail.hasAttachments")} data-testid="thread-has-attachments" />}
          {thread.hasDraft && !thread.draftId && <span className="shrink-0 text-[11px] font-semibold uppercase text-danger">{t("mail.draft")}</span>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              action.mutate({ threadIds: [thread.id], action: thread.starred ? "unstar" : "star", view });
            }}
            className={cx("shrink-0 transition-opacity", thread.starred ? "text-warning" : "text-text-tertiary opacity-0 group-hover:opacity-100")}
            aria-label={thread.starred ? t("mail.unstar") : t("mail.star")}
          >
            {thread.starred ? <RiStarFill className="size-4" /> : <RiStarLine className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions (shared by toolbar, bulk selection and mobile bar)

export function useActionRunner() {
  const t = useT();
  const view = useMail((s) => s.view);
  const openThread = useMail((s) => s.openThread);
  const clear = useMail((s) => s.clearSelection);
  const action = useThreadAction();
  return (threadIds: string[], a: ThreadAction) => {
    const undoable: Partial<Record<ThreadAction, { msg: MessageKey; undo: ThreadAction }>> = {
      archive: { msg: "mail.moved.archive", undo: "inbox" },
      trash: { msg: "mail.moved.trash", undo: "restore" },
      inbox: { msg: "mail.moved.inbox", undo: "archive" },
      restore: { msg: "mail.moved.restore", undo: "trash" },
    };
    // mutateAsync: the toolbar that triggered this may unmount right away.
    action
      .mutateAsync({ threadIds, action: a, view })
      .then(() => {
        const u = undoable[a];
        if (u) toast({ title: t(u.msg), action: { label: t("mail.undo"), onClick: () => action.mutate({ threadIds, action: u.undo, view: "inbox" }) } });
        if (a === "delete_forever") toast({ title: t("mail.deleted") });
      })
      .catch((err) => toast({ title: errorMessage(t, err), tone: "danger" }));
    if (["archive", "trash", "restore", "inbox", "delete_forever"].includes(a)) {
      openThread(null);
      clear();
    }
  };
}

export function ThreadToolbar({ threadIds, starred, unread, compact }: { threadIds: string[]; starred?: boolean; unread?: boolean; compact?: boolean }) {
  const t = useT();
  const view = useMail((s) => s.view);
  const run = useActionRunner();
  const [confirm, setConfirm] = useState(false);
  const btn = (label: string, icon: ReactNode, onClick: () => void, testId?: string) => (
    <IconButton label={label} onClick={onClick} size={compact ? "md" : "md"} data-testid={testId}>
      {icon}
    </IconButton>
  );
  return (
    <div className="flex items-center gap-0.5">
      {view === "trash" ? (
        <>
          {btn(t("mail.restore"), <RiArrowGoBackLine className="size-5" />, () => run(threadIds, "restore"), "action-restore")}
          {btn(t("mail.deleteForever"), <RiDeleteBin6Line className="size-5 text-danger" />, () => setConfirm(true), "action-delete-forever")}
        </>
      ) : (
        <>
          {view === "archive"
            ? btn(t("mail.moveToInbox"), <RiInboxArchiveLine className="size-5" />, () => run(threadIds, "inbox"), "action-inbox")
            : view !== "sent" && btn(t("mail.archiveAction"), <RiArchiveLine className="size-5" />, () => run(threadIds, "archive"), "action-archive")}
          {btn(t("mail.delete"), <RiDeleteBin6Line className="size-5" />, () => run(threadIds, "trash"), "action-trash")}
        </>
      )}
      {btn(unread ? t("mail.markRead") : t("mail.markUnread"), unread ? <RiMailOpenLine className="size-5" /> : <RiMailLine className="size-5" />, () => run(threadIds, unread ? "read" : "unread"), "action-unread")}
      {btn(starred ? t("mail.unstar") : t("mail.star"), starred ? <RiStarFill className="size-5 text-warning" /> : <RiStarLine className="size-5" />, () => run(threadIds, starred ? "unstar" : "star"), "action-star")}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          run(threadIds, "delete_forever");
        }}
        title={t("mail.deleteForever")}
        message={t("mail.deleteForeverConfirm")}
        confirmLabel={t("mail.deleteForever")}
        danger
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread view

export function ThreadView({ threadId }: { threadId: string }) {
  const t = useT();
  const view = useMail((s) => s.view);
  const thread = useThread(threadId, view);

  if (thread.isLoading)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full rounded-3xl" />
      </div>
    );
  if (thread.error || !thread.data)
    return (
      <div className="p-6">
        <Notice tone="danger">{thread.error ? errorMessage(t, thread.error) : t("error.not_found")}</Notice>
      </div>
    );
  const d = thread.data;
  const sent = d.messages.filter((m) => m.status === "sent");
  return (
    <div className="mx-auto w-full max-w-[860px] px-4 pb-10 pt-2 sm:px-6" data-testid="thread-view">
      <h1 className="mb-1 text-[22px] font-bold leading-snug tracking-tight sm:text-[24px]" data-selectable>
        {d.subject || t("mail.noSubject")}
      </h1>
      <div className="mb-5 text-[13px] text-text-tertiary">{sent.length > 1 && t("mail.messages", { n: sent.length })}</div>
      <div className="space-y-3">
        {d.messages.map((m, i) => (
          <MessageCard key={m.id} message={m} defaultOpen={i === d.messages.length - 1 || !m.read} />
        ))}
      </div>
    </div>
  );
}

function MessageCard({ message: m, defaultOpen }: { message: MailMessageDto; defaultOpen: boolean }) {
  const t = useT();
  const lang = useLanguage();
  const me = useSession((s) => s.user)!;
  const compose = useMail((s) => s.compose);
  const [open, setOpen] = useState(defaultOpen);
  const [showQuote, setShowQuote] = useState(false);
  const own = m.isOwn;
  const fromName = own ? `${me.firstName} ${me.lastName}` : m.from.name ?? m.from.address;

  const reply = async (mode: "reply" | "reply_all" | "forward") => {
    const d = await fetchComposeDefaults(m.id, mode, lang);
    compose({ to: d.to, cc: d.cc, subject: d.subject, body: d.body, replyToMessageId: d.replyToMessageId, forwardOfMessageId: d.forwardOfMessageId });
  };

  if (m.status === "draft") {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-dashed border-danger/40 bg-danger-soft/40 px-5 py-4">
        <span className="text-[13px] font-semibold uppercase text-danger">{t("mail.draft")}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] text-text-secondary">{m.body.split("\n")[0] || "…"}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            const d = await draftsApi.get(m.id);
            compose({ draftId: d.id, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body: d.body, replyToMessageId: d.replyToMessageId ?? undefined, attachments: d.attachments });
          }}
        >
          {t("mail.continueDraft")}
        </Button>
      </div>
    );
  }

  const lines = m.body.split("\n");
  const quoteStart = quoteStartLine(lines);
  const head = quoteStart > 0 ? lines.slice(0, quoteStart).join("\n").trimEnd() : m.body;
  // A forward without a comment shows the forwarded text directly.
  const mainText = head.trim() ? head : m.body.trim();
  const quoted = head.trim() && quoteStart > 0 ? lines.slice(quoteStart).join("\n") : "";
  const recipients = (kind: string) => m.recipients.filter((r) => r.kind === kind).map((r) => (r.address === me.mailAddress ? t("mail.me") : r.name ?? r.address));

  return (
    <article className={cx("rounded-3xl border bg-surface transition-shadow", open ? "shadow-surface" : "hover:bg-surface-hover")} data-testid="message-card">
      <button className="flex w-full items-start gap-3 px-5 pt-4 text-left" onClick={() => setOpen((o) => !o)} style={{ paddingBottom: open ? 0 : 16 }}>
        <Avatar name={fromName} userId={own ? me.id : undefined} version={own ? me.avatarVersion : 0} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[15px] font-semibold">{fromName}</span>
            {!own && <span className="hidden truncate text-[13px] text-text-tertiary sm:inline">{m.from.address}</span>}
            <span className="ml-auto shrink-0 text-[12px] text-text-tertiary">{m.sentAt && formatDate(m.sentAt, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          {open ? (
            <div className="truncate text-[13px] text-text-secondary">
              {t("mail.to")}: {recipients("to").join(", ")}
              {recipients("cc").length > 0 && ` · ${t("mail.cc")}: ${recipients("cc").join(", ")}`}
              {recipients("bcc").length > 0 && ` · ${t("mail.bcc")}: ${recipients("bcc").join(", ")}`}
            </div>
          ) : (
            <div className="truncate text-[13px] text-text-secondary">{mainText.replace(/\s+/g, " ")}</div>
          )}
        </div>
      </button>
      {open && (
        <div className="px-5 pb-4 pt-3">
          <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text" data-selectable data-testid="message-body">
            {mainText}
          </div>
          {quoted && (
            <>
              <button className="mt-3 rounded-full bg-surface-secondary px-3 py-1 text-[12px] font-medium text-text-secondary hover:bg-surface-hover" onClick={() => setShowQuote((s) => !s)}>
                {showQuote ? t("common.hide") : t("mail.showQuoted")}
              </button>
              {showQuote && <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-primary/30 pl-3 text-[14px] text-text-secondary" data-selectable>{quoted}</div>}
            </>
          )}
          <MessageAttachments items={m.attachments} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={<RiReplyLine className="size-4" />} onClick={() => reply("reply")} data-testid="reply">
              {t("mail.reply")}
            </Button>
            {m.recipients.length + 1 > 2 && (
              <Button variant="secondary" size="sm" icon={<RiReplyAllLine className="size-4" />} onClick={() => reply("reply_all")} data-testid="reply-all">
                {t("mail.replyAll")}
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={<RiShareForwardLine className="size-4" />} onClick={() => reply("forward")} data-testid="forward">
              {t("mail.forward")}
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
