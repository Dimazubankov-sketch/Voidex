import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { RiAnticlockwise2Line, RiCheckLine, RiCloseLine, RiZoomInLine, RiZoomOutLine } from "@remixicon/react";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";

/**
 * "Adjust photo" — the fullscreen editor shown after picking an avatar or a
 * cover, before anything is saved (Voyzen reference). The picture moves under
 * a fixed mask: round for the avatar, wide for the cover.
 *
 *   phone  drag with a finger, pinch to zoom
 *   PC     drag with the mouse, wheel or the slider to zoom
 *   both   rotate 90°, ✕ cancels, ✓ saves; keyboard: arrows move, +/− zoom, Esc, Enter
 *
 * ✓ renders exactly the visible part into a new picture (JPEG) — that picture
 * is what gets uploaded, so every place that shows the avatar / cover shows
 * the same crop without extra metadata.
 */

export type PhotoShape = "circle" | "wide";

const OUT: Record<PhotoShape, { w: number; h: number }> = { circle: { w: 512, h: 512 }, wide: { w: 1500, h: 500 } };
const ZOOM_MAX = 4;
/** The avatar endpoint takes up to 512 KB. */
const AVATAR_MAX_BYTES = 500 * 1024;

interface View {
  zoom: number;
  x: number;
  y: number;
  rot: 0 | 90 | 180 | 270;
}

function maskSize(shape: PhotoShape, w: number, h: number) {
  if (shape === "circle") {
    const d = Math.round(Math.min(w * 0.86, h * 0.62, 440));
    return { w: d, h: d };
  }
  const mw = Math.round(Math.min(w * 0.94, 960));
  return { w: mw, h: Math.round(mw / 3) };
}

/** On-screen size of the (rotated) picture at a zoom: zoom 1 just covers the mask. */
function shownSize(img: HTMLImageElement | null, rot: View["rot"], mask: { w: number; h: number }, zoom: number) {
  if (!img) return { w: mask.w, h: mask.h };
  const turned = rot === 90 || rot === 270;
  const w = turned ? img.naturalHeight : img.naturalWidth;
  const h = turned ? img.naturalWidth : img.naturalHeight;
  const k = Math.max(mask.w / w, mask.h / h) * zoom;
  return { w: w * k, h: h * k };
}

