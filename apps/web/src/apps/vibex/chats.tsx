import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import {
  RiArrowLeftSLine,
  RiAttachment2,
  RiCheckDoubleLine,
  RiCheckLine,
  RiCloseLine,
  RiFileLine,
  RiImageLine,
  RiMoreFill,
  RiPushpin2Fill,
  RiPushpinLine,
  RiSendPlaneFill,
  RiShareForwardLine,
  RiUnpinLine,
  RiUserLine,
  RiCameraLensLine,
  RiMicLine,
  RiPhoneLine,
  RiReplyLine,
  RiVidiconLine,
} from "@remixicon/react";
import { VIBEX_FILES_MAX, VIBEX_MESSAGE_MAX, type VibexChatDto, type VibexFileDto, type VibexMessageDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useFormFactor } from "@/lib/form-factor";
import { formatDate, formatShortDate, useLanguage, useT } from "@/lib/i18n";
import { ATTACHMENT_ACCEPT } from "@/apps/mail/attachments";
import { WindowHeader } from "@/os/window-context";
import { EmptyState, IconButton, Skeleton, Spinner } from "@/ui/controls";
import { MenuList, Popover, Sheet, toast, usePopover, type MenuItem } from "@/ui/overlays";
import { checkVibexFile, filesApi, markRead, useChat, useChats, useMessages, useSendMessage, useSetPins } from "./data";
import { FileChip, Lightbox, VibexImage, VibexVideoTile } from "./media";
import { CircleBubble, VoiceBubble } from "./media-bubbles";
import { CircleRecorder, VoiceRecordingBar, recordingSupported, useRecorder, type RecordKind } from "./recorder";
import { CallSheet, type CallKind } from "./calls";
import { useSession } from "@/lib/session";
import { NestedPost, UnavailablePost } from "./posts";
import { markVisible, useVibex } from "./store";

const EASE = [0.22, 1, 0.36, 1] as const;
/** Press-and-hold before a pinned chat lifts (touch and mouse alike). */
const HOLD_MS = 320;
const MOVE_TOLERANCE = 8;

// ------------------------------------------------------------------ list

function Preview({ chat }: { chat: VibexChatDto }) {
  const t = useT();
  const m = chat.lastMessage;
  if (!m) return <span className="text-text-tertiary">{t("vibex.chat.empty", { name: chat.peer.firstName })}</span>;
  const what = m.kind === "voice"
    ? t("vibex.voice.message")
    : m.kind === "circle"
      ? t("vibex.circle.message")
      : m.text
    ? m.text
    : m.sharedPost !== undefined
      ? t("vibex.chats.sharedPost")
      : m.files.some((f) => f.kind === "image")
        ? t("vibex.chats.photo")
        : t("vibex.chats.file");
  return (
    <>
      {m.mine && <span className="text-text-secondary">{t("vibex.chats.you")} </span>}
      {m.kind === "text" && !m.text && m.files.length > 0 &&
        (m.files.some((f) => f.kind === "image") ? (
          <RiImageLine className="-mt-0.5 mr-1 inline size-3.5 text-text-tertiary" />
        ) : (
          <RiAttachment2 className="-mt-0.5 mr-1 inline size-3.5 text-text-tertiary" />
        ))}
      {what}
    </>
  );
}

function ChatRowBody({ chat, active }: { chat: VibexChatDto; active: boolean }) {
  const lang = useLanguage();
  const read = chat.lastMessage?.mine && chat.peerReadAt && chat.peerReadAt >= chat.lastMessage.createdAt;
  return (
    <>
      <Avatar name={chat.peer.name} userId={chat.peer.id} version={chat.peer.avatarVersion} size={50} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cx("min-w-0 flex-1 truncate text-[15px] font-semibold", active ? "text-primary-strong" : "text-text")}>{chat.peer.name}</span>
          {chat.lastMessage?.mine &&
            (read ? <RiCheckDoubleLine className="size-4 shrink-0 text-primary" /> : <RiCheckLine className="size-4 shrink-0 text-text-tertiary" />)}
          <span className={cx("shrink-0 text-[12px] tabular-nums text-text-tertiary", HOVER_HIDE)}>{chat.lastMessage ? formatShortDate(chat.lastMessage.createdAt, lang) : ""}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="line-clamp-1 min-w-0 flex-1 text-[14px] text-text-secondary">
            <Preview chat={chat} />
          </span>
          {chat.unread > 0 ? (
            <span className={cx("flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[12px] font-semibold text-white", HOVER_HIDE)} data-testid="chat-unread">
              {chat.unread}
            </span>
          ) : chat.pinnedPosition !== null ? (
            <RiPushpin2Fill className="size-4 shrink-0 rotate-45 text-text-tertiary" aria-hidden />
          ) : null}
        </span>
      </span>
    </>
  );
}

