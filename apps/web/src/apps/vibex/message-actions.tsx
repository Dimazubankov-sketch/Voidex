import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import {
  RiCheckLine,
  RiCheckboxMultipleLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiPencilLine,
  RiPushpin2Line,
  RiPushpinLine,
  RiReplyLine,
  RiShareForwardLine,
  RiUnpinLine,
} from "@remixicon/react";
import type { VibexChatDto, VibexMessageDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { mayStart } from "@/os/gesture-priority";
import { Button, Spinner } from "@/ui/controls";
import { Sheet, toast } from "@/ui/overlays";
import { VoidexSearchField } from "@/ui/search-field";
import { forwardMessages, useChats, useDeleteMessages, usePinMessage } from "./data";
import { ChatAvatar, chatTitle } from "./groups";

const EASE = [0.22, 1, 0.36, 1] as const;

/** What a message's actions are opened on: the message and where it is on screen. */
export interface MessageMenuState {
  msg: VibexMessageDto;
  anchor: DOMRect;
  /** PC's hover delete button: open straight on the «у себя / у всех» choice. */
  deleting?: boolean;
}

/**
 * Step 2.10 — a message's actions (long press on phones, right click on PC).
 *
 * The chat is dimmed, the message stays bright in its place, and a compact
 * menu opens next to it: Ответить, Скопировать, Редактировать (mine, text),
 * Закрепить (when allowed), Переслать, Удалить, Выбрать. «Удалить» turns, in
 * its own place, into «Удалить у себя» and (my own message) «Удалить у всех».
 * A tap on the dimmed area closes it.
 */
export function MessageMenu({
  chat,
  state,
  host,
  onClose,
  onReply,
  onEdit,
  onSelect,
  onForward,
}: {
  chat: VibexChatDto;
  state: MessageMenuState | null;
  /** The chat's message area (the menu is placed inside it). */
  host: HTMLElement | null;
  onClose: () => void;
  onReply: (m: VibexMessageDto) => void;
  onEdit: (m: VibexMessageDto) => void;
  onSelect: (m: VibexMessageDto) => void;
  onForward: (ids: string[]) => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const pin = usePinMessage(chat.id);
  const del = useDeleteMessages(chat.id);
  const [deleting, setDeleting] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => setDeleting(!!state?.deleting), [state]);

  useEffect(() => {
    if (!state) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [state, onClose]);

  // Below the message when it fits, above it otherwise; on the message's side.
  useLayoutEffect(() => {
    if (!state || !host || !menu.current) return setPos(null);
    const h = host.getBoundingClientRect();
    // Layout size (not the on-screen box: the menu is still scaling in).
    const m = { width: menu.current.offsetWidth, height: menu.current.offsetHeight };
    const a = state.anchor;
    const below = a.bottom - h.top + 8;
    const top = below + m.height <= h.height - 8 ? below : Math.max(8, a.top - h.top - m.height - 8);
    const left = state.msg.mine ? a.right - h.left - m.width : a.left - h.left;
    setPos({ top, left: Math.max(8, Math.min(h.width - m.width - 8, left)) });
  }, [state, host, deleting]);

  const m = state?.msg;
  const pinned = !!m && chat.pinnedMessage?.id === m.id;
  const item = (id: string, icon: ReactNode, label: string, onClick: () => void, danger = false) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx("flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors", danger ? "text-danger hover:bg-danger-soft" : "text-text hover:bg-surface-hover")}
      data-testid={`msg-action-${id}`}
    >
      <span className={cx("flex size-5 items-center justify-center", danger ? "text-danger" : "text-text-secondary")}>{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
  const remove = (scope: "me" | "all") => {
    if (!m) return;
    onClose();
    del.mutate({ ids: [m.id], scope }, { onError: (e) => toast({ title: errorMessage(t, e), tone: "danger" }) });
  };

  return (
    <AnimatePresence>
      {m && (
        <motion.div
          key="menu"
          className="absolute inset-0 z-30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
          data-testid="message-menu-layer"
        >
          {/* The rest of the chat dims; the message itself is lifted above this layer (see Messages). */}
          <button type="button" aria-label={t("common.close")} className="absolute inset-0 bg-black/30" onClick={onClose} data-testid="message-menu-backdrop" />
          <motion.div
            ref={menu}
            role="menu"
            aria-label={t("vibex.msg.menu")}
            className="absolute z-40 w-[240px] rounded-[20px] bg-surface p-1.5 shadow-window"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0 }}
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={reduced ? { duration: 0 } : { duration: 0.18, ease: EASE }}
            data-testid="message-menu"
            data-message-id={m.id}
          >
            {deleting ? (
              <div className="flex flex-col" data-testid="msg-delete-choice">
                {item("delete-me", <RiDeleteBinLine className="size-5" />, t("vibex.chats.deleteForMe"), () => remove("me"), true)}
                {m.mine && item("delete-all", <RiDeleteBinLine className="size-5" />, t("vibex.chats.deleteForAll"), () => remove("all"), true)}
                {item("delete-cancel", <RiCloseLine className="size-5" />, t("common.cancel"), () => (state?.deleting ? onClose() : setDeleting(false)))}
              </div>
            ) : (
              <div className="flex flex-col">
                {item("reply", <RiReplyLine className="size-5" />, t("vibex.chat.reply"), () => (onClose(), onReply(m)))}
                {m.text &&
                  item("copy", <RiFileCopyLine className="size-5" />, t("vibex.msg.copy"), () => {
                    onClose();
                    void navigator.clipboard?.writeText(m.text).then(
                      () => toast({ title: t("vibex.msg.copied"), tone: "success" }),
                      () => undefined,
                    );
                  })}
                {m.mine && m.kind === "text" && !m.forwardedFrom && m.text && item("edit", <RiPencilLine className="size-5" />, t("vibex.msg.edit"), () => (onClose(), onEdit(m)))}
                {chat.canPin &&
                  item(pinned ? "unpin" : "pin", pinned ? <RiUnpinLine className="size-5" /> : <RiPushpinLine className="size-5" />, t(pinned ? "vibex.msg.unpin" : "vibex.msg.pin"), () => {
                    onClose();
                    pin.mutate(pinned ? null : m.id, { onError: (e) => toast({ title: errorMessage(t, e), tone: "danger" }) });
                  })}
                {item("forward", <RiShareForwardLine className="size-5" />, t("vibex.msg.forward"), () => (onClose(), onForward([m.id])))}
                {item("delete", <RiDeleteBinLine className="size-5" />, t("vibex.chat.delete"), () => setDeleting(true), true)}
                {item("select", <RiCheckboxMultipleLine className="size-5" />, t("vibex.msg.select"), () => (onClose(), onSelect(m)))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Step 2.10 — multi-select: in place of the composer, the count and Переслать /
 * Удалить / Закрыть. «Удалить у всех» is offered only when every selected
 * message is mine (the server checks each one again).
 */
export function SelectionBar({
  chat,
  selected,
  onClose,
  onForward,
}: {
  chat: VibexChatDto;
  selected: VibexMessageDto[];
  onClose: () => void;
  onForward: (ids: string[]) => void;
}) {
  const t = useT();
  const del = useDeleteMessages(chat.id);
  const [deleting, setDeleting] = useState(false);
  const allMine = selected.length > 0 && selected.every((m) => m.mine);
  const remove = (scope: "me" | "all") =>
    del.mutate(
      { ids: selected.map((m) => m.id), scope },
      { onSuccess: onClose, onError: (e) => toast({ title: errorMessage(t, e), tone: "danger" }) },
    );
  return (
    <div className="shrink-0 px-3 pb-2.5 pt-2 sm:px-4" data-testid="selection-bar">
      <div className="vx-glass-strong flex min-h-[52px] items-center gap-1 rounded-[26px] p-1.5">
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex size-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover" data-testid="selection-close">
          <RiCloseLine className="size-5" />
        </button>
        <span className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold" data-testid="selection-count">
          {t("vibex.msg.selected", { n: selected.length })}
        </span>
        {deleting ? (
          <>
            <button type="button" onClick={() => remove("me")} disabled={!selected.length || del.isPending} className="h-10 rounded-full px-3 text-[14px] font-semibold text-danger hover:bg-danger-soft" data-testid="selection-delete-me">
              {t("vibex.chats.deleteForMe")}
            </button>
            {allMine && (
              <button type="button" onClick={() => remove("all")} disabled={del.isPending} className="h-10 rounded-full px-3 text-[14px] font-semibold text-danger hover:bg-danger-soft" data-testid="selection-delete-all">
                {t("vibex.chats.deleteForAll")}
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onForward(selected.map((m) => m.id))}
              disabled={!selected.length}
              aria-label={t("vibex.msg.forward")}
              title={t("vibex.msg.forward")}
              className="flex size-10 items-center justify-center rounded-full text-primary hover:bg-surface-hover disabled:opacity-40"
              data-testid="selection-forward"
            >
              <RiShareForwardLine className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => setDeleting(true)}
              disabled={!selected.length}
              aria-label={t("vibex.chat.delete")}
              title={t("vibex.chat.delete")}
              className="flex size-10 items-center justify-center rounded-full text-danger hover:bg-danger-soft disabled:opacity-40"
              data-testid="selection-delete"
            >
              <RiDeleteBinLine className="size-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The round selector at the left of a message in multi-select. */
export function SelectDot({ on }: { on: boolean }) {
  return (
    <span
      className={cx("flex size-[22px] shrink-0 items-center justify-center self-center rounded-full border-2 transition", on ? "border-primary bg-primary text-white" : "border-border-strong bg-surface/70")}
      aria-hidden
      data-testid="select-dot"
      data-on={on || undefined}
    >
      {on && <RiCheckLine className="size-3.5" />}
    </span>
  );
}

/** Step 2.10 — forward to one or more chats (search, tick, send). */
export function ForwardSheet({ ids, onClose, onDone }: { ids: string[] | null; onClose: () => void; onDone?: () => void }) {
  const t = useT();
  const chats = useChats().data ?? [];
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ids) {
      setQ("");
      setPicked([]);
    }
  }, [ids]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return chats.filter((c) => !needle || chatTitle(c).toLowerCase().includes(needle) || (c.peer?.address ?? "").toLowerCase().includes(needle));
  }, [chats, q]);
  const send = async () => {
    if (!ids?.length || !picked.length) return;
    setBusy(true);
    try {
      await forwardMessages(ids, picked);
      toast({ title: t("vibex.msg.forwardedDone"), tone: "success" });
      onClose();
      onDone?.();
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={!!ids}
      onClose={onClose}
      title={t("vibex.msg.forwardTo")}
      width={460}
      testId="forward-sheet"
      footer={
        <Button onClick={() => void send()} disabled={!picked.length} loading={busy} data-testid="forward-send">
          <RiShareForwardLine className="size-4" /> {t("vibex.msg.forward")}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <VoidexSearchField value={q} onChange={setQ} placeholder={t("vibex.chats.search")} testId="forward-search" />
        <div className="flex flex-col">
          {list.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked((x) => (on ? x.filter((y) => y !== c.id) : [...x, c.id]))}
                className="flex items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-surface-hover"
                data-testid="forward-chat"
                data-chat-id={c.id}
              >
                <ChatAvatar chat={c} size={42} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{chatTitle(c)}</span>
                <SelectDot on={on} />
              </button>
            );
          })}
          {!list.length && <div className="py-6 text-center text-[14px] text-text-tertiary">{t("vibex.people.empty")}</div>}
        </div>
      </div>
    </Sheet>
  );
}

/** Step 2.10 — the pinned message under the chat's header: a tap finds it, X unpins (when allowed). */
export function PinnedBar({ chat, onJump }: { chat: VibexChatDto; onJump: (id: string) => void }) {
  const t = useT();
  const pin = usePinMessage(chat.id);
  const p = chat.pinnedMessage;
  if (!p) return null;
  const what = p.kind === "voice" ? t("vibex.voice.message") : p.kind === "circle" ? t("vibex.circle.message") : p.text || t("vibex.chats.file");
  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-surface px-3 py-1.5" data-testid="pinned-bar">
      <button type="button" onClick={() => onJump(p.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="h-8 w-[3px] shrink-0 rounded-full bg-primary" aria-hidden />
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-[12.5px] font-semibold text-primary">
            <RiPushpin2Line className="size-3.5" /> {t("vibex.msg.pinned")}
          </span>
          <span className="block truncate text-[13.5px] text-text-secondary" data-testid="pinned-text">
            {what}
          </span>
        </span>
      </button>
      {chat.canPin && (
        <button
          type="button"
          onClick={() => pin.mutate(null)}
          aria-label={t("vibex.msg.unpin")}
          title={t("vibex.msg.unpin")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-hover"
          data-testid="pinned-unpin"
        >
          {pin.isPending ? <Spinner size={14} /> : <RiCloseLine className="size-4" />}
        </button>
      )}
    </div>
  );
}

/** Pull this far to the left (px) to reply. */
export const SWIPE_REPLY_AT = 64;

/**
 * Step 2.10 — swipe a message to the LEFT to answer it: the bubble follows the
 * finger, a reply icon grows at its side, past the threshold it ticks (a
 * short vibration) and the release sets the reply. Players (voice waveform,
 * circle ring, media) keep their own drags (see os/gesture-priority).
 */
export function useSwipeReply(onReply: () => void, enabled: boolean) {
  const x = useMotionValue(0);
  const reduced = useReducedMotion();
  const icon = useTransform(x, [0, -SWIPE_REPLY_AT], [0, 1]);
  const s = useRef<{ id: number; x: number; y: number; on: boolean; armed: boolean } | null>(null);
  const settle = () => (reduced ? x.set(0) : void animate(x, 0, { type: "spring", stiffness: 520, damping: 40 }));
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      // A finger (or pen) gesture: with a mouse, a drag over the text selects it (PC replies from the hover button).
      if (!enabled || e.button !== 0 || e.pointerType === "mouse" || !mayStart("swipe-reply", e.target)) return;
      s.current = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, armed: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = s.current;
      if (!g || g.id !== e.pointerId) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (!g.on) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          s.current = null; // a scroll
          return;
        }
        if (dx > -12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        g.on = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
      const v = Math.max(-96, Math.min(0, dx * 0.85));
      x.set(v);
      const armed = v <= -SWIPE_REPLY_AT;
      if (armed && !g.armed && navigator.vibrate) navigator.vibrate(8);
      g.armed = armed;
    },
    onPointerUp: (e: React.PointerEvent) => {
      const g = s.current;
      s.current = null;
      if (!g || g.id !== e.pointerId || !g.on) return;
      if (g.armed) {
        onReply();
        // The release is not a tap on what lies under the finger.
        const stop = (ev: Event) => (ev.stopPropagation(), ev.preventDefault());
        window.addEventListener("click", stop, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", stop, true), 300);
      }
      settle();
    },
    onPointerCancel: () => {
      s.current = null;
      settle();
    },
  };
  return { x, icon, handlers, active: () => !!s.current?.on };
}

/** The reply arrow that appears beside a message being swiped. */
export function SwipeReplyIcon({ progress }: { progress: ReturnType<typeof useSwipeReply>["icon"] }) {
  const scale = useTransform(progress, [0, 1], [0.4, 1]);
  return (
    <motion.span
      className="pointer-events-none absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-primary shadow-tile"
      style={{ opacity: progress, scale }}
      aria-hidden
      data-testid="swipe-reply-icon"
    >
      <RiReplyLine className="size-4" />
    </motion.span>
  );
}
