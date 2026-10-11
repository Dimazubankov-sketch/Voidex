import { useEffect, useMemo, useRef, useState } from "react";
import { RiPauseFill, RiPlayFill } from "@remixicon/react";
import type { VibexFileDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { useFileUrl } from "./data";
import { formatDuration } from "./recorder";

const BARS = 36;

/**
 * Step 2.5: one voice message / circle plays with sound at a time — starting
 * one pauses the others (Step 2.9: shared with the expanded video circle).
 */
let playingNow: HTMLMediaElement | null = null;
export function takeOver(el: HTMLMediaElement) {
  if (playingNow && playingNow !== el && !playingNow.paused) playingNow.pause();
  playingNow = el;
}

/**
 * Step 2.5.1: recordings made by MediaRecorder (WebM) carry no duration in
 * their header — the browser reports Infinity until it has read the whole
 * file, so seeking and the progress bar can't work. Asking for a far-away
 * position makes it scan to the end; then it knows the real length and we go
 * back to the start.
 */
function probeDuration(el: HTMLMediaElement) {
  if (Number.isFinite(el.duration) && el.duration > 0) return;
  const done = () => {
    if (!Number.isFinite(el.duration)) return;
    el.removeEventListener("durationchange", done);
    el.currentTime = 0;
  };
  el.addEventListener("durationchange", done);
  el.currentTime = 1e101;
}

/** Step 2.5: voice messages I have listened to (this device), for the "unplayed" dot. */
const PLAYED_KEY = "vx.vibex.played";
function playedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PLAYED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function markPlayed(id: string) {
  try {
    const s = playedSet();
    if (s.has(id)) return;
    s.add(id);
    localStorage.setItem(PLAYED_KEY, JSON.stringify([...s].slice(-2000)));
  } catch {
    /* storage unavailable */
  }
}

/** A stable pseudo-waveform from the file id (used until / unless the audio is decoded). */
function seededBars(id: string): number[] {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Array.from({ length: BARS }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 16777619);
    return 0.25 + ((h >>> 0) % 1000) / 1333;
  });
}

/** Real peaks of the recording (WebAudio), when the browser can decode it. */
function usePeaks(src: string | undefined, fallback: number[]) {
  const [peaks, setPeaks] = useState(fallback);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    (async () => {
      try {
        const buf = await (await fetch(src)).arrayBuffer();
        const ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(buf);
        void ctx.close();
        const data = audio.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / BARS));
        const out: number[] = [];
        for (let i = 0; i < BARS; i++) {
          let m = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) m = Math.max(m, Math.abs(data[j]!));
          out.push(m);
        }
        const top = Math.max(...out, 0.01);
        if (alive) setPeaks(out.map((v) => 0.18 + (v / top) * 0.82));
      } catch {
        /* keep the stable fallback */
      }
    })();
    return () => {
      alive = false;
    };
  }, [src]);
  return peaks;
}

/** Voice message: play / pause, waveform with progress, duration. */
export function VoiceBubble({ file, durationMs, mine }: { file: VibexFileDto; durationMs: number | null; mine: boolean }) {
  const t = useT();
  const { data: src } = useFileUrl(file.id);
  const fallback = useMemo(() => seededBars(file.id), [file.id]);
  const peaks = usePeaks(src, fallback);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [played, setPlayed] = useState(() => mine || playedSet().has(file.id));
  const [real, setReal] = useState(0);
  const total = durationMs ?? real;

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };
  const length = () => {
    const a = audio.current;
    return a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration : total / 1000;
  };
  const seekTo = (fraction: number) => {
    const a = audio.current;
    const d = length();
    if (!a || !d) return;
    const f = Math.max(0, Math.min(1, fraction));
    a.currentTime = f * d;
    setPos(f);
  };
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seekTo((e.clientX - r.left) / r.width);
  };

  return (
    <div className="flex w-[240px] max-w-full items-center gap-2.5 px-1.5 py-1" data-testid="voice-message" data-played={played || undefined} data-playing={playing || undefined}>
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? t("vibex.voice.pause") : t("vibex.voice.play")}
        className={cx("flex size-10 shrink-0 items-center justify-center rounded-full", mine ? "bg-white text-primary" : "bg-primary text-white")}
        data-testid="voice-play"
      >
        {!src ? <Spinner size={14} /> : playing ? <RiPauseFill className="size-5" /> : <RiPlayFill className="size-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className="flex h-7 cursor-pointer touch-none items-center gap-[2px] rounded outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          role="slider"
          tabIndex={src ? 0 : -1}
          aria-label={t("vibex.voice.position")}
          aria-valuemin={0}
          aria-valuemax={Math.round(total / 1000)}
          aria-valuenow={Math.round((pos * total) / 1000)}
          aria-valuetext={formatDuration(pos * total)}
          onPointerDown={(e) => {
            // Step 2.9: a touch that starts on the waveform belongs to seeking, never to the chat's swipe-back.
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            seek(e);
          }}
          onPointerMove={(e) => e.buttons && seek(e)}
          onKeyDown={(e) => {
            const step = 5 / Math.max(1, length());
            if (e.key === "ArrowRight") seekTo(pos + step);
            else if (e.key === "ArrowLeft") seekTo(pos - step);
            else if (e.key === " " || e.key === "Enter") toggle();
            else return;
            e.preventDefault();
          }}
          data-testid="voice-wave"
          data-gesture-owner
        >
          {peaks.map((v, i) => (
            <span
              key={i}
              className={cx("w-[3px] flex-1 rounded-full", i / BARS <= pos ? (mine ? "bg-white" : "bg-primary") : mine ? "bg-white/45" : "bg-primary/30")}
              style={{ height: `${Math.round(v * 100)}%` }}
            />
          ))}
        </div>
        <span className={cx("flex items-center gap-1.5 text-[11.5px] tabular-nums", mine ? "text-white/80" : "text-text-tertiary")}>
          <span data-testid="voice-duration">{formatDuration(playing || pos > 0 ? pos * total : total)}</span>
          {!played && <span className="size-1.5 rounded-full bg-primary" aria-label={t("vibex.voice.unplayed")} data-testid="voice-unplayed" />}
        </span>
      </div>
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => probeDuration(e.currentTarget)}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setReal(Math.round(d * 1000));
          }}
          onPlay={(e) => {
            takeOver(e.currentTarget);
            setPlaying(true);
            if (!played) {
              markPlayed(file.id);
              setPlayed(true);
            }
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : total / 1000;
            if (d) setPos(Math.min(1, a.currentTime / d));
          }}
        />
      )}
    </div>
  );
}

/**
 * Step 2.5: the "video circle" glyph for the composer — a round message with
 * its progress ring and a play mark. Deliberately not a camera.
 */
export function CircleMessageGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden data-testid="circle-glyph">
      <circle cx="12" cy="12" r="8.6" stroke="currentColor" strokeWidth="1.7" opacity="0.38" />
      <path d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10.3 9.1v5.8a.5.5 0 0 0 .76.43l4.6-2.9a.5.5 0 0 0 0-.85l-4.6-2.9a.5.5 0 0 0-.76.42Z" fill="currentColor" />
    </svg>
  );
}