/** With a mouse, the row's [...] button takes the place of the time and the counter on hover. */
const HOVER_HIDE = "transition-opacity [@media(hover:hover)]:group-hover:opacity-0";

function rowClass(active: boolean) {
  return cx(
    "flex w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-left transition-colors",
    active ? "bg-primary-soft" : "hover:bg-surface-hover",
  );
}

/** Row actions: right-click / [...] on desktop, press-and-hold on phones. */
function useChatMenu(chat: VibexChatDto, pinnedIds: string[]) {
  const t = useT();
  const setPins = useSetPins();
  const push = useVibex((s) => s.push);
  const pinned = chat.pinnedPosition !== null;
  const items: MenuItem[] = [
    pinned
      ? { id: "unpin", label: t("vibex.chats.unpin"), icon: <RiUnpinLine className="size-5" />, onSelect: () => setPins.mutate(pinnedIds.filter((id) => id !== chat.id)) }
      : { id: "pin", label: t("vibex.chats.pin"), icon: <RiPushpinLine className="size-5" />, onSelect: () => setPins.mutate([chat.id, ...pinnedIds]) },
    { id: "profile", label: t("vibex.chats.profile"), icon: <RiUserLine className="size-5" />, onSelect: () => push({ kind: "person", id: chat.peer.id }) },
  ];
  return items;
}

function RowMenu({ chat, pinnedIds, open, onClose, anchor }: { chat: VibexChatDto; pinnedIds: string[]; open: boolean; onClose: () => void; anchor: React.RefObject<HTMLElement | null> }) {
  const ff = useFormFactor();
  const items = useChatMenu(chat, pinnedIds);
  if (ff === "mobile") {
    return (
      <Sheet open={open} onClose={onClose} title={chat.peer.name} testId="chat-menu">
        <MenuList items={items} onDone={onClose} />
      </Sheet>
    );
  }
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} width={230} testId="chat-menu">
      <MenuList items={items} onDone={onClose} />
    </Popover>
  );
}

/** A regular chat: tap opens it; it never moves by hand (its place follows activity). */
function ChatRow({ chat, pinnedIds }: { chat: VibexChatDto; pinnedIds: string[] }) {
  const t = useT();
  const openChat = useVibex((s) => s.openChat);
  const activeId = useVibex((s) => s.chatId);
  const pop = usePopover();
  const hold = useHold({ onHold: () => pop.setOpen(true) });
  return (
    <div className="group relative" data-testid="chat-row" data-chat-id={chat.id} data-pinned="false">
      <button
        type="button"
        className={rowClass(activeId === chat.id)}
        onClick={() => !hold.fired() && openChat(chat.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          pop.setOpen(true);
        }}
        {...hold.handlers}
      >
        <ChatRowBody chat={chat} active={activeId === chat.id} />
      </button>
      <IconButton
        ref={pop.anchor}
        label={t("vibex.post.more")}
        size="sm"
        className="absolute right-3 top-1/2 hidden -translate-y-1/2 bg-surface shadow-tile [@media(hover:hover)]:group-hover:inline-flex"
        onClick={pop.toggle}
        data-testid="chat-row-menu"
      >
        <RiMoreFill className="size-4" />
      </IconButton>
      <RowMenu chat={chat} pinnedIds={pinnedIds} open={pop.open} onClose={pop.close} anchor={pop.anchor} />
    </div>
  );
}

/**
 * After a press-and-hold the browser still delivers a click where the finger was
 * lifted — by then that spot is the menu's backdrop. Swallow that one click.
 */
function swallowNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  const done = () => {
    window.removeEventListener("click", stop, true);
    window.clearTimeout(timer);
  };
  window.addEventListener("click", stop, true);
  const timer = window.setTimeout(done, 700);
}

/**
 * Press-and-hold detector. Moving before the hold fires cancels it (that was a
 * scroll); `fired()` lets the click handler ignore the click that ends a hold.
 */
function useHold({ onHold, ms = HOLD_MS }: { onHold: (e: PointerEvent) => void; ms?: number }) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const cancel = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  return {
    fired: () => {
      const f = firedRef.current;
      firedRef.current = false;
      return f;
    },
    handlers: {
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.button !== 0) return;
        firedRef.current = false;
        const native = e.nativeEvent;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          timer.current = null;
          firedRef.current = true;
          if (native.pointerType !== "mouse") swallowNextClick();
          onHold(native);
        }, ms);
      },
      onPointerMove: (e: ReactPointerEvent) => {
        if (!start.current || !timer.current) return;
        if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > MOVE_TOLERANCE) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: () => timer.current && cancel(),
    },
  };
}

/**
 * A pinned chat. Press and hold lifts it (shadow, slight scale), the other
 * pinned chats fade back, and it can be dragged to a new place among the
 * pinned ones; the rest slide out of the way. Releasing settles it, and the
 * new order is saved to the account. Releasing without moving opens the menu.
 */
function PinnedRow({
  chat,
  pinnedIds,
  dragging,
  onLift,
  onDrop,
}: {
  chat: VibexChatDto;
  pinnedIds: string[];
  dragging: string | null;
  onLift: (id: string) => void;
  onDrop: (moved: boolean) => void;
}) {
  const t = useT();
  const openChat = useVibex((s) => s.openChat);
  const activeId = useVibex((s) => s.chatId);
  const controls = useDragControls();
  const pop = usePopover();
  const moved = useRef(false);
  const lifted = dragging === chat.id;
  const stopScroll = useRef<(() => void) | null>(null);
  const hold = useHold({
    onHold: (e) => {
      moved.current = false;
      onLift(chat.id);
      if (navigator.vibrate) navigator.vibrate(8);
      // While lifted, a finger moves the chat instead of scrolling the list.
      const block = (ev: TouchEvent) => ev.cancelable && ev.preventDefault();
      window.addEventListener("touchmove", block, { passive: false });
      stopScroll.current = () => window.removeEventListener("touchmove", block);
      controls.start(e, { snapToCursor: false });
    },
  });
  useEffect(() => () => stopScroll.current?.(), []);

  return (
    <Reorder.Item
      value={chat.id}
      dragListener={false}
      dragControls={controls}
      layout="position"
      className="relative list-none"
      style={{ zIndex: lifted ? 5 : 0, position: "relative" }}
      animate={{ opacity: dragging && !lifted ? 0.45 : 1, scale: lifted ? 1.03 : 1 }}
      transition={{ duration: 0.22, ease: EASE }}
      onDrag={(_, info) => {
        if (Math.abs(info.offset.y) > 4) moved.current = true;
      }}
      onDragEnd={() => {
        stopScroll.current?.();
        stopScroll.current = null;
        onDrop(moved.current);
        if (!moved.current) pop.setOpen(true);
      }}
      data-testid="chat-row"
      data-chat-id={chat.id}
      data-pinned="true"
      data-lifted={lifted || undefined}
    >
      <motion.div
        className={cx("group relative rounded-[20px]", lifted && "bg-surface")}
        animate={{ boxShadow: lifted ? "0 18px 42px rgba(30, 20, 80, 0.20), 0 2px 6px rgba(30, 20, 80, 0.08)" : "0 0 0 rgba(0,0,0,0)" }}
        transition={{ duration: 0.22 }}
      >
        <button
          type="button"
          className={cx(rowClass(activeId === chat.id && !lifted), "touch-pan-y select-none")}
          onClick={() => !hold.fired() && openChat(chat.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            pop.setOpen(true);
          }}
          {...hold.handlers}
        >
          <ChatRowBody chat={chat} active={activeId === chat.id} />
        </button>
        <IconButton
          ref={pop.anchor}
          label={t("vibex.post.more")}
          size="sm"
          className={cx("absolute right-3 top-1/2 hidden -translate-y-1/2 bg-surface shadow-tile", !dragging && "[@media(hover:hover)]:group-hover:inline-flex")}
          onClick={pop.toggle}
          data-testid="chat-row-menu"
        >
          <RiMoreFill className="size-4" />
        </IconButton>
      </motion.div>
      <RowMenu chat={chat} pinnedIds={pinnedIds} open={pop.open} onClose={pop.close} anchor={pop.anchor} />
    </Reorder.Item>
  );
}

