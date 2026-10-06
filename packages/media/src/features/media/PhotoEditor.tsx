"use client";
import React, { useEffect, useRef, useState, useId } from "react";
import {
  ArrowLeft,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  Crop,
  SlidersHorizontal,
  Palette,
  PenLine,
  Type,
  Undo2,
  Redo2,
  
  Sun,
  Contrast,
  Droplets,
  Thermometer,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Slider } from "../../components/ui/slider";
import type { MediaItem } from "./model";
import { type EditSettings, freshEdit, filters, renderImage, canvasBlob, editFilter } from "./media-utils";
export default function PhotoEditor({
  item,
  onCancel,
  onSave,
  resolveSrc,
}: {
  item: MediaItem;
  onCancel: () => void;
  onSave: (blob: Blob, width: number, height: number) => Promise<void>;
  resolveSrc: (s: string) => string;
}) {
  const [settings, setSettings] = useState<EditSettings>(freshEdit);
  const clipPrefix = useId().replace(/:/g, "");
  const [filterId, setFilterId] = useState("original");
  const [tab, setTab] = useState("adjust");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [color, setColor] = useState("#ffffff");
  const [penWidth, setPenWidth] = useState(5);
  const [text, setText] = useState("");
  const [markTool, setMarkTool] = useState("pen");
  const history = useRef<EditSettings[]>([]);
  const future = useRef<EditSettings[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  const drawing = useRef(false);
  const lastDraw = useRef(0);
  const generation = useRef(0);
  function change(next: EditSettings, record = true) {
    if (record) {
      history.current.push(settingsRef.current);
      history.current = history.current.slice(-30);
      future.current = [];
    }
    settingsRef.current = next;
    setSettings(next);
  }
  useEffect(() => {
    const version = ++generation.current;
    setError("");
    renderImage(item, settings, 1400, resolveSrc)
      .then((canvas) => {
        if (version !== generation.current) return;
        const el = canvasRef.current;
        if (el) {
          el.width = canvas.width;
          el.height = canvas.height;
          el.getContext("2d")?.drawImage(canvas, 0, 0);
        }
      })
      .catch((e) => setError(e.message));
  }, [settings, item, resolveSrc]);
  function point(e: React.PointerEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (tab !== "markup") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    if (markTool === "text") {
      if (text.trim()) change({ ...settings, texts: [...settings.texts, { text: text.trim(), color, ...p }] });
      return;
    }
    drawing.current = true;
    change({ ...settings, strokes: [...settings.strokes, { color, width: penWidth, points: [p] }] });
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || Date.now() - lastDraw.current < 16) return;
    lastDraw.current = Date.now();
    const s = settingsRef.current;
    const strokes = structuredClone(s.strokes);
    strokes.at(-1)?.points.push(point(e));
    change({ ...s, strokes }, false);
  }
  function undo(redo = false) {
    const a = redo ? future : history;
    const next = a.current.pop();
    if (next) {
      (redo ? history : future).current.push(settingsRef.current);
      change(next, false);
    }
  }
  function setCropRatio(ratio: number) {
    const natural = item.width / item.height;
    let w = 100,
      h = 100;
    if (natural > ratio) w = (100 * ratio) / natural;
    else h = (100 * natural) / ratio;
    change({ ...settings, crop: { x: (100 - w) / 2, y: (100 - h) / 2, w, h } });
  }
  return (
    <div className="vm-editor">
      <header className="vm-editor-header">
        <button className="vm-round" onClick={onCancel} aria-label="Отмена">
          <ArrowLeft />
        </button>
        <div>
          <h2>Редактирование</h2>
          <p>{item.name}</p>
        </div>
        <div className="vm-editor-history">
          <button className="vm-round" disabled={!history.current.length} onClick={() => undo()} aria-label="Отменить">
            <Undo2 />
          </button>
          <button className="vm-round" disabled={!future.current.length} onClick={() => undo(true)} aria-label="Повторить">
            <Redo2 />
          </button>
        </div>
        <button
          className="vm-primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setError("");
            try {
              const canvas = await renderImage(item, settings, 4096, resolveSrc);
              await onSave(await canvasBlob(canvas), canvas.width, canvas.height);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Сохраняем…" : "Готово"}
        </button>
      </header>
      <div className="vm-editor-body">
        <aside className="vm-editor-nav">
          <Tabs value={tab} onValueChange={setTab} orientation="vertical">
            <TabsList>
              <TabsTrigger value="adjust">
                <SlidersHorizontal /> Коррекция
              </TabsTrigger>
              <TabsTrigger value="filters">
                <Palette /> Фильтры
              </TabsTrigger>
              <TabsTrigger value="crop">
                <Crop /> Обрезка
              </TabsTrigger>
              <TabsTrigger value="markup">
                <PenLine /> Разметка
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </aside>
        <div className="vm-edit-stage">
          <div className={"vm-edit-canvas " + (tab === "markup" ? "drawing" : "")}>
            <canvas
              ref={canvasRef}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={() => (drawing.current = false)}
              onPointerCancel={() => (drawing.current = false)}
            />
            {tab === "crop" && (
              <div className="vm-crop-grid" aria-hidden>
                <i />
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          {error && (
            <p className="vm-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <aside className="vm-edit-controls">
          {tab === "adjust" && (
            <>
              <h3>Коррекция</h3>
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
                    <b>{settings[key]}</b>
                  </span>
                  <Slider
                    aria-label={label}
                    min={key === "warmth" ? 0 : 0}
                    max={key === "warmth" ? 100 : 200}
                    value={[settings[key]]}
                    onValueChange={(v) => {
                      setFilterId("custom");
                      change({ ...settings, [key]: v[0] });
                    }}
                  />
                </label>
              ))}
            </>
          )}
          {tab === "filters" && (
            <>
              <h3>Фильтры</h3>
              <div className="vm-filter-options">
                {filters.map(([id, label, patch]) => (
                  <button
                    key={id}
                    className={filterId === id ? "active" : ""}
                    aria-pressed={filterId === id}
                    onClick={() => {
                      setFilterId(id);
                      change({
                        ...settings,
                        ...freshEdit(),
                        crop: settings.crop,
                        rotation: settings.rotation,
                        flip: settings.flip,
                        strokes: settings.strokes,
                        texts: settings.texts,
                        ...patch,
                      });
                    }}
                  >
                    <div style={{ filter: editFilter({ ...freshEdit(), ...patch }) }}>
                      {item.region ? (
                        <svg
                          className="vm-region"
                          viewBox={`${item.region.x} ${item.region.y} ${item.region.w} ${item.region.h}`}
                          preserveAspectRatio="xMidYMid slice"
                        >
                          <defs>
                            <clipPath id={clipPrefix + id}>
                              <rect x={item.region.x} y={item.region.y} width={item.region.w} height={item.region.h} />
                            </clipPath>
                          </defs>
                          <g clipPath={`url(#${clipPrefix + id})`}>
                            <image href={resolveSrc(item.src)} width={item.region.sw} height={item.region.sh} />
                          </g>
                        </svg>
                      ) : (
                        <img src={resolveSrc(item.src)} alt="" />
                      )}
                    </div>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {tab === "crop" && (
            <>
              <h3>Обрезка и поворот</h3>
              <div className="vm-ratios">
                {[
                  ["Оригинал", item.width / item.height],
                  ["16:9", 16 / 9],
                  ["4:3", 4 / 3],
                  ["1:1", 1],
                  ["9:16", 9 / 16],
                ].map(([name, ratio]) => (
                  <button key={name} onClick={() => setCropRatio(Number(ratio))}>
                    {name}
                  </button>
                ))}
              </div>
              {(["x", "y", "w", "h"] as const).map((k) => (
                <label key={k}>
                  <span>
                    {{ x: "Сдвиг по горизонтали", y: "Сдвиг по вертикали", w: "Ширина", h: "Высота" }[k]}{" "}
                    <b>{Math.round(settings.crop[k])}%</b>
                  </span>
                  <Slider
                    aria-label={k}
                    min={k === "w" || k === "h" ? 10 : 0}
                    max={
                      k === "x"
                        ? 100 - settings.crop.w
                        : k === "y"
                          ? 100 - settings.crop.h
                          : k === "w"
                            ? 100 - settings.crop.x
                            : 100 - settings.crop.y
                    }
                    value={[settings.crop[k]]}
                    onValueChange={(v) => change({ ...settings, crop: { ...settings.crop, [k]: v[0] } })}
                  />
                </label>
              ))}
              <div className="vm-control-row">
                <button className="vm-soft" onClick={() => change({ ...settings, rotation: (settings.rotation + 270) % 360 })}>
                  <RotateCcw size={17} /> Влево
                </button>
                <button className="vm-soft" onClick={() => change({ ...settings, rotation: (settings.rotation + 90) % 360 })}>
                  <RotateCw size={17} /> Вправо
                </button>
              </div>
              <button className="vm-soft" onClick={() => change({ ...settings, flip: !settings.flip })}>
                <FlipHorizontal size={18} /> Отразить
              </button>
            </>
          )}
          {tab === "markup" && (
            <>
              <h3>Разметка</h3>
              <Tabs value={markTool} onValueChange={setMarkTool}>
                <TabsList>
                  <TabsTrigger value="pen">
                    <PenLine size={16} /> Перо
                  </TabsTrigger>
                  <TabsTrigger value="text">
                    <Type size={16} /> Текст
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <label>
                Цвет
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
              {markTool === "pen" ? (
                <label>
                  <span>
                    Толщина <b>{penWidth}</b>
                  </span>
                  <Slider aria-label="Толщина пера" min={2} max={18} value={[penWidth]} onValueChange={(v) => setPenWidth(v[0]!)} />
                </label>
              ) : (
                <label>
                  Текст
                  <input placeholder="Например, Тула 2026" value={text} maxLength={120} onChange={(e) => setText(e.target.value)} />
                  <small>Нажмите на фото, чтобы разместить подпись.</small>
                </label>
              )}
              <button className="vm-soft" onClick={() => change({ ...settings, strokes: [], texts: [] })}>
                Очистить разметку
              </button>
            </>
          )}
          <button
            className="vm-reset"
            onClick={() => {
              setFilterId("original");
              change(freshEdit());
            }}
          >
            <RotateCcw size={16} /> Сбросить изменения
          </button>
        </aside>
      </div>
      <nav className="vm-edit-mobile-tabs">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="adjust">
              <SlidersHorizontal />
              Коррекция
            </TabsTrigger>
            <TabsTrigger value="filters">
              <Palette />
              Фильтры
            </TabsTrigger>
            <TabsTrigger value="crop">
              <Crop />
              Обрезка
            </TabsTrigger>
            <TabsTrigger value="markup">
              <PenLine />
              Разметка
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </nav>
    </div>
  );
}
