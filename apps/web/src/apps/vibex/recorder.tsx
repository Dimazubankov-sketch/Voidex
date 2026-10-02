import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { RiCloseLine, RiDeleteBinLine, RiSendPlaneFill } from "@remixicon/react";
import { VIBEX_CIRCLE_MAX_MS, VIBEX_VOICE_MAX_MS } from "@voidex/shared";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";

/**
 * Voice messages and video circles, recorded in the browser with the native
 * MediaRecorder (no external service). The result is uploaded through the
 * normal Vibex file storage (purpose "voice" / "circle", type and size
 * checked by the server) and sent as one message.
 */

export type RecordKind = "voice" | "circle";

const TYPES: Record<RecordKind, { mime: string; ext: string }[]> = {
  voice: [
    { mime: "audio/webm;codecs=opus", ext: "weba" },
    { mime: "audio/webm", ext: "weba" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  ],
  circle: [
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
    { mime: "video/mp4", ext: "mp4" },
  ],
};

export function recordingSupported(kind: RecordKind): boolean {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  return TYPES[kind].some((t) => MediaRecorder.isTypeSupported?.(t.mime));
}

export interface Recording {
  file: File;
  durationMs: number;
}

/** One recording session: start → (live level, elapsed) → stop (a file) or cancel (nothing). */
export function useRecorder(kind: RecordKind) {
  const [state, setState] = useState<"idle" | "starting" | "recording">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const levels = useRef<number[]>([]);
  const analyser = useRef<{ ctx: AudioContext; node: AnalyserNode } | null>(null);
  const resolveStop = useRef<((r: Recording | null) => void) | null>(null);
  const max = kind === "voice" ? VIBEX_VOICE_MAX_MS : VIBEX_CIRCLE_MAX_MS;

  const cleanup = useCallback(() => {
    window.clearInterval(timer.current);
    stream?.getTracks().forEach((t) => t.stop());
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    void analyser.current?.ctx.close().catch(() => undefined);
    analyser.current = null;
    rec.current = null;
    setStream(null);
    setState("idle");
    setElapsed(0);
  }, [stream]);

  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setState("starting");
    try {
      const media = await navigator.mediaDevices.getUserMedia(kind === "voice" ? { audio: true } : { audio: true, video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } } });
      const type = TYPES[kind].find((t) => MediaRecorder.isTypeSupported?.(t.mime)) ?? TYPES[kind][0]!;
      const r = new MediaRecorder(media, { mimeType: type.mime, ...(kind === "circle" ? { videoBitsPerSecond: 900_000 } : { audioBitsPerSecond: 48_000 }) });
      chunks.current = [];
      levels.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        const durationMs = Math.min(max, Math.round(performance.now() - started.current));
        const blob = new Blob(chunks.current, { type: type.mime.split(";")[0] });
        const done = resolveStop.current;
        resolveStop.current = null;
        done?.(blob.size ? { file: new File([blob], `${kind}.${type.ext}`, { type: blob.type }), durationMs } : null);
      };
      // Live level for the waveform while recording.
      try {
        const ctx = new AudioContext();
        const node = ctx.createAnalyser();
        node.fftSize = 256;
        ctx.createMediaStreamSource(media).connect(node);
        analyser.current = { ctx, node };
      } catch {
        /* no level meter */
      }
      rec.current = r;
      setStream(media);
      r.start(250);
      started.current = performance.now();
      setState("recording");
      timer.current = window.setInterval(() => {
        const ms = performance.now() - started.current;
        setElapsed(ms);
        const a = analyser.current;
        if (a) {
          const data = new Uint8Array(a.node.frequencyBinCount);
          a.node.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          levels.current.push(Math.min(1, peak / 64));
        }
        if (ms >= max) rec.current?.state === "recording" && rec.current.stop();
      }, 100);
    } catch (e) {
      cleanup();
      throw e;
    }
  }, [state, kind, max, cleanup]);

  /** Stops and returns the recording (null if nothing was captured). */
  const stop = useCallback(async (): Promise<Recording | null> => {
    const r = rec.current;
    if (!r) return null;
    const result = new Promise<Recording | null>((res) => (resolveStop.current = res));
    if (r.state === "recording") r.stop();
    const out = await result;
    cleanup();
    return out;
  }, [cleanup]);

  const cancel = useCallback(() => {
    resolveStop.current = null;
    if (rec.current?.state === "recording") {
      rec.current.onstop = null;
      rec.current.stop();
    }
    cleanup();
  }, [cleanup]);

  return { state, elapsed, stream, levels, start, stop, cancel, max };
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The composer while a voice message is being recorded: level, time, cancel, send. */
export function VoiceRecordingBar({ elapsed, levels, onCancel, onSend, sending }: { elapsed: number; levels: number[]; onCancel: () => void; onSend: () => void; sending: boolean }) {
  const t = useT();
  const bars = levels.slice(-40);
  return (
    <div className="vx-glass-strong flex items-center gap-2 rounded-[26px] p-1.5" data-testid="voice-recording">
      <button type="button" onClick={onCancel} aria-label={t("vibex.voice.cancel")} className="flex size-10 shrink-0 items-center justify-center rounded-full text-danger hover:bg-danger-soft" data-testid="voice-cancel">
        <RiDeleteBinLine className="size-5" />
      </button>
      <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
      <span className="w-11 shrink-0 text-[14px] tabular-nums text-text" data-testid="voice-elapsed">
        {formatDuration(elapsed)}
      </span>
      <span className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden>
        {bars.map((v, i) => (
          <span key={i} className="w-[3px] shrink-0 rounded-full bg-primary/70" style={{ height: `${Math.max(12, v * 100)}%` }} />
        ))}
      </span>
      <motion.button
        type="button"
        onClick={onSend}
        disabled={sending}
        whileTap={{ scale: 0.9 }}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-60"
        aria-label={t("vibex.chat.send")}
        data-testid="voice-send"
      >
        {sending ? <Spinner size={16} /> : <RiSendPlaneFill className="size-[18px]" />}
      </motion.button>
    </div>
  );
}

