"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Undo2,
  Redo2,
  Video,
  SlidersHorizontal,
  Palette,
  Crop,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  Volume2,
  VolumeX,
  Sun,
  Contrast,
  Droplets,
  Thermometer,
} from "lucide-react";
import { Slider } from "../../components/ui/slider";
import type { MediaItem } from "./model";
import { durationLabel } from "./model";
import { freshEdit, filters, editFilter, type EditSettings } from "./media-utils";
import { exportVideo, videoFrames } from "./video-utils";
import VideoPlayer from "./VideoPlayer";
type State = { settings: EditSettings; start: number; end: number; muted: boolean; filter: string };
export default function VideoEditor({
  item,
  resolveSrc,
  onCancel,
  onSave,
}: {
  item: MediaItem;
  resolveSrc: (s: string) => string;
  onCancel: () => void;
  onSave: (blob: Blob, width: number, height: number, duration: number) => Promise<void>;
}) {
  const [duration, setDuration] = useState(item.duration || 1),
    [tab, setTab] = useState("video");
  const [state, setState] = useState<State>({ settings: freshEdit(), start: 0, end: item.duration || 1, muted: false, filter: "original" });
  const current = useRef(state);
  current.current = state;
  const history = useRef<State[]>([]),
    future = useRef<State[]>([]),
    abort = useRef<AbortController | null>(null);
  const [frames, setFrames] = useState<string[]>([]),
    [saving, setSaving] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    videoFrames(resolveSrc(item.src), controller.signal, item.duration)
      .then(setFrames)
      .catch(() => {});
    return () => {
      controller.abort();
      abort.current?.abort();
    };
  }, [item.src, resolveSrc]);
  function change(next: State) {
    history.current.push(current.current);
    history.current = history.current.slice(-40);
    future.current = [];
    current.current = next;
    setState(next);
  }
  function settings(patch: Partial<EditSettings>) {
    change({ ...state, filter: "custom", settings: { ...state.settings, ...patch } });
  }
  function undo(redo = false) {
    const source = redo ? future : history,
      next = source.current.pop();
    if (next) {
      (redo ? history : future).current.push(current.current);
      current.current = next;
      setState(next);
    }
  }
  function ratio(r: number) {
    const natural = item.width / item.height;
    let w = 100,
      h = 100;
    if (natural > r) w = (100 * r) / natural;
    else h = (100 * natural) / r;
    settings({ crop: { x: (100 - w) / 2, y: (100 - h) / 2, w, h } });
  }
  async function save() {
    setSaving(true);
    setError("");
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await exportVideo(
        resolveSrc(item.src),
        state.settings,
        state.start,
        state.end,
        state.muted,
        setProgress,
        controller.signal,
      );
      await onSave(result.blob, result.width, result.height, result.duration);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setSaving(false);
      abort.current = null;
    }
  }
  return (
    <div className="vm-editor vm-video-editor">
      <header className="vm-editor-header">
        <button
          className="vm-round"
          aria-label={saving ? "Отменить сохранение" : "Отмена"}
          onClick={() => {
            if (saving) abort.current?.abort();
            else onCancel();
          }}
        >
          <ArrowLeft />
        </button>
        <div>
          <h2>Редактирование видео</h2>
          <p>{item.name}</p>
        </div>
        <div className="vm-editor-history">
          <button className="vm-round" aria-label="Отменить изменение" disabled={saving || !history.current.length} onClick={() => undo()}>
            <Undo2 />
          </button>
          <button
            className="vm-round"
            aria-label="Повторить изменение"
            disabled={saving || !future.current.length}
            onClick={() => undo(true)}
          >
            <Redo2 />
          </button>
        </div>
        <button className="vm-primary" disabled={saving} onClick={() => void save()}>
          {saving ? `${Math.round(progress * 100)}%` : "Готово"}
        </button>
      </header>
      <div className="vm-video-edit-stage">
        <VideoPlayer
          src={resolveSrc(item.src)}
          name={item.name}
          durationHint={item.duration}
          settings={state.settings}
          start={state.start}
          end={state.end}
          muted={state.muted}
          onMute={(muted) => change({ ...state, muted })}
          onDuration={(n) => {
            if (n > 0 && n !== duration) {
              setDuration(n);
              setState((s) => ({ ...s, end: Math.abs(s.end - duration) < 0.05 ? n : Math.min(n, s.end) }));
            }
          }}
        />
      </div>
      {error && (
        <p className="vm-error" role="alert">
          {error}
        </p>
      )}
      {saving ? (
        <div className="vm-export-progress">
          <strong>Сохраняем видео · {Math.round(progress * 100)}%</strong>
          <progress value={progress} max="1" />
          <span>Оставьте приложение открытым. Сохранение занимает примерно длину выбранного фрагмента.</span>
          <button className="vm-soft" onClick={() => abort.current?.abort()}>
            Отменить сохранение
          </button>
        </div>
      ) : (
        <>
          <div className="vm-video-tools" key={tab}>
            {tab === "video" && (
              <>
                <div className="vm-timeline-label">
                  <strong>Фрагмент · {durationLabel(state.end - state.start)}</strong>
                  <span>
                    {durationLabel(state.start)} – {durationLabel(state.end)}
                  </span>
                  <button
                    className="vm-round"
                    aria-label={state.muted ? "Включить звук" : "Убрать звук"}
                    onClick={() => change({ ...state, muted: !state.muted })}
                  >
                    {state.muted ? <VolumeX /> : <Volume2 />}
                  </button>
                </div>
                <div className="vm-video-timeline">
                  <div className="vm-timeline-frames">
                    {frames.map((src, i) => (
                      <img src={src} key={i} alt="" />
                    ))}
                    {!frames.length && <span>Видео · {durationLabel(duration)}</span>}
                  </div>
                  <div
                    className="vm-timeline-selection"
                    style={{ left: `${(state.start / duration) * 100}%`, width: `${((state.end - state.start) / duration) * 100}%` }}
                  />
                  <Slider
                    aria-label="Начало и конец видео"
                    min={0}
                    max={duration}
                    minStepsBetweenThumbs={1}
                    step={0.1}
                    value={[state.start, state.end]}
                    onValueChange={(v) => change({ ...state, start: v[0]!, end: v[1]! })}
                  />
                </div>
                <p className="vm-tool-hint">Потяните края, чтобы выбрать начало и конец.</p>
              </>
            )}
            {tab === "adjust" && (
              <div className="vm-horizontal-adjust">
                {(
                  [
                    ["brightness", "Яркость", Sun],
                    ["contrast", "Контраст", Contrast],
                    ["saturation", "Насыщенность", Droplets],
                    ["warmth", "Тепло", Thermometer],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <label key={key}>
                    <span>
                      <Icon size={18} />
                      {label}
                      <b>{state.settings[key]}</b>
                    </span>
                    <Slider
                      aria-label={label}
                      min={0}
                      max={key === "warmth" ? 100 : 200}
                      value={[state.settings[key]]}
                      onValueChange={(v) => settings({ [key]: v[0] })}
                    />
                  </label>
                ))}
              </div>
            )}
            {tab === "filters" && (
              <div className="vm-filter-options">
                {filters.map(([id, label, patch]) => (
                  <button
                    key={id}
                    className={state.filter === id ? "active" : ""}
                    aria-pressed={state.filter === id}
                    onClick={() =>
                      change({
                        ...state,
                        filter: id,
                        settings: {
                          ...state.settings,
                          ...freshEdit(),
                          rotation: state.settings.rotation,
                          flip: state.settings.flip,
                          crop: state.settings.crop,
                          ...patch,
                        },
                      })
                    }
                  >
                    <div style={{ filter: editFilter({ ...freshEdit(), ...patch }) }}>
                      {frames[3] ? <img src={frames[3]} alt="" /> : <Video />}
                    </div>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
            {tab === "crop" && (
              <>
                <div className="vm-video-crop-actions">
                  <button className="vm-soft" onClick={() => settings({ rotation: (state.settings.rotation + 270) % 360 })}>
                    <RotateCcw size={18} />
                    Влево
                  </button>
                  <button className="vm-soft" onClick={() => settings({ rotation: (state.settings.rotation + 90) % 360 })}>
                    <RotateCw size={18} />
                    Вправо
                  </button>
                  <button className="vm-soft" onClick={() => settings({ flip: !state.settings.flip })}>
                    <FlipHorizontal size={18} />
                    Отразить
                  </button>
                </div>
                <div className="vm-ratios">
                  {[
                    ["Оригинал", item.width / item.height],
                    ["16:9", 16 / 9],
                    ["4:3", 4 / 3],
                    ["1:1", 1],
                    ["9:16", 9 / 16],
                  ].map(([label, r]) => (
                    <button key={label} onClick={() => ratio(Number(r))}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="vm-horizontal-adjust">
                  {(["x", "y", "w", "h"] as const).map((k) => (
                    <label key={k}>
                      <span>
                        {{ x: "По горизонтали", y: "По вертикали", w: "Ширина", h: "Высота" }[k]}
                        <b>{Math.round(state.settings.crop[k])}%</b>
                      </span>
                      <Slider
                        aria-label={k}
                        min={k === "w" || k === "h" ? 10 : 0}
                        max={
                          k === "x"
                            ? 100 - state.settings.crop.w
                            : k === "y"
                              ? 100 - state.settings.crop.h
                              : k === "w"
                                ? 100 - state.settings.crop.x
                                : 100 - state.settings.crop.y
                        }
                        value={[state.settings.crop[k]]}
                        onValueChange={(v) => settings({ crop: { ...state.settings.crop, [k]: v[0] } })}
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            className="vm-reset"
            onClick={() => change({ settings: freshEdit(), start: 0, end: duration, muted: false, filter: "original" })}
          >
            <RotateCcw size={16} />
            Сбросить изменения
          </button>
        </>
      )}
      <nav className="vm-video-editor-tabs" aria-label="Инструменты видео">
        {(
          [
            ["video", "Видео", Video],
            ["adjust", "Коррекция", SlidersHorizontal],
            ["filters", "Фильтры", Palette],
            ["crop", "Обрезка", Crop],
          ] as const
        ).map(([id, label, Icon]) => (
          <button className={tab === id ? "active" : ""} aria-pressed={tab === id} disabled={saving} key={id} onClick={() => setTab(id)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
