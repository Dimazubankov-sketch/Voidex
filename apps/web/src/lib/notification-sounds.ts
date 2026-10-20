import { DEFAULT_NOTIFICATION_SOUND, NOTIFICATION_SOUNDS, type NotificationSoundId } from "@voidex/shared";
import type { MessageKey } from "@/lib/i18n";

/**
 * Step 2.16: the VOIDEX system notification sounds. They are Forma's
 * «Уведомления» (Forma → Звуки → Уведомления): the same files from Forma's
 * sound library, never copies. «Входящее» (about 1.5 s) by default.
 *
 * Played with Web Audio: each file is decoded once and kept; a new sound (a
 * preview in Settings, a notification) stops the one still playing, so two
 * never overlap. Browsers allow sound only after the person interacted with
 * the page: the audio is unlocked on the first tap / key press, and a preview
 * (itself a tap) always resumes it.
 */
const BASE = "/forma/sounds/audio/preview/";

export const NOTIFICATION_SOUND_NAMES: Record<NotificationSoundId, MessageKey> = {
  "soft-inbox": "sound.notify.inbox",
  "soft-notice": "sound.notify.notice",
  "soft-message": "sound.notify.message",
  "soft-ping": "sound.notify.ping",
  "soft-mention": "sound.notify.mention",
  "bright-notice": "sound.notify.spark",
  "drop-notice": "sound.notify.drop",
};

export const soundIdOf = (id: string | undefined | null): NotificationSoundId =>
  (NOTIFICATION_SOUNDS as readonly string[]).includes(id ?? "") ? (id as NotificationSoundId) : DEFAULT_NOTIFICATION_SOUND;

let ctx: AudioContext | null = null;
let unlocked = false;
const buffers = new Map<NotificationSoundId, Promise<AudioBuffer>>();
let playing: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

function context(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

function unlock() {
  unlocked = true;
  const c = context();
  if (c && c.state === "suspended") void c.resume();
}
if (typeof window !== "undefined") {
  for (const e of ["pointerdown", "keydown"] as const) window.addEventListener(e, unlock, { passive: true, capture: true });
}

function buffer(id: NotificationSoundId): Promise<AudioBuffer> {
  let p = buffers.get(id);
  if (!p) {
    const c = context();
    if (!c) return Promise.reject(new Error("no audio"));
    p = fetch(`${BASE}${id}.mp3`, { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`sound ${id}`);
        return r.arrayBuffer();
      })
      .then((data) => c.decodeAudioData(data));
    p.catch(() => buffers.delete(id));
    buffers.set(id, p);
  }
  return p;
}

/** Decodes a sound ahead of time (the first notification then plays at once). */
export function preloadNotificationSound(id: string | undefined | null) {
  if (context()) void buffer(soundIdOf(id)).catch(() => undefined);
}

export function stopNotificationSound() {
  const p = playing;
  playing = null;
  if (!p) return;
  try {
    p.source.onended = null;
    p.source.stop();
  } catch {
    /* already over */
  }
}

async function play(id: NotificationSoundId, force: boolean): Promise<boolean> {
  const c = context();
  if (!c || (!unlocked && !force)) return false;
  if (c.state !== "running") {
    try {
      await c.resume();
    } catch {
      return false;
    }
  }
  if (c.state !== "running") return false;
  const buf = await buffer(id);
  stopNotificationSound();
  const source = c.createBufferSource();
  const gain = c.createGain();
  gain.gain.value = 0.9;
  source.buffer = buf;
  source.connect(gain).connect(c.destination);
  const mine = { source, gain };
  playing = mine;
  source.onended = () => {
    if (playing === mine) playing = null;
  };
  source.start();
  return true;
}

/** A notification arrived (callers check the "sound" switch). Silent until the page was touched once. */
export function playNotificationSound(id?: string | null) {
  void play(soundIdOf(id), false).catch(() => undefined);
}

/** Settings → Notifications: hear a sound (a tap, so audio may start). Resolves false when the browser refused. */
export function previewNotificationSound(id: string): Promise<boolean> {
  unlocked = true;
  return play(soundIdOf(id), true).catch(() => false);
}
