import type { EditSettings } from "./media-utils";
import { filterPixels } from "./edit-color";
export function trimRange(start: number, end: number, duration: number): [number, number] {
  const a = Math.max(0, Math.min(start, Math.max(0, duration - 0.1)));
  return [a, Math.max(a + 0.1, Math.min(duration, end))];
}
export function videoSize(w: number, h: number, s: EditSettings, max = 1280) {
  const cw = (w * s.crop.w) / 100,
    ch = (h * s.crop.h) / 100,
    scale = Math.min(1, max / Math.max(cw, ch));
  const width = Math.max(2, Math.round((cw * scale) / 2) * 2),
    height = Math.max(2, Math.round((ch * scale) / 2) * 2);
  return s.rotation % 180 ? { width: height, height: width } : { width, height };
}
export function drawVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, s: EditSettings, max = 1280) {
  if (!video.videoWidth || video.readyState < 2) return;
  const size = videoSize(video.videoWidth, video.videoHeight, s, max);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const sw = (video.videoWidth * s.crop.w) / 100,
    sh = (video.videoHeight * s.crop.h) / 100;
  const rotated = s.rotation % 180 !== 0,
    w = rotated ? canvas.height : canvas.width,
    h = rotated ? canvas.width : canvas.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((s.rotation * Math.PI) / 180);
  if (s.flip) ctx.scale(-1, 1);
  ctx.drawImage(video, (video.videoWidth * s.crop.x) / 100, (video.videoHeight * s.crop.y) / 100, sw, sh, -w / 2, -h / 2, w, h);
  ctx.restore();
  filterPixels(ctx, s);
}
function event(video: HTMLVideoElement, name: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("Видео не отвечает. Попробуйте открыть его снова.")), 20000);
    function finish(error?: Error) {
      clearTimeout(timeout);
      video.removeEventListener(name, ok);
      video.removeEventListener("error", bad);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    }
    function ok() {
      finish();
    }
    function bad() {
      finish(new Error("Не удалось прочитать видео."));
    }
    function abort() {
      finish(new DOMException("Отменено", "AbortError"));
    }
    video.addEventListener(name, ok, { once: true });
    video.addEventListener("error", bad, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
export async function videoFrames(src: string, signal: AbortSignal, durationHint = 0): Promise<string[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const urls: string[] = [];
  try {
    const ready = event(video, "loadeddata", signal);
    video.src = src;
    await ready;
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 72;
    for (let i = 0; i < 8; i++) {
      const duration = Number.isFinite(video.duration) ? video.duration : durationHint;
      if (!(duration > 0)) return [];
      const target = Math.max(0.01, Math.min(duration - 0.01, (duration * (i + 0.5)) / 8));
      const ready = event(video, "seeked", signal);
      video.currentTime = target;
      await ready;
      const scale = Math.max(120 / video.videoWidth, 72 / video.videoHeight),
        sw = 120 / scale,
        sh = 72 / scale;
      canvas.getContext("2d")!.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, 120, 72);
      urls.push(canvas.toDataURL("image/jpeg", 0.65));
    }
    return urls;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
/** Render trimmed, transformed frames into a real video file; audio stays synchronized. */
export async function exportVideo(
  src: string,
  s: EditSettings,
  start: number,
  end: number,
  muted: boolean,
  onProgress: (n: number) => void,
  signal: AbortSignal,
) {
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream)
    throw new Error(
      "Этот браузер не поддерживает сохранение обработанного видео. Откройте редактор в современном Safari, Chrome или Edge.",
    );
  const mime = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error("Нет доступного формата для сохранения видео.");
  const audio = muted ? null : new AudioContext();
  const resumed = audio?.resume();
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.muted = muted;
  Object.assign(video.style, { position: "fixed", width: "1px", height: "1px", opacity: ".01", pointerEvents: "none" });
  document.body.appendChild(video);
  let stream: MediaStream | null = null,
    recorder: MediaRecorder | null = null,
    raf = 0;
  try {
    await resumed;
    const ready = event(video, "loadeddata", signal);
    video.src = src;
    await ready;
    const [from, to] = trimRange(start, end, Number.isFinite(video.duration) ? video.duration : end);
    if (from > 0) {
      const ready = event(video, "seeked", signal);
      video.currentTime = from;
      await ready;
    }
    const canvas = document.createElement("canvas");
    drawVideoFrame(video, canvas, s);
    stream = canvas.captureStream(24);
    if (audio) {
      const source = audio.createMediaElementSource(video);
      const destination = audio.createMediaStreamDestination();
      source.connect(destination);
      destination.stream.getAudioTracks().forEach((track) => stream!.addTrack(track));
    }
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 });
    const rec = recorder,
      chunks: Blob[] = [];
    let bytes = 0;
    const blob = await new Promise<Blob>((resolve, reject) => {
      let finished = false;
      function finish(error?: Error) {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(raf);
        video.pause();
        signal.removeEventListener("abort", abort);
        if (rec.state !== "inactive") {
          rec.onstop = () => (error ? reject(error) : resolve(new Blob(chunks, { type: mime!.split(";")[0] })));
          rec.stop();
        } else if (error) reject(error);
      }
      function abort() {
        finish(new DOMException("Отменено", "AbortError"));
      }
      rec.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          bytes += e.data.size;
          if (bytes > 70000000) finish(new Error("Результат больше 70 МБ. Сократите длину видео."));
        }
      };
      rec.onerror = () => finish(new Error("Не удалось сохранить видео."));
      function draw() {
        if (finished) return;
        try {
          drawVideoFrame(video, canvas, s);
          onProgress(Math.min(1, (video.currentTime - from) / (to - from)));
          if (video.currentTime >= to - 0.02 || video.ended) {
            onProgress(1);
            finish();
          } else raf = requestAnimationFrame(draw);
        } catch (e) {
          finish(e as Error);
        }
      }
      signal.addEventListener("abort", abort, { once: true });
      rec.start(500);
      video
        .play()
        .then(() => {
          raf = requestAnimationFrame(draw);
        })
        .catch((e) => finish(e));
      if (signal.aborted) abort();
    });
    if (!blob.size) throw new Error("Браузер вернул пустой видеофайл.");
    return { blob, width: canvas.width, height: canvas.height, duration: to - from };
  } finally {
    cancelAnimationFrame(raf);
    if (recorder?.state === "recording") recorder.stop();
    stream?.getTracks().forEach((t) => t.stop());
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    await audio?.close();
  }
}
