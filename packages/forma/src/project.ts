import { COMPONENTS, DEFAULT_STYLE, ICONS, isComponentType, type IconName, type PropSpec } from "./components.js";
import {
  DEVICES,
  FORMA_SCHEMA_VERSION,
  type Action,
  type ComponentType,
  type Device,
  type ElementNode,
  type EventName,
  type Frontend,
  type FrontendDocument,
  type Layout,
  type NavItem,
  type Project,
  type ProjectSettings,
  type Resource,
  type Screen,
  type ScreenEventName,
  type ScreenRole,
  type Size,
  type Style,
} from "./types.js";
import { FormaError, arr, bool, clone, color, id, isRecord, nowIso, num, oneOf, str, uid } from "./util.js";

export const LIMITS = {
  nameMax: 80,
  screens: 40,
  elementsPerScreen: 300,
  shared: 12,
  resources: 200,
  actionsPerEvent: 12,
  navItems: 8,
  frontendBytes: 900_000,
} as const;

export const DEFAULT_FRAMES: Record<Device, Size> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

/** Top inset of the phone status bar and the desktop window chrome, where content starts. */
export const TOP_INSET: Record<Device, number> = { phone: 52, desktop: 32 };

const EVENTS: EventName[] = ["press", "change", "submit", "itemPress", "confirm", "cancel", "finish"];

export function emptyScreen(name: string, frames: Record<Device, Size> = DEFAULT_FRAMES, role: Screen["role"] = null): Screen {
  return {
    id: uid("screen"),
    name: name.slice(0, LIMITS.nameMax),
    role,
    background: "#ffffff",
    height: { phone: frames.phone.height, desktop: frames.desktop.height },
    hideShared: false,
    elements: [],
    events: {},
  };
}

/** A new app project with one empty main screen. Forma makes apps only. */
export function createProject(name: string, opts: { id?: string } = {}): Project {
  const title = name.trim().slice(0, LIMITS.nameMax);
  if (!title) throw new FormaError("Укажите название приложения.", "name");
  const main = emptyScreen("Главный экран", DEFAULT_FRAMES, "main");
  const at = nowIso();
  return {
    schemaVersion: FORMA_SCHEMA_VERSION,
    id: opts.id ?? uid("project"),
    name: title,
    kind: "app",
    createdAt: at,
    updatedAt: at,
    settings: { startScreenId: main.id, frames: clone(DEFAULT_FRAMES), accent: "#6c5cff" },
    frontend: { screens: [main], shared: [], resources: [] },
    backend: { runtime: "sandbox-pending", operations: [] },
    bindings: [],
    publishing: { appId: null, version: "0.1.0", status: "draft" },
  };
}

// ---------------------------------------------------------------------------
// Lookups

export function allElements(p: Pick<Project, "frontend">): ElementNode[] {
  return [...p.frontend.shared, ...p.frontend.screens.flatMap((s) => s.elements)];
}

export function findElement(p: Pick<Project, "frontend">, elementId: string): ElementNode | undefined {
  return allElements(p).find((n) => n.id === elementId);
}

export function findScreen(p: Pick<Project, "frontend">, screenId: string): Screen | undefined {
  return p.frontend.screens.find((s) => s.id === screenId);
}

/** The screen an element is on (null for shared elements). */
export function screenOf(p: Pick<Project, "frontend">, elementId: string): Screen | null {
  return p.frontend.screens.find((s) => s.elements.some((n) => n.id === elementId)) ?? null;
}

export function isShared(p: Pick<Project, "frontend">, elementId: string) {
  return p.frontend.shared.some((n) => n.id === elementId);
}

/** Elements visible on a screen, bottom to top: its own, then the shared menus. */
export function visibleElements(p: Pick<Project, "frontend">, screen: Screen): ElementNode[] {
  return screen.hideShared ? screen.elements : [...screen.elements, ...p.frontend.shared];
}

/**
 * The screen every new preview / app run starts on: a sign-up screen first
 * when the project has one, else the chosen start screen, the main one, the first.
 */
export function startScreen(p: Pick<Project, "frontend" | "settings">): Screen {
  const s = p.frontend.screens;
  return (
    s.find((x) => x.role === "registration") ??
    s.find((x) => x.id === p.settings.startScreenId) ??
    s.find((x) => x.role === "main") ??
    s[0]!
  );
}

// ---------------------------------------------------------------------------
// Element factory

