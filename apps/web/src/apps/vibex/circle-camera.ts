/**
 * Step 2.10 — the camera behind a video circle, as one continuous recording.
 *
 * The MediaRecorder never records the camera directly. It records a square
 * canvas that the current camera is drawn into, plus the microphone track.
 * Switching front ↔ rear only swaps the camera feeding the canvas, so the
 * recording, its timer and everything recorded so far go on untouched (no
 * restart, no second file). Zoom is the camera's own (track constraint
 * `zoom`), offered only when the camera reports it, never below 1x and never
 * faked by cropping.
 */

export type Facing = "user" | "environment";

/** The zoom a camera offers, or null (no zoom, the control stays hidden). Never below 1x. */
export function zoomRange(caps: { min?: number; max?: number; step?: number } | undefined | null): { min: number; max: number; step: number } | null {
  if (!caps || typeof caps.max !== "number" || !Number.isFinite(caps.max)) return null;
  const min = Math.max(1, typeof caps.min === "number" && Number.isFinite(caps.min) ? caps.min : 1);
  const max = caps.max;
  if (max <= min + 0.01) return null;
  const step = typeof caps.step === "number" && caps.step > 0 ? caps.step : 0.1;
  return { min, max, step };
}

/** Keeps a zoom value inside the range (min ≥ 1). */
export function clampZoom(v: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, Number.isFinite(v) ? v : range.min));
}

const SIZE = 480;
const FPS = 30;

export class CircleCamera {
  /** What the MediaRecorder records: the canvas (video) + the microphone (audio). */
  readonly output: MediaStream;
  /** The camera right now (for the live preview; it changes on a switch). */
  camera: MediaStream;
  facing: Facing;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly source: HTMLVideoElement;
  private readonly audio: MediaStreamTrack | null;
  private timer: number | undefined;
  private stopped = false;

  private constructor(camera: MediaStream, audio: MediaStreamTrack | null, facing: Facing) {
    this.camera = camera;
    this.audio = audio;
    this.facing = facing;
    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext("2d")!;
    this.source = document.createElement("video");
    this.source.muted = true;
    this.source.playsInline = true;
    this.source.srcObject = camera;
    void this.source.play().catch(() => undefined);
    const video = this.canvas.captureStream(FPS).getVideoTracks()[0]!;
    this.output = new MediaStream(audio ? [video, audio] : [video]);
    // A timer, not requestAnimationFrame: drawing goes on while the tab is hidden for a moment.
    this.timer = window.setInterval(() => this.draw(), 1000 / FPS);
  }

  /** Whether this browser can record a canvas (otherwise the old one-camera recording is used). */
  static supported(): boolean {
    return typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
  }

  static async open(facing: Facing = "user"): Promise<CircleCamera> {
    const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: CircleCamera.video(facing) });
    const audio = media.getAudioTracks()[0] ?? null;
    const camera = new MediaStream(media.getVideoTracks());
    return new CircleCamera(camera, audio, facing);
  }

  private static video(facing: Facing): MediaTrackConstraints {
    return { facingMode: facing, width: { ideal: SIZE }, height: { ideal: SIZE } };
  }

  /** The centre square of the camera, scaled to the canvas. */
  private draw() {
    const v = this.source;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h || this.stopped) return;
    const side = Math.min(w, h);
    this.ctx.drawImage(v, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  }

  /**
   * The other camera. The recording is not touched: the new camera starts
   * feeding the canvas, then the old one is released. If the other camera
   * fails, the current one simply stays.
   */
  async switchTo(facing: Facing): Promise<boolean> {
    if (facing === this.facing || this.stopped) return false;
    let next: MediaStream;
    try {
      next = await navigator.mediaDevices.getUserMedia({ video: CircleCamera.video(facing) });
    } catch {
      return false;
    }
    if (this.stopped) {
      next.getTracks().forEach((t) => t.stop());
      return false;
    }
    const old = this.camera;
    this.camera = next;
    this.facing = facing;
    this.source.srcObject = next;
    await this.source.play().catch(() => undefined);
    old.getTracks().forEach((t) => t.stop());
    return true;
  }

  /** The current camera's zoom range (null: no zoom). */
  zoomRange() {
    const track = this.camera.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() as { zoom?: { min?: number; max?: number; step?: number } } | undefined)?.zoom;
    return zoomRange(caps);
  }

  async setZoom(value: number): Promise<number | null> {
    const range = this.zoomRange();
    const track = this.camera.getVideoTracks()[0];
    if (!range || !track) return null;
    const z = clampZoom(value, range);
    try {
      await track.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] });
      return z;
    } catch {
      return null;
    }
  }

  /** Everything off: the cameras, the microphone, the canvas track, the drawing timer. */
  close() {
    this.stopped = true;
    window.clearInterval(this.timer);
    this.camera.getTracks().forEach((t) => t.stop());
    this.output.getTracks().forEach((t) => t.stop());
    this.audio?.stop();
    this.source.srcObject = null;
  }
}