/** Fullscreen round camera preview while a video circle is being recorded. */
export function CircleRecorder({ stream, elapsed, max, onCancel, onSend, sending }: { stream: MediaStream | null; elapsed: number; max: number; onCancel: () => void; onSend: () => void; sending: boolean }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
  }, [stream]);
  const size = Math.min(window.innerWidth * 0.78, 340);
  const r = size / 2 + 6;
  const c = 2 * Math.PI * r;
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[280] flex flex-col items-center justify-center gap-8 bg-[rgba(12,12,20,0.82)] backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={t("vibex.circle.recording")}
      data-testid="circle-recorder"
    >
      <div className="relative" style={{ width: size + 16, height: size + 16 }}>
        <svg className="absolute inset-0 -rotate-90" width={size + 16} height={size + 16} aria-hidden>
          <circle cx={(size + 16) / 2} cy={(size + 16) / 2} r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="4" />
          <circle cx={(size + 16) / 2} cy={(size + 16) / 2} r={r} fill="none" stroke="#8b7bff" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, elapsed / max))} />
        </svg>
        <video ref={video} autoPlay muted playsInline className="absolute left-2 top-2 rounded-full bg-black object-cover [transform:scaleX(-1)]" style={{ width: size, height: size }} />
        {!stream && <Spinner className="absolute inset-0 m-auto text-white" />}
      </div>
      <span className="flex items-center gap-2 text-[15px] tabular-nums text-white">
        <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
        {formatDuration(elapsed)} / {formatDuration(max)}
      </span>
      <div className="flex items-center gap-6">
        <button type="button" onClick={onCancel} aria-label={t("vibex.voice.cancel")} className="flex size-14 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/20" data-testid="circle-cancel">
          <RiCloseLine className="size-7" />
        </button>
        <button type="button" onClick={onSend} disabled={sending} aria-label={t("vibex.chat.send")} className="flex size-16 items-center justify-center rounded-full bg-primary text-white disabled:opacity-60" data-testid="circle-send">
          {sending ? <Spinner size={18} /> : <RiSendPlaneFill className="size-7" />}
        </button>
      </div>
    </motion.div>,
    document.body,
  );
}
