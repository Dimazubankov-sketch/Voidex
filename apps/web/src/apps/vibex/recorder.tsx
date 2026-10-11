import { useCallback, useEffect, useRef, useState } from "react";
import { VIBEX_CIRCLE_MAX_MS, VIBEX_VOICE_MAX_MS } from "@voidex/shared";

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
  /** Step 2.5: which camera a circle uses (front by default) and whether there is a second one. */
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [canFlip, setCanFlip] = useState(false);
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

  const constraints = (face: "user" | "environment"): MediaStreamConstraints =>
    kind === "voice" ? { audio: true } : { audio: true, video: { facingMode: face, width: { ideal: 480 }, height: { ideal: 480 } } };

  /** Records from this stream (a fresh clip: chunks and time start over). */
  const begin = useCallback(
    (media: MediaStream) => {
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
      setElapsed(0);
      setState("recording");
      window.clearInterval(timer.current);
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
    },
    [kind, max],
  );

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setState("starting");
    try {
      setFacing("user");
      const media = await navigator.mediaDevices.getUserMedia(constraints("user"));
      begin(media);
      if (kind === "circle") {
        // Labels / devices are known once the permission is granted: offer the flip only with two cameras.
        const cams = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === "videoinput");
        setCanFlip(cams.length > 1);
      }
    } catch (e) {
      cleanup();
      throw e;
    }
  }, [state, kind, begin, cleanup]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Step 2.5: front ↔ rear camera for a circle. The unfinished clip is
   * dropped (a circle is one shot from one camera), the old camera and
   * microphone are released, and recording starts over with the other camera.
   */
  const flip = useCallback(async () => {
    if (kind !== "circle" || !rec.current || !canFlip) return;
    const next = facing === "user" ? "environment" : "user";
    const old = rec.current;
    old.onstop = null;
    old.ondataavailable = null;
    if (old.state === "recording") old.stop();
    old.stream.getTracks().forEach((t) => t.stop());
    void analyser.current?.ctx.close().catch(() => undefined);
    analyser.current = null;
    rec.current = null;
    window.clearInterval(timer.current);
    setState("starting");
    try {
      const media = await navigator.mediaDevices.getUserMedia(constraints(next));
      setFacing(next);
      begin(media);
    } catch {
      // The other camera failed: back to the one that worked.
      const media = await navigator.mediaDevices.getUserMedia(constraints(facing));
      begin(media);
    }
  }, [kind, canFlip, facing, begin]); // eslint-disable-line react-hooks/exhaustive-deps

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

  return { state, elapsed, stream, levels, start, stop, cancel, max, facing, canFlip, flip };
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
