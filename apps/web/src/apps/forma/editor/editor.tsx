import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RiArrowLeftLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiCodeSSlashLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiDragMove2Line,
  RiEditLine,
  RiFileCopyLine,
  RiLayoutLeftLine,
  RiLayoutRightLine,
  RiMenuLine,
  RiPlayFill,
  RiSave3Line,
  RiSmartphoneLine,
  RiLayoutGridLine,
  RiPagesLine,
  RiStackLine,
  RiMusic2Line,
  RiCloseLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from "@remixicon/react";
import {
  COMPONENTS,
  FormaError,
  GRID,
  applyCommands,
  commitHistory,
  findElement,
  findScreen,
  isShared,
  redoHistory,
  screenOf,
  undoHistory,
  type Command,
  type Device,
  type History,
  type Project,
} from "@voidex/forma";
import { FormaGlyph } from "@/brand/brand";
import { ApiError } from "@/lib/api";
import { WindowMenuButton, useWindow } from "@/os/window-context";
import { toast } from "@/ui/overlays";
import { formaApi, readPrefs, writePrefs, type EditorPrefs } from "../data";
import { soundEngine } from "../sounds/engine";
import { SoundLibrary } from "../sounds/library";
import { BackendPanel } from "./backend";
import { Canvas } from "./canvas";
import { ElementBar } from "./element-bar";
import { Inspector } from "./inspector";
import { Layers } from "./layers";
import { ComponentLibrary } from "./library";
import { Preview } from "./preview";
import { ScreensPanel } from "./screens";

export type Panel = "components" | "screens" | "layers" | "sounds";
type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface EditorApi {
  project: Project;
  device: Device;
  screenId: string;
  selectedId: string | null;
  moveMode: boolean;
  phone: boolean;
  command: (cmd: Command | Command[], opts?: { quiet?: boolean }) => boolean;
  select: (id: string | null) => void;
  setScreen: (id: string) => void;
  setMoveMode: (on: boolean) => void;
  notify: (text: string, tone?: "default" | "danger") => void;
  openPanel: (panel: Panel) => void;
  openInspector: () => void;
}

const PANELS: { id: Panel; icon: typeof RiPagesLine; title: string }[] = [
  { id: "components", icon: RiLayoutGridLine, title: "Компоненты" },
  { id: "screens", icon: RiPagesLine, title: "Экраны" },
  { id: "layers", icon: RiStackLine, title: "Слои" },
  { id: "sounds", icon: RiMusic2Line, title: "Звуки" },
];

/** The Forma editor of one project: library, canvas, properties, events, sounds, preview, backend. */
export function Editor({ projectId, phone, onExit }: { projectId: string; phone: boolean; onExit: () => void }) {
  const q = useQuery({ queryKey: ["forma", "project", projectId], queryFn: () => formaApi.get(projectId), staleTime: Infinity, gcTime: 0, retry: 1 });
  if (q.isError)
    return (
      <div className="fx-center-msg">
        <b>Не удалось открыть проект</b>
        <p>{q.error instanceof ApiError && q.error.status === 404 ? "Проект удалён или недоступен." : "Проверьте соединение и попробуйте ещё раз."}</p>
        <div className="fx-row-gap">
          <button type="button" className="fx-btn" onClick={onExit}>
            К проектам
          </button>
          <button type="button" className="fx-btn primary" onClick={() => void q.refetch()}>
            Повторить
          </button>
        </div>
      </div>
    );
  if (!q.data)
    return (
      <div className="fx-center-msg">
        <RiLoader4Line className="fx-spin" size={22} />
        <p>Открываем проект…</p>
      </div>
    );
  return <EditorLoaded key={q.dataUpdatedAt} initial={q.data} phone={phone} onExit={onExit} onReload={() => void q.refetch()} />;
}

