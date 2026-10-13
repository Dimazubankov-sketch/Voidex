import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import {
  RiArrowLeftSLine,
  RiAttachment2,
  RiCheckDoubleLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFileLine,
  RiImageLine,
  RiMic2Fill,
  RiMoreFill,
  RiPushpin2Fill,
  RiSendPlaneFill,
  RiShareForwardLine,
  RiPencilLine,
  RiPhoneLine,
  RiReplyLine,
  RiVidiconLine,
  RiVolumeMuteFill,
} from "@remixicon/react";
import { VIBEX_FILES_MAX, VIBEX_MESSAGE_MAX, chatSections, type VibexChatDto, type VibexChatOrder, type VibexFileDto, type VibexMessageDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useFormFactor } from "@/lib/form-factor";
import { formatDate, formatShortDate, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { ATTACHMENT_ACCEPT } from "@/apps/mail/attachments";
import { NotesFileCard } from "@/apps/notes/card";
import { WindowHeader } from "@/os/window-context";
import { EmptyState, IconButton, Skeleton, Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { UploadCancelled, checkVibexFile, filesApi, markRead, uploadWithProgress, useChat, useChats, useEditMessage, useFileUrl, useMessages, useSendMessage, useSetPins } from "./data";
import { FileChip, Lightbox } from "./media";
import { VideoMessageGlyph, VoiceBubble } from "./media-bubbles";
import { ForwardSheet, MessageMenu, PinnedBar, SelectDot, SelectionBar, SwipeReplyIcon, useSwipeReply, type MessageMenuState } from "./message-actions";
import { CircleBubble } from "./circle-player";
import { type RecordKind, type Recording } from "./recorder";
import { RecordButton } from "./record-button";
import { CallSheet, type CallKind } from "./calls";
import { useSession } from "@/lib/session";
import { NestedPost, UnavailablePost } from "./posts";
import { markVisible, useVibex } from "./store";
import { ChatAvatar, GroupAvatar, GroupInfoSheet, chatTitle } from "./groups";
import { StoryHalo } from "./stories";
import { MediaMosaic } from "./mosaic";
import { AttachSourceSheet } from "@/os/share/attach-source";

const EASE = [0.22, 1, 0.36, 1] as const;
/** Press-and-hold before a pinned chat lifts (touch and mouse alike). */
const HOLD_MS = 320;
const MOVE_TOLERANCE = 8;

// ------------------------------------------------------------------ list

function Preview({ chat }: { chat: VibexChatDto }) {
  const t = useT();
  const m = chat.lastMessage;
  if (!m) return <span className="text-text-tertiary">{chat.group ? t("vibex.group.created") : t("vibex.chat.empty", { name: chat.peer?.firstName ?? "" })}</span>;
  // Groups: who wrote it.
  const author = chat.group && !m.mine ? chat.group.members.find((x) => x.id === m.senderId)?.firstName : null;
  // Step 2.11: voice and video messages read with their marks (the same video mark as the record button).
  const mark = m.kind === "voice" ? <RiMic2Fill className="-mt-0.5 mr-1 inline size-3.5 text-text-tertiary" /> : m.kind === "circle" ? <VideoMessageGlyph className="-mt-0.5 mr-1 inline size-[15px] text-text-tertiary" /> : null;
  const what = m.kind === "voice"
    ? t("vibex.voice.message")
    : m.kind === "circle"
      ? t("vibex.circle.message")
      : m.text
    ? m.text
    : m.notesCard
      ? `📄 ${m.notesCard.title}${m.notesCard.ext}`
    : m.sharedPost !== undefined
      ? t("vibex.chats.sharedPost")
      : m.files.some((f) => f.kind === "image")
        ? t("vibex.chats.photo")
        : t("vibex.chats.file");
  return (
    <>
      {m.mine && <span className="text-text-secondary">{t("vibex.chats.you")} </span>}
      {author && <span className="text-text-secondary">{author}: </span>}
      {mark}
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
  const t = useT();
  const lang = useLanguage();
  const read = chat.lastMessage?.mine && chat.peerReadAt && chat.peerReadAt >= chat.lastMessage.createdAt;
  return (
    <>
      <StoryHalo personId={chat.peer?.id} gap="ring-[var(--chat-card)]">
        <ChatAvatar chat={chat} size={50} />
      </StoryHalo>
      <span className="min-w-0 flex-1 self-stretch py-[9px] pr-3">
        <span className="flex items-center gap-1">
          <span className={cx("min-w-0 truncate text-[15.5px] font-semibold tracking-[-0.01em]", active ? "text-primary-strong" : "text-text")}>{chatTitle(chat)}</span>
          {chat.muted && <RiVolumeMuteFill className="size-[14px] shrink-0 text-text-tertiary/80" aria-label={t("vibex.chats.muted")} data-testid="chat-muted" />}
          <span className="min-w-2 flex-1" />
          {chat.lastMessage?.mine &&
            (read ? <RiCheckDoubleLine className="size-[15px] shrink-0 text-primary" /> : <RiCheckLine className="size-[15px] shrink-0 text-text-tertiary" />)}
          <span className={cx("shrink-0 text-[12px] tabular-nums", chat.unread > 0 && !chat.muted ? "font-medium text-primary" : "text-text-tertiary", HOVER_HIDE)}>
            {chat.lastMessage ? formatShortDate(chat.lastMessage.createdAt, lang) : ""}
          </span>
        </span>
        <span className="mt-[3px] flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] leading-snug text-text-secondary">
            <Preview chat={chat} />
          </span>
          {chat.pinnedPosition !== null && (
            <RiPushpin2Fill className={cx("size-[14px] shrink-0 rotate-45 text-text-tertiary/80", HOVER_HIDE)} aria-label={t("vibex.chats.pinnedOne")} data-testid="chat-pinned" />
          )}
          {chat.unread > 0 && (
            <span
              className={cx("flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[12px] font-semibold tabular-nums", chat.muted ? "bg-[var(--chat-badge-muted)] text-white" : "bg-primary text-white", HOVER_HIDE)}
              data-testid="chat-unread"
            >
              {chat.unread > 999 ? "999+" : chat.unread}
            </span>
          )}
        </span>
      </span>
    </>
  );
}

/** With a mouse, the row's [...] button takes the place of the time and the counter on hover. */
const HOVER_HIDE = "transition-opacity [@media(hover:hover)]:group-hover:opacity-0";

/**
 * Step 2.11: every chat is its own quiet card (semantic tokens: --chat-card,
 * --chat-card-shadow, --chat-card-active; light, Media / Notes looks and dark
 * each set them). The open chat (PC) reads as selected by tone and a thin
 * violet edge, never by a heavy border.
 */
function rowClass(active: boolean) {
  return cx(
    "vx-chat-card flex w-full items-center gap-3 rounded-[22px] pl-2.5 text-left transition-[background-color,box-shadow,filter] duration-150",
    active ? "vx-chat-card-active" : "[@media(hover:hover)]:hover:brightness-[0.985] active:brightness-[0.97]",
  );
}

/** Step 2.9: what a chat row asks its list for — the preview (phones: long press) and the actions menu (PC: right click / [...]). */
export interface ChatRowActions {
  pinnedIds: string[];
  onPreview: (chat: VibexChatDto) => void;
  onMenu: (chat: VibexChatDto, at: { x: number; y: number }) => void;
}

/**
 * A regular chat: a tap opens it; it never moves by hand (its place follows
 * activity). Step 2.9: a long press (touch) opens its preview; a right click
 * or the [...] button (mouse) its actions.
 */
function ChatRow({ chat, actions }: { chat: VibexChatDto; actions: ChatRowActions }) {
  const t = useT();
  const openChat = useVibex((s) => s.openChat);
  const activeId = useVibex((s) => s.chatId);
  const hold = useHold({ onHold: (e) => (e.pointerType === "mouse" ? actions.onMenu(chat, { x: e.clientX, y: e.clientY }) : actions.onPreview(chat)) });
  return (
    <div className="group relative" data-testid="chat-row" data-chat-id={chat.id} data-pinned="false" data-kind={chat.kind}>
      <button
        type="button"
        className={rowClass(activeId === chat.id)}
        onClick={() => !hold.fired() && openChat(chat.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          actions.onMenu(chat, { x: e.clientX, y: e.clientY });
        }}
        {...hold.handlers}
      >
        <ChatRowBody chat={chat} active={activeId === chat.id} />
      </button>
      <IconButton
        label={t("vibex.post.more")}
        size="sm"
        // "!": IconButton is inline-flex itself; without it the button covered the time and unread badge on every row.
        className="absolute right-3 top-1/2 !hidden -translate-y-1/2 bg-surface shadow-tile [@media(hover:hover)]:group-hover:!inline-flex"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          actions.onMenu(chat, { x: r.left, y: r.bottom });
        }}
        data-testid="chat-row-menu"
      >
        <RiMoreFill className="size-4" />
      </IconButton>
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
 * new order is saved to the account. Releasing without moving opens its
 * preview (touch) or its actions (mouse).
 */
function PinnedRow({
  chat,
  actions,
  dragging,
  onLift,
  onDrop,
}: {
  chat: VibexChatDto;
  actions: ChatRowActions;
  dragging: string | null;
  onLift: (id: string) => void;
  onDrop: (moved: boolean) => void;
}) {
  const t = useT();
  const openChat = useVibex((s) => s.openChat);
  const activeId = useVibex((s) => s.chatId);
  const controls = useDragControls();
  const moved = useRef(false);
  const last = useRef<{ x: number; y: number; mouse: boolean }>({ x: 0, y: 0, mouse: false });
  const lifted = dragging === chat.id;
  const stopScroll = useRef<(() => void) | null>(null);
  const hold = useHold({
    onHold: (e) => {
      moved.current = false;
      last.current = { x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse" };
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
        if (!moved.current) {
          if (last.current.mouse) actions.onMenu(chat, last.current);
          else actions.onPreview(chat);
        }
      }}
      data-testid="chat-row"
      data-chat-id={chat.id}
      data-pinned="true"
      data-kind={chat.kind}
      data-lifted={lifted || undefined}
    >
      <motion.div
        className={cx("group relative rounded-[18px]", lifted && "bg-surface")}
        animate={{ boxShadow: lifted ? "0 18px 42px rgba(30, 20, 80, 0.20), 0 2px 6px rgba(30, 20, 80, 0.08)" : "0 0 0 rgba(0,0,0,0)" }}
        transition={{ duration: 0.22 }}
      >
        <button
          type="button"
          className={cx(rowClass(activeId === chat.id && !lifted), "touch-pan-y select-none")}
          onClick={() => !hold.fired() && openChat(chat.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            actions.onMenu(chat, { x: e.clientX, y: e.clientY });
          }}
          {...hold.handlers}
        >
          <ChatRowBody chat={chat} active={activeId === chat.id} />
        </button>
        <IconButton
          label={t("vibex.post.more")}
          size="sm"
          className={cx("absolute right-3 top-1/2 !hidden -translate-y-1/2 bg-surface shadow-tile", !dragging && "[@media(hover:hover)]:group-hover:!inline-flex")}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            actions.onMenu(chat, { x: r.left, y: r.bottom });
          }}
          data-testid="chat-row-menu"
        >
          <RiMoreFill className="size-4" />
        </IconButton>
      </motion.div>
    </Reorder.Item>
  );
}

const SECTION_LABEL: Record<"pinned" | "chats" | "groups" | "all", MessageKey | null> = {
  pinned: "vibex.chats.pinned",
  chats: "vibex.chats.sectionChats",
  groups: "vibex.chats.sectionGroups",
  all: null,
};

/**
 * Step 2.9 chat list: «Закреплённые» always first (their own order, press and
 * hold to rearrange), then «Чаты» and «Группы» in the order chosen with the
 * filter button, or one mixed list. Long press / right click: preview and
 * actions (see ChatsPane).
 */
export function ChatList({ actions, order }: { actions: Omit<ChatRowActions, "pinnedIds">; order: VibexChatOrder }) {
  const t = useT();
  const chats = useChats();
  const go = useVibex((s) => s.go);
  const setPins = useSetPins();
  const list = chats.data ?? [];
  const serverPinned = useMemo(() => list.filter((c) => c.pinnedPosition !== null).sort((a, b) => a.pinnedPosition! - b.pinnedPosition!).map((c) => c.id), [list]);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const pinnedIds = localOrder ?? serverPinned;
  const byId = useMemo(() => new Map(list.map((c) => [c.id, c])), [list]);
  const sections = useMemo(() => chatSections(list, order).filter((s) => s.key !== "pinned"), [list, order]);
  const rowActions: ChatRowActions = { ...actions, pinnedIds };

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

  const header = (key: keyof typeof SECTION_LABEL) =>
    SECTION_LABEL[key] && (
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary" data-testid={`chat-section-${key}`}>
        {key === "pinned" && <RiPushpin2Fill className="size-3.5 rotate-45" />} {t(SECTION_LABEL[key]!)}
      </div>
    );

  return (
    <div className="flex flex-col gap-1.5 px-2.5 pb-2" data-testid="chat-list" data-order={order}>
      {pinnedIds.length > 0 && (
        <section data-testid="chat-section" data-key="pinned">
          {header("pinned")}
          <Reorder.Group axis="y" values={pinnedIds} onReorder={setLocalOrder} className="flex flex-col gap-1.5" data-testid="pinned-chats">
            {pinnedIds.map((id) => {
              const c = byId.get(id);
              return c ? (
                <PinnedRow
                  key={id}
                  chat={c}
                  actions={rowActions}
                  dragging={dragging}
                  onLift={(x) => {
                    setLocalOrder(pinnedIds);
                    setDragging(x);
                  }}
                  onDrop={(moved) => {
                    setDragging(null);
                    const next = localOrder ?? pinnedIds;
                    if (moved && next.join() !== serverPinned.join()) {
                      setPins.mutate(next, { onSettled: () => setLocalOrder(null) });
                    } else setLocalOrder(null);
                  }}
                />
              ) : null;
            })}
          </Reorder.Group>
        </section>
      )}
      <motion.div className="flex flex-col" animate={{ opacity: dragging ? 0.45 : 1 }} transition={{ duration: 0.22 }}>
        {sections.map((sec) => (
          <section key={sec.key} className="flex flex-col gap-1.5" data-testid="chat-section" data-key={sec.key}>
            {header(sec.key)}
            {sec.items.map((c) => (
              <ChatRow key={c.id} chat={c} actions={rowActions} />
            ))}
          </section>
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
function ReplyQuote({ reply, mine, nameOf }: { reply: NonNullable<VibexMessageDto["replyTo"]>; mine: boolean; nameOf: NameOf }) {
  const t = useT();
  const me = useSession((s) => s.user)!;
  const who = reply.senderId === me.id ? t("vibex.chats.you") : nameOf(reply.senderId);
  const what =
    reply.kind === "voice"
      ? t("vibex.voice.message")
      : reply.kind === "circle"
        ? t("vibex.circle.message")
        : reply.text || t("vibex.chats.file");
  return (
    <div className={cx("mx-1.5 mt-1 rounded-[14px] border-l-[3px] px-2.5 py-1 text-[12.5px]", mine ? "border-white/70 bg-white/15" : "border-primary bg-primary/[0.07]")} data-testid="message-reply-quote">
      <span className={cx("block font-semibold", mine ? "text-white" : "text-primary")}>{who}</span>
      <span className={cx("line-clamp-1", mine ? "text-white/85" : "text-text-secondary")}>{what}</span>
    </div>
  );
}

/** Name of a chat participant by id (groups: whoever wrote; direct: the other person). */
type NameOf = (userId: string) => string;

function useNameOf(chat: VibexChatDto): NameOf {
  const t = useT();
  return useCallback(
    (id: string) => chat.peer?.name ?? chat.group?.members.find((m) => m.id === id)?.name ?? t("vibex.group.formerMember"),
    [chat, t],
  );
}

/** Step 2.10: what a message row asks its chat for (actions, multi-select). */
interface BubbleActions {
  onReply: (m: VibexMessageDto) => void;
  /** Long press / right click (or the delete button, straight on the delete choice). */
  onMenu: (m: VibexMessageDto, el: HTMLElement, deleting?: boolean) => void;
  /** Multi-select is on: a tap selects instead. */
  selecting: boolean;
  selected: boolean;
  onToggle: (m: VibexMessageDto) => void;
  /** This message's menu is open: it stays bright above the dimmed chat. */
  lifted: boolean;
}

function Bubble({
  msg,
  peerReadAt,
  tail,
  nameOf,
  author,
  actions,
}: {
  msg: VibexMessageDto;
  peerReadAt: string | null;
  tail: boolean;
  nameOf: NameOf;
  /** Groups: the sender's name above the first message of a run. */
  author?: string | null;
  actions: BubbleActions;
}) {
  const t = useT();
  const lang = useLanguage();
  const [viewer, setViewer] = useState<number | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const images = msg.files.filter((f) => f.kind === "image" || (msg.kind === "text" && f.kind === "video"));
  const files = msg.files.filter((f) => (f.kind === "file" || f.kind === "audio") && msg.kind === "text");
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(msg.createdAt));
  const mine = msg.mine;
  const { selecting, selected, lifted } = actions;
  const openMenu = (deleting?: boolean) => actions.onMenu(msg, bubble.current ?? row.current!, deleting);
  // Phones: press and hold a message for its actions; a mouse uses the right click (and the hover buttons).
  const hold = useHold({ onHold: (e) => e.pointerType !== "mouse" && !selecting && openMenu(), ms: 450 }).handlers;
  // Step 2.10: swipe left to reply (players keep their own drags).
  const swipe = useSwipeReply(() => actions.onReply(msg), !selecting);
  const meta = (
    <span className={cx("ml-auto flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums", mine ? "text-white/75" : "text-text-tertiary")}>
      {msg.editedAt && (
        <span className="mr-0.5" data-testid="message-edited">
          {t("vibex.msg.edited")}
        </span>
      )}
      {time}
      {mine && <Ticks msg={msg} peerReadAt={peerReadAt} />}
    </span>
  );
  const replyButton = !selecting && (
    <button
      type="button"
      onClick={() => actions.onReply(msg)}
      aria-label={t("vibex.chat.reply")}
      title={t("vibex.chat.reply")}
      className="flex size-8 shrink-0 items-center justify-center self-center rounded-full text-text-tertiary opacity-0 transition hover:bg-surface-hover hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
      data-testid="message-reply"
    >
      <RiReplyLine className="size-4" />
    </button>
  );
  const deleteButton = mine && !selecting && (
    <button
      type="button"
      onClick={() => openMenu(true)}
      aria-label={t("vibex.chat.delete")}
      title={t("vibex.chat.delete")}
      className="flex size-8 shrink-0 items-center justify-center self-center rounded-full text-text-tertiary opacity-0 transition hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      data-testid="message-delete"
    >
      <RiDeleteBinLine className="size-4" />
    </button>
  );
  const forwarded = msg.forwardedFrom && (
    <span className={cx("flex items-center gap-1 px-2.5 pt-1 text-[12.5px] font-medium", mine ? "text-white/85" : "text-primary")} data-testid="message-forwarded">
      <RiShareForwardLine className="size-3.5 shrink-0" />
      <span className="truncate">{t("vibex.msg.forwardedFrom", { name: msg.forwardedFrom.name })}</span>
    </span>
  );

  const body =
    msg.kind === "circle" && msg.files[0] ? (
      <div ref={bubble} className="flex flex-col items-end gap-1">
        {forwarded}
        {msg.replyTo && <ReplyQuote reply={msg.replyTo} mine={false} nameOf={nameOf} />}
        <CircleBubble file={msg.files[0]} durationMs={msg.durationMs} />
        <span className="rounded-full bg-black/35 px-2 text-[11px] tabular-nums text-white">{time}</span>
      </div>
    ) : (
      <div
        ref={bubble}
        className={cx(
          "flex max-w-[min(78%,520px)] flex-col gap-1.5 overflow-hidden px-1 py-1",
          mine ? "bg-primary text-white" : "bg-surface text-text shadow-tile",
          "rounded-[22px]",
          tail && (mine ? "rounded-br-[8px]" : "rounded-bl-[8px]"),
        )}
      >
        {author && (
          <span className="px-2.5 pt-1 text-[12.5px] font-semibold text-primary" data-testid="message-author">
            {author}
          </span>
        )}
        {forwarded}
        {msg.story && <StoryReplyRef story={msg.story} mine={mine} />}
        {msg.replyTo && <ReplyQuote reply={msg.replyTo} mine={mine} nameOf={nameOf} />}
        {msg.kind === "voice" && msg.files[0] && <VoiceBubble file={msg.files[0]} durationMs={msg.durationMs} mine={mine} />}
        {images.length > 0 && (
          // Step 2.11: a Telegram-like mosaic (one outer radius, thin gaps, no empty cells).
          <MediaMosaic items={images.map((f) => ({ key: f.id, kind: f.kind === "video" ? "video" : "image", file: f }))} onOpen={setViewer} />
        )}
        {files.map((f) => (
          <FileChip key={f.id} file={f} tone={mine ? "mine" : "default"} />
        ))}
        {msg.notesCard && (
          <div className="px-1 pt-1">
            <NotesFileCard card={msg.notesCard} tone={mine ? "mine" : "default"} />
          </div>
        )}
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
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-0.5 text-[15px] leading-[1.4]" data-selectable={!selecting || undefined}>
              {msg.text}
            </p>
          )}
          {meta}
        </div>
      </div>
    );

  return (
    <div
      ref={row}
      className={cx("group relative flex w-full items-center gap-1", lifted && "z-[31]", selecting && "cursor-pointer rounded-2xl", selected && "bg-primary/[0.08]")}
      data-testid="message"
      data-message-id={msg.id}
      data-mine={mine}
      data-kind={msg.kind === "circle" && msg.files[0] ? "circle" : msg.kind}
      data-selected={selected || undefined}
      onContextMenu={(e) => {
        if (selecting) return;
        e.preventDefault();
        openMenu();
      }}
      // Multi-select: a tap anywhere on the row selects it (nothing inside reacts).
      onClickCapture={(e) => {
        if (!selecting) return;
        e.preventDefault();
        e.stopPropagation();
        actions.onToggle(msg);
      }}
      {...hold}
      onPointerDown={(e) => {
        hold.onPointerDown(e);
        swipe.handlers.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        hold.onPointerMove(e);
        swipe.handlers.onPointerMove(e);
      }}
      onPointerUp={(e) => {
        hold.onPointerUp();
        swipe.handlers.onPointerUp(e);
      }}
      onPointerCancel={() => {
        hold.onPointerCancel();
        swipe.handlers.onPointerCancel();
      }}
    >
      {selecting && <SelectDot on={selected} />}
      <motion.div className={cx("flex min-w-0 flex-1 items-center gap-1", mine ? "justify-end" : "justify-start", selecting && "pointer-events-none")} style={{ x: swipe.x }}>
        {deleteButton}
        {mine && replyButton}
        {body}
        {!mine && replyButton}
      </motion.div>
      <SwipeReplyIcon progress={swipe.icon} />
      <Lightbox files={images} index={viewer} onIndex={setViewer} />
    </div>
  );
}

/** Step 2.11: the story a message answers (its picture while it is there, a note once it is gone). */
function StoryReplyRef({ story, mine }: { story: NonNullable<VibexMessageDto["story"]>; mine: boolean }) {
  const t = useT();
  const me = useSession((s) => s.user?.id);
  const { data: src } = useFileUrl(story.file?.id ?? null);
  return (
    <div className={cx("flex items-center gap-2.5 px-2 pt-1", mine ? "text-white/85" : "text-text-secondary")} data-testid="message-story">
      <span className={cx("relative h-[72px] w-[46px] shrink-0 overflow-hidden rounded-[10px]", mine ? "bg-white/20" : "bg-surface-secondary")}>
        {src && (story.kind === "video" ? <video src={src} muted playsInline preload="metadata" className="size-full object-cover" /> : <img src={src} alt="" loading="lazy" draggable={false} className="size-full object-cover" />)}
      </span>
      <span className="min-w-0 text-[12.5px] leading-snug">
        <span className="block font-medium">{t(story.ownerId === me ? "vibex.stories.replyToYours" : "vibex.stories.replyTo")}</span>
        {!story.file && <span className="block opacity-80">{t("vibex.stories.gone")}</span>}
      </span>
    </div>
  );
}

/**
 * Step 2.9: a chat's latest messages for its preview — read-only, and it
 * never marks anything read (no POST /read: the badge, the read marker and
 * the other person's receipts stay as they are).
 */
export function ChatPreviewMessages({ chat }: { chat: VibexChatDto }) {
  return <Messages chat={chat} preview />;
}

/** Step 2.10: what the conversation hands its message list (actions, multi-select, the open menu). */
interface ListActions {
  onReply: (m: VibexMessageDto) => void;
  onMenu: (m: VibexMessageDto, el: HTMLElement, deleting?: boolean) => void;
  selection: Set<string> | null;
  onToggle: (m: VibexMessageDto) => void;
  menuId: string | null;
  /** The loaded messages (for the selection bar). */
  onItems?: (items: VibexMessageDto[]) => void;
}

const NO_ACTIONS: ListActions = { onReply: () => undefined, onMenu: () => undefined, selection: null, onToggle: () => undefined, menuId: null };

function Messages({ chat, actions = NO_ACTIONS, preview = false }: { chat: VibexChatDto; actions?: ListActions; preview?: boolean }) {
  const t = useT();
  const lang = useLanguage();
  const q = useMessages(chat.id);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const top = useRef<HTMLDivElement>(null);
  const nameOf = useNameOf(chat);
  const { onItems } = actions;
  useEffect(() => onItems?.(items), [items, onItems]);

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
    if (preview || !newest || newest.mine || document.visibilityState !== "visible") return;
    void markRead(chat.id).catch(() => undefined);
  }, [newest?.id, chat.id, preview]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <ChatAvatar chat={chat} size={72} />
        <span className="text-[15px]">{chat.group ? t("vibex.group.emptyHint") : t("vibex.chat.empty", { name: chat.peer?.firstName ?? "" })}</span>
      </div>
    );
  }
  // Rendered bottom-up (column-reverse keeps the newest at the bottom without scroll math).
  return (
    // Step 2.10: the preview scrolls too (its own wrapper keeps every message control inert, see PreviewScroller).
    <div className="scroll-area flex flex-1 flex-col-reverse gap-1 overflow-x-hidden px-3 py-3 sm:px-5" data-testid={preview ? "preview-messages" : "messages"}>
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
            <Bubble
              msg={m}
              peerReadAt={chat.peerReadAt}
              tail={tail}
              nameOf={nameOf}
              author={chat.group && !m.mine && (!older || older.senderId !== m.senderId || dayBreak) ? nameOf(m.senderId) : null}
              actions={{
                onReply: actions.onReply,
                onMenu: actions.onMenu,
                selecting: !!actions.selection,
                selected: !!actions.selection?.has(m.id),
                onToggle: actions.onToggle,
                lifted: actions.menuId === m.id,
              }}
            />
          </div>
        );
      })}
      <div ref={top} className="flex justify-center py-2">
        {q.isFetchingNextPage && <Spinner />}
      </div>
    </div>
  );
}

