/**
 * Forma sound engine: the Soundlab playback rules of Forma 0.1, in TypeScript.
 *
 *   one press = one playback; a sound that is playing cannot start again
 *   until it ends; different sounds play at the same time; nothing loops;
 *   the natural tail of every file is kept (no fade, no cut).
 *
 * Files are decoded once with Web Audio and played from memory (low
 * latency); without Web Audio an <audio> element is used. The waveform of a
 * tile follows the real playback position through the catalog's animation
 * frames (50 per second), so the bars move with what is heard.
 */

export interface SoundEntry {
  id: string;
  name: string;
  category: string;
  action: string;
  tags: string[];
  kind: "audio" | "haptic";
  file: string;
  sha256: string;
  durationMs: number;
  fps: number;
  frames: number[][];
  haptic?: { pattern: number[]; durationMs: number };
}

export interface SoundCatalog {
  categories: { id: string; name: string }[];
  sounds: SoundEntry[];
}

export const SOUND_BASE = "/forma/sounds/";

let catalogPromise: Promise<SoundCatalog> | null = null;

export function loadCatalog(): Promise<SoundCatalog> {
  catalogPromise ??= fetch(`${SOUND_BASE}catalog.json`, { cache: "force-cache" })
    .then((r) => {
      if (!r.ok) throw new Error("catalog");
      return r.json() as Promise<SoundCatalog>;
    })
    .catch((e) => {
      catalogPromise = null;
      throw e;
    });
  return catalogPromise;
}

interface Playing {
  sound: SoundEntry;
  startedAt: number;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
  audio?: HTMLAudioElement;
  timer?: number;
}

type Listener = () => void;

class Engine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private active = new Map<string, Playing>();
  private listeners = new Set<Listener>();
  private byId = new Map<string, SoundEntry>();
  volume = 0.78;

  register(sounds: SoundEntry[]) {
    for (const s of sounds) this.byId.set(s.id, s);
  }

  get(id: string) {
    return this.byId.get(id);
  }

  private context(): AudioContext | null {
    if (this.ctx && this.ctx.state !== "closed") return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC({ latencyHint: "interactive" });
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Decodes a sound ahead of its first press (hover, visible tiles). */
  preload(id: string): Promise<AudioBuffer | null> {
    const s = this.byId.get(id);
    const ctx = this.context();
    if (!s || !ctx) return Promise.resolve(null);
    const ready = this.buffers.get(id);
    if (ready) return Promise.resolve(ready);
    let p = this.loading.get(id);
    if (!p) {
      p = fetch(SOUND_BASE + s.file)
        .then((r) => {
          if (!r.ok) throw new Error("audio");
          return r.arrayBuffer();
        })
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => {
          this.buffers.set(id, buffer);
          this.loading.delete(id);
          return buffer;
        })
        .catch(() => {
          this.loading.delete(id);
          return null;
        });
      this.loading.set(id, p);
    }
    return p;
  }

  isPlaying(id: string) {
    return this.active.has(id);
  }

  playing(): string[] {
    return [...this.active.keys()];
  }

  /** Seconds since the sound started (for its waveform), or null. */
  position(id: string): number | null {
    const p = this.active.get(id);
    if (!p) return null;
    if (p.source && this.ctx) return Math.max(0, this.ctx.currentTime - p.startedAt);
    if (p.audio) return p.audio.currentTime;
    return Math.max(0, performance.now() / 1000 - p.startedAt);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** Plays once. Returns false when the sound is unknown or already playing (no re-trigger). */
  play(id: string, onError?: (message: string) => void): boolean {
    const s = this.byId.get(id);
    if (!s || this.active.has(id)) return false;
    const entry: Playing = { sound: s, startedAt: performance.now() / 1000 };
    this.active.set(id, entry);
    this.emit();
    if (s.kind === "haptic" && s.haptic && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate(s.haptic.pattern);
      } catch {
        /* no vibration on this device: the audio preview still plays */
      }
    }
    const failed = () => {
      if (this.active.get(id) !== entry) return;
      this.finish(id);
      onError?.("Не удалось загрузить звук. Попробуйте ещё раз.");
    };
    const ctx = this.context();
    if (ctx) {
      if (ctx.state !== "running") void ctx.resume().catch(failed);
      void this.preload(id).then((buffer) => {
        if (this.active.get(id) !== entry) return;
        if (!buffer) return failed();
        try {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          const gain = ctx.createGain();
          gain.gain.value = this.volume;
          source.connect(gain).connect(ctx.destination);
          entry.source = source;
          entry.gain = gain;
          entry.startedAt = ctx.currentTime;
          source.onended = () => this.finish(id, source);
          source.start();
        } catch {
          failed();
        }
      });
    } else {
      const audio = new Audio(SOUND_BASE + s.file);
      audio.volume = this.volume;
      audio.loop = false;
      entry.audio = audio;
      audio.addEventListener("ended", () => this.finish(id));
      audio.addEventListener("error", failed);
      void audio.play().catch(failed);
    }
    return true;
  }

  private finish(id: string, source?: AudioBufferSourceNode) {
    const p = this.active.get(id);
    if (!p || (source && p.source !== source)) return;
    this.active.delete(id);
    try {
      p.source?.disconnect();
      p.gain?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.emit();
  }

  stopAll() {
    for (const [id, p] of [...this.active]) {
      if (p.source) {
        p.source.onended = null;
        try {
          p.source.stop();
        } catch {
          /* not started */
        }
      }
      p.audio?.pause();
      this.finish(id, p.source);
    }
    try {
      navigator.vibrate?.(0);
    } catch {
      /* ignore */
    }
  }
}

export const soundEngine = new Engine();

/** Bar heights (0..1 multipliers) of a 9-bar waveform at a playback position, as in Soundlab. */
export function waveLevels(s: SoundEntry, seconds: number, previous: number[]): number[] {
  const frames = s.frames;
  if (!frames.length) return previous;
  const pos = seconds * (s.fps || 50);
  const i = Math.min(Math.floor(pos), frames.length - 1);
  const j = Math.min(i + 1, frames.length - 1);
  const mix = Math.max(0, Math.min(1, pos - i));
  const levels = frames[i]!.map((v, k) => v * (1 - mix) + (frames[j]![k] ?? v) * mix);
  const amplitude = Math.max(...levels);
  const out: number[] = [];
  for (let b = 0; b < 9; b++) {
    const edge = b === 0 || b === 8;
    const energy = edge ? amplitude : (levels[b - 1] ?? 0);
    const shape = edge ? 1 : 0.34 + 0.66 * energy;
    const target = edge ? 1 : 0.74 + Math.min(0.38, shape * amplitude * 0.38);
    const prev = previous[b] ?? 1;
    out.push(prev + (target - prev) * 0.22);
  }
  return out;
}

export function prefersReduced() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
