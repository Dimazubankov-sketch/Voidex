/**
 * Step 2.5: the VOIDEX notification sound — a soft two-note glass chime made
 * with WebAudio (no audio file). Browsers only allow sound after the person
 * interacted with the page, so the audio context is created / resumed on the
 * first tap or key press; before that the chime is skipped silently.
 * Callers check the "sound" preference (Settings → Notifications).
 */
let ctx: AudioContext | null = null;
let unlocked = false;

function unlock() {
  unlocked = true;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* no audio */
  }
}
if (typeof window !== "undefined") {
  for (const e of ["pointerdown", "keydown"] as const) window.addEventListener(e, unlock, { once: false, passive: true, capture: true });
}

function note(c: AudioContext, freq: number, at: number, length: number, peak: number) {
  const o = c.createOscillator();
  const o2 = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o2.type = "triangle";
  o.frequency.setValueAtTime(freq, at);
  o2.frequency.setValueAtTime(freq * 2, at);
  const g2 = c.createGain();
  g2.gain.value = 0.18;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.018);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  o.connect(g);
  o2.connect(g2).connect(g);
  g.connect(c.destination);
  o.start(at);
  o2.start(at);
  o.stop(at + length + 0.05);
  o2.stop(at + length + 0.05);
}

export function playNotificationSound() {
  if (!unlocked) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== "running") return;
    const now = ctx.currentTime + 0.01;
    // A rising major third, quiet and short: noticeable, never startling.
    note(ctx, 784, now, 0.42, 0.07);
    note(ctx, 988, now + 0.11, 0.55, 0.06);
  } catch {
    /* audio unavailable */
  }
}