/**
 * Step 2.11: an attachment in the composer: shown at once from the device
 * (object URL), uploaded with real progress, cancellable (AbortController).
 */
type Attachment = { key: string; file: File; url: string | null; kind: "image" | "video" | "file"; progress: number; ctl: AbortController; dto: VibexFileDto | null };

function MessageComposer({
  chatId,
  replyTo,
  onClearReply,
  nameOf,
  editing,
  onEditDone,
}: {
  chatId: string;
  replyTo: VibexMessageDto | null;
  onClearReply: () => void;
  nameOf: NameOf;
  /** Step 2.10: my text message being edited (the field holds its text; send saves it). */
  editing: VibexMessageDto | null;
  onEditDone: () => void;
}) {
  const t = useT();
  const ff = useFormFactor();
  const me = useSession((s) => s.user)!;
  const send = useSendMessage(chatId);
  // Step 2.9: one button for voice and video circles (a tap switches; hold to record).
  const [recMode, setRecMode] = useState<RecordKind>("voice");
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const files = attachments.flatMap((a) => (a.dto ? [a.dto] : []));
  const pending = attachments.filter((a) => !a.dto);
  const live = useRef<Attachment[]>([]);
  live.current = attachments;
  // Leaving the chat: uploads stop, previews are freed, uploaded but unsent files are discarded (nothing left behind).
  useEffect(
    () => () => {
      for (const a of live.current) {
        a.ctl.abort();
        if (a.url) URL.revokeObjectURL(a.url);
        if (a.dto) void filesApi.discard(a.dto.id).catch(() => undefined);
      }
    },
    [],
  );
  const patch = (key: string, p: Partial<Attachment>) => setAttachments((list) => list.map((a) => (a.key === key ? { ...a, ...p } : a)));
  const removeAttachment = (key: string) => {
    const a = live.current.find((x) => x.key === key);
    if (!a) return;
    a.ctl.abort();
    if (a.url) URL.revokeObjectURL(a.url);
    if (a.dto) void filesApi.discard(a.dto.id).catch(() => undefined);
    setAttachments((list) => list.filter((x) => x.key !== key));
  };
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const edit = useEditMessage(chatId);
  const draft = useRef("");
  // Step 2.10: editing puts the message's text in the field (and gives the draft back afterwards).
  useEffect(() => {
    if (editing) {
      draft.current = text;
      setText(editing.text);
      window.setTimeout(() => area.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);
  const stopEditing = (restore = true) => {
    onEditDone();
    setText(restore ? draft.current : "");
  };

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [text]);

  const [chooser, setChooser] = useState(false);
  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    for (const file of [...list].slice(0, Math.max(0, VIBEX_FILES_MAX - live.current.length))) {
      const bad = checkVibexFile(file, "message");
      if (bad) {
        toast({ title: t(`error.${bad}`), body: file.name, tone: "danger" });
        continue;
      }
      const mime = file.type || "";
      const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "file";
      const a: Attachment = { key: `${file.name}-${Math.random()}`, file, url: kind === "file" ? null : URL.createObjectURL(file), kind, progress: 0, ctl: new AbortController(), dto: null };
      live.current = [...live.current, a];
      setAttachments((l) => [...l, a]);
      void uploadWithProgress(file, "message", { signal: a.ctl.signal, onProgress: (p) => patch(a.key, { progress: p }) }).then(
        (dto) => patch(a.key, { dto, progress: 1 }),
        (e) => {
          if (e instanceof UploadCancelled) return;
          toast({ title: errorMessage(t, e), body: file.name, tone: "danger" });
          if (a.url) URL.revokeObjectURL(a.url);
          setAttachments((l) => l.filter((x) => x.key !== a.key));
        },
      );
    }
  };

  const canSend = (text.trim().length > 0 || files.length > 0) && !pending.length && !send.isPending;
  const submit = async () => {
    if (editing) {
      const next = text.trim();
      if (!next) return;
      if (next === editing.text) return stopEditing();
      try {
        await edit.mutateAsync({ id: editing.id, text: next });
        stopEditing();
      } catch (e) {
        toast({ title: errorMessage(t, e), tone: "danger" });
      }
      return;
    }
    if (!canSend) return;
    const body = { text, fileIds: files.map((f) => f.id), ...(replyTo ? { replyToId: replyTo.id } : {}) };
    const sent = live.current;
    setText("");
    live.current = [];
    setAttachments([]);
    // The previews were only for the composer; the message loads its files from the server.
    window.setTimeout(() => sent.forEach((a) => a.url && URL.revokeObjectURL(a.url)), 2000);
    onClearReply();
    try {
      await send.mutateAsync(body);
    } catch (e) {
      setText(body.text);
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
    area.current?.focus();
  };

  /** A finished voice message / video circle: uploaded through the Vibex file store, then sent as one message. */
  const sendRecording = async (kind: RecordKind, rec: Recording) => {
    const dto = await filesApi.upload(rec.file, kind);
    await send.mutateAsync({ text: "", fileIds: [dto.id], kind, durationMs: rec.durationMs, ...(replyTo ? { replyToId: replyTo.id } : {}) });
    onClearReply();
  };
  const empty = !text.trim() && !files.length && !pending.length;

  return (
    <div className="shrink-0 px-3 pb-2.5 pt-2 sm:px-4">
      <AnimatePresence initial={false}>
        {attachments.length > 0 && (
          <motion.div className="mb-2 flex flex-col gap-2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} data-testid="composer-files">
            {attachments.some((a) => a.kind !== "file") && (
              <MediaMosaic
                testId="composer-mosaic"
                className="w-[min(260px,100%)]"
                items={attachments
                  .filter((a) => a.kind !== "file")
                  .map((a) => ({
                    key: a.key,
                    kind: a.kind === "video" ? "video" : "image",
                    localUrl: a.url ?? undefined,
                    label: a.file.name,
                    progress: a.dto ? undefined : a.progress,
                    onCancel: () => removeAttachment(a.key),
                  }))}
                onOpen={() => undefined}
              />
            )}
            {attachments
              .filter((a) => a.kind === "file")
              .map((a) => (
                <span key={a.key} className="relative flex h-14 max-w-[260px] items-center gap-2 overflow-hidden rounded-2xl bg-surface px-3 text-[13px] shadow-tile" data-testid="composer-file" data-uploading={!a.dto || undefined}>
                  <RiFileLine className="size-5 shrink-0 text-text-tertiary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{a.file.name}</span>
                    {!a.dto && (
                      <span className="block text-[11.5px] tabular-nums text-text-tertiary">
                        {t("vibex.upload.loading")} {Math.round(a.progress * 100)}%
                      </span>
                    )}
                  </span>
                  {!a.dto && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-primary/80 transition-[width]" style={{ width: `${Math.round(a.progress * 100)}%` }} aria-hidden />}
                  <button
                    type="button"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-hover"
                    aria-label={a.dto ? t("common.remove") : t("vibex.upload.cancel")}
                    onClick={() => removeAttachment(a.key)}
                    data-testid="composer-file-cancel"
                  >
                    <RiCloseLine className="size-4" />
                  </button>
                </span>
              ))}
          </motion.div>
        )}
      </AnimatePresence>
      {editing && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl bg-surface px-3 py-1.5 shadow-tile" data-testid="composer-edit">
          <RiPencilLine className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-[13px]">
            <span className="block font-semibold text-primary">{t("vibex.msg.editing")}</span>
            <span className="line-clamp-1 text-text-secondary">{editing.text}</span>
          </span>
          <button type="button" onClick={() => stopEditing()} aria-label={t("common.cancel")} className="flex size-7 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-hover" data-testid="composer-edit-cancel">
            <RiCloseLine className="size-4" />
          </button>
        </div>
      )}
      {replyTo && !editing && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl bg-surface px-3 py-1.5 shadow-tile" data-testid="composer-reply">
          <RiReplyLine className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-[13px]">
            <span className="block font-semibold text-primary">{replyTo.senderId === me.id ? t("vibex.chats.you") : nameOf(replyTo.senderId)}</span>
            <span className="line-clamp-1 text-text-secondary">
              {replyTo.kind === "voice" ? t("vibex.voice.message") : replyTo.kind === "circle" ? t("vibex.circle.message") : replyTo.text || t("vibex.chats.file")}
            </span>
          </span>
          <button type="button" onClick={onClearReply} aria-label={t("common.cancel")} className="flex size-7 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-hover" data-testid="composer-reply-cancel">
            <RiCloseLine className="size-4" />
          </button>
        </div>
      )}
      <div ref={setRow} className="vx-glass-strong relative flex items-end gap-1 rounded-[26px] p-1.5" data-testid="composer-row">
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
        <AttachSourceSheet
          open={chooser}
          onClose={() => setChooser(false)}
          onDevice={() => input.current?.click()}
          onPick={(picked) => void add(picked)}
          max={Math.max(0, VIBEX_FILES_MAX - files.length - pending.length)}
        />
        <IconButton label={t("vibex.chat.attach")} onClick={() => setChooser(true)} disabled={!!editing || files.length + pending.length >= VIBEX_FILES_MAX} data-testid="chat-attach">
          <RiAttachment2 className="size-5" />
        </IconButton>
        <textarea
          ref={area}
          rows={1}
          value={text}
          maxLength={VIBEX_MESSAGE_MAX}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && editing) stopEditing();
            if (e.key === "Enter" && !e.shiftKey && ff === "desktop" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={t("vibex.chat.placeholder")}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-[1.35] outline-none placeholder:text-text-tertiary"
          data-testid="chat-input"
        />
        {editing ? (
          <motion.button
            type="button"
            onClick={() => void submit()}
            disabled={!text.trim() || edit.isPending}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-opacity disabled:opacity-35"
            whileTap={{ scale: 0.9 }}
            aria-label={t("common.save")}
            data-testid="chat-edit-save"
          >
            {edit.isPending ? <Spinner size={16} /> : <RiCheckLine className="size-[18px]" />}
          </motion.button>
        ) : empty ? (
          <RecordButton mode={recMode} onMode={setRecMode} onRecorded={sendRecording} barHost={row} />
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
    </div>
  );
}

export function Conversation({ chatId, onBack }: { chatId: string; onBack?: () => void }) {
  const t = useT();
  const chat = useChat(chatId);
  const push = useVibex((s) => s.push);
  const [replyTo, setReplyTo] = useState<VibexMessageDto | null>(null);
  const [call, setCall] = useState<CallKind | null>(null);
  const [info, setInfo] = useState(false);
  useEffect(() => markVisible(chatId), [chatId]);
  if (!chat.data) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-tertiary">
        {chat.isError ? t("vibex.chat.unavailable") : <Spinner />}
      </div>
    );
  }
  const c = chat.data;
  return <ConversationView c={c} chatId={chatId} onBack={onBack} replyTo={replyTo} setReplyTo={setReplyTo} call={call} setCall={setCall} info={info} setInfo={setInfo} push={push} />;
}

function ConversationView({
  c,
  chatId,
  onBack,
  replyTo,
  setReplyTo,
  call,
  setCall,
  info,
  setInfo,
  push,
}: {
  c: VibexChatDto;
  chatId: string;
  onBack?: () => void;
  replyTo: VibexMessageDto | null;
  setReplyTo: (m: VibexMessageDto | null) => void;
  call: CallKind | null;
  setCall: (k: CallKind | null) => void;
  info: boolean;
  setInfo: (v: boolean) => void;
  push: (p: { kind: "person"; id: string }) => void;
}) {
  const t = useT();
  const nameOf = useNameOf(c);
  // Step 2.10: message actions, multi-select, editing, forwarding.
  const [menu, setMenu] = useState<MessageMenuState | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [editing, setEditing] = useState<VibexMessageDto | null>(null);
  const [forwarding, setForwarding] = useState<string[] | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [items, setItems] = useState<VibexMessageDto[]>([]);
  const toggle = useCallback(
    (m: VibexMessageDto) =>
      setSelection((sel) => {
        const next = new Set(sel ?? []);
        if (next.has(m.id)) next.delete(m.id);
        else next.add(m.id);
        return next;
      }),
    [],
  );
  const listActions: ListActions = {
    onReply: (m) => {
      setEditing(null);
      setReplyTo(m);
    },
    onMenu: (m, el, deleting) => setMenu({ msg: m, anchor: el.getBoundingClientRect(), deleting }),
    selection,
    onToggle: toggle,
    menuId: menu?.msg.id ?? null,
    onItems: setItems,
  };
  const jump = (id: string) => {
    const el = host?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.animate([{ backgroundColor: "rgba(127,114,255,0.18)" }, { backgroundColor: "transparent" }], { duration: 1200 });
  };
  const selected = selection ? items.filter((m) => selection.has(m.id)) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="conversation" data-chat-id={chatId}>
      <WindowHeader className="border-b px-2 sm:px-3">
        {onBack && (
          <IconButton label={t("common.back")} onClick={onBack} data-testid="chat-back">
            <RiArrowLeftSLine className="size-7" />
          </IconButton>
        )}
        {c.group ? (
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setInfo(true)} data-testid="group-header">
            <GroupAvatar title={c.group.title} fileId={c.group.avatarFileId} size={38} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">{c.group.title}</span>
              <span className="block truncate text-[12px] text-text-tertiary">{t("vibex.group.members", { n: c.group.members.length })}</span>
            </span>
          </button>
        ) : (
          <>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => push({ kind: "person", id: c.peer!.id })}>
              <Avatar name={c.peer!.name} userId={c.peer!.id} version={c.peer!.avatarVersion} size={38} />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold">{c.peer!.name}</span>
                <span className="block truncate text-[12px] text-text-tertiary">{c.peer!.address}</span>
              </span>
            </button>
            <IconButton label={t("vibex.call.audio")} onClick={() => setCall("audio")} data-testid="chat-call-audio">
              <RiPhoneLine className="size-5" />
            </IconButton>
            <IconButton label={t("vibex.call.video")} onClick={() => setCall("video")} data-testid="chat-call-video">
              <RiVidiconLine className="size-5" />
            </IconButton>
          </>
        )}
      </WindowHeader>
      <PinnedBar chat={c} onJump={jump} />
      <div ref={setHost} className="relative flex min-h-0 flex-1 flex-col bg-surface-secondary/50">
        <Messages chat={c} actions={listActions} />
        {selection ? (
          <SelectionBar chat={c} selected={selected} onClose={() => setSelection(null)} onForward={(ids) => setForwarding(ids)} />
        ) : (
          <MessageComposer
            chatId={chatId}
            key={chatId}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            nameOf={nameOf}
            editing={editing}
            onEditDone={() => setEditing(null)}
          />
        )}
        <MessageMenu
          chat={c}
          state={menu}
          host={host}
          onClose={() => setMenu(null)}
          onReply={(m) => (setEditing(null), setReplyTo(m))}
          onEdit={(m) => (setReplyTo(null), setEditing(m))}
          onSelect={(m) => setSelection(new Set([m.id]))}
          onForward={setForwarding}
        />
      </div>
      <ForwardSheet ids={forwarding} onClose={() => setForwarding(null)} onDone={() => setSelection(null)} />
      {c.peer && <CallSheet kind={call} peer={c.peer} onClose={() => setCall(null)} />}
      {c.group && <GroupInfoSheet key={c.group.title + c.group.avatarFileId} chat={c} open={info} onClose={() => setInfo(false)} />}
    </div>
  );
}