export function ChatList() {
  const t = useT();
  const chats = useChats();
  const go = useVibex((s) => s.go);
  const setPins = useSetPins();
  const list = chats.data ?? [];
  const serverPinned = useMemo(() => list.filter((c) => c.pinnedPosition !== null).map((c) => c.id), [list]);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const pinnedIds = order ?? serverPinned;
  const byId = useMemo(() => new Map(list.map((c) => [c.id, c])), [list]);
  const regular = list.filter((c) => c.pinnedPosition === null);

  if (chats.isPending) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[70px] rounded-[20px]" />
        ))}
      </div>
    );
  }
  if (!list.length) {
    return (
      <EmptyState
        icon={<RiSendPlaneFill className="size-7" />}
        title={t("vibex.chats.empty")}
        hint={t("vibex.chats.emptyHint")}
        action={
          <button type="button" className="pressable mt-1 rounded-2xl bg-primary px-4 py-2.5 text-[14px] font-semibold text-white" onClick={() => go("people")}>
            {t("vibex.chats.new")}
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col p-2" data-testid="chat-list">
      {pinnedIds.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-1 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
            <RiPushpin2Fill className="size-3.5 rotate-45" /> {t("vibex.chats.pinned")}
          </div>
          <Reorder.Group axis="y" values={pinnedIds} onReorder={setOrder} className="flex flex-col" data-testid="pinned-chats">
            {pinnedIds.map((id) => {
              const c = byId.get(id);
              return c ? (
                <PinnedRow
                  key={id}
                  chat={c}
                  pinnedIds={pinnedIds}
                  dragging={dragging}
                  onLift={(x) => {
                    setOrder(pinnedIds);
                    setDragging(x);
                  }}
                  onDrop={(moved) => {
                    setDragging(null);
                    const next = order ?? pinnedIds;
                    if (moved && next.join() !== serverPinned.join()) {
                      setPins.mutate(next, { onSettled: () => setOrder(null) });
                    } else setOrder(null);
                  }}
                />
              ) : null;
            })}
          </Reorder.Group>
          {regular.length > 0 && <div className="mx-3 my-1.5 h-px bg-border" />}
        </>
      )}
      <motion.div className="flex flex-col" animate={{ opacity: dragging ? 0.45 : 1 }} transition={{ duration: 0.22 }}>
        {regular.map((c) => (
          <ChatRow key={c.id} chat={c} pinnedIds={pinnedIds} />
        ))}
      </motion.div>
      {dragging && <span className="sr-only">{t("vibex.chats.dragHint")}</span>}
    </div>
  );
}

// ---------------------------------------------------------- conversation

function dayKey(iso: string) {
  return new Date(iso).toDateString();
}

function Ticks({ msg, peerReadAt }: { msg: VibexMessageDto; peerReadAt: string | null }) {
  const t = useT();
  const read = !!peerReadAt && peerReadAt >= msg.createdAt;
  return read ? (
    <RiCheckDoubleLine className="size-[15px]" aria-label={t("vibex.chat.read")} data-testid="msg-read" />
  ) : (
    <RiCheckLine className="size-[15px]" aria-label={t("vibex.chat.sent")} data-testid="msg-sent" />
  );
}

/** Quote of the message a reply answers. */
function ReplyQuote({ reply, mine, peerName }: { reply: NonNullable<VibexMessageDto["replyTo"]>; mine: boolean; peerName: string }) {
  const t = useT();
  const me = useSession((s) => s.user)!;
  const who = reply.senderId === me.id ? t("vibex.chats.you") : peerName;
  const what = reply.kind === "voice" ? t("vibex.voice.message") : reply.kind === "circle" ? t("vibex.circle.message") : reply.text || t("vibex.chats.file");
  return (
    <div className={cx("mx-1.5 mt-1 rounded-[14px] border-l-[3px] px-2.5 py-1 text-[12.5px]", mine ? "border-white/70 bg-white/15" : "border-primary bg-primary/[0.07]")} data-testid="message-reply-quote">
      <span className={cx("block font-semibold", mine ? "text-white" : "text-primary")}>{who}</span>
      <span className={cx("line-clamp-1", mine ? "text-white/85" : "text-text-secondary")}>{what}</span>
    </div>
  );
}

