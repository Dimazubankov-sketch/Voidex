import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { RiCloseLine } from "@remixicon/react";
import {
  busyText,
  completeCall,
  dispatch,
  findScreen,
  initRuntime,
  isBusy,
  navigate as navigateStep,
  resolveLayout,
  setDrawer,
  tick,
  timerCommand,
  valueOf,
  visibleElements,
  type Device,
  type Effect,
  type ElementNode,
  type EventName,
  type NavItem,
  type Project,
  type Rect,
  type RuntimeState,
  type Size,
  type Step,
} from "@voidex/forma";
import { soundEngine, loadCatalog } from "../sounds/engine";
import { AppIcon } from "./icons";
import { RenderElement, useNow } from "./render";

export interface CallLog {
  id: number;
  at: number;
  operation: string;
  input: Record<string, unknown>;
  status: "pending" | "missing" | "invalid" | "unavailable";
  message: string;
}

export interface RuntimeApi {
  state: RuntimeState;
  now: number;
  fire: (el: ElementNode, event: EventName, payload?: { value?: unknown; index?: number }) => void;
  navigate: (target: string) => void;
  openDrawer: (open: boolean) => void;
  timerControl: (el: ElementNode, command: "start" | "pause" | "reset") => void;
  restart: () => void;
  calls: CallLog[];
  toasts: { id: number; text: string; tone: "info" | "error" }[];
}

let seq = 0;

/** Plays a project sound resource through the Forma sound engine. */
export async function playResource(p: Project, resourceId: string) {
  const r = p.frontend.resources.find((x) => x.id === resourceId);
  if (!r) return;
  if (!soundEngine.get(r.libraryId)) {
    try {
      soundEngine.register((await loadCatalog()).sounds);
    } catch {
      return;
    }
  }
  soundEngine.play(r.libraryId);
}

/**
 * Runs a project with the shared runtime. `mode: "preview"` performs backend
 * calls through the gateway; the editor canvas runs without bindings (its
 * buttons still navigate, play sounds, toggle and open dialogs).
 */