function defaultProps(type: ComponentType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of COMPONENTS[type].props) {
    if (spec.kind === "listItems") out[spec.key] = spec.default.map((i) => ({ id: uid("item"), ...i }));
    else out[spec.key] = clone(spec.default);
  }
  return out;
}

export function navIcon(label: string): IconName {
  const l = label.toLowerCase();
  if (l.includes("чат") || l.includes("сообщ")) return "chat";
  if (l.includes("поиск")) return "search";
  if (l.includes("уведом")) return "bell";
  if (l.includes("проф")) return "user";
  if (l.includes("настрой")) return "settings";
  if (l.includes("избран")) return "heart";
  return "home";
}

/** Places a new element: docked components at their edge, others under the lowest element. */
export function placeElement(type: ComponentType, screen: Screen | null, frames: Record<Device, Size>, others: ElementNode[]): Record<Device, Layout> {
  const spec = COMPONENTS[type];
  const out = {} as Record<Device, Layout>;
  for (const d of DEVICES) {
    const f = frames[d];
    const size = spec.size[d];
    const width = Math.min(size.width, f.width);
    const height = Math.min(size.height, f.height);
    const margin = d === "phone" ? 28 : 80;
    let x = margin;
    let y: number;
    if (type === "topBar") {
      x = 0;
      y = TOP_INSET[d] - 8;
    } else if (spec.dock === "bottom") {
      x = Math.round((f.width - width) / 2);
      y = f.height - height - (d === "phone" ? 24 : 20);
    } else if (spec.dock === "top") {
      const left = others.filter((n) => COMPONENTS[n.type].dock === "top" && n.type !== "topBar");
      x = (d === "phone" ? 16 : 24) + left.reduce((acc, n) => acc + n.layouts[d].width + 12, 0);
      y = TOP_INSET[d];
    } else if (spec.constraints.v === "center") {
      x = Math.round((f.width - width) / 2);
      y = Math.round((f.height - height) / 2);
    } else {
      const flow = (screen?.elements ?? []).filter((n) => COMPONENTS[n.type].dock !== "bottom" && n.type !== "dialog" && !n.layouts[d].hidden);
      const bottom = Math.max(TOP_INSET[d] + 56, ...flow.map((n) => n.layouts[d].y + n.layouts[d].height));
      y = bottom + 24;
      const limit = (screen?.height[d] ?? f.height) - height - 8;
      if (y > limit) y = Math.max(TOP_INSET[d], limit);
    }
    if (spec.constraints.h === "stretch" && type !== "topBar") x = Math.round((f.width - width) / 2);
    out[d] = { x: snap(x), y: snap(y), width, height, h: spec.constraints.h, v: spec.constraints.v };
  }
  return out;
}

const snap = (n: number) => Math.round(n / 8) * 8;

export function createElement(type: ComponentType, screen: Screen | null, frames: Record<Device, Size>, others: ElementNode[], name?: string): ElementNode {
  const spec = COMPONENTS[type];
  const same = others.filter((n) => n.type === type).length;
  return {
    id: uid(type),
    type,
    name: name ?? (same ? `${spec.label} ${same + 1}` : spec.label),
    props: defaultProps(type),
    style: { ...DEFAULT_STYLE, ...spec.style },
    layouts: placeElement(type, screen, frames, others),
    events: {},
  };
}

// ---------------------------------------------------------------------------
// Validation: every document the server stores and every project the editor
// opens goes through these. Unknown keys are dropped, sizes are bounded.

function parseStyle(v: unknown, path: string, type: ComponentType): Style {
  const base = { ...DEFAULT_STYLE, ...COMPONENTS[type].style };
  if (!isRecord(v)) return base;
  return {
    fill: v.fill === undefined ? base.fill : color(v.fill, `${path}.fill`),
    text: v.text === undefined ? base.text : color(v.text, `${path}.text`),
    radius: v.radius === undefined ? base.radius : num(v.radius, `${path}.radius`, 0, 200),
    fontSize: v.fontSize === undefined ? base.fontSize : num(v.fontSize, `${path}.fontSize`, 8, 120),
    fontWeight: v.fontWeight === undefined ? base.fontWeight : (oneOf(String(v.fontWeight), ["400", "500", "600", "700"], `${path}.fontWeight`), Number(v.fontWeight) as Style["fontWeight"]),
    align: v.align === undefined ? base.align : oneOf(v.align, ["left", "center", "right"], `${path}.align`),
    border: v.border === undefined ? base.border : v.border === null ? null : color(v.border, `${path}.border`),
    opacity: v.opacity === undefined ? base.opacity : num(v.opacity, `${path}.opacity`, 0, 1),
  };
}

