import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RiCloseLine, RiPauseFill, RiPlayFill, RiUnpinLine } from "@remixicon/react";
import type { VibexChatDto, VibexPinDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { useRemovePin } from "./data";
import { stopPlayback, togglePlayback, usePlayback } from "./playback";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Update 2 · C1 / C8: the one strip under the chat header. While a voice message or a video circle of
 * this chat plays, it is the playback bar; otherwise the pinned messages; otherwise nothing. Never
 * both at once.
 */
export function ChatTopPanel({ chat, onJump, nameOf }: { chat: VibexChatDto; onJump: (id: string) => void; nameOf: (id: string) => string }) {
  const playing = usePlayback((s) => (s.current && s.current.chatId === chat.id ? s.current : null));
  const pins = chat.pins ?? (chat.pinnedMessage ? [{ ...chat.pinnedMessage, createdAt: "", pinnedAt: "" }] : []);
  // Leaving the chat stops what plays in it (predictable when switching chats).
  useEffect(() => () => stopPlayback(chat.id), [chat.id]);
  return (
    <AnimatePresence initial={false} mode="wait">
      {playing ? (
        <PanelShell key="playing">
          <PlaybackBar kind={playing.kind} who={playing.senderName} paused={playing.paused} onJump={() => onJump(playing.messageId)} />
        </PanelShell>
      ) : pins.length ? (
        <PanelShell key={`pins-${chat.id}`}>
          <PinsBar chat={chat} pins={pins} onJump={onJump} nameOf={nameOf} />
        </PanelShell>
      ) : null}
    </AnimatePresence>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="relative z-[2] shrink-0 px-2 pt-1.5"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: EASE }}
    >
      <div className="vx-glass-strong flex h-[48px] items-center gap-2 rounded-2xl pl-3 pr-1.5 shadow-tile">{children}</div>
    </motion.div>
  );
}

/** Which of up to four segments is lit (the pins scroll through the segments, newest at the bottom). */
function Segments({ count, index }: { count: number; index: number }) {
  const shown = Math.min(4, count);
  const first = Math.max(0, Math.min(count - shown, index - shown + 1));
  return (
    <span className="flex h-[32px] w-[3px] shrink-0 flex-col gap-[2px]" aria-hidden data-testid="pins-segments">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className={cx("min-h-0 flex-1 rounded-full transition-colors", first + i === index ? "bg-primary" : "bg-primary/25")} />
      ))}
    </span>
  );
}

function pinText(t: ReturnType<typeof useT>, p: Pick<VibexPinDto, "kind" | "text">) {
  return p.kind === "voice" ? t("vibex.voice.message") : p.kind === "circle" ? t("vibex.circle.message") : p.text || t("vibex.chats.file");
}

/**
 * C1: the pinned messages, newest first. A tap goes to the one shown (it is briefly highlighted in the
 * history) and shows the next older one; after the oldest it starts again from the newest (always the
 * same direction). Reopening the chat starts from the newest.
 */
function PinsBar({ chat, pins, onJump, nameOf }: { chat: VibexChatDto; pins: Pick<VibexPinDto, "id" | "kind" | "text" | "senderId">[]; onJump: (id: string) => void; nameOf: (id: string) => string }) {
  const t = useT();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(pins.length - 1);
  const unpin = useRemovePin(chat.id);
  // Pins added or removed: the newest shows again (a removed one never lingers).
  const sig = pins.map((p) => p.id).join(",");
  useEffect(() => setIndex(pins.length - 1), [sig, pins.length]);
  const i = Math.min(Math.max(0, index), pins.length - 1);
  const p = pins[i]!;
  const go = () => {
    onJump(p.id);
    setIndex(i === 0 ? pins.length - 1 : i - 1);
  };
  return (
    <>
      <button type="button" onClick={go} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" data-testid="pinned-bar" data-pin={p.id} data-index={i} data-count={pins.length}>
        <Segments count={pins.length} index={i} />
        <span className="relative min-w-0 flex-1 overflow-hidden">
          {/* The next pin comes in with a short rise (the previous one simply gives way). */}
          <motion.span
            key={p.id}
            className="block"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <span className="block truncate text-[12.5px] font-semibold text-primary" data-testid="pinned-title">
              {pins.length > 1 ? t("vibex.pins.titleN", { n: i + 1 }) : t("vibex.pins.title")}
            </span>
            <span className="block truncate text-[13.5px] text-text-secondary" data-testid="pinned-text">
              {chat.group ? `${nameOf(p.senderId)}: ` : ""}
              {pinText(t, p)}
            </span>
          </motion.span>
        </span>
      </button>
      {chat.canPin && (
        <button
          type="button"
          onClick={() => unpin.mutate(p.id)}
          aria-label={t("vibex.pins.unpin")}
          title={t("vibex.pins.unpin")}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-surface-hover"
          data-testid="pinned-unpin"
        >
          {unpin.isPending ? <Spinner size={14} /> : <RiUnpinLine className="size-[18px]" />}
        </button>
      )}
    </>
  );
}

/** C8: what plays now — a tap goes to it in the history; play / pause; close stops it. */
function PlaybackBar({ kind, who, paused, onJump }: { kind: "voice" | "circle"; who: string; paused: boolean; onJump: () => void }) {
  const t = useT();
  return (
    <>
      <button
        type="button"
        onClick={togglePlayback}
        aria-label={paused ? t("vibex.voice.play") : t("vibex.voice.pause")}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white"
        data-testid="playback-toggle"
      >
        {paused ? <RiPlayFill className="size-5" /> : <RiPauseFill className="size-5" />}
      </button>
      <button type="button" onClick={onJump} className="min-w-0 flex-1 text-left" data-testid="playback-bar" data-kind={kind}>
        <span className="block truncate text-[13px] font-semibold text-text">{who}</span>
        <span className="block truncate text-[12.5px] text-text-secondary">{kind === "voice" ? t("vibex.voice.message") : t("vibex.circle.message")}</span>
      </button>
      <button
        type="button"
        onClick={() => stopPlayback()}
        aria-label={t("vibex.playing.stop")}
        title={t("vibex.playing.stop")}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-hover"
        data-testid="playback-close"
      >
        <RiCloseLine className="size-5" />
      </button>
    </>
  );
}
