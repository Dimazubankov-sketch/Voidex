import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  RiCheckLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiFilter3Line,
  RiNotification3Line,
  RiNotificationOffLine,
  RiPushpinLine,
  RiUnpinLine,
  RiUserLine,
} from "@remixicon/react";
import { VIBEX_CHAT_ORDERS, type VibexChatDto, type VibexChatOrder, type VibexPersonDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useFormFactor } from "@/lib/form-factor";
import { formatShortDate, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { VoidexSearchField } from "@/ui/search-field";
import { ChatList, ChatPreviewMessages } from "./chats";
import { openDirect, useChatSearch, useChats, useDeleteChat, useMuteChat, usePeople, useSetPins, useStories, useUpdateSettings, useVibexMe } from "./data";
import { ChatAvatar, chatTitle } from "./groups";
import { StackedStories, StoriesStrip, StoryArchive, StoryComposer, StoryViewer } from "./stories";
import { useVibex } from "./store";

const EASE = [0.22, 1, 0.36, 1] as const;
/** Pull-down distances (px) that reveal the search, then the stories. */
const PULL_SEARCH = 36;
const PULL_STORIES = 96;

/** Eats the one click the browser sends after a drag ended on a button. */
function swallowClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    window.removeEventListener("click", stop, true);
  };
  window.addEventListener("click", stop, true);
  window.setTimeout(() => window.removeEventListener("click", stop, true), 400);
}

const ORDER_LABEL: Record<VibexChatOrder, MessageKey> = {
  "chats-first": "vibex.chats.orderChats",
  "groups-first": "vibex.chats.orderGroups",
  mixed: "vibex.chats.orderMixed",
};

/**
 * Step 2.9 «Чаты» (Telegram-like density, Vibex look).
 *
 *   collapsed   the header shows a few story avatars overlapping each other
 *   pull a bit  the chat search (with the filter button) comes out
 *   pull more   the stories row opens: «Моя история» with + first, then
 *               everyone's, swiped sideways
 * Scrolling the list folds them back (the search stays while it has text).
 * Step 2.10: PC works the same way (wheel up at the top opens a level, wheel
 * down / scrolling folds it back); everything starts folded.
 */
