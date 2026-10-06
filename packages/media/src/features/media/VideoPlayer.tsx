"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize } from "lucide-react";
import { durationLabel } from "./model";
import type { EditSettings } from "./media-utils";
import { drawVideoFrame } from "./video-utils";
export default function VideoPlayer({
  src,
  name,
  settings,
  start = 0,
  end = Infinity,
  durationHint = 0,
  onDuration,
  muted: controlledMute,
  onMute,
}: {
  src: string;
  name: string;
  settings?: EditSettings;
  start?: number;
  end?: number;
  durationHint?: number;
  onDuration?: (n: number) => void;
  muted?: boolean;
  onMute?: (m: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    root = useRef<HTMLDivElement>(null);
  const current = useRef(settings);
  current.current = settings;
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(durationHint),
    [muted, setMuted] = useState(false),
    [error, setError] = useState("");
  const mute = controlledMute ?? muted;
  const stop = Math.min(end, duration || end);
  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setError("");
  }, [src]);
  useEffect(() => {
    let frame = 0,
      last = 0,
      lastTime = -1,
      lastSettings: EditSettings | undefined;
    const draw = (now: number) => {
      const v = video.current,
        c = canvas.current,
        s = current.current;
      if (v && c && s && v.readyState >= 2 && now - last > 40 && (v.currentTime !== lastTime || s !== lastSettings)) {
        try {
          drawVideoFrame(v, c, s, 960);
          lastTime = v.currentTime;
          lastSettings = s;
        } catch (e) {
          setError((e as Error).message);
        }
        last = now;
      }
      frame = requestAnimationFrame(draw);
    };
    if (settings) frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [src, !!settings]);
  useEffect(() => {
    const v = video.current;
    if (v && v.readyState >= 1 && (v.currentTime < start || v.currentTime > stop)) v.currentTime = start;
  }, [start, stop]);
  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime >= stop - 0.05 || v.currentTime < start) v.currentTime = start;
      v.play().catch(() => setError("Не удалось воспроизвести видео."));
    } else v.pause();
  }
  return (
    <div className={"vm-video-player " + (settings ? "editing" : "")} ref={root}>
      <div
        className="vm-video-picture"
        onDoubleClick={() => {
          if (!settings) void root.current?.requestFullscreen?.().catch(() => {});
        }}
      >
        <video
          ref={video}
          src={src}
          playsInline
          preload="auto"
          muted={mute}
          aria-label={name}
          className={settings ? "vm-video-source" : ""}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            const d = Number.isFinite(v.duration) ? v.duration : durationHint;
            setDuration(d);
            onDuration?.(d);
            if (start > 0) v.currentTime = start;
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            setTime(v.currentTime);
            if (v.currentTime >= stop) {
              v.pause();
              v.currentTime = Math.max(start, stop - 0.01);
            }
          }}
          onError={() => setError("Видео не поддерживается браузером или недоступно.")}
        />
        {settings && <canvas ref={canvas} aria-label={"Предпросмотр: " + name} />}
        {!playing && (
          <button className="vm-video-center" aria-label="Воспроизвести видео" onClick={toggle}>
            <Play fill="currentColor" />
          </button>
        )}
      </div>
      {error && (
        <p className="vm-error" role="alert">
          {error}
        </p>
      )}
      <div className="vm-video-controls vm-glass">
        <button aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={toggle}>
          {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <span>{durationLabel(Math.max(0, time - start))}</span>
        <input
          type="range"
          aria-label="Позиция видео"
          min={start}
          max={Number.isFinite(stop) ? stop : 0}
          step="0.01"
          value={Math.max(start, Math.min(time, Number.isFinite(stop) ? stop : start))}
          onChange={(e) => {
            if (video.current) video.current.currentTime = Number(e.target.value);
            setTime(Number(e.target.value));
          }}
        />
        <span>{durationLabel(Math.max(0, stop - start))}</span>
        <button
          aria-label={mute ? "Включить звук" : "Выключить звук"}
          onClick={() => {
            setMuted(!mute);
            onMute?.(!mute);
          }}
        >
          {mute ? <VolumeX /> : <Volume2 />}
        </button>
        {!settings && (
          <button
            aria-label="На весь экран"
            onClick={() => {
              const v = video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
              if (root.current?.requestFullscreen) void root.current.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
              else v?.webkitEnterFullscreen?.();
            }}
          >
            <Maximize />
          </button>
        )}
      </div>
    </div>
  );
}
