import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { RiAddLine } from "@remixicon/react";
import { COMPONENTS, findScreen, snapRect, type ElementNode, type Rect } from "@voidex/forma";
import { ScreenView, useRuntime } from "../runtime/host";
import type { EditorApi } from "./editor";

interface Gesture {
  id: string;
  mode: "move" | "resize";
  pointerId: number;
  x: number;
  y: number;
  rect: Rect;
  moved: boolean;
}

/**
 * The working canvas: the current screen at the selected device, fitted into
 * the workspace (never zoomed by gestures). A tap selects (purple frame);
 * taps on the selected element use it like the app would. Moving and
 * resizing happen only in the explicit move mode, on the invisible 8 px grid.
 */
export function Canvas({ api }: { api: EditorApi }) {
  const { project, device, moveMode } = api;
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 800, height: 600 });
  const [draft, setDraft] = useState<{ id: string; rect: Rect } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef<string | null>(null);
  const rt = useRuntime(project, "canvas", { screenId: api.screenId, onScreen: (id) => id !== api.screenId && api.setScreen(id) });

  useLayoutEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setBox({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const screen = findScreen(project, api.screenId) ?? project.frontend.screens[0]!;
  const frame = project.settings.frames[device];
  const contentHeight = screen.height[device];
  const pad = api.phone ? 24 : 48;
  const scale = Math.max(0.1, Math.min(1, (box.width - pad) / frame.width, (box.height - pad) / frame.height));
  const empty = screen.elements.length === 0 && (screen.hideShared || project.frontend.shared.length === 0);

  const start = (e: ReactPointerEvent, el: ElementNode, rect: Rect, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    const selected = api.selectedId === el.id;
    if (!selected) {
      // First tap only selects: no action, no movement.
      e.stopPropagation();
      api.select(el.id);
      swallowClick.current = el.id;
      return;
    }
    if (!moveMode) return;
    e.stopPropagation();
    e.preventDefault();
    gesture.current = { id: el.id, mode, pointerId: e.pointerId, x: e.clientX, y: e.clientY, rect: { ...rect }, moved: false };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort */
    }
  };

  const move = (e: ReactPointerEvent, el: ElementNode) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId || g.id !== el.id) return;
    e.preventDefault();
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;
    g.moved = true;
    const shared = !screen.elements.some((n) => n.id === el.id);
    const bounds = { width: frame.width, height: shared ? frame.height : contentHeight };
    const rect = snapRect(g.rect, (e.clientX - g.x) / scale, (e.clientY - g.y) / scale, g.mode, bounds, COMPONENTS[el.type].minSize);
    setDraft({ id: el.id, rect });
  };

  const end = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    const d = draft;
    setDraft(null);
    if (g.moved && d && d.id === g.id && JSON.stringify(d.rect) !== JSON.stringify(g.rect)) {
      api.command({ type: "setLayout", id: g.id, device, layout: d.rect });
    }
  };

  const cancel = () => {
    gesture.current = null;
    setDraft(null);
  };

  const wrap = (el: ElementNode, rect: Rect, content: ReactNode) => {
    const selected = api.selectedId === el.id;
    const d = draft?.id === el.id ? draft.rect : null;
    const style = d ? { left: d.x - rect.x, top: d.y - rect.y, width: d.width, height: d.height } : undefined;
    const shown = d ?? rect;
    return (
      <div
        className={`fx-node${selected ? " selected" : ""}${selected && moveMode ? " moving" : ""}`}
        style={style}
        data-forma-el={el.id}
        data-forma-type={el.type}
        onPointerDown={(e) => start(e, el, rect, "move")}
        onPointerMove={(e) => move(e, el)}
        onPointerUp={end}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onClickCapture={(e) => {
          if (swallowClick.current === el.id) {
            swallowClick.current = null;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <div className="fx-node-content">{content}</div>
        {selected && (
          <>
            <span className="fx-sel-label" style={{ fontSize: 11 / scale, padding: `${2 / scale}px ${6 / scale}px`, top: -20 / scale, borderRadius: 6 / scale }}>
              {el.name}
            </span>
            {moveMode && (
              <>
                <span className="fx-sel-size" style={{ fontSize: 11 / scale, padding: `${2 / scale}px ${6 / scale}px`, bottom: -22 / scale, borderRadius: 6 / scale }}>
                  {Math.round(shown.width)} × {Math.round(shown.height)}
                </span>
                <button
                  type="button"
                  className="fx-resize"
                  aria-label="Изменить размер"
                  style={{ width: 28 / scale, height: 28 / scale, right: -14 / scale, bottom: -14 / scale }}
                  onPointerDown={(e) => start(e, el, rect, "resize")}
                  onPointerMove={(e) => move(e, el)}
                  onPointerUp={end}
                  onPointerCancel={cancel}
                >
                  <i style={{ borderWidth: 2 / scale }} />
                </button>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div
      ref={host}
      className={`fx-canvas${moveMode ? " move-mode" : ""}`}
      data-testid="forma-canvas"
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest(".fx-node")) api.select(null);
      }}
    >
      <div className="fx-artboard-anchor" style={{ width: frame.width * scale, height: contentHeight * scale }}>
        <div className={`fx-artboard ${device}`} style={{ width: frame.width, height: contentHeight, transform: `scale(${scale})` }}>
          <ScreenView project={project} device={device} rt={rt} editing wrap={wrap} live={!moveMode} />
          {empty && (
            <div className="fx-empty-board">
              <span>
                <RiAddLine size={22} />
              </span>
              <b>Здесь начинается приложение</b>
              <p>Добавьте компонент из библиотеки.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