export function ChatsPane({ header }: { header?: (stack: ReactNode) => ReactNode }) {
  const t = useT();
  const ff = useFormFactor();
  const pc = ff === "desktop";
  const reduced = useReducedMotion();
  const stories = useStories();
  const groups = stories.data ?? [];
  const order: VibexChatOrder = useVibexMe().data?.settings.chats?.order ?? "chats-first";
  const [level, setLevel] = useState(0);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [archive, setArchive] = useState(false);
  const [preview, setPreview] = useState<VibexChatDto | null>(null);
  const [menu, setMenu] = useState<{ chat: VibexChatDto; x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const shown = Math.max(level, query || focused ? 1 : 0);
  const wheelAt = useRef(0);
  /** The list is too short to scroll: a scroll up can't fold the parts, so a move up does. */
  const cantScroll = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.clientHeight < 8;
  };

  // Pull-down at the top of the list (touch and mouse); a wheel up at the top does the same on PC.
  const pull = useRef<{ y: number; id: number } | null>(null);
  const [pulling, setPulling] = useState(0);
  const onDown = (e: React.PointerEvent) => {
    if ((scroller.current?.scrollTop ?? 0) > 2 || e.button !== 0) return;
    pull.current = { y: e.clientY, id: e.pointerId };
  };
  const onMove = (e: React.PointerEvent) => {
    const p = pull.current;
    if (!p || p.id !== e.pointerId) return;
    const dy = e.clientY - p.y;
    if (dy < 0) {
      setPulling(0);
      if (dy > -24) return;
      pull.current = null;
      // Step 2.10: pushing up folds what is open (when the list itself has nowhere to scroll).
      if (level > 0 && !query && !focused && cantScroll()) {
        setLevel((l) => Math.max(0, l - 1));
        swallowClick();
      }
      return;
    }
    setPulling(Math.min(140, dy));
  };
  const onUp = () => {
    if (pull.current) {
      // Step 2.10: a long pull opens everything; a short one goes one level further (search, then the stories).
      if (pulling >= PULL_STORIES) setLevel(2);
      else if (pulling >= PULL_SEARCH) setLevel((l) => Math.min(2, l + 1));
      // A pull is not a tap: the row under the finger must not open.
      if (pulling > 10) swallowClick();
    }
    pull.current = null;
    setPulling(0);
  };
  const onScroll = () => {
    const top = scroller.current?.scrollTop ?? 0;
    if (top > 24 && level === 2) setLevel(1);
    if (top > 64 && level >= 1 && !query && !focused) setLevel(0);
  };

  const push = useVibex((s) => s.push);
  const openChat = useVibex((s) => s.openChat);
  const actions = {
    onPreview: (chat: VibexChatDto) => setPreview(chat),
    // Step 2.12: the avatar: the person's story (seen or not) when there is one, else the profile; a group: the chat.
    onAvatar: (chat: VibexChatDto) => {
      const peer = chat.peer?.id;
      if (peer && groups.some((g) => g.person.id === peer)) setViewing(peer);
      else if (peer && chat.kind === "direct") push({ kind: "person", id: peer });
      else openChat(chat.id);
    },
    onMenu: (chat: VibexChatDto, at: { x: number; y: number }) => (pc ? setMenu({ chat, ...at }) : setPreview(chat)),
  };

  const stack = <StackedStories groups={groups} onClick={() => setLevel(2)} />;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="chats-pane" data-level={shown}>
      {header?.(stack)}
      <div
        ref={scroller}
        className="vx-chat-list vx-tab-scroll scroll-area relative min-h-0 flex-1 overscroll-y-contain"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onScroll={onScroll}
        onWheel={(e) => {
          // One level per wheel gesture (a wheel sends a stream of events).
          const now = performance.now();
          if (now - wheelAt.current < 380 || Math.abs(e.deltaY) < 20) return;
          if ((scroller.current?.scrollTop ?? 0) <= 0 && e.deltaY < 0) {
            wheelAt.current = now;
            setLevel((l) => Math.min(2, l + 1));
          } else if (e.deltaY > 0 && level > 0 && !query && !focused && cantScroll()) {
            wheelAt.current = now;
            setLevel((l) => Math.max(0, l - 1));
          }
        }}
        data-testid="chats-scroll"
      >
        {/* The pull itself: a soft gap that follows the finger before the parts open. */}
        <div style={{ height: pulling * 0.5, transition: pulling ? "none" : "height 200ms ease" }} aria-hidden />
        <AnimatePresence initial={false}>
          {shown >= 2 && (
            <motion.div
              key="stories"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.3, ease: EASE }}
              className="overflow-hidden"
              data-testid="stories-header"
            >
              <StoriesStrip groups={groups} onOpen={setViewing} onCreate={() => setCreating(true)} />
            </motion.div>
          )}
          {shown >= 1 && (
            <motion.div
              key="search"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.26, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 pb-2 pt-1.5">
                <div className="min-w-0 flex-1" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
                  <VoidexSearchField value={query} onChange={setQuery} placeholder={t("vibex.chats.search")} testId="chat-search" />
                </div>
                <OrderFilter order={order} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {query.trim() ? <ChatSearchResults query={query} onDone={() => setQuery("")} /> : <ChatList actions={actions} order={order} />}
        <div className="h-24" aria-hidden />
      </div>

      <StoryViewer groups={groups} startPerson={viewing} onClose={() => setViewing(null)} onArchive={() => (setViewing(null), setArchive(true))} />
      <StoryComposer open={creating} onClose={() => setCreating(false)} />
      <StoryArchive open={archive} onClose={() => setArchive(false)} />
      <ChatPreview chat={preview} onClose={() => setPreview(null)} />
      <ChatContextMenu menu={menu} onClose={() => setMenu(null)} onPreview={(c) => setPreview(c)} />
    </div>
  );
}

// -------------------------------------------------------------- filter

