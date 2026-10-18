import { create } from "zustand";
import { soundById } from "@voidex/clock";
import { SOUND_URLS, WHEEL_TICK_URL } from "./sound-urls";

/**
 * Step 2.14: the sound of Voidex Clock (ported from the Web Audio code of
 * Voidex-Clock app.js). One AudioContext for the whole app, created on the
 * first tap (browsers start it only after a gesture):
 *
 *   tick     the drums' click, only on a real step of a drum, at most once
 *            every 28 ms, very quiet; never on the first render of a drum
 *   preview  one play per tap; the same sound cannot start again while it
 *            plays; another sound stops the previous one; leaving the picker
 *            stops it
 *   ring     the alarm / timer signal, looped until Stop or Snooze
 *
 * Every start fades in over 35 ms and every stop fades out over 80 ms (no
 * clicks). Step 2.15: there is no «Включить звук»: the sound is unlocked by
 * the first tap anywhere in VOIDEX while something is set to ring, and a ring
 * whose sound the browser still holds back starts with the next tap.
 */

interface AudioUi {
  /** The context runs (sound can play right now). */
  running: boolean;
  /** The sound being previewed, if any. */
  previewId: string | null;
  /** The signal is audible. */
  ringing: boolean;
}

export const useClockAudio = create<AudioUi>(() => ({ running: false, previewId: null, ringing: false }));

type Ctx = AudioContext;
let context: Ctx | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
let tickBuffer: AudioBuffer | null = null;
let tickLoading = false;
let lastTick = 0;
let preview: { id: string; source: AudioBufferSourceNode; gain: GainNode; endsAt: number } | null = null;
let previewSafety: number | undefined;
let previewToken = 0;
let ring: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let ringToken = 0;

function syncRunning() {
  const running = context?.state === "running";
  if (useClockAudio.getState().running !== running) useClockAudio.setState({ running });
}

/** Creates / resumes the context. Call it from a user gesture. */
export async function enableAudio(): Promise<Ctx> {
  if (!context) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("no-audio");
    context = new AC();
    context.addEventListener?.("statechange", syncRunning);
  }
  if (context.state !== "running") await context.resume();
  syncRunning();
  warmTick();
  return context;
}

/** Best effort from any tap: never throws. */
export function unlockAudio() {
  if (context?.state === "running") return;
  enableAudio().catch(() => {});
}

function warmTick() {
  if (tickBuffer || tickLoading || !context || !WHEEL_TICK_URL) return;
  tickLoading = true;
  const ctx = context;
  fetch(WHEEL_TICK_URL)
    .then((r) => {
      if (!r.ok) throw new Error("wheel tick");
      return r.arrayBuffer();
    })
    .then((bytes) => ctx.decodeAudioData(bytes))
    .then((b) => (tickBuffer = b))
    .catch(() => {})
    .finally(() => (tickLoading = false));
}

/** The drums' click: only once the context runs (a tap unlocked it), rate-limited. */
export function playWheelTick() {
  if (!context || context.state !== "running") return;
  if (!tickBuffer) return warmTick();
  const now = context.currentTime;
  if (now - lastTick < 0.028) return;
  lastTick = now;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = tickBuffer;
  gain.gain.value = 0.045;
  source.connect(gain).connect(context.destination);
  source.start();
}

async function loadSound(id: string): Promise<AudioBuffer> {
  const ctx = await enableAudio();
  const entry = soundById(id);
  if (!buffers.has(entry.id)) {
    buffers.set(
      entry.id,
      fetch(SOUND_URLS[entry.id]!)
        .then((r) => {
          if (!r.ok) throw new Error("load");
          return r.arrayBuffer();
        })
        .then((bytes) => ctx.decodeAudioData(bytes))
        .catch((e) => {
          buffers.delete(entry.id);
          throw e;
        }),
    );
  }
  return buffers.get(entry.id)!;
}

function fadeIn(gain: GainNode, volume: number) {
  const t = context!.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.035);
}

function fadeStop(source: AudioBufferSourceNode, gain: GainNode) {
  try {
    const t = context!.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.08);
    source.stop(t + 0.09);
  } catch {
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
  }
}