function EditorLoaded({
  initial,
  phone,
  onExit,
  onReload,
}: {
  initial: { project: Project; frontendRevision: number; backendRevision: number };
  phone: boolean;
  onExit: () => void;
  onReload: () => void;
}) {
  const win = useWindow();
  const prefs0 = useMemo(() => readPrefs(initial.project.id), [initial.project.id]);
  const [history, setHistory] = useState<History>({ past: [], present: initial.project, future: [] });
  const historyRef = useRef(history);
  historyRef.current = history;
  const project = history.present;
  const [device, setDevice] = useState<Device>(prefs0.device);
  const [screenId, setScreenId] = useState<string>(() => (prefs0.screenId && findScreen(initial.project, prefs0.screenId) ? prefs0.screenId : initial.project.settings.startScreenId));
  const [selectedId, setSelected] = useState<string | null>(null);
  const [moveMode, setMoveModeState] = useState(false);
  const [panel, setPanel] = useState<Panel>("components");
  const [leftOpen, setLeftOpen] = useState(prefs0.leftOpen);
  const [rightOpen, setRightOpen] = useState(prefs0.rightOpen);
  const [sheet, setSheet] = useState<Panel | "inspector" | "menu" | null>(null);
  const [preview, setPreview] = useState(false);
  const [backendOpen, setBackendOpen] = useState(false);
  const [save, setSave] = useState<SaveState>("saved");
  const rev = useRef({ frontend: initial.frontendRevision, backend: initial.backendRevision });
  const savedJson = useRef(JSON.stringify(docOf(initial.project)));
  const saving = useRef(false);

  const screen = findScreen(project, screenId) ?? project.frontend.screens[0]!;
  const selected = selectedId ? (findElement(project, selectedId) ?? null) : null;

  useEffect(() => {
    writePrefs(project.id, { device, screenId, leftOpen, rightOpen } satisfies EditorPrefs);
  }, [project.id, device, screenId, leftOpen, rightOpen]);

  const notify = useCallback((text: string, tone: "default" | "danger" = "default") => toast({ title: text, tone: tone === "danger" ? "danger" : "default", duration: 2600 }), []);

  // ---- commands & history --------------------------------------------------
  const command = useCallback(
    (cmd: Command | Command[], opts: { quiet?: boolean } = {}) => {
      const list = Array.isArray(cmd) ? cmd : [cmd];
      try {
        const r = applyCommands(historyRef.current.present, list);
        const next = commitHistory(historyRef.current, r.project);
        historyRef.current = next;
        setHistory(next);
        if (r.selectedId !== undefined) {
          setSelected(r.selectedId);
          if (r.selectedId) setMoveModeState(false);
        }
        if (r.screenId) setScreenId(r.screenId);
        // On a phone, adding something returns to the canvas.
        if (phone && list.some((c) => c.type === "addElement" || c.type === "addTemplate" || c.type === "addScreen")) setSheet(null);
        return true;
      } catch (e) {
        if (!opts.quiet) notify(e instanceof FormaError ? e.message : "Не удалось изменить проект.", "danger");
        return false;
      }
    },
    [notify, phone],
  );

  const undo = useCallback(() => {
    const next = undoHistory(historyRef.current);
    historyRef.current = next;
    setHistory(next);
  }, []);
  const redo = useCallback(() => {
    const next = redoHistory(historyRef.current);
    historyRef.current = next;
    setHistory(next);
  }, []);

  // Selection and the screen stay valid after undo / delete.
  useEffect(() => {
    if (selectedId && !findElement(project, selectedId)) setSelected(null);
    if (!findScreen(project, screenId)) setScreenId(project.settings.startScreenId);
  }, [project, selectedId, screenId]);

  const select = useCallback((id: string | null) => {
    setSelected(id);
    if (!id) setMoveModeState(false);
  }, []);

  const setMoveMode = useCallback((on: boolean) => setMoveModeState(on), []);

  // Selecting an element of another screen (layers) shows that screen.
  useEffect(() => {
    if (!selectedId) return;
    const s = screenOf(project, selectedId);
    if (s && s.id !== screenId) setScreenId(s.id);
  }, [selectedId, project, screenId]);

  // ---- saving -----------------------------------------------------------------
  const doSave = useCallback(
    async (checkpoint: boolean) => {
      if (saving.current) return;
      const p = historyRef.current.present;
      const json = JSON.stringify(docOf(p));
      if (json === savedJson.current && !checkpoint) {
        setSave("saved");
        return;
      }
      saving.current = true;
      setSave("saving");
      try {
        const r = await formaApi.save(p, rev.current.frontend, checkpoint);
        rev.current.frontend = r.frontendRevision;
        savedJson.current = json;
        const still = JSON.stringify(docOf(historyRef.current.present)) === json;
        setSave(still ? "saved" : "dirty");
        if (checkpoint) notify("Проект сохранён");
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setSave("conflict");
        else {
          setSave("error");
          if (checkpoint) notify("Не удалось сохранить. Проверьте соединение.", "danger");
        }
      } finally {
        saving.current = false;
      }
    },
    [notify],
  );

  // Autosave: shortly after the last change.
  useEffect(() => {
    if (save === "conflict") return;
    const json = JSON.stringify(docOf(project));
    if (json === savedJson.current) {
      // Back to what the server has (e.g. undo then redo): nothing to save.
      setSave((s) => (s === "dirty" ? "saved" : s));
      return;
    }
    setSave((s) => (s === "saving" ? s : "dirty"));
    const t = window.setTimeout(() => void doSave(false), 900);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // Retry a failed save every few seconds.
  useEffect(() => {
    if (save !== "error") return;
    const t = window.setTimeout(() => void doSave(false), 5000);
    return () => window.clearTimeout(t);
  }, [save, doSave]);

  // Save before the window closes / the page hides.
  useEffect(() => {
    const flush = () => {
      if (JSON.stringify(docOf(historyRef.current.present)) !== savedJson.current) void doSave(false);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [doSave]);

  // An AI agent changes the backend while the editor is open: pick it up (the frontend is untouched).
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await formaApi.revision(project.id);
        if (stop) return;
        if (r.backendRevision !== rev.current.backend) {
          const fresh = await formaApi.get(project.id);
          if (stop) return;
          rev.current.backend = fresh.backendRevision;
          const merge = (p: Project): Project => ({ ...p, backend: fresh.project.backend, bindings: fresh.project.bindings });
          const h = historyRef.current;
          const next = { past: h.past.map(merge), present: merge(h.present), future: h.future.map(merge) };
          historyRef.current = next;
          setHistory(next);
          notify("AI-агент обновил Backend");
        }
        if (r.frontendRevision !== rev.current.frontend && !saving.current) setSave("conflict");
      } catch {
        /* offline: try again later */
      }
    };
    const t = window.setInterval(() => void poll(), 8000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [project.id, notify]);

  const overwrite = async () => {
    try {
      const r = await formaApi.revision(project.id);
      rev.current.frontend = r.frontendRevision;
      setSave("dirty");
      await doSave(true);
    } catch {
      setSave("error");
    }
  };

  // ---- keyboard -----------------------------------------------------------------
  useEffect(() => {
    if (preview) return;
    const key = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s") {
        e.preventDefault();
        void doSave(true);
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!(target.closest(".fx-app") || target === document.body)) return;
      const sel = selectedId ? findElement(historyRef.current.present, selectedId) : null;
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (mod && k === "d" && sel) {
        e.preventDefault();
        command({ type: "duplicateElement", id: sel.id });
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        command({ type: "deleteElement", id: sel.id });
      } else if (k === "m" && !mod && sel) {
        e.preventDefault();
        setMoveModeState((m) => !m);
      } else if (e.key.startsWith("Arrow") && sel && moveMode) {
        e.preventDefault();
        const l = sel.layouts[device];
        const v = e.shiftKey ? GRID * 4 : GRID;
        command({ type: "setLayout", id: sel.id, device, layout: { x: l.x + (e.key === "ArrowRight" ? v : e.key === "ArrowLeft" ? -v : 0), y: l.y + (e.key === "ArrowDown" ? v : e.key === "ArrowUp" ? -v : 0) } }, { quiet: true });
      } else if (e.key === "Escape") {
        if (moveMode) setMoveModeState(false);
        else select(null);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [preview, selectedId, moveMode, device, command, undo, redo, doSave, select]);

  useEffect(() => () => soundEngine.stopAll(), []);

  const api: EditorApi = {
    project,
    device,
    screenId: screen.id,
    selectedId,
    moveMode,
    phone,
    command,
    select,
    setScreen: (id) => {
      setScreenId(id);
      setSelected(null);
      setMoveModeState(false);
    },
    setMoveMode,
    notify,
    openPanel: (p) => {
      if (phone) setSheet(p);
      else {
        setPanel(p);
        setLeftOpen(true);
      }
    },
    openInspector: () => {
      if (phone) setSheet("inspector");
      else setRightOpen(true);
    },
  };

  const startPreview = () => {
    setMoveModeState(false);
    setSheet(null);
    setPreview(true);
  };

  const saveBadge = (
    <span className={`fx-save ${save}`} data-testid="forma-save-state" data-state={save} title={SAVE_LABEL[save]}>
      {save === "saving" ? <RiLoader4Line size={15} className="fx-spin" /> : save === "saved" ? <RiCheckLine size={15} /> : save === "dirty" ? <i className="dot" /> : <RiErrorWarningLine size={15} />}
      {!phone && <span>{SAVE_LABEL[save]}</span>}
    </span>
  );

  const deviceSwitch = (
    <div className="fx-seg" role="group" aria-label="Устройство">
      <button type="button" className={device === "phone" ? "on" : ""} onClick={() => setDevice("phone")} aria-pressed={device === "phone"} data-testid="forma-device-phone">
        <RiSmartphoneLine size={15} />
        {!phone && <span>Телефон</span>}
      </button>
      <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} data-testid="forma-device-desktop">
        <RiComputerLine size={15} />
        {!phone && <span>Компьютер</span>}
      </button>
    </div>
  );

  const historyButtons = (
    <>
      <button type="button" className="fx-icon-btn" aria-label="Отменить" title="Отменить (Ctrl+Z)" disabled={!history.past.length} onClick={undo} data-testid="forma-undo">
        <RiArrowGoBackLine size={17} />
      </button>
      <button type="button" className="fx-icon-btn" aria-label="Повторить" title="Повторить (Ctrl+Shift+Z)" disabled={!history.future.length} onClick={redo} data-testid="forma-redo">
        <RiArrowGoForwardLine size={17} />
      </button>
    </>
  );

  const toolbar = (
    <header
      className="fx-toolbar"
      onPointerDown={(e) => {
        if (phone || (e.target as HTMLElement).closest("button, input, a, select, textarea, [data-no-drag]")) return;
        win.startDrag?.(e);
      }}
      onDoubleClick={(e) => {
        if (phone || (e.target as HTMLElement).closest("button, input, a, select, textarea, [data-no-drag]")) return;
        win.toggleMaximize();
      }}
    >
      <div className="fx-toolbar-left">
        {phone ? (
          <button type="button" className="fx-icon-btn" aria-label="Меню редактора" onClick={() => setSheet("menu")} data-testid="forma-menu">
            <RiMenuLine size={20} />
          </button>
        ) : (
          <button type="button" className="fx-icon-btn" aria-label="К проектам" title="Мои проекты" onClick={onExit} data-testid="forma-exit">
            <RiArrowLeftLine size={18} />
          </button>
        )}
        {!phone && <FormaGlyph className="size-6 shrink-0" />}
        <input
          className="fx-title-input"
          aria-label="Название приложения"
          value={project.name}
          maxLength={80}
          onChange={(e) => command({ type: "rename", name: e.target.value || " " }, { quiet: true })}
          onBlur={(e) => !e.target.value.trim() && command({ type: "rename", name: "Без названия" })}
          data-testid="forma-title"
        />
        {saveBadge}
      </div>
      {!phone && <div className="fx-toolbar-center">{deviceSwitch}</div>}
      <div className="fx-toolbar-right" data-no-drag>
        {!phone && historyButtons}
        {!phone && (
          <button type="button" className="fx-icon-btn" aria-label="Сохранить" title="Сохранить (Ctrl+S)" onClick={() => void doSave(true)} data-testid="forma-save">
            <RiSave3Line size={17} />
          </button>
        )}
        <button type="button" className="fx-btn ghost" onClick={() => setBackendOpen(true)} data-testid="forma-backend-open" aria-label="Backend и AI">
          <RiCodeSSlashLine size={16} />
          {!phone && <span>Backend и AI</span>}
          {project.backend.operations.length > 0 && <span className="fx-count">{project.backend.operations.length}</span>}
        </button>
        <button type="button" className="fx-btn primary" onClick={startPreview} data-testid="forma-preview-open" aria-label="Предпросмотр">
          <RiPlayFill size={15} />
          {!phone && <span>Предпросмотр</span>}
        </button>
        {!phone && <WindowMenuButton />}
      </div>
    </header>
  );

  const banner =
    save === "conflict" ? (
      <div className="fx-banner warn" role="alert" data-testid="forma-conflict">
        <RiErrorWarningLine size={17} />
        <span>Интерфейс изменили в другом месте (на другом устройстве или AI-агент). Ваши изменения не сохранены поверх.</span>
        <button type="button" className="fx-btn sm" onClick={onReload}>
          Загрузить последнюю
        </button>
        <button type="button" className="fx-btn sm ghost" onClick={() => void overwrite()}>
          Оставить мою
        </button>
      </div>
    ) : save === "error" ? (
      <div className="fx-banner danger" role="alert">
        <RiErrorWarningLine size={17} />
        <span>Не удалось сохранить. Изменения остаются в редакторе, Forma повторит попытку.</span>
        <button type="button" className="fx-btn sm" onClick={() => void doSave(true)}>
          Повторить
        </button>
      </div>
    ) : null;

  const panelBody = (p: Panel) =>
    p === "components" ? <ComponentLibrary api={api} /> : p === "screens" ? <ScreensPanel api={api} /> : p === "layers" ? <Layers api={api} /> : <SoundLibrary api={api} />;

  const canvas = <Canvas api={api} />;

  return (
    <div className="fx-editor" data-testid="forma-editor" data-device={device}>
      {toolbar}
      {banner}
      {phone ? (
        <>
          <div className="fx-phone-tools">
            {historyButtons}
            <span className="flex-1" />
            {deviceSwitch}
          </div>
          <main className="fx-workspace">{canvas}</main>
          {selected ? (
            <ElementBar api={api} element={selected} variant="phone" />
          ) : (
            <nav className="fx-tabbar" aria-label="Разделы редактора">
              {PANELS.map(({ id, icon: Icon, title }) => (
                <button key={id} type="button" onClick={() => setSheet(id)} data-testid={`forma-tab-${id}`}>
                  <Icon size={20} />
                  <span>{title}</span>
                </button>
              ))}
            </nav>
          )}
          {sheet && (
            <div className="fx-sheet-layer" onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
              <section className={`fx-sheet${sheet === "menu" ? " side" : ""}`} data-testid={`forma-sheet-${sheet}`}>
                <header>
                  <i className="grab" aria-hidden />
                  <b>{sheet === "menu" ? "Forma" : sheet === "inspector" ? (selected ? COMPONENTS[selected.type].label : "Свойства") : PANELS.find((x) => x.id === sheet)!.title}</b>
                  <button type="button" className="fx-icon-btn" aria-label="Закрыть" onClick={() => setSheet(null)}>
                    <RiCloseLine size={19} />
                  </button>
                </header>
                <div className="fx-sheet-body">
                  {sheet === "menu" ? (
                    <div className="fx-menu-list">
                      {PANELS.map(({ id, icon: Icon, title }) => (
                        <button key={id} type="button" onClick={() => setSheet(id)}>
                          <Icon size={19} />
                          {title}
                        </button>
                      ))}
                      <button type="button" onClick={() => (setSheet(null), setBackendOpen(true))}>
                        <RiCodeSSlashLine size={19} />
                        Backend и AI
                      </button>
                      <button type="button" onClick={() => (setSheet(null), void doSave(true))}>
                        <RiSave3Line size={19} />
                        Сохранить
                      </button>
                      <button type="button" className="sep" onClick={onExit} data-testid="forma-exit">
                        <RiArrowLeftLine size={19} />
                        Мои проекты
                      </button>
                    </div>
                  ) : sheet === "inspector" ? (
                    <Inspector api={api} />
                  ) : (
                    panelBody(sheet)
                  )}
                </div>
              </section>
            </div>
          )}
        </>
      ) : (
        <div className={`fx-body${leftOpen ? "" : " left-closed"}${rightOpen ? "" : " right-closed"}`}>
          <aside className="fx-left">
            <nav className="fx-rail" aria-label="Библиотеки">
              {PANELS.map(({ id, icon: Icon, title }) => (
                <button
                  key={id}
                  type="button"
                  title={title}
                  aria-label={title}
                  aria-pressed={leftOpen && panel === id}
                  className={leftOpen && panel === id ? "on" : ""}
                  onClick={() => {
                    if (leftOpen && panel === id) setLeftOpen(false);
                    else {
                      setPanel(id);
                      setLeftOpen(true);
                    }
                  }}
                  data-testid={`forma-tab-${id}`}
                >
                  <Icon size={19} />
                </button>
              ))}
              <span className="flex-1" />
              <button type="button" title={leftOpen ? "Свернуть панель" : "Развернуть панель"} aria-label={leftOpen ? "Свернуть панель" : "Развернуть панель"} onClick={() => setLeftOpen(!leftOpen)}>
                <RiLayoutLeftLine size={18} />
              </button>
            </nav>
            {leftOpen && (
              <div className="fx-panel" data-testid={`forma-panel-${panel}`}>
                <div className="fx-panel-head">
                  <b>{PANELS.find((x) => x.id === panel)!.title}</b>
                </div>
                <div className="fx-panel-body">{panelBody(panel)}</div>
              </div>
            )}
          </aside>
          <main className="fx-workspace">
            {canvas}
            {selected && <ElementBar api={api} element={selected} variant="desktop" />}
          </main>
          <aside className="fx-right">
            {rightOpen ? (
              <div className="fx-panel">
                <div className="fx-panel-head">
                  <b>{selected ? COMPONENTS[selected.type].label : "Экран"}</b>
                  {selected && isShared(project, selected.id) && <span className="fx-chip">на всех экранах</span>}
                  <span className="flex-1" />
                  <button type="button" className="fx-icon-btn sm" aria-label="Свернуть свойства" onClick={() => setRightOpen(false)}>
                    <RiLayoutRightLine size={17} />
                  </button>
                </div>
                <div className="fx-panel-body">
                  <Inspector api={api} />
                </div>
              </div>
            ) : (
              <nav className="fx-rail right">
                <button type="button" title="Свойства" aria-label="Развернуть свойства" onClick={() => setRightOpen(true)}>
                  <RiLayoutRightLine size={18} />
                </button>
                {selected && (
                  <>
                    <button type="button" title="Изменить" aria-label="Изменить" onClick={() => setRightOpen(true)}>
                      <RiEditLine size={18} />
                    </button>
                    <button type="button" title="Переместить" aria-label="Переместить" className={moveMode ? "on" : ""} onClick={() => setMoveModeState(!moveMode)}>
                      <RiDragMove2Line size={18} />
                    </button>
                    <button type="button" title="Дублировать" aria-label="Дублировать" onClick={() => command({ type: "duplicateElement", id: selected.id })}>
                      <RiFileCopyLine size={18} />
                    </button>
                    <button type="button" title="Удалить" aria-label="Удалить" onClick={() => command({ type: "deleteElement", id: selected.id })}>
                      <RiDeleteBinLine size={18} />
                    </button>
                  </>
                )}
              </nav>
            )}
          </aside>
        </div>
      )}
      {preview && <Preview project={project} initialDevice={device} phone={phone} onClose={() => setPreview(false)} onLastScreen={(id) => setScreenId(id)} />}
      {backendOpen && <BackendPanel project={project} phone={phone} backendRevision={rev.current.backend} onClose={() => setBackendOpen(false)} notify={notify} />}
    </div>
  );
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Сохранено",
  dirty: "Изменено",
  saving: "Сохранение…",
  error: "Не сохранено",
  conflict: "Конфликт версий",
};

function docOf(p: Project) {
  return { name: p.name, settings: p.settings, frontend: p.frontend };
}
