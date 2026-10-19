import { COMPONENTS, isComponentType } from "./components.js";
import { GRID } from "./layout.js";
import {
  LIMITS,
  allElements,
  createElement,
  emptyScreen,
  findElement,
  findScreen,
  isShared,
  navIcon,
  parseActions,
  parseLayout,
  parseProps,
  parseResource,
  screenOf,
  TOP_INSET,
} from "./project.js";
import { DEVICES, type Action, type ComponentType, type Device, type ElementNode, type EventName, type Layout, type Project, type Screen, type ScreenRole, type Style } from "./types.js";
import { FormaError, clamp, clone, color, isRecord, nowIso, num, oneOf, str, uid } from "./util.js";

/**
 * Frontend commands: the only way the visual editor (and an AI agent with the
 * `frontend.write` scope) changes a project. Each is validated; a batch is
 * atomic (all or nothing). Commands never touch the backend or the bindings.
 */
export type Command =
  | { type: "addElement"; component: ComponentType; screenId: string; at?: { device: Device; x: number; y: number } }
  | { type: "updateElement"; id: string; name?: string; props?: Record<string, unknown>; style?: Partial<Style> }
  | { type: "setLayout"; id: string; device: Device; layout: Partial<Layout> }
  | { type: "copyLayout"; id: string; from: Device; to: Device }
  | { type: "deleteElement"; id: string }
  | { type: "duplicateElement"; id: string }
  | { type: "arrange"; id: string; to: "front" | "back" | "forward" | "backward" }
  | { type: "align"; id: string; device: Device; edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" }
  | { type: "setEvent"; id: string; event: EventName; actions: Action[] }
  | { type: "addScreen"; name: string; role?: ScreenRole | null; duplicateOf?: string }
  | { type: "updateScreen"; id: string; name?: string; background?: string; role?: ScreenRole | null; hideShared?: boolean; height?: Partial<Record<Device, number>> }
  | { type: "setScreenEvent"; id: string; event: "open"; actions: Action[] }
  | { type: "deleteScreen"; id: string }
  | { type: "moveScreen"; id: string; index: number }
  | { type: "setStartScreen"; id: string }
  | { type: "addResource"; resource: unknown; assignTo?: { id: string; event: EventName } }
  | { type: "removeResource"; id: string }
  | { type: "rename"; name: string }
  | { type: "addTemplate"; template: TemplateId; screenId: string };

export type CommandType = Command["type"];

export type TemplateId = "hello" | "login" | "settings";

export const TEMPLATES: { id: TemplateId; label: string; description: string }[] = [
  { id: "hello", label: "Простой экран", description: "Заголовок, текст и кнопка" },
  { id: "login", label: "Вход", description: "Телефон, пароль и кнопка" },
  { id: "settings", label: "Настройки", description: "Переключатели и список" },
];

export interface CommandResult {
  project: Project;
  /** Element to select after the command (null: clear the selection). */
  selectedId?: string | null;
  /** Screen to show after the command. */
  screenId?: string;
}

function element(p: Project, elementId: string): ElementNode {
  const n = findElement(p, elementId);
  if (!n) throw new FormaError("Элемент не найден.", elementId, "not_found");
  return n;
}

function screen(p: Project, screenId: string): Screen {
  const s = findScreen(p, screenId);
  if (!s) throw new FormaError("Экран не найден.", screenId, "not_found");
  return s;
}

/** The list an element lives in (a screen's or the shared one). */
function container(p: Project, elementId: string): ElementNode[] {
  if (isShared(p, elementId)) return p.frontend.shared;
  const s = screenOf(p, elementId);
  if (!s) throw new FormaError("Элемент не найден.", elementId, "not_found");
  return s.elements;
}

function frameOf(p: Project, elementId: string, d: Device) {
  const s = screenOf(p, elementId);
  return { width: p.settings.frames[d].width, height: s ? s.height[d] : p.settings.frames[d].height };
}

function clampLayout(l: Layout, frame: { width: number; height: number }, min: { width: number; height: number }): Layout {
  const width = clamp(l.width, Math.min(min.width, frame.width), frame.width);
  const height = clamp(l.height, Math.min(min.height, frame.height), frame.height);
  return { ...l, width, height, x: clamp(l.x, 0, frame.width - width), y: clamp(l.y, 0, frame.height - height) };
}

/** Bottom menu / side menu need screens to point at: missing sections are created (as in Forma 0.1). */
function ensureNavItems(p: Project, n: ElementNode) {
  if (n.type !== "bottomNav" && n.type !== "sideNav") return;
  const labels = n.type === "sideNav" ? ["Главная", "Чаты", "Поиск", "Уведомления", "Профиль"] : ["Главная", "Поиск", "Уведомления", "Чаты", "Профиль"];
  const main = p.frontend.screens.find((s) => s.role === "main") ?? p.frontend.screens[0]!;
  n.props.items = labels.map((label) => {
    let target = label === "Главная" ? main : p.frontend.screens.find((s) => s.name === label);
    if (!target) {
      if (p.frontend.screens.length >= LIMITS.screens) target = main;
      else {
        target = emptyScreen(label, p.settings.frames);
        target.background = main.background;
        const heading = createElement("heading", target, p.settings.frames, []);
        heading.props.text = label;
        target.elements.push(heading);
        p.frontend.screens.push(target);
      }
    }
    return { id: uid("nav"), label, icon: navIcon(label), screenId: target.id };
  });
}

/** Removes references to a deleted screen / element / sound from every action and menu. */
function dropReferences(p: Project, gone: Set<string>) {
  const keep = (a: Action) =>
    !(
      (a.type === "navigate" && gone.has(a.screenId)) ||
      (a.type === "playSound" && gone.has(a.resourceId)) ||
      ("targetId" in a && gone.has(a.targetId))
    );
  const clean = (events: Partial<Record<string, Action[]>>) => {
    for (const k of Object.keys(events)) {
      const list = events[k]!.filter(keep);
      if (list.length) events[k] = list;
      else delete events[k];
    }
  };
  for (const n of allElements(p)) {
    clean(n.events);
    if (Array.isArray(n.props.items) && (n.type === "bottomNav" || n.type === "sideNav")) {
      n.props.items = (n.props.items as { screenId: string }[]).filter((i) => !gone.has(i.screenId));
    }
  }
  for (const s of p.frontend.screens) clean(s.events);
}

function checkTargets(p: Project, actions: Action[]) {
  for (const a of actions) {
    if (a.type === "navigate" && !findScreen(p, a.screenId)) throw new FormaError("Экран перехода не найден.", a.id);
    if (a.type === "playSound" && !p.frontend.resources.some((r) => r.id === a.resourceId)) throw new FormaError("Сначала добавьте звук в ресурсы проекта.", a.id);
    if ("targetId" in a) {
      const t = findElement(p, a.targetId);
      if (!t) throw new FormaError("Целевой элемент не найден.", a.id);
      if ((a.type === "openDialog" || a.type === "closeDialog") && t.type !== "dialog") throw new FormaError("Открыть можно только модальное окно.", a.id);
      if (a.type === "timer" && t.type !== "timer" && t.type !== "stopwatch") throw new FormaError("Управлять можно таймером или секундомером.", a.id);
    }
  }
}

function addTemplate(p: Project, s: Screen, template: TemplateId): string {
  const frames = p.settings.frames;
  const add = (type: ComponentType, patch: Record<string, unknown> = {}, name?: string) => {
    const n = createElement(type, s, frames, allElements(p), name);
    Object.assign(n.props, patch);
    s.elements.push(n);
    return n;
  };
  if (template === "hello") {
    add("heading", { text: "Привет, мир" });
    add("text", { text: "Это первый экран вашего приложения." });
    return add("button", { label: "Продолжить" }).id;
  }
  if (template === "login") {
    add("heading", { text: "Вход" });
    add("textInput", { label: "Телефон", placeholder: "+7 900 000-00-00", inputType: "tel" }, "Телефон");
    add("textInput", { label: "Пароль", placeholder: "Не меньше 8 символов", inputType: "password" }, "Пароль");
    add("text", { text: "" }, "Сообщение об ошибке");
    return add("button", { label: "Войти" }, "Кнопка входа").id;
  }
  add("heading", { text: "Настройки" });
  add("toggle", { label: "Уведомления", value: true });
  add("toggle", { label: "Звуки", value: false }, "Звуки");
  return add("list", { variant: "settings" }).id;
}

export function applyCommand(input: Project, cmd: Command): CommandResult {
  if (!isRecord(cmd)) throw new FormaError("Некорректная команда.");
  const p = clone(input);
  let selectedId: string | null | undefined;
  let screenId: string | undefined;
  switch (cmd.type) {
    case "addElement": {
      if (!isComponentType(cmd.component)) throw new FormaError("Неизвестный компонент.", "component");
      const s = screen(p, cmd.screenId);
      const spec = COMPONENTS[cmd.component];
      if (spec.shared) {
        if (p.frontend.shared.length >= LIMITS.shared) throw new FormaError("Слишком много общих меню.");
        if (p.frontend.shared.some((n) => n.type === cmd.component)) throw new FormaError(`${spec.label} уже есть в приложении.`, "component", "exists");
      } else if (s.elements.length >= LIMITS.elementsPerScreen) throw new FormaError("На экране слишком много элементов.");
      const n = createElement(cmd.component, spec.shared ? null : s, p.settings.frames, spec.shared ? p.frontend.shared : s.elements);
      ensureNavItems(p, n);
      if (cmd.at) {
        const d = cmd.at.device;
        const l = n.layouts[d];
        n.layouts[d] = clampLayout({ ...l, x: snap(cmd.at.x - l.width / 2), y: snap(cmd.at.y - l.height / 2) }, { width: p.settings.frames[d].width, height: s.height[d] }, spec.minSize);
      }
      if (spec.shared) p.frontend.shared.push(n);
      else s.elements.push(n);
      selectedId = n.id;
      break;
    }
    case "updateElement": {
      const n = element(p, cmd.id);
      if (cmd.name !== undefined) n.name = str(cmd.name, "name", LIMITS.nameMax);
      if (cmd.props) {
        const merged = parseProps(n.type, { ...n.props, ...cmd.props }, "props");
        if (n.type === "bottomNav" || n.type === "sideNav") {
          for (const item of merged.items as { screenId: string }[]) if (!findScreen(p, item.screenId)) throw new FormaError("Экран меню не найден.", "props.items");
        }
        n.props = merged;
      }
      if (cmd.style) {
        const s = cmd.style;
        if (s.fill !== undefined) n.style.fill = color(s.fill, "style.fill");
        if (s.text !== undefined) n.style.text = color(s.text, "style.text");
        if (s.border !== undefined) n.style.border = s.border === null ? null : color(s.border, "style.border");
        if (s.radius !== undefined) n.style.radius = num(s.radius, "style.radius", 0, 200);
        if (s.fontSize !== undefined) n.style.fontSize = num(s.fontSize, "style.fontSize", 8, 120);
        if (s.opacity !== undefined) n.style.opacity = num(s.opacity, "style.opacity", 0, 1);
        if (s.fontWeight !== undefined) n.style.fontWeight = Number(oneOf(String(s.fontWeight), ["400", "500", "600", "700"], "style.fontWeight")) as Style["fontWeight"];
        if (s.align !== undefined) n.style.align = oneOf(s.align, ["left", "center", "right"], "style.align");
      }
      break;
    }
    case "setLayout": {
      const n = element(p, cmd.id);
      const d = oneOf(cmd.device, ["phone", "desktop"], "device");
      const merged = parseLayout({ ...n.layouts[d], ...cmd.layout }, "layout", n.type);
      n.layouts[d] = clampLayout(merged, frameOf(p, n.id, d), COMPONENTS[n.type].minSize);
      break;
    }
    case "copyLayout": {
      const n = element(p, cmd.id);
      const from = oneOf(cmd.from, ["phone", "desktop"], "from");
      const to = oneOf(cmd.to, ["phone", "desktop"], "to");
      const src = n.layouts[from];
      const ff = p.settings.frames[from];
      const ft = p.settings.frames[to];
      const sx = ft.width / ff.width;
      n.layouts[to] = clampLayout(
        { ...src, x: snap(src.x * sx), width: snap(Math.max(src.width * Math.min(1, sx), COMPONENTS[n.type].minSize.width)), y: src.y, height: src.height },
        frameOf(p, n.id, to),
        COMPONENTS[n.type].minSize,
      );
      break;
    }
    case "deleteElement": {
      element(p, cmd.id);
      const list = container(p, cmd.id);
      list.splice(
        list.findIndex((n) => n.id === cmd.id),
        1,
      );
      dropReferences(p, new Set([cmd.id]));
      selectedId = null;
      break;
    }
    case "duplicateElement": {
      const src = element(p, cmd.id);
      if (COMPONENTS[src.type].shared) throw new FormaError("Общее меню бывает одно.", "id");
      const list = container(p, cmd.id);
      const n = clone(src);
      n.id = uid(n.type);
      n.name = `${src.name} (копия)`.slice(0, LIMITS.nameMax);
      for (const list of Object.values(n.events)) for (const a of list ?? []) a.id = uid("action");
      for (const key of ["items"]) if (Array.isArray(n.props[key]) && n.type !== "bottomNav" && n.type !== "sideNav") n.props[key] = (n.props[key] as { id: string }[]).map((i) => ({ ...i, id: uid("item") }));
      for (const d of DEVICES) {
        const l = n.layouts[d];
        n.layouts[d] = clampLayout({ ...l, x: l.x + 16, y: l.y + 16 }, frameOf(p, cmd.id, d), COMPONENTS[n.type].minSize);
      }
      list.splice(list.indexOf(list.find((x) => x.id === cmd.id)!) + 1, 0, n);
      selectedId = n.id;
      break;
    }
    case "arrange": {
      const list = container(p, cmd.id);
      const i = list.findIndex((n) => n.id === cmd.id);
      const [n] = list.splice(i, 1);
      const to = cmd.to === "front" ? list.length : cmd.to === "back" ? 0 : cmd.to === "forward" ? Math.min(list.length, i + 1) : Math.max(0, i - 1);
      list.splice(to, 0, n!);
      break;
    }
    case "align": {
      const n = element(p, cmd.id);
      const d = oneOf(cmd.device, ["phone", "desktop"], "device");
      const f = frameOf(p, n.id, d);
      const l = n.layouts[d];
      const edge = oneOf(cmd.edge, ["left", "hcenter", "right", "top", "vcenter", "bottom"], "edge");
      const margin = d === "phone" ? 24 : 40;
      const patch: Partial<Layout> =
        edge === "left"
          ? { x: margin, h: "left" }
          : edge === "right"
            ? { x: f.width - l.width - margin, h: "right" }
            : edge === "hcenter"
              ? { x: Math.round((f.width - l.width) / 2), h: "center" }
              : edge === "top"
                ? { y: TOP_INSET[d] + 8, v: "top" }
                : edge === "bottom"
                  ? { y: f.height - l.height - margin, v: "bottom" }
                  : { y: Math.round((f.height - l.height) / 2), v: "center" };
      n.layouts[d] = clampLayout({ ...l, ...patch }, f, COMPONENTS[n.type].minSize);
      break;
    }
    case "setEvent": {
      const n = element(p, cmd.id);
      if (!COMPONENTS[n.type].events.includes(cmd.event)) throw new FormaError(`${COMPONENTS[n.type].label} не поддерживает это событие.`, "event");
      const actions = parseActions(cmd.actions, "actions");
      checkTargets(p, actions);
      if (actions.length) n.events[cmd.event] = actions;
      else delete n.events[cmd.event];
      break;
    }
    case "addScreen": {
      if (p.frontend.screens.length >= LIMITS.screens) throw new FormaError("Слишком много экранов.");
      const name = str(cmd.name, "name", LIMITS.nameMax, { min: 1, trim: true });
      let s: Screen;
      if (cmd.duplicateOf) {
        s = clone(screen(p, cmd.duplicateOf));
        s.id = uid("screen");
        s.name = name;
        s.role = null;
        for (const n of s.elements) {
          n.id = uid(n.type);
          for (const list of Object.values(n.events)) for (const a of list ?? []) a.id = uid("action");
        }
      } else {
        s = emptyScreen(name, p.settings.frames, cmd.role ?? null);
        s.background = p.frontend.screens[0]?.background ?? "#ffffff";
      }
      if (cmd.role) s.role = oneOf<ScreenRole>(cmd.role, ["main", "registration", "settings"], "role");
      if (s.role === "registration") s.hideShared = true;
      p.frontend.screens.push(s);
      screenId = s.id;
      selectedId = null;
      break;
    }
    case "updateScreen": {
      const s = screen(p, cmd.id);
      if (cmd.name !== undefined) s.name = str(cmd.name, "name", LIMITS.nameMax, { min: 1, trim: true });
      if (cmd.background !== undefined) s.background = color(cmd.background, "background");
      if (cmd.hideShared !== undefined) s.hideShared = cmd.hideShared === true;
      if (cmd.role !== undefined) {
        const role = cmd.role === null ? null : oneOf(cmd.role, ["main", "registration", "settings"], "role");
        // One screen per role: the previous holder becomes an ordinary screen.
        if (role) for (const other of p.frontend.screens) if (other.role === role) other.role = null;
        s.role = role;
      }
      if (cmd.height) {
        for (const d of DEVICES) {
          const h = cmd.height[d];
          if (h === undefined) continue;
          s.height[d] = num(h, `height.${d}`, p.settings.frames[d].height, 20000);
          for (const n of s.elements) n.layouts[d] = clampLayout(n.layouts[d], { width: p.settings.frames[d].width, height: s.height[d] }, COMPONENTS[n.type].minSize);
        }
      }
      break;
    }
    case "setScreenEvent": {
      const s = screen(p, cmd.id);
      const actions = parseActions(cmd.actions, "actions");
      checkTargets(p, actions);
      if (actions.length) s.events.open = actions;
      else delete s.events.open;
      break;
    }
    case "deleteScreen": {
      screen(p, cmd.id);
      if (p.frontend.screens.length === 1) throw new FormaError("Нельзя удалить единственный экран.");
      const gone = p.frontend.screens.find((s) => s.id === cmd.id)!;
      p.frontend.screens = p.frontend.screens.filter((s) => s.id !== cmd.id);
      if (p.settings.startScreenId === cmd.id) p.settings.startScreenId = p.frontend.screens[0]!.id;
      dropReferences(p, new Set([cmd.id, ...gone.elements.map((n) => n.id)]));
      screenId = p.settings.startScreenId;
      selectedId = null;
      break;
    }
    case "moveScreen": {
      const i = p.frontend.screens.findIndex((s) => s.id === cmd.id);
      if (i < 0) throw new FormaError("Экран не найден.", cmd.id, "not_found");
      const [s] = p.frontend.screens.splice(i, 1);
      p.frontend.screens.splice(clamp(Math.round(num(cmd.index, "index", 0, LIMITS.screens)), 0, p.frontend.screens.length), 0, s!);
      break;
    }
    case "setStartScreen":
      p.settings.startScreenId = screen(p, cmd.id).id;
      break;
    case "addResource": {
      const r = parseResource(cmd.resource, "resource");
      const existing = p.frontend.resources.find((x) => x.libraryId === r.libraryId);
      const resource = existing ?? r;
      if (!existing) {
        if (p.frontend.resources.length >= LIMITS.resources) throw new FormaError("Слишком много звуков в проекте.");
        if (p.frontend.resources.some((x) => x.id === r.id)) resource.id = uid("sound");
        p.frontend.resources.push(resource);
      }
      if (cmd.assignTo) {
        const n = element(p, cmd.assignTo.id);
        if (!COMPONENTS[n.type].events.includes(cmd.assignTo.event)) throw new FormaError(`${COMPONENTS[n.type].label} не поддерживает это событие.`, "event");
        const list = (n.events[cmd.assignTo.event] ?? []).filter((a) => a.type !== "playSound");
        if (list.length >= LIMITS.actionsPerEvent) throw new FormaError("Слишком много действий.");
        n.events[cmd.assignTo.event] = [{ id: uid("action"), type: "playSound", resourceId: resource.id }, ...list];
      }
      break;
    }
    case "removeResource": {
      if (!p.frontend.resources.some((r) => r.id === cmd.id)) throw new FormaError("Звук не найден.", cmd.id, "not_found");
      p.frontend.resources = p.frontend.resources.filter((r) => r.id !== cmd.id);
      dropReferences(p, new Set([cmd.id]));
      break;
    }
    case "rename":
      p.name = str(cmd.name, "name", LIMITS.nameMax, { min: 1, trim: true });
      break;
    case "addTemplate": {
      const s = screen(p, cmd.screenId);
      const t = oneOf(cmd.template, ["hello", "login", "settings"], "template");
      if (s.elements.length + 6 > LIMITS.elementsPerScreen) throw new FormaError("На экране слишком много элементов.");
      selectedId = addTemplate(p, s, t);
      break;
    }
    default:
      throw new FormaError("Неизвестная команда.", "type", "unknown_command");
  }
  p.updatedAt = nowIso();
  return { project: p, selectedId, screenId };
}

/** Applies a batch atomically (max 100): any invalid command leaves the project untouched. */
export function applyCommands(p: Project, commands: Command[]): CommandResult {
  if (!Array.isArray(commands) || commands.length > 100) throw new FormaError("Допускается до 100 команд за раз.");
  let result: CommandResult = { project: p };
  for (const [i, c] of commands.entries()) {
    try {
      const next = applyCommand(result.project, c);
      result = {
        project: next.project,
        selectedId: next.selectedId === undefined ? result.selectedId : next.selectedId,
        screenId: next.screenId ?? result.screenId,
      };
    } catch (e) {
      if (e instanceof FormaError && commands.length > 1) throw new FormaError(e.message, `commands.${i}${e.path ? "." + e.path : ""}`, e.code);
      throw e;
    }
  }
  return result;
}

const snap = (n: number) => Math.round(n / GRID) * GRID;

// ---------------------------------------------------------------------------
// Undo / redo (editor session only, 80 states)

export interface History {
  past: Project[];
  present: Project;
  future: Project[];
}

export const HISTORY_LIMIT = 80;

export const commitHistory = (h: History, p: Project): History => ({ past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: p, future: [] });

/** Undo / redo restore the frontend only: backend and bindings always stay as the server has them. */
export function undoHistory(h: History): History {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1]!;
  return { past: h.past.slice(0, -1), present: { ...prev, backend: h.present.backend, bindings: h.present.bindings }, future: [h.present, ...h.future].slice(0, HISTORY_LIMIT) };
}

export function redoHistory(h: History): History {
  if (!h.future.length) return h;
  const next = h.future[0]!;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: { ...next, backend: h.present.backend, bindings: h.present.bindings }, future: h.future.slice(1) };
}