export function parseLayout(v: unknown, path: string, type: ComponentType): Layout {
  if (!isRecord(v)) throw new FormaError("Нет раскладки.", path);
  const spec = COMPONENTS[type];
  const out: Layout = {
    x: num(v.x, `${path}.x`, -4000, 20000),
    y: num(v.y, `${path}.y`, -4000, 20000),
    width: num(v.width, `${path}.width`, 1, 20000),
    height: num(v.height, `${path}.height`, 1, 20000),
    h: v.h === undefined ? spec.constraints.h : oneOf(v.h, ["left", "right", "center", "stretch", "scale"], `${path}.h`),
    v: v.v === undefined ? spec.constraints.v : oneOf(v.v, ["top", "bottom", "center", "stretch", "scale"], `${path}.v`),
  };
  if (v.minWidth !== undefined && v.minWidth !== null) out.minWidth = num(v.minWidth, `${path}.minWidth`, 1, 20000);
  if (v.maxWidth !== undefined && v.maxWidth !== null) out.maxWidth = num(v.maxWidth, `${path}.maxWidth`, 1, 20000);
  if (out.minWidth && out.maxWidth && out.minWidth > out.maxWidth) throw new FormaError("Минимальная ширина больше максимальной.", `${path}.minWidth`);
  if (v.hidden === true) out.hidden = true;
  return out;
}

function parseProp(spec: PropSpec, v: unknown, path: string): unknown {
  switch (spec.kind) {
    case "text":
      return str(v, path, spec.max);
    case "number":
      return num(v, path, spec.min, spec.max);
    case "boolean":
      return bool(v, path);
    case "select":
      return oneOf(
        v,
        spec.options.map((o) => o.value),
        path,
      );
    case "icon":
      return oneOf(v, ICONS, path);
    case "screen":
      return v === "" ? "" : id(v, path);
    case "time": {
      if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new FormaError("Время в формате ЧЧ:ММ.", path);
      return v;
    }
    case "options":
      return arr(v, path, spec.max).map((o, i) => str(o, `${path}.${i}`, 40));
    case "navItems":
      return arr(v, path, LIMITS.navItems).map((o, i): NavItem => {
        if (!isRecord(o)) throw new FormaError("Некорректный пункт меню.", `${path}.${i}`);
        return {
          id: id(o.id, `${path}.${i}.id`),
          label: str(o.label, `${path}.${i}.label`, 40),
          icon: o.icon === undefined ? navIcon(String(o.label)) : oneOf(o.icon, ICONS, `${path}.${i}.icon`),
          screenId: id(o.screenId, `${path}.${i}.screenId`),
        };
      });
    case "listItems":
      return arr(v, path, spec.max).map((o, i) => {
        if (!isRecord(o)) throw new FormaError("Некорректный пункт.", `${path}.${i}`);
        return {
          id: id(o.id, `${path}.${i}.id`),
          title: str(o.title, `${path}.${i}.title`, 80),
          subtitle: str(o.subtitle ?? "", `${path}.${i}.subtitle`, 160),
          icon: oneOf(o.icon ?? "star", ICONS, `${path}.${i}.icon`),
        };
      });
  }
}

export function parseProps(type: ComponentType, v: unknown, path: string): Record<string, unknown> {
  const raw = isRecord(v) ? v : {};
  const out: Record<string, unknown> = {};
  for (const spec of COMPONENTS[type].props) {
    out[spec.key] = raw[spec.key] === undefined ? clone(spec.default) : parseProp(spec, raw[spec.key], `${path}.${spec.key}`);
    if (spec.kind === "listItems" && raw[spec.key] === undefined) out[spec.key] = spec.default.map((i) => ({ id: uid("item"), ...i }));
  }
  return out;
}