function Bubble({ msg, peerReadAt, tail, peerName, onReply }: { msg: VibexMessageDto; peerReadAt: string | null; tail: boolean; peerName: string; onReply: (m: VibexMessageDto) => void }) {
  const t = useT();
  const lang = useLanguage();
  const [viewer, setViewer] = useState<number | null>(null);
  const images = msg.files.filter((f) => f.kind === "image" || (msg.kind === "text" && f.kind === "video"));
  const files = msg.files.filter((f) => (f.kind === "file" || f.kind === "audio") && msg.kind === "text");
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(msg.createdAt));
  const mine = msg.mine;
  // Phones: press and hold a message to reply to it (a mouse uses the reply button).
  const hold = useHold({ onHold: (e) => e.pointerType !== "mouse" && onReply(msg), ms: 450 }).handlers;
  const meta = (
    <span className={cx("ml-auto flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums", mine ? "text-white/75" : "text-text-tertiary")}>
      {time}
      {mine && <Ticks msg={msg} peerReadAt={peerReadAt} />}
    </span>
  );
  const replyButton = (
    <button
      type="button"
      onClick={() => onReply(msg)}
      aria-label={t("vibex.chat.reply")}
      title={t("vibex.chat.reply")}
      className="flex size-8 shrink-0 items-center justify-center self-center rounded-full text-text-tertiary opacity-0 transition hover:bg-surface-hover hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
      data-testid="message-reply"
    >
      <RiReplyLine className="size-4" />
    </button>
  );

  if (msg.kind === "circle" && msg.files[0]) {
    return (
      <div className={cx("group flex w-full items-end gap-1", mine ? "justify-end" : "justify-start")} data-testid="message" data-mine={mine} data-kind="circle" {...hold}>
        {mine && replyButton}
        <div className="flex flex-col items-end gap-1">
          {msg.replyTo && <ReplyQuote reply={msg.replyTo} mine={false} peerName={peerName} />}
          <CircleBubble file={msg.files[0]} durationMs={msg.durationMs} />
          <span className="rounded-full bg-black/35 px-2 text-[11px] tabular-nums text-white">{time}</span>
        </div>
        {!mine && replyButton}
      </div>
    );
  }

  return (
    <div className={cx("group flex w-full items-center gap-1", mine ? "justify-end" : "justify-start")} data-testid="message" data-mine={mine} data-kind={msg.kind} {...hold}>
      {mine && replyButton}
      <div
        className={cx(
          "flex max-w-[min(78%,520px)] flex-col gap-1.5 overflow-hidden px-1 py-1",
          mine ? "bg-primary text-white" : "bg-surface text-text shadow-tile",
          "rounded-[22px]",
          tail && (mine ? "rounded-br-[8px]" : "rounded-bl-[8px]"),
        )}
      >
        {msg.replyTo && <ReplyQuote reply={msg.replyTo} mine={mine} peerName={peerName} />}
        {msg.kind === "voice" && msg.files[0] && <VoiceBubble file={msg.files[0]} durationMs={msg.durationMs} mine={mine} />}
        {images.length > 0 && (
          <div className={cx("grid gap-1 overflow-hidden rounded-[18px]", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
            {images.map((f, i) =>
              f.kind === "video" ? (
                <VibexVideoTile key={f.id} file={f} onClick={() => setViewer(i)} className={cx(images.length === 1 ? "max-h-[320px] min-h-[140px] w-[260px] max-w-full" : "aspect-square w-[130px] max-w-full")} />
              ) : (
                <VibexImage key={f.id} file={f} onClick={() => setViewer(i)} className={cx(images.length === 1 ? "max-h-[320px] min-h-[140px] w-[260px] max-w-full" : "aspect-square w-[130px] max-w-full")} />
              ),
            )}
          </div>
        )}
        {files.map((f) => (
          <FileChip key={f.id} file={f} tone={mine ? "mine" : "default"} />
        ))}
        {msg.sharedPost !== undefined && (
          <div className="w-[300px] max-w-full text-text" data-testid="message-shared-post">
            <div className={cx("flex items-center gap-1 px-2 pb-1 text-[12px]", mine ? "text-white/80" : "text-text-tertiary")}>
              <RiShareForwardLine className="size-3.5" /> {t("vibex.chats.sharedPost")}
            </div>
            {msg.sharedPost ? <NestedPost post={msg.sharedPost} /> : <UnavailablePost className="bg-surface" />}
          </div>
        )}
        <div className="flex items-end gap-2 px-2.5 pb-1">
          {msg.text && (
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-0.5 text-[15px] leading-[1.4]" data-selectable>
              {msg.text}
            </p>
          )}
          {meta}
        </div>
      </div>
      {!mine && replyButton}
      <Lightbox files={images} index={viewer} onIndex={setViewer} />
    </div>
  );
}

function Messages({ chat, onReply }: { chat: VibexChatDto; onReply: (m: VibexMessageDto) => void }) {
  const t = useT();
  const lang = useLanguage();
  const q = useMessages(chat.id);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const top = useRef<HTMLDivElement>(null);

  // Load older messages when the top comes into view.
  useEffect(() => {
    if (!q.hasNextPage || !top.current) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && !q.isFetchingNextPage && void q.fetchNextPage(), { rootMargin: "300px" });
    io.observe(top.current);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage, q]);

  // Reading: everything on screen counts as read.
  const newest = items[0];
  useEffect(() => {
    if (!newest || newest.mine || document.visibilityState !== "visible") return;
    void markRead(chat.id).catch(() => undefined);
  }, [newest?.id, chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-text-tertiary">
        <Avatar name={chat.peer.name} userId={chat.peer.id} version={chat.peer.avatarVersion} size={72} />
        <span className="text-[15px]">{t("vibex.chat.empty", { name: chat.peer.firstName })}</span>
      </div>
    );
  }
  // Rendered bottom-up (column-reverse keeps the newest at the bottom without scroll math).
  return (
    <div className="scroll-area flex flex-1 flex-col-reverse gap-1 px-3 py-3 sm:px-5" data-testid="messages">
      {items.map((m, i) => {
        const older = items[i + 1];
        const newer = items[i - 1];
        const tail = !newer || newer.mine !== m.mine || dayKey(newer.createdAt) !== dayKey(m.createdAt);
        const dayBreak = !older || dayKey(older.createdAt) !== dayKey(m.createdAt);
        return (
          <div key={m.id} className={cx("flex flex-col", older && older.mine !== m.mine && "mt-2")}>
            {dayBreak && (
              <div className="my-2 flex justify-center">
                <span className="vx-glass rounded-full px-3 py-1 text-[12px] font-medium text-text-secondary">{formatDate(m.createdAt, lang, { day: "numeric", month: "long" })}</span>
              </div>
            )}
            <Bubble msg={m} peerReadAt={chat.peerReadAt} tail={tail} peerName={chat.peer.name} onReply={onReply} />
          </div>
        );
      })}
      <div ref={top} className="flex justify-center py-2">
        {q.isFetchingNextPage && <Spinner />}
      </div>
    </div>
  );
}

