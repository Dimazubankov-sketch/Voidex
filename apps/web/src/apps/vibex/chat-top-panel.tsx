import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
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
 * both at once. Update 3: on phones it floats with the header over the history.
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
      className="pointer-events-auto relative z-[2] shrink-0 px-2 pt-1"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: EASE }}
    >
      <div className="vx-glass-strong flex h-11 items-center gap-2 rounded-full pl-3.5 pr-1 shadow-tile">{children}</div>
    </motion.div>
  );
}

/**
 * Update 3 · C2 (SR525): the pins' place marker at the left: a thin dashed line of up to four segments,
 * the one shown is solid (the segments scroll with the pins).
 */
function Segments({ count, index }: { count: number; index: number }) {
  const shown = Math.min(4, count);
  const first = Math.max(0, Math.min(count - shown, index - shown + 1));
  return (
    <span className="flex h-[30px] w-[2.5px] shrink-0 flex-col gap-[2.5px]" aria-hidden data-testid="pins-segments">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className={cx("min-h-0 flex-1 rounded-full transition-colors duration-200", first + i === index ? "bg-primary" : "bg-primary/30")} />
      ))}
    </span>
  );
}

function pinText(t: ReturnType<typeof useT>, p: Pick<VibexPinDto, "kind" | "text">) {
  return p.kind === "voice" ? t("vibex.voice.message") : p.kind === "circle" ? t("vibex.circle.message") : p.text || t("vibex.chats.file");
}

/**
 * Update 3 · C2: the pinned messages, newest first. A tap goes to the one shown (the history scrolls to
 * it and highlights it briefly) and shows the next older one, always in the same direction: from the
 * newest to the very first. At the first pin a tap goes to it again; it never jumps back to the newest.
 * Reopening the chat (or a pin added / removed) starts from the newest again.
 *
 * Motion (SR525): the capsule answers the tap with a short pulse; the next pin's text rises in from below
 * while the shown one leaves upwards (≈220 ms).
 */
function PinsBar({ chat, pins, onJump, nameOf }: { chat: VibexChatDto; pins: Pick<VibexPinDto, "id" | "kind" | "text" | "senderId">[]; onJump: (id: string) => void; nameOf: (id: string) => string }) {
  const t = useT();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(pins.length - 1);
  const bar = useRef<HTMLButtonElement>(null);
  const unpin = useRemovePin(chat.id);
  // Pins added or removed: the newest shows again (a removed one never lingers).
  const sig = pins.map((p) => p.id).join(",");
  useEffect(() => setIndex(pins.length - 1), [sig, pins.length]);
  const i = Math.min(Math.max(0, index), pins.length - 1);
  const p = pins[i]!;
  const go = () => {
    onJump(p.id);
    if (bar.current && !reduced) void animate(bar.current, { scale: [1, 1.025, 1] }, { duration: 0.22, ease: EASE });
    // Towards the first pin; there it stays (no wrap to the newest).
    if (i > 0) setIndex(i - 1);
  };
  return (
    <>
      <button
        ref={bar}
        type="button"
        onClick={go}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left"
        data-testid="pinned-bar"
        data-pin={p.id}
        data-index={i}
        data-count={pins.length}
        data-at-first={i === 0 || undefined}
      >
        <Segments count={pins.length} index={i} />
        <span className="relative h-[34px] min-w-0 flex-1 overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={p.id}
              className="absolute inset-0 flex flex-col justify-center"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              <span className="block truncate text-[12.5px] font-semibold leading-[1.25] text-primary" data-testid="pinned-title">
                {pins.length > 1 ? t("vibex.pins.titleN", { n: i + 1 }) : t("vibex.pins.title")}
              </span>
              <span className="block truncate text-[13px] leading-[1.3] text-text-secondary" data-testid="pinned-text">
                {chat.group ? `${nameOf(p.senderId)}: ` : ""}
                {pinText(t, p)}
              </span>
            </motion.span>
          </AnimatePresence>
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