/** Right of the search: Чаты сверху / Группы сверху / Вперемешку (saved with the account; pinned always first). */
function OrderFilter({ order }: { order: VibexChatOrder }) {
  const t = useT();
  const update = useUpdateSettings();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pos = open && btn.current ? btn.current.getBoundingClientRect() : null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("vibex.chats.order")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("vibex.chats.order")}
        className={cx("flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text-secondary hover:text-text", order !== "chats-first" && "text-primary")}
        data-testid="chat-filter"
        data-order={order}
      >
        <RiFilter3Line className="size-[19px]" />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <button type="button" className="fixed inset-0 z-[240] cursor-default" aria-label={t("common.close")} onClick={() => setOpen(false)} />
            <motion.div
              role="menu"
              aria-label={t("vibex.chats.order")}
              className="fixed z-[241] w-[230px] rounded-[18px] border border-border bg-surface p-1.5 shadow-float"
              style={{ top: pos.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - 238, pos.right - 230)) }}
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              data-testid="chat-filter-menu"
            >
              <div className="px-2.5 pb-1 pt-1.5 text-[12px] text-text-tertiary">{t("vibex.chats.orderHint")}</div>
              {VIBEX_CHAT_ORDERS.map((o) => (
                <button
                  key={o}
                  type="button"
                  role="menuitemradio"
                  aria-checked={order === o}
                  onClick={() => {
                    setOpen(false);
                    update.mutate({ chats: { order: o } });
                  }}
                  className="flex h-11 w-full items-center gap-2 rounded-[12px] px-2.5 text-left text-[15px] text-text hover:bg-surface-hover"
                  data-testid={`chat-order-${o}`}
                >
                  <span className="flex-1">{t(ORDER_LABEL[o])}</span>
                  {order === o && <RiCheckLine className="size-5 text-primary" />}
                </button>
              ))}
            </motion.div>
          </>,
          document.body,
        )}
    </>
  );
}

// -------------------------------------------------------------- search

function ResultRow({ onClick, avatar, title, sub, meta, testId }: { onClick: () => void; avatar: ReactNode; title: ReactNode; sub: ReactNode; meta?: ReactNode; testId: string }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-[18px] px-2.5 py-2 text-left hover:bg-surface-hover" data-testid={testId}>
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</span>
          {meta}
        </span>
        <span className="block truncate text-[13.5px] text-text-secondary">{sub}</span>
      </span>
    </button>
  );
}

