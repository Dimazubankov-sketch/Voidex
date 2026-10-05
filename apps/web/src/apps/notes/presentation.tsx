import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  RiAddLine,
  RiAlertLine,
  RiArrowDownLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFileCopyLine,
  RiImageAddLine,
  RiLayoutGridLine,
  RiLockLine,
  RiLockUnlockLine,
  RiPlayFill,
  RiStackLine,
  RiText,
} from "@remixicon/react";
import type { PresentationBody, Slide, SlideLayer, SlideTransition } from "@voidex/shared";
import { SLIDE_TRANSITIONS, titleSlide } from "@voidex/shared";
import { newId, slideOverflows, slideRatio } from "@voidex/notes";
import { cx } from "@/lib/cx";
import { prefersReducedMotion, useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { downscale, notesApi, useMediaUrl } from "./data";

type Change = (next: PresentationBody, structural?: boolean) => void;
type Tab = "slides" | "layers" | "transitions";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const FONT = { title: 0.075, text: 0.045, image: 0.045 } as const;

// ---------------------------------------------------------------- rendering

function LayerImage({ src, alt }: { src?: string; alt: string }) {
  const url = useMediaUrl(src);
  return url ? <img src={url} alt={alt} draggable={false} className="size-full object-contain" /> : <span className="grid size-full place-items-center rounded-lg bg-black/5" />;
}

/** One slide at a given pixel width (thumbnails, the stage, the viewer). */
export function SlideView({ slide, width, ratio, children, className }: { slide: Slide; width: number; ratio: number; children?: (l: SlideLayer, style: React.CSSProperties) => ReactNode; className?: string }) {
  const h = width / ratio;
  return (
    <div className={cx("vn2-slide relative overflow-hidden bg-white", className)} style={{ width, height: h }} data-testid="notes-slide">
      {slide.layers.map((l) => {
        if (l.hidden) return null;
        const style: React.CSSProperties = {
          left: `${l.x}%`,
          top: `${l.y}%`,
          width: `${l.w}%`,
          height: `${l.h}%`,
          fontSize: h * FONT[l.kind] * (l.scale ?? 1),
          textAlign: l.align ?? "left",
        };
        if (children) return children(l, style);
        return (
          <div key={l.id} className={cx("vn2-layer absolute", `vn2-layer-${l.kind}`)} style={style}>
            {l.kind === "image" ? <LayerImage src={l.src} alt={l.text} /> : <div className="vn2-layer-text">{l.text}</div>}
          </div>
        );
      })}
    </div>
  );
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// ---------------------------------------------------------------- editor

/**
 * Presentation editor (Step 2.6): a minimal sidebar (Slides / Layers /
 * Transitions) and the slide. Layers move by dragging and resize by the
 * corner; text is typed straight on the slide. On phones the sidebar is a
 * panel under the slide.
 */
export function PresentationEditor({ body, onChange, readOnly, onPlay }: { body: PresentationBody; onChange: Change; readOnly: boolean; onPlay: (from: number) => void }) {
  const t = useT();
  const ff = useFormFactor();
  const [tab, setTab] = useState<Tab>("slides");
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [panel, setPanel] = useState(ff !== "mobile");
  const file = useRef<HTMLInputElement>(null);
  const ratio = slideRatio(body.format);
  const i = Math.min(index, body.slides.length - 1);
  const slide = body.slides[i]!;
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const [stageRef, stage] = useSize<HTMLDivElement>();
  const width = Math.max(120, Math.min(stage.w - (ff === "mobile" ? 24 : 64), (stage.h - (ff === "mobile" ? 24 : 56)) * ratio));
  const overflow = slideOverflows(slide, body.format);

  const setSlide = (fn: (s: Slide) => Slide, structural = true) => onChange({ ...bodyRef.current, slides: bodyRef.current.slides.map((s, k) => (k === i ? fn(s) : s)) }, structural);
  const setLayer = (id: string, p: Partial<SlideLayer>, structural = true) => setSlide((s) => ({ ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, ...p } : l)) }), structural);

  const addSlide = () => {
    const s = titleSlide();
    const slides = [...bodyRef.current.slides];
    slides.splice(i + 1, 0, { ...s, transition: slide.transition });
    onChange({ ...bodyRef.current, slides }, true);
    setIndex(i + 1);
    setSelected(null);
  };
  const duplicate = (k: number) => {
    const src = bodyRef.current.slides[k]!;
    const copy: Slide = { ...src, id: newId(), layers: src.layers.map((l) => ({ ...l, id: newId() })) };
    const slides = [...bodyRef.current.slides];
    slides.splice(k + 1, 0, copy);
    onChange({ ...bodyRef.current, slides }, true);
    setIndex(k + 1);
  };
  const removeSlide = (k: number) => {
    if (bodyRef.current.slides.length <= 1) return;
    onChange({ ...bodyRef.current, slides: bodyRef.current.slides.filter((_, j) => j !== k) }, true);
    setIndex(Math.max(0, Math.min(k, bodyRef.current.slides.length - 2)));
    setSelected(null);
  };
  const moveSlide = (k: number, d: -1 | 1) => {
    const j = k + d;
    if (j < 0 || j >= bodyRef.current.slides.length) return;
    const slides = [...bodyRef.current.slides];
    const [x] = slides.splice(k, 1);
    slides.splice(j, 0, x!);
    onChange({ ...bodyRef.current, slides }, true);
    setIndex(j);
  };

  const addText = () => {
    const l: SlideLayer = { id: newId(), kind: "text", text: "", x: 15, y: 40, w: 70, h: 20, align: "left" };
    setSlide((s) => ({ ...s, layers: [...s.layers, l] }));
    setSelected(l.id);
    setEditing(l.id);
  };
  const addImages = async (files: File[]) => {
    setUploading(true);
    try {
      for (const f of files) {
        const src = await notesApi.upload(f.type === "image/gif" ? f : await downscale(f, 2000));
        const l: SlideLayer = { id: newId(), kind: "image", text: "", src, x: 20, y: 18, w: 60, h: 64 };
        setSlide((s) => ({ ...s, layers: [...s.layers, l] }));
        setSelected(l.id);
      }
    } catch {
      toast({ title: t("notes.imageFailed"), tone: "danger" });
    } finally {
      setUploading(false);
    }
  };
  const removeLayer = (id: string) => {
    setSlide((s) => ({ ...s, layers: s.layers.filter((l) => l.id !== id) }));
    setSelected(null);
    setEditing(null);
  };
  const zOrder = (id: string, d: -1 | 1) =>
    setSlide((s) => {
      const layers = [...s.layers];
      const k = layers.findIndex((l) => l.id === id);
      const j = k + d;
      if (k < 0 || j < 0 || j >= layers.length) return s;
      const [x] = layers.splice(k, 1);
      layers.splice(j, 0, x!);
      return { ...s, layers };
    });

  // Keyboard on the stage: Delete removes the selected layer, arrows nudge it.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!selected || editing) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return;
      const l = slide.layers.find((x) => x.id === selected);
      if (!l || l.locked) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeLayer(l.id);
      }
      const step = e.shiftKey ? 5 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key as "ArrowLeft"];
      if (d) {
        e.preventDefault();
        setLayer(l.id, { x: clamp(l.x + d[0]!, 0, 100 - l.w), y: clamp(l.y + d[1]!, 0, 100 - l.h) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sidebar = (
    <div className={cx("vn2-pres-side flex min-h-0 flex-col", ff === "mobile" ? "max-h-[38%] border-t" : "w-[236px] shrink-0 border-r pt-[58px]")} data-testid="notes-pres-sidebar">
      <div className="flex shrink-0 gap-1 p-2" role="tablist">
        {(
          [
            ["slides", t("notes.pres.slides"), <RiLayoutGridLine key="s" className="size-4" />],
            ["layers", t("notes.pres.layers"), <RiStackLine key="l" className="size-4" />],
            ["transitions", t("notes.pres.transitions"), <RiPlayFill key="t" className="size-4" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx("flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-full text-[12.5px] font-medium", tab === id ? "bg-primary/12 text-primary" : "text-text-secondary hover:bg-surface-hover")}
            data-testid={`notes-pres-tab-${id}`}
          >
            {icon}
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
      <div className="scroll-area min-h-0 flex-1 px-2 pb-3">
        {tab === "slides" && (
          <div className={cx(ff === "mobile" ? "flex gap-2 overflow-x-auto pb-1" : "flex flex-col gap-2")} data-testid="notes-pres-slides">
            {body.slides.map((s, k) => (
              <div key={s.id} className="group relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIndex(k);
                    setSelected(null);
                    setEditing(null);
                  }}
                  className={cx("flex items-start gap-1.5 rounded-xl p-1 text-left", k === i ? "bg-primary/10" : "hover:bg-surface-hover")}
                  data-testid="notes-pres-thumb"
                  aria-current={k === i}
                >
                  <span className="w-4 pt-0.5 text-right text-[11px] tabular-nums text-text-tertiary">{k + 1}</span>
                  <span className={cx("overflow-hidden rounded-[6px] shadow-[0_0_0_1px_rgba(30,20,80,0.12)]", k === i && "shadow-[0_0_0_2px_var(--color-primary)]")}>
                    <SlideView slide={s} width={ff === "mobile" ? 110 : 172} ratio={ratio} />
                  </span>
                </button>
                {!readOnly && k === i && (
                  <div className="mt-1 flex justify-end gap-0.5 pr-1">
                    <SmallBtn label={t("notes.moveUp")} onClick={() => moveSlide(k, -1)} testId="notes-slide-up">
                      <RiArrowUpLine className="size-[15px]" />
                    </SmallBtn>
                    <SmallBtn label={t("notes.moveDown")} onClick={() => moveSlide(k, 1)} testId="notes-slide-down">
                      <RiArrowDownLine className="size-[15px]" />
                    </SmallBtn>
                    <SmallBtn label={t("notes.pres.duplicate")} onClick={() => duplicate(k)} testId="notes-slide-duplicate">
                      <RiFileCopyLine className="size-[15px]" />
                    </SmallBtn>
                    {body.slides.length > 1 && (
                      <SmallBtn label={t("notes.delete")} onClick={() => removeSlide(k)} testId="notes-slide-delete" danger>
                        <RiDeleteBinLine className="size-[15px]" />
                      </SmallBtn>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" onClick={addSlide} className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-hover" data-testid="notes-slide-add">
                <RiAddLine className="size-4" />
                {t("notes.pres.addSlide")}
              </button>
            )}
          </div>
        )}
        {tab === "layers" && (
          <div className="flex flex-col gap-0.5" data-testid="notes-pres-layers">
            {[...slide.layers].reverse().map((l) => (
              <div key={l.id} className={cx("flex min-h-10 items-center gap-1 rounded-xl pl-2", selected === l.id ? "bg-primary/10" : "hover:bg-surface-hover")} data-testid="notes-layer-row">
                <button type="button" onClick={() => setSelected(l.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {l.kind === "image" ? <RiImageAddLine className="size-4 shrink-0 text-text-tertiary" /> : <RiText className="size-4 shrink-0 text-text-tertiary" />}
                  <span className={cx("truncate text-[13px]", l.hidden ? "text-text-tertiary" : "text-text")}>{l.text.trim() || t(`notes.layer.${l.kind}`)}</span>
                </button>
                {!readOnly && (
                  <>
                    <SmallBtn label={l.hidden ? t("notes.layer.show") : t("notes.layer.hide")} onClick={() => setLayer(l.id, { hidden: !l.hidden })} testId="notes-layer-hide">
                      {l.hidden ? <RiEyeOffLine className="size-[15px]" /> : <RiEyeLine className="size-[15px]" />}
                    </SmallBtn>
                    <SmallBtn label={l.locked ? t("notes.layer.unlock") : t("notes.layer.lock")} onClick={() => setLayer(l.id, { locked: !l.locked })} testId="notes-layer-lock">
                      {l.locked ? <RiLockLine className="size-[15px]" /> : <RiLockUnlockLine className="size-[15px]" />}
                    </SmallBtn>
                    <SmallBtn label={t("notes.layer.forward")} onClick={() => zOrder(l.id, 1)} testId="notes-layer-up">
                      <RiArrowUpLine className="size-[15px]" />
                    </SmallBtn>
                    <SmallBtn label={t("notes.layer.backward")} onClick={() => zOrder(l.id, -1)} testId="notes-layer-down">
                      <RiArrowDownLine className="size-[15px]" />
                    </SmallBtn>
                  </>
                )}
              </div>
            ))}
            {!slide.layers.length && <p className="px-2 py-3 text-[13px] text-text-tertiary">{t("notes.layer.none")}</p>}
          </div>
        )}
        {tab === "transitions" && (
          <div className="flex flex-col gap-1" data-testid="notes-pres-transitions">
            {SLIDE_TRANSITIONS.map((tr) => (
              <button
                key={tr}
                type="button"
                disabled={readOnly}
                onClick={() => {
                  setSlide((s) => ({ ...s, transition: tr }));
                  setPreview((n) => n + 1);
                }}
                className={cx("flex h-10 items-center gap-2 rounded-xl px-3 text-left text-[13.5px]", slide.transition === tr ? "bg-primary/10 font-semibold text-primary" : "text-text hover:bg-surface-hover")}
                aria-pressed={slide.transition === tr}
                data-testid={`notes-transition-${tr}`}
              >
                {t(`notes.transition.${tr}`)}
              </button>
            ))}
            <button type="button" onClick={() => setPreview((n) => n + 1)} className="mt-1 flex h-9 items-center justify-center gap-1.5 rounded-xl bg-surface-secondary text-[13px] font-medium text-text" data-testid="notes-transition-preview">
              <RiPlayFill className="size-4" />
              {t("notes.transition.preview")}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange({ ...bodyRef.current, slides: bodyRef.current.slides.map((s) => ({ ...s, transition: slide.transition })) }, true)}
                className="flex h-9 items-center justify-center rounded-xl text-[13px] font-medium text-primary hover:bg-primary/10"
                data-testid="notes-transition-all"
              >
                {t("notes.transition.applyAll")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={cx("vn2-pres flex min-h-0 flex-1", ff === "mobile" ? "flex-col-reverse" : "flex-row")} data-testid="notes-pres-editor" data-format={body.format} data-slides={body.slides.length}>
      {panel && sidebar}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col pt-[60px]">
        <div ref={stageRef} className="relative grid min-h-0 flex-1 place-items-center" onPointerDown={(e) => e.target === e.currentTarget && (setSelected(null), setEditing(null))}>
          {width > 0 && (
            <motion.div key={`${slide.id}:${preview}`} {...transitionMotion(slide.transition)} className="shadow-[0_10px_40px_-12px_rgba(40,30,120,0.35)]">
              <SlideView slide={slide} width={width} ratio={ratio}>
                {(l, style) => (
                  <EditableLayer
                    key={l.id}
                    l={l}
                    style={style}
                    readOnly={readOnly}
                    selected={selected === l.id}
                    editing={editing === l.id}
                    onSelect={() => {
                      if (selected === l.id && l.kind !== "image" && !l.locked) setEditing(l.id);
                      else {
                        setSelected(l.id);
                        setEditing(null);
                      }
                    }}
                    onPatch={(p, structural) => setLayer(l.id, p, structural)}
                    onRemove={() => removeLayer(l.id)}
                  />
                )}
              </SlideView>
            </motion.div>
          )}
          {overflow && (
            <span className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1 text-[12.5px] font-medium text-warning" data-testid="notes-slide-overflow">
              <RiAlertLine className="size-4" />
              {t("notes.pres.overflow")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 justify-center px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
          <div className="vn2-toolbar flex items-center gap-0.5 rounded-full p-1" data-testid="notes-pres-toolbar">
            <button type="button" onClick={() => setPanel((v) => !v)} aria-pressed={panel} aria-label={t("notes.pres.panel")} title={t("notes.pres.panel")} className={cx("vn2-icon-btn size-11", panel && "text-primary")} data-testid="notes-pres-panel">
              <RiLayoutGridLine className="size-[20px]" />
            </button>
            <button type="button" onClick={() => setIndex(Math.max(0, i - 1))} disabled={i === 0} aria-label={t("notes.page.prev")} className="vn2-icon-btn size-11" data-testid="notes-pres-prev">
              <RiArrowLeftSLine className="size-5" />
            </button>
            <span className="min-w-[44px] text-center text-[13.5px] font-medium tabular-nums" data-testid="notes-pres-indicator">
              {i + 1} / {body.slides.length}
            </span>
            <button type="button" onClick={() => setIndex(Math.min(body.slides.length - 1, i + 1))} disabled={i >= body.slides.length - 1} aria-label={t("notes.page.next")} className="vn2-icon-btn size-11" data-testid="notes-pres-next">
              <RiArrowRightSLine className="size-5" />
            </button>
            {!readOnly && (
              <>
                <span className="mx-0.5 h-6 w-px bg-border" />
                <button type="button" onClick={addText} aria-label={t("notes.pres.addText")} title={t("notes.pres.addText")} className="vn2-icon-btn size-11" data-testid="notes-pres-add-text">
                  <RiText className="size-[20px]" />
                </button>
                <button type="button" onClick={() => file.current?.click()} aria-label={t("notes.tool.image")} title={t("notes.tool.image")} className="vn2-icon-btn size-11" data-testid="notes-pres-add-image">
                  {uploading ? <Spinner size={18} /> : <RiImageAddLine className="size-[20px]" />}
                </button>
                <button type="button" onClick={addSlide} aria-label={t("notes.pres.addSlide")} title={t("notes.pres.addSlide")} className="vn2-icon-btn size-11" data-testid="notes-pres-add-slide">
                  <RiAddLine className="size-[22px]" />
                </button>
                <input
                  ref={file}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  className="hidden"
                  data-testid="notes-pres-image-file"
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = "";
                    if (files.length) void addImages(files);
                  }}
                />
              </>
            )}
            <span className="mx-0.5 h-6 w-px bg-border" />
            <button type="button" onClick={() => onPlay(i)} aria-label={t("notes.pres.play")} title={t("notes.pres.play")} className="vn2-icon-btn size-11 text-primary" data-testid="notes-pres-play">
              <RiPlayFill className="size-[22px]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SmallBtn({ label, onClick, children, testId, danger }: { label: string; onClick: () => void; children: ReactNode; testId?: string; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cx("grid size-7 shrink-0 place-items-center rounded-full", danger ? "text-danger hover:bg-danger-soft" : "text-text-secondary hover:bg-surface-hover")} data-testid={testId}>
      {children}
    </button>
  );
}

function EditableLayer({
  l,
  style,
  readOnly,
  selected,
  editing,
  onSelect,
  onPatch,
  onRemove,
}: {
  l: SlideLayer;
  style: React.CSSProperties;
  readOnly: boolean;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onPatch: (p: Partial<SlideLayer>, structural?: boolean) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "size"; x: number; y: number; l: SlideLayer; w: number; h: number; moved: boolean } | null>(null);
  const [live, setLive] = useState<Partial<SlideLayer> | null>(null);
  const start = (mode: "move" | "size") => (e: RPointerEvent) => {
    if (readOnly || editing || l.locked) return;
    const slideEl = el.current?.parentElement;
    if (!slideEl) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, l, w: slideEl.clientWidth, h: slideEl.clientHeight, moved: false };
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = ((e.clientX - d.x) / d.w) * 100;
    const dy = ((e.clientY - d.y) / d.h) * 100;
    if (Math.abs(dx) + Math.abs(dy) > 0.6) d.moved = true;
    if (!d.moved) return;
    if (d.mode === "move") setLive({ x: Math.round(clamp(d.l.x + dx, -d.l.w + 5, 95) * 10) / 10, y: Math.round(clamp(d.l.y + dy, -d.l.h + 5, 95) * 10) / 10 });
    else setLive({ w: Math.round(clamp(d.l.w + dx, 5, 100 - d.l.x) * 10) / 10, h: Math.round(clamp(d.l.h + dy, 4, 100 - d.l.y) * 10) / 10 });
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && live) onPatch(live, true);
    else if (d && !d.moved && d.mode === "move") onSelect();
    setLive(null);
  };
  const shown = { ...l, ...live };
  const box: React.CSSProperties = { ...style, left: `${shown.x}%`, top: `${shown.y}%`, width: `${shown.w}%`, height: `${shown.h}%` };
  return (
    <div
      ref={el}
      className={cx("vn2-layer absolute", `vn2-layer-${l.kind}`, !readOnly && "vn2-layer-edit", selected && "vn2-layer-selected", l.locked && "vn2-layer-locked")}
      style={box}
      onPointerDown={readOnly ? undefined : (e) => (selected && !l.locked ? start("move")(e) : (e.stopPropagation(), onSelect()))}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      data-testid="notes-layer"
      data-kind={l.kind}
      data-selected={selected}
    >
      {l.kind === "image" ? (
        <LayerImage src={l.src} alt={l.text} />
      ) : editing ? (
        <textarea
          autoFocus
          value={l.text}
          onChange={(e) => onPatch({ text: e.target.value }, false)}
          onPointerDown={(e) => e.stopPropagation()}
          className="vn2-layer-text size-full resize-none bg-transparent outline-none"
          style={{ textAlign: l.align ?? "left" }}
          placeholder={l.kind === "title" ? t("notes.layer.titlePlaceholder") : t("notes.layer.textPlaceholder")}
          data-testid="notes-layer-input"
        />
      ) : (
        <div className={cx("vn2-layer-text", !l.text && "text-black/30")}>{l.text || (readOnly ? "" : l.kind === "title" ? t("notes.layer.titlePlaceholder") : t("notes.layer.textPlaceholder"))}</div>
      )}
      {selected && !readOnly && !l.locked && (
        <>
          <span onPointerDown={start("size")} className="absolute -bottom-2.5 -right-2.5 size-5 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-primary shadow" data-testid="notes-layer-resize" />
          <div className="absolute -top-11 left-0 z-10 flex items-center gap-0.5 rounded-full bg-surface p-0.5 shadow-float" onPointerDown={(e) => e.stopPropagation()}>
            {l.kind !== "image" &&
              (["left", "center", "right"] as const).map((a) => (
                <button key={a} type="button" onClick={() => onPatch({ align: a })} className={cx("h-8 rounded-full px-2 text-[12px] font-medium", (l.align ?? "left") === a ? "bg-primary text-white" : "text-text")} data-testid={`notes-layer-align-${a}`}>
                  {t(`notes.image.${a}`)}
                </button>
              ))}
            {l.kind !== "image" && (
              <>
                <button type="button" onClick={() => onPatch({ scale: Math.max(0.5, Math.round(((l.scale ?? 1) - 0.1) * 10) / 10) })} className="h-8 rounded-full px-2 text-[13px] font-semibold text-text" aria-label={t("notes.layer.smaller")} data-testid="notes-layer-smaller">
                  A−
                </button>
                <button type="button" onClick={() => onPatch({ scale: Math.min(3, Math.round(((l.scale ?? 1) + 0.1) * 10) / 10) })} className="h-8 rounded-full px-2 text-[13px] font-semibold text-text" aria-label={t("notes.layer.larger")} data-testid="notes-layer-larger">
                  A+
                </button>
              </>
            )}
            <button type="button" onClick={onRemove} className="grid size-8 place-items-center rounded-full text-danger" aria-label={t("notes.delete")} data-testid="notes-layer-remove">
              <RiDeleteBinLine className="size-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- viewer

function transitionMotion(tr: SlideTransition, dir = 1) {
  if (prefersReducedMotion() || tr === "none") return { initial: false as const, animate: { opacity: 1 } };
  const ease = [0.22, 1, 0.36, 1] as const;
  switch (tr) {
    case "fade":
      return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.35, ease } };
    case "slide":
      return { initial: { opacity: 0.4, x: `${dir * 40}%` }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: `${-dir * 40}%` }, transition: { duration: 0.4, ease } };
    case "scale":
      return { initial: { opacity: 0, scale: 0.86 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 1.08 }, transition: { duration: 0.35, ease } };
  }
}

/**
 * Showing the presentation: fullscreen, the slide as large as fits (16:9 or
 * square), ‹ › and the arrow keys, swipe on touch, each slide's transition
 * (none when the person prefers reduced motion).
 */
export function PresentationViewer({ body, start, onClose }: { body: PresentationBody; start: number; onClose: () => void }) {
  const t = useT();
  const [i, setI] = useState(Math.min(start, body.slides.length - 1));
  const [dir, setDir] = useState(1);
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const ratio = slideRatio(body.format);
  const go = (d: number) => {
    setDir(d);
    setI((x) => clamp(x + d, 0, body.slides.length - 1));
  };
  useEffect(() => {
    const el = root.current;
    el?.focus();
    el?.requestFullscreen?.().catch(() => undefined);
    const resize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", resize);
    const onFs = () => !document.fullscreenElement && resize();
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const width = Math.max(120, Math.min(size.w - 32, (size.h - 150) * ratio));
  const slide = body.slides[i]!;
  return createPortal(
    <div
      ref={root}
      tabIndex={-1}
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-[#0c0b14] outline-none"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
          e.preventDefault();
          go(-1);
        } else if (e.key === "Escape") onClose();
      }}
      onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
      }}
      data-testid="notes-pres-viewer"
      data-index={i}
    >
      <div className="relative grid place-items-center" style={{ width, height: width / ratio }}>
        <AnimatePresence initial={false} mode="popLayout" custom={dir}>
          <motion.div key={slide.id} className="absolute inset-0" {...transitionMotion(slide.transition, dir)}>
            <SlideView slide={slide} width={width} ratio={ratio} className="rounded-[6px]" />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="mt-4 flex items-center gap-2 text-white/85">
        <button type="button" onClick={() => go(-1)} disabled={i === 0} aria-label={t("notes.page.prev")} className="grid size-11 place-items-center rounded-full bg-white/10 disabled:opacity-30" data-testid="notes-viewer-prev">
          <RiArrowLeftSLine className="size-6" />
        </button>
        <span className="min-w-[64px] text-center text-[14px] tabular-nums" data-testid="notes-viewer-indicator">
          {i + 1} / {body.slides.length}
        </span>
        <button type="button" onClick={() => go(1)} disabled={i >= body.slides.length - 1} aria-label={t("notes.page.next")} className="grid size-11 place-items-center rounded-full bg-white/10 disabled:opacity-30" data-testid="notes-viewer-next">
          <RiArrowRightSLine className="size-6" />
        </button>
      </div>
      <button type="button" onClick={onClose} aria-label={t("common.close")} className="absolute right-4 top-[max(env(safe-area-inset-top),16px)] grid size-11 place-items-center rounded-full bg-white/10 text-white" data-testid="notes-viewer-close">
        <RiCloseLine className="size-6" />
      </button>
    </div>,
    document.body,
  );
}