type Pending = { key: string; name: string };

function MessageComposer({ chatId, replyTo, onClearReply, peerName }: { chatId: string; replyTo: VibexMessageDto | null; onClearReply: () => void; peerName: string }) {
  const t = useT();
  const ff = useFormFactor();
  const me = useSession((s) => s.user)!;
  const send = useSendMessage(chatId);
  const voice = useRecorder("voice");
  const circle = useRecorder("circle");
  const [sendingRec, setSendingRec] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<VibexFileDto[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [text]);

  const add = async (list: FileList | null) => {
    if (!list) return;
    for (const file of [...list].slice(0, Math.max(0, VIBEX_FILES_MAX - files.length - pending.length))) {
      const bad = checkVibexFile(file, "message");
      if (bad) {
        toast({ title: t(`error.${bad}`), body: file.name, tone: "danger" });
        continue;
      }
      const key = `${file.name}-${Math.random()}`;
      setPending((p) => [...p, { key, name: file.name }]);
      try {
        const dto = await filesApi.upload(file, "message");
        setFiles((f) => [...f, dto]);
      } catch (e) {
        toast({ title: errorMessage(t, e), body: file.name, tone: "danger" });
      } finally {
        setPending((p) => p.filter((x) => x.key !== key));
      }
    }
  };

  const canSend = (text.trim().length > 0 || files.length > 0) && !pending.length && !send.isPending;
  const submit = async () => {
    if (!canSend) return;
    const body = { text, fileIds: files.map((f) => f.id), ...(replyTo ? { replyToId: replyTo.id } : {}) };
    setText("");
    setFiles([]);
    onClearReply();
    try {
      await send.mutateAsync(body);
    } catch (e) {
      setText(body.text);
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
    area.current?.focus();
  };

  /** Starts a voice message / video circle (microphone / camera permission is asked by the browser). */
  const record = async (kind: RecordKind) => {
    if (!recordingSupported(kind)) {
      toast({ title: t("vibex.voice.unsupported"), tone: "danger" });
      return;
    }
    try {
      await (kind === "voice" ? voice : circle).start();
    } catch {
      toast({ title: t(kind === "voice" ? "vibex.voice.noMic" : "vibex.circle.noCamera"), tone: "danger" });
    }
  };
  const sendRecording = async (kind: RecordKind) => {
    setSendingRec(true);
    try {
      const rec = await (kind === "voice" ? voice : circle).stop();
      if (!rec) return;
      const dto = await filesApi.upload(rec.file, kind);
      await send.mutateAsync({ text: "", fileIds: [dto.id], kind, durationMs: rec.durationMs, ...(replyTo ? { replyToId: replyTo.id } : {}) });
      onClearReply();
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setSendingRec(false);
    }
  };
  const empty = !text.trim() && !files.length && !pending.length;

  return (
    <div className="shrink-0 px-3 pb-[max(var(--safe-bottom),10px)] pt-2 sm:px-4">
      <AnimatePresence initial={false}>
        {(files.length > 0 || pending.length > 0) && (
          <motion.div className="mb-2 flex flex-wrap gap-2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} data-testid="composer-files">
            {files.map((f) => (
              <span key={f.id} className="relative">
                {f.kind === "image" ? (
                  <VibexImage file={f} className="size-16 rounded-2xl" />
                ) : (
                  <span className="flex h-16 max-w-[180px] items-center gap-2 rounded-2xl bg-surface px-3 text-[13px] shadow-tile">
                    <RiFileLine className="size-5 shrink-0 text-text-tertiary" />
                    <span className="truncate">{f.filename}</span>
                  </span>
                )}
                <button
                  type="button"
                  className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-[rgba(20,20,30,0.7)] text-white"
                  aria-label={t("common.remove")}
                  onClick={() => {
                    setFiles((x) => x.filter((y) => y.id !== f.id));
                    void filesApi.discard(f.id).catch(() => undefined);
                  }}
                >
                  <RiCloseLine className="size-4" />
                </button>
              </span>
            ))}
            {pending.map((p) => (
              <span key={p.key} className="flex size-16 items-center justify-center rounded-2xl bg-surface text-text-tertiary shadow-tile" title={p.name}>
                <Spinner />
              </span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl bg-surface px-3 py-1.5 shadow-tile" data-testid="composer-reply">
          <RiReplyLine className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-[13px]">
            <span className="block font-semibold text-primary">{replyTo.senderId === me.id ? t("vibex.chats.you") : peerName}</span>
            <span className="line-clamp-1 text-text-secondary">
              {replyTo.kind === "voice" ? t("vibex.voice.message") : replyTo.kind === "circle" ? t("vibex.circle.message") : replyTo.text || t("vibex.chats.file")}
            </span>
          </span>
          <button type="button" onClick={onClearReply} aria-label={t("common.cancel")} className="flex size-7 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-hover" data-testid="composer-reply-cancel">
            <RiCloseLine className="size-4" />
          </button>
        </div>
      )}
      <AnimatePresence>
        {circle.state !== "idle" && <CircleRecorder stream={circle.stream} elapsed={circle.elapsed} max={circle.max} onCancel={circle.cancel} onSend={() => void sendRecording("circle")} sending={sendingRec} />}
      </AnimatePresence>
      {voice.state === "recording" ? (
        <VoiceRecordingBar elapsed={voice.elapsed} levels={voice.levels.current} onCancel={voice.cancel} onSend={() => void sendRecording("voice")} sending={sendingRec} />
      ) : (
      <div className="vx-glass-strong flex items-end gap-1 rounded-[26px] p-1.5">
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          accept={ATTACHMENT_ACCEPT}
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = "";
          }}
          data-testid="chat-file"
        />
        <IconButton label={t("vibex.chat.attach")} onClick={() => input.current?.click()} disabled={files.length + pending.length >= VIBEX_FILES_MAX} data-testid="chat-attach">
          <RiAttachment2 className="size-5" />
        </IconButton>
        <textarea
          ref={area}
          rows={1}
          value={text}
          maxLength={VIBEX_MESSAGE_MAX}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && ff === "desktop" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={t("vibex.chat.placeholder")}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-[1.35] outline-none placeholder:text-text-tertiary"
          data-testid="chat-input"
        />
        {empty ? (
          <>
            <IconButton label={t("vibex.circle.record")} onClick={() => void record("circle")} data-testid="chat-circle">
              <RiCameraLensLine className="size-5" />
            </IconButton>
            <motion.button
              type="button"
              onClick={() => void record("voice")}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-white"
              whileTap={{ scale: 0.9 }}
              aria-label={t("vibex.voice.record")}
              title={t("vibex.voice.record")}
              data-testid="chat-voice"
            >
              {voice.state === "starting" ? <Spinner size={16} /> : <RiMicLine className="size-[19px]" />}
            </motion.button>
          </>
        ) : (
          <motion.button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-opacity disabled:opacity-35"
            whileTap={{ scale: 0.9 }}
            aria-label={t("vibex.chat.send")}
            data-testid="chat-send"
          >
            {send.isPending ? <Spinner size={16} /> : <RiSendPlaneFill className="size-[18px]" />}
          </motion.button>
        )}
      </div>
      )}
    </div>
  );
}

export function Conversation({ chatId, onBack }: { chatId: string; onBack?: () => void }) {
  const t = useT();
  const chat = useChat(chatId);
  const push = useVibex((s) => s.push);
  const [replyTo, setReplyTo] = useState<VibexMessageDto | null>(null);
  const [call, setCall] = useState<CallKind | null>(null);
  useEffect(() => markVisible(chatId), [chatId]);
  if (!chat.data) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-tertiary">
        {chat.isError ? t("vibex.chat.unavailable") : <Spinner />}
      </div>
    );
  }
  const c = chat.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="conversation" data-chat-id={chatId}>
      <WindowHeader className="border-b px-2 sm:px-3">
        {onBack && (
          <IconButton label={t("common.back")} onClick={onBack} data-testid="chat-back">
            <RiArrowLeftSLine className="size-7" />
          </IconButton>
        )}
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => push({ kind: "person", id: c.peer.id })}>
          <Avatar name={c.peer.name} userId={c.peer.id} version={c.peer.avatarVersion} size={38} />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold">{c.peer.name}</span>
            <span className="block truncate text-[12px] text-text-tertiary">{c.peer.address}</span>
          </span>
        </button>
        <IconButton label={t("vibex.call.audio")} onClick={() => setCall("audio")} data-testid="chat-call-audio">
          <RiPhoneLine className="size-5" />
        </IconButton>
        <IconButton label={t("vibex.call.video")} onClick={() => setCall("video")} data-testid="chat-call-video">
          <RiVidiconLine className="size-5" />
        </IconButton>
      </WindowHeader>
      <div className="flex min-h-0 flex-1 flex-col bg-surface-secondary/50">
        <Messages chat={c} onReply={setReplyTo} />
        <MessageComposer chatId={chatId} key={chatId} replyTo={replyTo} onClearReply={() => setReplyTo(null)} peerName={c.peer.name} />
      </div>
      <CallSheet kind={call} peer={c.peer} onClose={() => setCall(null)} />
    </div>
  );
}