export function parseAction(v: unknown, path: string): Action {
  if (!isRecord(v)) throw new FormaError("Некорректное действие.", path);
  const aid = v.id === undefined ? uid("action") : id(v.id, `${path}.id`);
  const type = oneOf(v.type, ["navigate", "back", "playSound", "setValue", "toggleValue", "openDialog", "closeDialog", "showToast", "timer"], `${path}.type`);
  switch (type) {
    case "navigate":
      return { id: aid, type, screenId: id(v.screenId, `${path}.screenId`) };
    case "back":
      return { id: aid, type };
    case "playSound":
      return { id: aid, type, resourceId: id(v.resourceId, `${path}.resourceId`) };
    case "setValue": {
      const value = v.value;
      if (typeof value === "string") str(value, `${path}.value`, 1000);
      else if (typeof value === "number") num(value, `${path}.value`, -1e9, 1e9);
      else if (typeof value !== "boolean") throw new FormaError("Значение: текст, число или да/нет.", `${path}.value`);
      return { id: aid, type, targetId: id(v.targetId, `${path}.targetId`), value };
    }
    case "toggleValue":
    case "openDialog":
    case "closeDialog":
      return { id: aid, type, targetId: id(v.targetId, `${path}.targetId`) };
    case "showToast":
      return { id: aid, type, text: str(v.text, `${path}.text`, 200, { min: 1 }) };
    case "timer":
      return { id: aid, type, targetId: id(v.targetId, `${path}.targetId`), command: oneOf(v.command, ["start", "pause", "reset"], `${path}.command`) };
  }
}

export function parseActions(v: unknown, path: string): Action[] {
  return arr(v, path, LIMITS.actionsPerEvent).map((a, i) => parseAction(a, `${path}.${i}`));
}

export function parseElement(v: unknown, path: string): ElementNode {
  if (!isRecord(v)) throw new FormaError("Некорректный элемент.", path);
  if (!isComponentType(v.type)) throw new FormaError("Неизвестный компонент.", `${path}.type`);
  const type = v.type;
  const layouts = isRecord(v.layouts) ? v.layouts : {};
  const events: ElementNode["events"] = {};
  const rawEvents = isRecord(v.events) ? v.events : {};
  for (const [name, list] of Object.entries(rawEvents)) {
    const ev = oneOf(name, EVENTS, `${path}.events`);
    if (!COMPONENTS[type].events.includes(ev)) throw new FormaError(`${COMPONENTS[type].label} не поддерживает это событие.`, `${path}.events.${name}`);
    const actions = parseActions(list, `${path}.events.${name}`);
    if (actions.length) events[ev] = actions;
  }
  return {
    id: id(v.id, `${path}.id`),
    type,
    name: str(v.name ?? COMPONENTS[type].label, `${path}.name`, LIMITS.nameMax),
    props: parseProps(type, v.props, `${path}.props`),
    style: parseStyle(v.style, `${path}.style`, type),
    layouts: { phone: parseLayout(layouts.phone, `${path}.layouts.phone`, type), desktop: parseLayout(layouts.desktop, `${path}.layouts.desktop`, type) },
    events,
  };
}

function parseScreen(v: unknown, path: string, frames: Record<Device, Size>): Screen {
  if (!isRecord(v)) throw new FormaError("Некорректный экран.", path);
  const height = isRecord(v.height) ? v.height : {};
  const events: Screen["events"] = {};
  if (isRecord(v.events)) {
    for (const [name, list] of Object.entries(v.events)) {
      const ev = oneOf(name, ["open"] as ScreenEventName[], `${path}.events`);
      const actions = parseActions(list, `${path}.events.${name}`);
      if (actions.length) events[ev] = actions;
    }
  }
  return {
    id: id(v.id, `${path}.id`),
    name: str(v.name, `${path}.name`, LIMITS.nameMax, { min: 1 }),
    role: v.role === null || v.role === undefined ? null : oneOf<ScreenRole>(v.role, ["main", "registration", "settings"], `${path}.role`),
    background: v.background === undefined ? "#ffffff" : color(v.background, `${path}.background`),
    height: {
      phone: height.phone === undefined ? frames.phone.height : num(height.phone, `${path}.height.phone`, frames.phone.height, 20000),
      desktop: height.desktop === undefined ? frames.desktop.height : num(height.desktop, `${path}.height.desktop`, frames.desktop.height, 20000),
    },
    hideShared: v.hideShared === true,
    elements: arr(v.elements ?? [], `${path}.elements`, LIMITS.elementsPerScreen).map((e, i) => parseElement(e, `${path}.elements.${i}`)),
    events,
  };
}

const LIBRARY_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE_RE = /^audio\/preview\/[a-z0-9][a-z0-9-]{0,63}\.mp3$/;

