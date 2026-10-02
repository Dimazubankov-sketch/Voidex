import { useEffect, useMemo, useRef, useState } from "react";
import { RiPauseFill, RiPlayFill } from "@remixicon/react";
import type { VibexFileDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { useFileUrl } from "./data";
import { formatDuration } from "./recorder";

const BARS = 36;

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
  const total = durationMs ?? 0;

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audio.current;
    if (!a || !Number.isFinite(a.duration)) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
  };

  return (
    <div className="flex w-[240px] max-w-full items-center gap-2.5 px-1.5 py-1" data-testid="voice-message">
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
        <div className="flex h-7 cursor-pointer items-center gap-[2px]" onClick={seek} aria-hidden>
          {peaks.map((v, i) => (
            <span
              key={i}
              className={cx("w-[3px] flex-1 rounded-full", i / BARS <= pos ? (mine ? "bg-white" : "bg-primary") : mine ? "bg-white/45" : "bg-primary/30")}
              style={{ height: `${Math.round(v * 100)}%` }}
            />
          ))}
        </div>
        <span className={cx("text-[11.5px] tabular-nums", mine ? "text-white/80" : "text-text-tertiary")} data-testid="voice-duration">
          {formatDuration(playing || pos > 0 ? pos * total : total)}
        </span>
      </div>
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
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

/** Video circle: round video; tap plays / pauses with sound; a ring shows progress. */
export function CircleBubble({ file, durationMs }: { file: VibexFileDto; durationMs: number | null }) {
  const t = useT();
  const { data: src } = useFileUrl(file.id);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const size = 208;
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={() => {
        const v = video.current;
        if (!v) return;
        if (v.paused) {
          v.muted = false;
          void v.play();
        } else v.pause();
      }}
      aria-label={playing ? t("vibex.voice.pause") : t("vibex.circle.play")}
      className="relative block shrink-0 rounded-full"
      style={{ width: size, height: size }}
      data-testid="circle-message"
    >
      {src ? (
        <video
          ref={video}
          src={src}
          playsInline
          preload="metadata"
          className="size-full rounded-full bg-black object-cover"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (durationMs ?? 0) / 1000;
            if (d) setPos(Math.min(1, v.currentTime / d));
          }}
        />
      ) : (
        <span className="flex size-full items-center justify-center rounded-full bg-black/80">
          <Spinner className="text-white" />
        </span>
      )}
      <svg className="pointer-events-none absolute inset-0 -rotate-90" width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#8b7bff" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pos)} opacity={pos > 0 ? 1 : 0} />
      </svg>
      {!playing && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur">
            <RiPlayFill className="size-7" />
          </span>
        </span>
      )}
      {durationMs !== null && (
        <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] tabular-nums text-white">{formatDuration(durationMs)}</span>
      )}
    </button>
  );
}