export function PhotoEditor({ file, shape, onCancel, onConfirm }: { file: File; shape: PhotoShape; onCancel: () => void; onConfirm: (blob: Blob) => Promise<void> | void }) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0, rot: 0 });
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number; mid: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => setImg(im);
    im.onerror = () => setFailed(true);
    im.src = url;
    // Revoked after the exit animation (the picture is still on screen while it fades).
    return () => void window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [file]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mask = maskSize(shape, size.w, size.h);
  const turned = view.rot === 90 || view.rot === 270;
  const natW = img ? (turned ? img.naturalHeight : img.naturalWidth) : 1;
  const natH = img ? (turned ? img.naturalWidth : img.naturalHeight) : 1;
  // Zoom 1 = the picture just covers the mask.
  const base = Math.max(mask.w / natW, mask.h / natH);

  /** Keeps the mask covered: the picture can't be moved or zoomed out past its edges. */
  const clamp = useCallback(
    (v: View): View => {
      const zoom = Math.max(1, Math.min(ZOOM_MAX, v.zoom));
      const { w, h } = shownSize(img, v.rot, mask, zoom);
      const mx = Math.max(0, (w - mask.w) / 2);
      const my = Math.max(0, (h - mask.h) / 2);
      return { ...v, zoom, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [img, mask.w, mask.h],
  );

  const update = useCallback((fn: (v: View) => View) => setView((v) => clamp(fn(v))), [clamp]);
  useEffect(() => setView((v) => clamp(v)), [clamp]);

  const zoomBy = (factor: number) => update((v) => ({ ...v, zoom: v.zoom * factor, x: v.x * factor, y: v.y * factor }));

  const confirm = useCallback(async () => {
    if (!img || busy) return;
    setBusy(true);
    try {
      const out = OUT[shape];
      const canvas = document.createElement("canvas");
      canvas.width = out.w;
      canvas.height = out.h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, out.w, out.h);
      ctx.imageSmoothingQuality = "high";
      const k = out.w / mask.w;
      ctx.translate(out.w / 2, out.h / 2);
      ctx.scale(k, k);
      ctx.translate(view.x, view.y);
      ctx.rotate((view.rot * Math.PI) / 180);
      const s = base * view.zoom;
      ctx.scale(s, s);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      let q = 0.9;
      let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
      while (shape === "circle" && blob && blob.size > AVATAR_MAX_BYTES && q > 0.5) {
        q -= 0.1;
        blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
      }
      if (blob) await onConfirm(blob);
    } finally {
      setBusy(false);
    }
  }, [img, busy, shape, mask.w, view, base, onConfirm]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter") void confirm();
      else if (e.key === "+" || e.key === "=") zoomBy(1.15);
      else if (e.key === "-") zoomBy(1 / 1.15);
      else if (e.key.startsWith("Arrow")) {
        const d = e.shiftKey ? 40 : 10;
        update((v) => ({ ...v, x: v.x + (e.key === "ArrowLeft" ? d : e.key === "ArrowRight" ? -d : 0), y: v.y + (e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0) }));
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const g = gesture.current;
      const nextZoom = g.zoom * (dist / Math.max(1, g.dist));
      update((v) => {
        const f = nextZoom / v.zoom;
        return { ...v, zoom: nextZoom, x: v.x * f + (mid.x - g.mid.x), y: v.y * f + (mid.y - g.mid.y) };
      });
      g.mid = mid;
      return;
    }
    update((v) => ({ ...v, x: v.x + cur.x - prev.x, y: v.y + cur.y - prev.y }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };

  const s = base * view.zoom;
  return createPortal(
    <motion.div
      ref={root}
      className="fixed inset-0 z-[300] select-none overflow-hidden bg-black text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={t("vibex.photo.title")}
      data-testid="photo-editor"
      data-shape={shape}
    >
      <div
        className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08)}
        data-testid="photo-stage"
      >
        {img && (
          <img
            src={img.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
            style={{
              width: img.naturalWidth,
              height: img.naturalHeight,
              transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) rotate(${view.rot}deg) scale(${s})`,
            }}
          />
        )}
        {/* The mask: everything outside is dimmed; the hole shows what will be saved. */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-white/50"
          style={{ width: mask.w, height: mask.h, borderRadius: shape === "circle" ? "50%" : 18, boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)" }}
          data-testid="photo-mask"
        />
        {!img && <div className="absolute inset-0 flex items-center justify-center">{failed ? <span className="text-[14px] text-white/70">{t("vibex.photo.failed")}</span> : <Spinner className="text-white" />}</div>}
      </div>

      <header className="absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-[max(var(--safe-top),10px)]">
        <button type="button" onClick={onCancel} aria-label={t("common.cancel")} className="flex size-11 items-center justify-center rounded-full hover:bg-white/10" data-testid="photo-cancel">
          <RiCloseLine className="size-6" />
        </button>
        <h2 className="text-[16px] font-semibold">{t("vibex.photo.title")}</h2>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={!img || busy}
          aria-label={t("common.save")}
          className="flex size-11 items-center justify-center rounded-full text-[#9d8bff] hover:bg-white/10 disabled:opacity-40"
          data-testid="photo-confirm"
        >
          {busy ? <Spinner size={18} className="text-white" /> : <RiCheckLine className="size-6" />}
        </button>
      </header>

      <footer className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-6 pb-[max(var(--safe-bottom),18px)]">
        <div className="flex w-full max-w-[360px] items-center gap-3">
          <RiZoomOutLine className="size-5 shrink-0 text-white/70" aria-hidden />
          <input
            type="range"
            min={1}
            max={ZOOM_MAX}
            step={0.01}
            value={view.zoom}
            onChange={(e) => {
              const z = Number(e.target.value);
              update((v) => ({ ...v, zoom: z, x: (v.x * z) / v.zoom, y: (v.y * z) / v.zoom }));
            }}
            aria-label={t("vibex.photo.zoom")}
            className="h-1 flex-1 accent-[#8b7bff]"
            data-testid="photo-zoom"
          />
          <RiZoomInLine className="size-5 shrink-0 text-white/70" aria-hidden />
        </div>
        <button
          type="button"
          onClick={() => update((v) => ({ ...v, rot: (((v.rot + 270) % 360) as View["rot"]), x: 0, y: 0 }))}
          aria-label={t("vibex.photo.rotate")}
          title={t("vibex.photo.rotate")}
          className="flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
          data-testid="photo-rotate"
        >
          <RiAnticlockwise2Line className="size-5" />
        </button>
      </footer>
    </motion.div>,
    document.body,
  );
}