export function useRuntime(project: Project, mode: "preview" | "canvas", opts: { screenId?: string; onScreen?: (id: string) => void } = {}): RuntimeApi {
  const p = useMemo(() => (mode === "canvas" ? { ...project, bindings: [] } : project), [project, mode]);
  const pRef = useRef(p);
  pRef.current = p;
  const [state, setState] = useState<RuntimeState>(() => {
    const init = initRuntime(p).state;
    return opts.screenId && findScreen(p, opts.screenId) ? { ...init, screenId: opts.screenId } : init;
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [toasts, setToasts] = useState<RuntimeApi["toasts"]>([]);
  const onScreen = useRef(opts.onScreen);
  onScreen.current = opts.onScreen;

  const hasTimers = Object.values(state.timers).some((t) => t.running);
  const hasClock = useMemo(() => {
    const s = findScreen(p, state.screenId);
    return !!s && visibleElements(p, s).some((e) => e.type === "clock");
  }, [p, state.screenId]);
  const now = useNow(hasTimers || hasClock, hasTimers ? 100 : 1000);

  const apply = useCallback((step: Step) => {
    stateRef.current = step.state;
    setState(step.state);
    for (const e of step.effects) runEffect(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runEffect = (e: Effect) => {
    if (e.type === "sound") void playResource(pRef.current, e.resourceId);
    else if (e.type === "toast") {
      const id = ++seq;
      setToasts((t) => [...t.slice(-2), { id, text: e.text, tone: e.tone }]);
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
    } else if (e.type === "call") {
      // The backend gateway. Nothing is invented: with no isolated runtime
      // yet, a valid request ends in an explicit "not running" state.
      const id = ++seq;
      const log: CallLog = { id, at: Date.now(), operation: e.binding.operation, input: e.input, status: "pending", message: "Запрос отправлен" };
      setCalls((c) => [log, ...c].slice(0, 30));
      window.setTimeout(() => {
        let status: CallLog["status"];
        let message: string;
        let code: string;
        if (!e.operation) {
          status = "missing";
          code = "operation_missing";
          message = `Операция ${e.binding.operation} ещё не создана AI-агентом.`;
        } else if (e.issues.length) {
          status = "invalid";
          code = "invalid_input";
          message = e.issues.map((i) => (i.field ? `${i.field}: ${i.message}` : i.message)).join(" ");
        } else {
          status = "unavailable";
          code = "backend_unavailable";
          message = "Backend ещё не исполняется: запрос проверен по контракту, защищённая среда запуска не подключена.";
        }
        setCalls((c) => c.map((x) => (x.id === id ? { ...x, status, message } : x)));
        apply(completeCall(pRef.current, stateRef.current, e.binding.id, { ok: false, code, message }));
      }, 450);
    }
  };

  useEffect(() => {
    if (!hasTimers) return;
    const step = tick(pRef.current, stateRef.current, now);
    if (step.state !== stateRef.current) apply(step);
  }, [now, hasTimers, apply]);

  // The screen the editor asked for. Reporting it back would make the two
  // ping-pong when both change in the same frame, so only the runtime's own
  // navigation is reported.
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (state.screenId === followed.current) return;
    followed.current = null;
    onScreen.current?.(state.screenId);
  }, [state.screenId]);

  // The editor moves to another screen: the canvas follows.
  useEffect(() => {
    if (opts.screenId && opts.screenId !== stateRef.current.screenId && findScreen(pRef.current, opts.screenId)) {
      followed.current = opts.screenId;
      const next = { ...stateRef.current, screenId: opts.screenId, dialogs: [], drawer: false };
      stateRef.current = next;
      setState(next);
    }
  }, [opts.screenId]);

  // A deleted screen: back to the start.
  useEffect(() => {
    if (!findScreen(p, stateRef.current.screenId)) apply(initRuntime(p));
  }, [p, apply]);

  return {
    state,
    now,
    calls,
    toasts,
    fire: (el, event, payload) => apply(dispatch(pRef.current, stateRef.current, { elementId: el.id, event, value: payload?.value, index: payload?.index }, Date.now())),
    navigate: (target) => apply(navigateStep(pRef.current, stateRef.current, target, Date.now())),
    openDrawer: (open) => apply({ state: setDrawer(stateRef.current, open), effects: [] }),
    timerControl: (el, command) => {
      const s = { ...stateRef.current, timers: { ...stateRef.current.timers, [el.id]: timerCommand(el, stateRef.current.timers[el.id], command, Date.now()) } };
      apply({ state: s, effects: [] });
    },
    restart: () => {
      soundEngine.stopAll();
      setCalls([]);
      apply(initRuntime(pRef.current));
    },
  };
}

export interface ScreenViewProps {
  project: Project;
  device: Device;
  rt: RuntimeApi;
  /** Size to lay out for; the design frame when omitted (editor). */
  viewport?: Size;
  /** Editor: every dialog is shown where it is (to be edited); runtime: only open ones, over a scrim. */
  editing?: boolean;
  /** Editor wrapper of each element (selection, drag). */
  wrap?: (el: ElementNode, rect: Rect, content: ReactNode) => ReactNode;
  live: boolean;
  statusBar?: boolean;
}

export function rectFor(el: ElementNode, device: Device, project: Project, viewport: Size | undefined, contentHeight: number): Rect {
  const l = el.layouts[device];
  if (!viewport) return l;
  return resolveLayout(l, project.settings.frames[device], viewport, contentHeight);
}

/** One screen of the app at its size: its elements, the shared menus, open dialogs and the drawer. */
export function ScreenView({ project, device, rt, viewport, editing = false, wrap, live, statusBar = true }: ScreenViewProps) {
  const screen = findScreen(project, rt.state.screenId) ?? project.frontend.screens[0]!;
  const frame = project.settings.frames[device];
  const contentHeight = screen.height[device];
  // The editor shows the whole content (a tall screen is edited at full height); a run shows the viewport.
  const size = viewport ?? (editing ? { width: frame.width, height: contentHeight } : frame);
  const scrollHeight = editing ? contentHeight : contentHeight + (size.height - frame.height);
  const elements = visibleElements(project, screen).filter((e) => !e.layouts[device].hidden);
  const shared = new Set(project.frontend.shared.map((e) => e.id));
  const own = elements.filter((e) => !shared.has(e.id) && (editing || e.type !== "dialog"));
  const menus = elements.filter((e) => shared.has(e.id));
  const dialogs = editing ? [] : rt.state.dialogs.map((id) => elements.find((e) => e.id === id)).filter((e): e is ElementNode => !!e);
  const sideNav = project.frontend.shared.find((e) => e.type === "sideNav");

  const draw = (el: ElementNode, scroll: boolean) => {
    const rect = rectFor(el, device, project, viewport, scroll ? contentHeight : frame.height);
    const content = (
      <RenderElement
        el={el}
        live={live}
        screenId={screen.id}
        value={valueOf(project, rt.state, el)}
        timer={rt.state.timers[el.id]}
        now={rt.now}
        busy={isBusy(project, rt.state, el.id)}
        busyText={busyText(project, rt.state, el.id)}
        fire={(event, payload) => rt.fire(el, event, payload)}
        navigate={rt.navigate}
        openDrawer={() => rt.openDrawer(true)}
        timerControl={(c) => rt.timerControl(el, c)}
      />
    );
    const style: CSSProperties = { left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: el.style.opacity };
    return wrap ? (
      <div key={el.id} className="fx-node-slot" style={style}>
        {wrap(el, rect, content)}
      </div>
    ) : (
      <div key={el.id} className="fx-node-slot" style={style} data-forma-el={el.id} data-forma-type={el.type}>
        {content}
      </div>
    );
  };

  return (
    <div className="fx-screen" style={{ width: size.width, height: size.height, background: screen.background }} data-testid="forma-screen" data-screen={screen.id}>
      <div className={`fx-screen-scroll${scrollHeight > size.height ? " scrolls" : ""}`}>
        <div className="fx-screen-content" style={{ height: Math.max(size.height, scrollHeight) }}>
          {statusBar && device === "phone" && (
            <div className="fx-statusbar" aria-hidden>
              <span>9:41</span>
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
          {own.map((e) => draw(e, true))}
        </div>
      </div>
      <div className="fx-screen-fixed">{menus.map((e) => draw(e, false))}</div>
      {dialogs.length > 0 && (
        <div className="fx-scrim">
          {dialogs.map((e) => draw(e, false))}
        </div>
      )}
      {rt.state.drawer && sideNav && (
        <div className="fx-drawer-layer" onClick={(e) => e.target === e.currentTarget && rt.openDrawer(false)}>
          <nav className="fx-drawer" style={{ background: sideNav.style.fill, color: sideNav.style.text, width: Math.min(310, size.width * 0.8) }} aria-label="Меню приложения">
            <header>
              <b>{String(sideNav.props.title ?? "")}</b>
              <button type="button" aria-label="Закрыть меню" onClick={() => rt.openDrawer(false)}>
                <RiCloseLine size={18} />
              </button>
            </header>
            {((sideNav.props.items as NavItem[]) ?? []).map((i) => (
              <button key={i.id} type="button" className={i.screenId === screen.id ? "on" : ""} onClick={() => rt.navigate(i.screenId)}>
                <AppIcon name={i.icon} size={19} />
                <span>{i.label}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
      {rt.toasts.length > 0 && (
        <div className="fx-app-toasts" aria-live="polite">
          {rt.toasts.map((t) => (
            <div key={t.id} className={t.tone === "error" ? "err" : ""}>
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
