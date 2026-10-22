import { create } from "zustand";

/**
 * Update 2 · C8: the one voice message or video circle playing with sound. Starting another pauses
 * this one (never two at once). The chat shows a small bar for it where the pinned messages are; it
 * stops when the chat closes or when the bar's close button is pressed, and goes when playback ends.
 */
export interface Playing {
  /** The message being played. */
  messageId: string;
  chatId: string;
  kind: "voice" | "circle";
  /** Who sent it (shown in the bar). */
  senderName: string;
  el: HTMLMediaElement;
  paused: boolean;
}

interface PlaybackState {
  current: Playing | null;
}

export const usePlayback = create<PlaybackState>(() => ({ current: null }));

/** A player started (or resumed): it becomes the one; any other stops. */
export function claimPlayback(p: Omit<Playing, "paused">) {
  const cur = usePlayback.getState().current;
  if (cur && cur.el !== p.el) {
    try {
      cur.el.pause();
    } catch {
      /* already gone */
    }
  }
  usePlayback.setState({ current: { ...p, paused: false } });
}

/** The player paused (the bar stays, with a play button). */
export function pausedPlayback(el: HTMLMediaElement) {
  const cur = usePlayback.getState().current;
  if (cur?.el === el && !cur.paused) usePlayback.setState({ current: { ...cur, paused: true } });
}

/** Played to the end, or its element went away: the bar goes. */
export function releasePlayback(el: HTMLMediaElement) {
  if (usePlayback.getState().current?.el === el) usePlayback.setState({ current: null });
}

/** The bar's close button, or the chat closed: playback stops and the bar goes. */
export function stopPlayback(chatId?: string) {
  const cur = usePlayback.getState().current;
  if (!cur || (chatId && cur.chatId !== chatId)) return;
  try {
    cur.el.pause();
  } catch {
    /* already gone */
  }
  usePlayback.setState({ current: null });
}

export function togglePlayback() {
  const cur = usePlayback.getState().current;
  if (!cur) return;
  if (cur.el.paused) void cur.el.play().catch(() => undefined);
  else cur.el.pause();
}