export function stopPreview() {
  previewToken++;
  window.clearTimeout(previewSafety);
  if (preview) {
    preview.source.onended = null;
    fadeStop(preview.source, preview.gain);
    preview = null;
  }
  if (useClockAudio.getState().previewId !== null) useClockAudio.setState({ previewId: null });
}

/**
 * Plays a sound once (Step 2.15: reliably on every tap). The same sound is not
 * started again while it is really playing; another sound stops it first. A
 * preview that could not be heard (the context was held back, the end never
 * came) never blocks the next tap: it is simply started again.
 */
export async function previewSound(id: string): Promise<void> {
  const ctxNow = context;
  if (preview && preview.id === id && ctxNow?.state === "running" && ctxNow.currentTime < preview.endsAt) return;
  stopPreview();
  const token = ++previewToken;
  useClockAudio.setState({ previewId: id });
  try {
    // Called from the tap: the context is created / resumed inside the gesture (enableAudio runs synchronously up to resume()).
    const buffer = await loadSound(id);
    if (token !== previewToken) return;
    const ctx = context!;
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
    if (token !== previewToken) return;
    if (ctx.state !== "running") throw new Error("audio-blocked");
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    fadeIn(gain, 0.55);
    source.connect(gain).connect(ctx.destination);
    const done = () => {
      if (token !== previewToken) return;
      window.clearTimeout(previewSafety);
      preview = null;
      useClockAudio.setState({ previewId: null });
    };
    source.onended = done;
    preview = { id, source, gain, endsAt: ctx.currentTime + buffer.duration };
    source.start();
    // If "ended" never comes (the context was suspended meanwhile), the button comes back anyway.
    window.clearTimeout(previewSafety);
    previewSafety = window.setTimeout(done, buffer.duration * 1000 + 400);
  } catch (e) {
    if (token === previewToken) useClockAudio.setState({ previewId: null });
    throw e;
  }
}

export function stopRing() {
  ringToken++;
  if (ring) {
    fadeStop(ring.source, ring.gain);
    ring = null;
  }
  if (useClockAudio.getState().ringing) useClockAudio.setState({ ringing: false });
}

/**
 * Starts the looped signal. Resolves false when it cannot be heard (the
 * browser keeps sound off until a tap): the sheet then offers «Включить звук».
 */
export async function ringSound(id: string, opts: { force?: boolean } = {}): Promise<boolean> {
  stopPreview();
  // Without a gesture a new context stays suspended: do not even try (no silent "success").
  if (!opts.force && (!context || context.state !== "running")) return false;
  const token = ++ringToken;
  try {
    const buffer = await loadSound(id);
    if (token !== ringToken) return false;
    const ctx = context!;
    if (ctx.state !== "running") return false;
    if (ring) fadeStop(ring.source, ring.gain);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    fadeIn(gain, 0.6);
    source.connect(gain).connect(ctx.destination);
    source.start();
    ring = { source, gain };
    useClockAudio.setState({ ringing: true });
    return true;
  } catch {
    return false;
  }
}

/*
 * Step 2.15: the stopwatch's ticking. While the stopwatch runs and Clock is in
 * front, a quiet tick-tock on every whole second of the stopwatch. It stops
 * when Clock goes to the background, another app comes to the front or Clock
 * closes, and goes on when the running stopwatch is back on screen; the
 * stopwatch itself counts regardless.
 */
let swTimer: number | undefined;
let swTock = false;

function playClockTick() {
  if (!context || context.state !== "running" || !tickBuffer) return;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = tickBuffer;
  // Tick, tock: the second one a little lower and softer.
  source.playbackRate.value = swTock ? 0.72 : 0.9;
  gain.gain.value = swTock ? 0.05 : 0.065;
  swTock = !swTock;
  source.connect(gain).connect(context.destination);
  source.start();
}

/** Starts the ticking; `elapsed` gives the stopwatch's time now (ticks land on its whole seconds). */
export function startStopwatchTick(elapsed: () => number) {
  stopStopwatchTick();
  warmTick();
  const next = () => {
    const ms = elapsed();
    swTimer = window.setTimeout(() => {
      playClockTick();
      next();
    }, 1000 - (ms % 1000) + 2);
  };
  next();
}

export function stopStopwatchTick() {
  window.clearTimeout(swTimer);
  swTimer = undefined;
}

/** Test hook: whether the stopwatch is ticking now. */
export const stopwatchTicking = () => swTimer !== undefined;
