import { useCallback, useEffect, useRef, useState } from "react";
import { VIBEX_CIRCLE_MAX_MS, VIBEX_VOICE_MAX_MS } from "@voidex/shared";
import { CircleCamera, type Facing } from "./circle-camera";

/**
 * Voice messages and video circles, recorded in the browser with the native
 * MediaRecorder (no external service). The result is uploaded through the
 * normal Vibex file storage (purpose "voice" / "circle", type and size
 * checked by the server) and sent as one message.
 *
 * Step 2.10: a recording can pause and go on (the time counts only what is
 * recorded); a circle records through CircleCamera, so switching the camera
 * keeps one continuous recording (same timer, nothing lost); the camera's
 * own zoom (never below 1x) when it has one.
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

/** One recording session: start → (live level, elapsed, pause / resume) → stop (a file) or cancel (nothing). */
export function useRecorder(kind: RecordKind) {
  const [state, setState] = useState<"idle" | "starting" | "recording" | "paused">("idle");
  const [elapsed, setElapsed] = useState(0);
  /** What the live preview shows (a circle: the current camera). */
  const [stream, setStream] = useState<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const cam = useRef<CircleCamera | null>(null);
  const chunks = useRef<Blob[]>([]);
  /** Recorded time: the finished stretches plus the one running now. */
  const doneMs = useRef(0);
  const runFrom = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const levels = useRef<number[]>([]);
  const analyser = useRef<{ ctx: AudioContext; node: AnalyserNode } | null>(null);
  const resolveStop = useRef<((r: Recording | null) => void) | null>(null);
  /** Which camera a circle uses (front by default) and whether there is a second one. */
  const [facing, setFacing] = useState<Facing>("user");
  const [canFlip, setCanFlip] = useState(false);
  const [zoom, setZoomValue] = useState(1);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const max = kind === "voice" ? VIBEX_VOICE_MAX_MS : VIBEX_CIRCLE_MAX_MS;

  const recorded = () => doneMs.current + (runFrom.current === null ? 0 : performance.now() - runFrom.current);

  const cleanup = useCallback(() => {
    window.clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    cam.current?.close();
    cam.current = null;
    void analyser.current?.ctx.close().catch(() => undefined);
    analyser.current = null;
    rec.current = null;
    doneMs.current = 0;
    runFrom.current = null;
    setStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setState("idle");
    setElapsed(0);
    setZoomRange(null);
    setZoomValue(1);
  }, []);

  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const constraints = (face: Facing): MediaStreamConstraints =>
    kind === "voice" ? { audio: true } : { audio: true, video: { facingMode: face, width: { ideal: 480 }, height: { ideal: 480 } } };

  /** Records from this stream (a fresh clip: chunks and time start over). */
  const begin = useCallback(
    (media: MediaStream, preview: MediaStream) => {
      const type = TYPES[kind].find((t) => MediaRecorder.isTypeSupported?.(t.mime)) ?? TYPES[kind][0]!;
      const r = new MediaRecorder(media, { mimeType: type.mime, ...(kind === "circle" ? { videoBitsPerSecond: 900_000 } : { audioBitsPerSecond: 48_000 }) });
      chunks.current = [];
      levels.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        const durationMs = Math.min(max, Math.round(recorded()));
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
      setStream(preview);
      r.start(250);
      doneMs.current = 0;
      runFrom.current = performance.now();
      setElapsed(0);
      setState("recording");
      window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        const ms = recorded();
        setElapsed(ms);
        const a = analyser.current;
        if (a && runFrom.current !== null) {
          const data = new Uint8Array(a.node.frequencyBinCount);
          a.node.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          levels.current.push(Math.min(1, peak / 64));
        }
        if (ms >= max && rec.current && rec.current.state !== "inactive") rec.current.stop();
      }, 100);
    },
    [kind, max], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const readZoom = () => {
    const range = cam.current?.zoomRange() ?? null;
    setZoomRange(range);
    setZoomValue(range ? range.min : 1);
  };

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setState("starting");
    try {
      setFacing("user");
      if (kind === "circle" && CircleCamera.supported()) {
        const c = await CircleCamera.open("user");
        cam.current = c;
        begin(c.output, c.camera);
        readZoom();
      } else {
        const media = await navigator.mediaDevices.getUserMedia(constraints("user"));
        begin(media, media);
      }
      if (kind === "circle") {
        // Labels / devices are known once the permission is granted: offer the switch only with two cameras.
        const cams = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === "videoinput");
        setCanFlip(cams.length > 1);
      }
    } catch (e) {
      cleanup();
      throw e;
    }
  }, [state, kind, begin, cleanup]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Front ↔ rear camera for a circle. Step 2.10: the recording goes on (the
   * same file, the same timer); only the picture changes. Without canvas
   * recording (old browsers) the unfinished clip starts over, as before.
   */
  const flip = useCallback(async () => {
    if (kind !== "circle" || !rec.current || !canFlip) return;
    const next: Facing = facing === "user" ? "environment" : "user";
    const c = cam.current;
    if (c) {
      if (await c.switchTo(next)) {
        setFacing(next);
        setStream(c.camera);
        readZoom();
      }
      return;
    }
    const old = rec.current;
    old.onstop = null;
    old.ondataavailable = null;
    if (old.state !== "inactive") old.stop();
    old.stream.getTracks().forEach((t) => t.stop());
    void analyser.current?.ctx.close().catch(() => undefined);
    analyser.current = null;
    rec.current = null;
    window.clearInterval(timer.current);
    setState("starting");
    try {
      const media = await navigator.mediaDevices.getUserMedia(constraints(next));
      setFacing(next);
      begin(media, media);
    } catch {
      const media = await navigator.mediaDevices.getUserMedia(constraints(facing));
      begin(media, media);
    }
  }, [kind, canFlip, facing, begin]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Step 2.10: pause (the time stops; nothing is recorded) and go on. */
  const pause = useCallback(() => {
    const r = rec.current;
    if (!r || r.state !== "recording") return;
    r.pause();
    if (runFrom.current !== null) doneMs.current += performance.now() - runFrom.current;
    runFrom.current = null;
    setElapsed(doneMs.current);
    setState("paused");
  }, []);
  const resume = useCallback(() => {
    const r = rec.current;
    if (!r || r.state !== "paused") return;
    r.resume();
    runFrom.current = performance.now();
    setState("recording");
  }, []);

  /** Step 2.10: the camera's own zoom (min 1x); null when it has none. */
  const setZoom = useCallback(async (v: number) => {
    const z = await cam.current?.setZoom(v);
    if (typeof z === "number") setZoomValue(z);
  }, []);

  /** Stops and returns the recording (null if nothing was captured). */
  const stop = useCallback(async (): Promise<Recording | null> => {
    const r = rec.current;
    if (!r) return null;
    const result = new Promise<Recording | null>((res) => (resolveStop.current = res));
    if (r.state !== "inactive") r.stop();
    const out = await result;
    cleanup();
    return out;
  }, [cleanup]);

  const cancel = useCallback(() => {
    resolveStop.current = null;
    if (rec.current && rec.current.state !== "inactive") {
      rec.current.onstop = null;
      rec.current.stop();
    }
    cleanup();
  }, [cleanup]);

  return { state, elapsed, stream, levels, start, stop, cancel, max, facing, canFlip, flip, pause, resume, zoom, zoomRange, setZoom };
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
