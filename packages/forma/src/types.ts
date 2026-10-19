/**
 * Forma project model, schema version 2.
 *
 * A project is one app. It has three layers with an explicit interface
 * between them:
 *
 *   frontend  screens, components, styles, adaptive layouts, navigation,
 *             visual events, sounds. Edited by the person in the visual
 *             editor (and by an AI agent only with the `frontend.write` scope).
 *   backend   server operations with request / response contracts and their
 *             source code. Written by an authorised AI agent; a person can
 *             read and copy it in Forma, never edit it (enforced by the server).
 *   bindings  which component event calls which operation, with what input,
 *             what the UI shows while it runs and after it answers. Written by
 *             the agent, read by everyone.
 *
 * Editor state (selected device, open screen, zoom, collapsed panels) is not
 * part of the project: it lives on the device that edits it.
 */

export const FORMA_SCHEMA_VERSION = 2 as const;

export type Device = "phone" | "desktop";
export const DEVICES: readonly Device[] = ["phone", "desktop"];

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How an element follows the screen when it is wider or narrower than the design frame. */
export type HConstraint = "left" | "right" | "center" | "stretch" | "scale";
/** How an element follows the screen when it is taller or shorter than the design frame. */
export type VConstraint = "top" | "bottom" | "center" | "stretch" | "scale";

/** The geometry of an element on one device profile. */
export interface Layout extends Rect {
  h: HConstraint;
  v: VConstraint;
  minWidth?: number;
  maxWidth?: number;
  /** Not shown on this device (the element exists on the other one). */
  hidden?: boolean;
}

export interface Style {
  fill: string;
  text: string;
  radius: number;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  align: "left" | "center" | "right";
  /** Hairline border colour, or null for none. */
  border: string | null;
  opacity: number;
}

export type ComponentType =
  // navigation
  | "bottomNav"
  | "sideNav"
  | "back"
  | "topBar"
  | "tabs"
  // buttons and controls
  | "button"
  | "iconButton"
  | "toggle"
  | "checkbox"
  | "slider"
  | "segmented"
  // inputs
  | "textInput"
  | "searchField"
  | "textArea"
  // text and images
  | "heading"
  | "text"
  | "image"
  | "icon"
  | "badge"
  // containers
  | "panel"
  | "card"
  | "dialog"
  | "divider"
  // lists and cards
  | "list"
  | "grid"
  | "appCard"
  | "progress"
  // time
  | "timer"
  | "stopwatch"
  | "timePicker"
  | "clock"
  // system
  | "notice"
  | "spinner";

export type EventName = "press" | "change" | "submit" | "itemPress" | "confirm" | "cancel" | "finish";

/** Screen-level events. */
export type ScreenEventName = "open";

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  screenId: string;
}

export interface ListItem {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
}

/** What a visual event does, in order. The same list runs in the editor's preview and in the app runtime. */
export type Action =
  | { id: string; type: "navigate"; screenId: string }
  | { id: string; type: "back" }
  | { id: string; type: "playSound"; resourceId: string }
  | { id: string; type: "setValue"; targetId: string; value: string | number | boolean }
  | { id: string; type: "toggleValue"; targetId: string }
  | { id: string; type: "openDialog"; targetId: string }
  | { id: string; type: "closeDialog"; targetId: string }
  | { id: string; type: "showToast"; text: string }
  | { id: string; type: "timer"; targetId: string; command: "start" | "pause" | "reset" };

export type ActionType = Action["type"];

export interface ElementNode {
  id: string;
  type: ComponentType;
  name: string;
  props: Record<string, unknown>;
  style: Style;
  layouts: Record<Device, Layout>;
  events: Partial<Record<EventName, Action[]>>;
}

export type ScreenRole = "main" | "registration" | "settings";

export interface Screen {
  id: string;
  name: string;
  role: ScreenRole | null;
  background: string;
  /** Content height per device; taller than the frame = the screen scrolls. */
  height: Record<Device, number>;
  /** Shared elements (menus) are not shown on this screen (e.g. sign-up). */
  hideShared: boolean;
  elements: ElementNode[];
  events: Partial<Record<ScreenEventName, Action[]>>;
}

/** A sound or a haptic pattern of the Forma library, referenced by the project. */
export interface Resource {
  id: string;
  name: string;
  kind: "audio" | "haptic";
  /** Library id of the sound (`soft-ping`), stable across releases. */
  libraryId: string;
  /** Played file, relative to the sound library root. */
  file: string;
  sha256: string;
  durationMs: number;
}

export interface Frontend {
  screens: Screen[];
  /** Elements shown on every screen (bottom menu, side menu, back): stored once. */
  shared: ElementNode[];
  resources: Resource[];
}

// ---------------------------------------------------------------------------
// Backend: contracts and operations (written by AI agents)

export type FieldType = "string" | "number" | "boolean" | "string[]";

export interface ContractField {
  name: string;
  type: FieldType;
  required: boolean;
  description?: string;
  /** string: length; number: value; string[]: items. */
  min?: number;
  max?: number;
  pattern?: string;
  enum?: string[];
}

export interface Contract {
  fields: ContractField[];
}

export interface OperationError {
  code: string;
  message: string;
}

export interface OperationTest {
  name: string;
  input: Record<string, unknown>;
  expect: { ok: true; output: Record<string, unknown> } | { ok: false; error: string };
}

export interface Operation {
  id: string;
  /** Dotted name the frontend calls, e.g. `auth.login`. */
  name: string;
  description: string;
  input: Contract;
  output: Contract;
  errors: OperationError[];
  handler: { language: "javascript"; source: string };
  tests: OperationTest[];
  updatedAt: string;
  /** Who wrote the current version (agent connection name). */
  updatedBy: string;
}

export interface Backend {
  /**
   * Where operations run. `sandbox-pending`: the isolated runtime is not
   * available yet; code is stored and checked, never executed.
   */
  runtime: "sandbox-pending";
  operations: Operation[];
}

/** Where a binding takes one input field from. */
export type InputSource = { from: "element"; elementId: string } | { from: "const"; value: string | number | boolean };

export interface Binding {
  id: string;
  elementId: string;
  event: EventName;
  /** Operation name (`auth.login`). */
  operation: string;
  input: Record<string, InputSource>;
  /** Element that shows an output field (as its text / value). */
  output: { targetId: string; field: string } | null;
  /** While the call runs: the trigger is disabled and may show this text. */
  loading: { disable: boolean; text: string };
  /** Element that shows the error message (else a toast). */
  errorTargetId: string | null;
  onSuccess: Action[];
  onError: Action[];
}

export interface PublishingInfo {
  /** Filled when the app is published to Appex Store (later step). */
  appId: string | null;
  version: string;
  status: "draft";
}

export interface ProjectSettings {
  startScreenId: string;
  frames: Record<Device, Size>;
  accent: string;
}

export interface Project {
  schemaVersion: typeof FORMA_SCHEMA_VERSION;
  id: string;
  name: string;
  kind: "app";
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  frontend: Frontend;
  backend: Backend;
  bindings: Binding[];
  publishing: PublishingInfo;
}

/** The part of a project the person edits (and the server accepts from the visual editor). */
export interface FrontendDocument {
  name: string;
  settings: ProjectSettings;
  frontend: Frontend;
}