export function parseResource(v: unknown, path: string): Resource {
  if (!isRecord(v)) throw new FormaError("Некорректный ресурс.", path);
  const libraryId = str(v.libraryId, `${path}.libraryId`, 64);
  if (!LIBRARY_ID_RE.test(libraryId)) throw new FormaError("Некорректный звук библиотеки.", `${path}.libraryId`);
  const file = str(v.file, `${path}.file`, 120);
  if (!FILE_RE.test(file)) throw new FormaError("Недопустимый путь звука.", `${path}.file`);
  const sha = str(v.sha256 ?? "", `${path}.sha256`, 64);
  if (sha && !/^[0-9a-f]{64}$/.test(sha)) throw new FormaError("Некорректная контрольная сумма.", `${path}.sha256`);
  return {
    id: id(v.id, `${path}.id`),
    name: str(v.name, `${path}.name`, 120, { min: 1 }),
    kind: oneOf(v.kind, ["audio", "haptic"], `${path}.kind`),
    libraryId,
    file,
    sha256: sha,
    durationMs: num(v.durationMs ?? 0, `${path}.durationMs`, 0, 600_000),
  };
}

function parseFrames(v: unknown, path: string): Record<Device, Size> {
  const f = isRecord(v) ? v : {};
  const one = (d: Device): Size => {
    const x = isRecord(f[d]) ? (f[d] as Record<string, unknown>) : DEFAULT_FRAMES[d];
    return { width: num(x.width, `${path}.${d}.width`, 240, 3840), height: num(x.height, `${path}.${d}.height`, 320, 2400) };
  };
  return { phone: one("phone"), desktop: one("desktop") };
}

export function parseSettings(v: unknown, path = "settings"): ProjectSettings {
  const s = isRecord(v) ? v : {};
  return {
    startScreenId: id(s.startScreenId, `${path}.startScreenId`),
    frames: parseFrames(s.frames, `${path}.frames`),
    accent: s.accent === undefined ? "#6c5cff" : color(s.accent, `${path}.accent`),
  };
}

/** Validates the person-editable part of a project (what the visual editor saves). */
export function parseFrontendDocument(v: unknown): FrontendDocument {
  if (!isRecord(v)) throw new FormaError("Некорректный проект.");
  const settings = parseSettings(v.settings);
  const fe = isRecord(v.frontend) ? v.frontend : {};
  const screens = arr(fe.screens, "frontend.screens", LIMITS.screens).map((s, i) => parseScreen(s, `frontend.screens.${i}`, settings.frames));
  if (!screens.length) throw new FormaError("В приложении должен быть хотя бы один экран.", "frontend.screens");
  const shared = arr(fe.shared ?? [], "frontend.shared", LIMITS.shared).map((e, i) => parseElement(e, `frontend.shared.${i}`));
  const resources = arr(fe.resources ?? [], "frontend.resources", LIMITS.resources).map((r, i) => parseResource(r, `frontend.resources.${i}`));
  const frontend: Frontend = { screens, shared, resources };
  // Identity: unique ids everywhere; the start screen must exist.
  const seen = new Set<string>();
  for (const s of screens) {
    if (seen.has(s.id)) throw new FormaError("Повторяющийся идентификатор экрана.", `frontend.screens`);
    seen.add(s.id);
  }
  for (const n of allElements({ frontend })) {
    if (seen.has(n.id)) throw new FormaError("Повторяющийся идентификатор элемента.", n.id);
    seen.add(n.id);
  }
  if (!screens.some((s) => s.id === settings.startScreenId)) settings.startScreenId = screens[0]!.id;
  const name = str(v.name, "name", LIMITS.nameMax, { min: 1, trim: true });
  return { name, settings, frontend };
}