/** Chats (people, groups) and people found by name or @voidops address, and messages by their text. */
function ChatSearchResults({ query, onDone }: { query: string; onDone: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const openChat = useVibex((s) => s.openChat);
  const q = query.trim();
  const found = useChatSearch(q);
  const people = usePeople(q.replace(/^@/, ""));
  const chats = useChats().data ?? [];
  // Instant local matches while the server answers.
  const lower = q.toLowerCase();
  const local = chats.filter((c) => chatTitle(c).toLowerCase().includes(lower) || (c.peer?.address ?? "").toLowerCase().includes(lower));
  const chatHits = found.data?.chats ?? local;
  const inChats = new Set(chats.flatMap((c) => (c.peer ? [c.peer.id] : [])));
  const newPeople = (people.data ?? []).filter((p) => !inChats.has(p.id));
  const messages = found.data?.messages ?? [];
  const open = (id: string) => {
    onDone();
    openChat(id);
  };
  const startWith = async (p: VibexPersonDto) => {
    try {
      const c = await openDirect(p.id);
      open(c.id);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };
  const label = (k: MessageKey) => <div className="px-3 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{t(k)}</div>;
  const nothing = !chatHits.length && !newPeople.length && !messages.length && !found.isFetching && !people.isFetching;
  return (
    <div className="flex flex-col px-1.5" data-testid="chat-search-results">
      {chatHits.length > 0 && (
        <section data-testid="chat-search-chats">
          {label("vibex.chats.found")}
          {chatHits.map((c) => (
            <ResultRow key={c.id} onClick={() => open(c.id)} avatar={<ChatAvatar chat={c} size={46} />} title={chatTitle(c)} sub={c.group ? t("vibex.group.members", { n: c.group.members.length }) : c.peer?.address} testId="chat-search-chat" />
          ))}
        </section>
      )}
      {newPeople.length > 0 && (
        <section data-testid="chat-search-people">
          {label("vibex.chats.people")}
          {newPeople.map((p) => (
            <ResultRow key={p.id} onClick={() => void startWith(p)} avatar={<Avatar name={p.name} userId={p.id} version={p.avatarVersion} size={46} />} title={p.name} sub={p.address} testId="chat-search-person" />
          ))}
        </section>
      )}
      {messages.length > 0 && (
        <section data-testid="chat-search-messages">
          {label("vibex.chats.messagesFound")}
          {messages.map(({ chat, message }) => (
            <ResultRow
              key={message.id}
              onClick={() => open(chat.id)}
              avatar={<ChatAvatar chat={chat} size={46} />}
              title={chatTitle(chat)}
              sub={<Highlight text={message.text} q={q} />}
              meta={<span className="shrink-0 text-[12px] text-text-tertiary">{formatShortDate(message.createdAt, lang)}</span>}
              testId="chat-search-message"
            />
          ))}
        </section>
      )}
      {(found.isFetching || people.isFetching) && !chatHits.length && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
      {nothing && <div className="py-10 text-center text-[14px] text-text-tertiary" data-testid="chat-search-empty">{t("vibex.chats.nothingFound")}</div>}
    </div>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  const from = Math.max(0, i - 24);
  return (
    <>
      {from > 0 && "…"}
      {text.slice(from, i)}
      <mark className="rounded bg-primary/15 px-0.5 text-text">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

// ------------------------------------------------------------ actions

/**
 * The actions of one chat: Preview / Open, notifications on / off, pin, the
 * profile, and Delete — which turns, in its own place, into «Удалить у себя»
 * and (when allowed) «Удалить у всех». No second confirmation sheet.
 */
function ChatActions({ chat, onDone, onPreview, inPreview }: { chat: VibexChatDto; onDone: () => void; onPreview?: () => void; inPreview?: boolean }) {
  const t = useT();
  const push = useVibex((s) => s.push);
  const mute = useMuteChat();
  const del = useDeleteChat();
  const setPins = useSetPins();
  const pinnedIds = (useChats().data ?? []).filter((c) => c.pinnedPosition !== null).sort((a, b) => a.pinnedPosition! - b.pinnedPosition!).map((c) => c.id);
  const [deleting, setDeleting] = useState(false);
  const pinned = chat.pinnedPosition !== null;
  const remove = (scope: "me" | "all") => {
    onDone();
    del.mutate({ id: chat.id, scope }, { onError: (e) => toast({ title: errorMessage(t, e), tone: "danger" }), onSuccess: () => toast({ title: t(scope === "me" ? "vibex.chats.deletedForMe" : "vibex.chats.deletedForAll") }) });
  };
  const item = (id: string, icon: ReactNode, label: string, run: () => void, danger = false) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      onClick={run}
      className={cx("flex min-h-11 w-full items-center gap-3 rounded-[12px] px-3 text-left text-[15px] hover:bg-surface-hover", danger ? "text-danger" : "text-text")}
      data-testid={`chat-action-${id}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
    </button>
  );
  return (
    <div className="flex flex-col p-1.5" role="menu" aria-label={chatTitle(chat)} data-testid="chat-actions">
      {/* Step 2.10: no «Открыть» in the preview (a tap on a message opens the chat). */}
      {!inPreview && onPreview && item("preview", <RiEyeLine className="size-5" />, t("vibex.chats.preview"), () => (onDone(), onPreview()))}
      {item(
        "mute",
        chat.muted ? <RiNotification3Line className="size-5" /> : <RiNotificationOffLine className="size-5" />,
        t(chat.muted ? "vibex.chats.unmute" : "vibex.chats.mute"),
        () => {
          mute.mutate({ id: chat.id, muted: !chat.muted });
          onDone();
        },
      )}
      {item(
        pinned ? "unpin" : "pin",
        pinned ? <RiUnpinLine className="size-5" /> : <RiPushpinLine className="size-5" />,
        t(pinned ? "vibex.chats.unpin" : "vibex.chats.pin"),
        () => {
          setPins.mutate(pinned ? pinnedIds.filter((id) => id !== chat.id) : [chat.id, ...pinnedIds]);
          onDone();
        },
      )}
      {chat.peer && item("profile", <RiUserLine className="size-5" />, t("vibex.chats.profile"), () => (onDone(), push({ kind: "person", id: chat.peer!.id })))}
      <AnimatePresence initial={false} mode="popLayout">
        {!deleting ? (
          <motion.div key="delete" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {item("delete", <RiDeleteBinLine className="size-5" />, t("vibex.chats.delete"), () => setDeleting(true), true)}
          </motion.div>
        ) : (
          <motion.div key="choice" className="flex flex-col" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.2, ease: EASE }} data-testid="chat-delete-choice">
            {item("delete-me", <RiDeleteBinLine className="size-5" />, t("vibex.chats.deleteForMe"), () => remove("me"), true)}
            {chat.canDeleteForAll && item("delete-all", <RiDeleteBinLine className="size-5" />, t("vibex.chats.deleteForAll"), () => remove("all"), true)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** PC: right click on a chat — its menu at the pointer (Preview opens only when chosen). */
function ChatContextMenu({ menu, onClose, onPreview }: { menu: { chat: VibexChatDto; x: number; y: number } | null; onClose: () => void; onPreview: (c: VibexChatDto) => void }) {
  const t = useT();
  const live = useChats().data?.find((c) => c.id === menu?.chat.id) ?? menu?.chat;
  useEffect(() => {
    if (!menu) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [menu, onClose]);
  if (!menu || !live) return null;
  const w = 248;
  return createPortal(
    <>
      <button type="button" className="fixed inset-0 z-[240] cursor-default" aria-label={t("common.close")} onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <motion.div
        className="fixed z-[241] rounded-[18px] border border-border bg-surface shadow-float"
        style={{ left: Math.min(menu.x, window.innerWidth - w - 8), top: Math.min(menu.y, window.innerHeight - 320), width: w }}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.14 }}
        data-testid="chat-context-menu"
      >
        <ChatActions chat={live} onDone={onClose} onPreview={() => onPreview(live)} />
      </motion.div>
    </>,
    document.body,
  );
}

/**
 * Long press (phone) or «Предпросмотр» (PC): the chat's latest messages over
 * the list, with the actions beside them. Looking does not read: no read
 * marker moves, no receipt is sent, the unread badge stays. Tap outside closes.
 */
/**
 * Step 2.10: the preview's messages scroll freely (nothing is marked read, see
 * ChatPreviewMessages). Nothing inside reacts to a touch on its own: a tap on
 * a message or a control closes the preview and opens the real chat; players,
 * holds and seeks never start here.
 */
function PreviewScroller({ children, onOpen }: { children: ReactNode; onOpen: () => void }) {
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      // Stopping the event on the way down keeps the messages' own handlers out; native scrolling still works.
      onPointerDownCapture={(e) => {
        down.current = { x: e.clientX, y: e.clientY, t: performance.now() };
        e.stopPropagation();
      }}
      onPointerUpCapture={(e) => e.stopPropagation()}
      onContextMenuCapture={(e) => (e.preventDefault(), e.stopPropagation())}
      onClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const d = down.current;
        down.current = null;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
        const hit = (e.target as HTMLElement).closest('[data-testid="message"], button, a, [role="button"], video, audio, img, [data-gesture-owner]');
        if (hit) onOpen();
      }}
      data-testid="chat-preview-messages"
    >
      {children}
    </div>
  );
}

function ChatPreview({ chat, onClose }: { chat: VibexChatDto | null; onClose: () => void }) {
  const t = useT();
  const openChat = useVibex((s) => s.openChat);
  const ff = useFormFactor();
  const live = useChats().data?.find((c) => c.id === chat?.id) ?? chat;
  const me = useSession((s) => s.user);
  useEffect(() => {
    if (!chat) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [chat, onClose]);
  return createPortal(
    <AnimatePresence>
      {live && me && (
        <motion.div
          className="fixed inset-0 z-[230] flex items-center justify-center p-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label={t("vibex.chats.previewOf", { name: chatTitle(live) })}
          data-testid="chat-preview"
          data-chat-id={live.id}
        >
          <button type="button" className="absolute inset-0 bg-black/25 backdrop-blur-[6px]" aria-label={t("common.close")} onClick={onClose} data-testid="chat-preview-backdrop" />
          <motion.div
            className={cx("relative flex max-h-full w-full gap-3", ff === "desktop" ? "max-w-[760px] flex-row items-start" : "max-w-[440px] flex-col")}
            initial={{ scale: 0.94, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            <div className="flex h-[min(58dvh,520px)] min-w-0 flex-1 flex-col overflow-hidden rounded-[26px] bg-surface shadow-window">
              <div className="flex items-center gap-3 border-b px-4 py-3">
                <ChatAvatar chat={live} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] font-semibold">{chatTitle(live)}</span>
                  <span className="block truncate text-[12.5px] text-text-tertiary">{live.group ? t("vibex.group.members", { n: live.group.members.length }) : live.peer?.address}</span>
                </span>
              </div>
              <PreviewScroller onOpen={() => (onClose(), openChat(live.id))}>
                <ChatPreviewMessages chat={live} />
              </PreviewScroller>
            </div>
            <div className={cx("shrink-0 rounded-[22px] bg-surface shadow-window", ff === "desktop" ? "w-[248px]" : "w-full")}>
              <ChatActions chat={live} onDone={onClose} inPreview />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