/** Validates a whole project (any schema version Forma knows; older ones are migrated). */
export function parseProject(v: unknown, parseBackendLayer: (p: Record<string, unknown>) => Pick<Project, "backend" | "bindings">): Project {
  if (!isRecord(v)) throw new FormaError("Некорректный проект.");
  if (v.schemaVersion === 1) return parseProject(migrateV1(v), parseBackendLayer);
  if (v.schemaVersion !== FORMA_SCHEMA_VERSION) throw new FormaError("Версия формата проекта не поддерживается.", "schemaVersion", "unsupported_version");
  const doc = parseFrontendDocument(v);
  const created = typeof v.createdAt === "string" && Number.isFinite(Date.parse(v.createdAt)) ? v.createdAt : nowIso();
  const updated = typeof v.updatedAt === "string" && Number.isFinite(Date.parse(v.updatedAt)) ? v.updatedAt : created;
  const publishing = isRecord(v.publishing) ? v.publishing : {};
  return {
    schemaVersion: FORMA_SCHEMA_VERSION,
    id: id(v.id, "id"),
    name: doc.name,
    kind: "app",
    createdAt: created,
    updatedAt: updated,
    settings: doc.settings,
    frontend: doc.frontend,
    ...parseBackendLayer(v),
    publishing: {
      appId: typeof publishing.appId === "string" ? str(publishing.appId, "publishing.appId", 64) : null,
      version: typeof publishing.version === "string" && /^\d+\.\d+\.\d+$/.test(publishing.version) ? publishing.version : "0.1.0",
      status: "draft",
    },
  };
}

// ---------------------------------------------------------------------------
// Forma 0.1 (schema 1, stored in the browser) to schema 2.

type V1Node = {
  id: string;
  kind: string;
  name: string;
  text: string;
  layouts: Record<Device, { x: number; y: number; width: number; height: number }>;
  style: { fill: string; textColor: string; radius: number; fontSize: number };
  actions?: { id: string; resourceId: string }[];
  items?: { id: string; label: string; screenId: string }[];
  navigateTo?: string;
};

export function migrateV1(v: Record<string, unknown>): Record<string, unknown> {
  const screens = (Array.isArray(v.screens) ? v.screens : []) as Record<string, unknown>[];
  const nav = new Set(["bottomNav", "sideNav", "back"]);
  const shared: Record<string, unknown>[] = [];
  const toNode = (n: V1Node): Record<string, unknown> => {
    const type: ComponentType = n.kind === "heading" ? "heading" : n.kind === "bottomNav" || n.kind === "sideNav" || n.kind === "back" ? n.kind : "button";
    const spec = COMPONENTS[type];
    const props: Record<string, unknown> = {};
    if (type === "button") props.label = n.text;
    if (type === "heading") props.text = n.text;
    if (type === "back") props.label = n.text || "Назад";
    if (type === "sideNav") props.title = n.text || "Приложение";
    if (n.items) props.items = n.items.map((i) => ({ id: i.id, label: i.label, icon: navIcon(i.label), screenId: i.screenId }));
    const press: Record<string, unknown>[] = [];
    for (const a of n.actions ?? []) press.push({ id: a.id, type: "playSound", resourceId: a.resourceId });
    if (n.navigateTo) press.push({ type: "navigate", screenId: n.navigateTo });
    const layouts: Record<string, unknown> = {};
    for (const d of DEVICES) layouts[d] = { ...n.layouts[d], h: spec.constraints.h, v: spec.constraints.v };
    return {
      id: n.id,
      type,
      name: n.name,
      props,
      style: { fill: n.style.fill, text: n.style.textColor, radius: n.style.radius, fontSize: n.style.fontSize },
      layouts,
      events: type === "button" && press.length ? { press } : {},
    };
  };
  const outScreens = screens.map((s) => {
    const elements = ((s.elements as V1Node[]) ?? []).filter((n) => {
      if (nav.has(n.kind)) {
        shared.push(toNode(n));
        return false;
      }
      return true;
    });
    return {
      id: s.id,
      name: s.name,
      role: s.role ?? null,
      background: s.background ?? "#ffffff",
      elements: elements.map(toNode),
    };
  });
  const settings = (isRecord(v.settings) ? v.settings : {}) as Record<string, unknown>;
  const resources = ((v.resources as Record<string, unknown>[]) ?? []).map((r) => {
    const file = String(r.previewFile ?? r.file ?? "");
    const libraryId = file.split("/").pop()!.replace(/\.(mp3|wav|json)$/, "");
    return { id: r.id, name: r.name, kind: r.type === "haptic" ? "haptic" : "audio", libraryId, file: `audio/preview/${libraryId}.mp3`, sha256: "", durationMs: 0 };
  });
  const first = outScreens[0] as { id?: string } | undefined;
  return {
    schemaVersion: FORMA_SCHEMA_VERSION,
    id: v.id,
    name: v.name,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    settings: { startScreenId: settings.startScreenId ?? first?.id, frames: DEFAULT_FRAMES },
    frontend: { screens: outScreens, shared, resources },
    backend: { runtime: "sandbox-pending", operations: [] },
    bindings: [],
  };
}
