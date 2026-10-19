import type { ComponentType, Device, EventName, HConstraint, Style, VConstraint } from "./types.js";

/**
 * The Forma component library. Every component is described here once:
 * its category, props schema (drives the inspector, validation and the AI
 * contracts API), supported events, default size per device and style. The
 * web runtime draws it; nothing here depends on a particular Voidex app.
 */

export const COMPONENT_CATEGORIES = ["navigation", "controls", "inputs", "content", "containers", "lists", "time", "system"] as const;
export type ComponentCategory = (typeof COMPONENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ComponentCategory | "sounds", string> = {
  navigation: "Навигация",
  controls: "Кнопки и управление",
  inputs: "Поля ввода",
  content: "Текст и изображения",
  containers: "Контейнеры",
  lists: "Списки и карточки",
  time: "Время",
  system: "Системные элементы",
  sounds: "Звуки",
};

/** The icon vocabulary of Forma apps (drawn by the runtime with the Voidex icon set). */
export const ICONS = [
  "home",
  "search",
  "bell",
  "chat",
  "user",
  "settings",
  "heart",
  "star",
  "plus",
  "play",
  "pause",
  "music",
  "image",
  "camera",
  "calendar",
  "clock",
  "timer",
  "mail",
  "lock",
  "cart",
  "gift",
  "bolt",
  "check",
  "close",
  "arrowRight",
  "arrowLeft",
  "menu",
  "grid",
  "list",
  "folder",
  "file",
  "download",
  "share",
  "edit",
  "trash",
  "info",
  "sun",
  "moon",
  "store",
  "phone",
] as const;
export type IconName = (typeof ICONS)[number];

export type PropSpec =
  | { key: string; label: string; kind: "text"; max: number; default: string; multiline?: boolean }
  | { key: string; label: string; kind: "number"; min: number; max: number; step: number; default: number }
  | { key: string; label: string; kind: "boolean"; default: boolean }
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[]; default: string }
  | { key: string; label: string; kind: "icon"; default: IconName }
  | { key: string; label: string; kind: "screen"; default: "" }
  | { key: string; label: string; kind: "navItems"; default: [] }
  | { key: string; label: string; kind: "listItems"; max: number; default: { title: string; subtitle: string; icon: IconName }[] }
  | { key: string; label: string; kind: "options"; max: number; default: string[] }
  | { key: string; label: string; kind: "time"; default: string };

/** What a component holds as its value: what `setValue` writes and a binding reads. */
export type ValueKind = "string" | "number" | "boolean" | "none";

export type StyleField = "fill" | "text" | "radius" | "fontSize" | "fontWeight" | "align" | "border" | "opacity";

export interface ComponentSpec {
  type: ComponentType;
  category: ComponentCategory;
  label: string;
  description: string;
  icon: IconName;
  events: EventName[];
  props: PropSpec[];
  /** The prop holding the component's value (`value`), when it has one. */
  value: { kind: ValueKind; prop: string | null };
  size: Record<Device, { width: number; height: number }>;
  style: Partial<Style>;
  styleFields: StyleField[];
  constraints: { h: HConstraint; v: VConstraint };
  /** Navigation that belongs to every screen: added to the shared layer. */
  shared?: boolean;
  /** Bottom / top placement on insert. */
  dock?: "top" | "bottom";
  minSize: { width: number; height: number };
}

export const EVENT_LABELS: Record<EventName, string> = {
  press: "При нажатии",
  change: "При изменении",
  submit: "При отправке",
  itemPress: "При выборе пункта",
  confirm: "При подтверждении",
  cancel: "При отмене",
  finish: "При завершении",
};

const S = (phone: [number, number], desktop: [number, number]) => ({
  phone: { width: phone[0], height: phone[1] },
  desktop: { width: desktop[0], height: desktop[1] },
});

const TEXT_STYLE: StyleField[] = ["text", "fontSize", "fontWeight", "align", "opacity"];
const BOX_STYLE: StyleField[] = ["fill", "text", "radius", "fontSize", "fontWeight", "border", "opacity"];

const item = (title: string, subtitle: string, icon: IconName) => ({ title, subtitle, icon });

export const COMPONENTS: Record<ComponentType, ComponentSpec> = {
  // ---- navigation ---------------------------------------------------------
  bottomNav: {
    type: "bottomNav",
    category: "navigation",
    label: "Нижнее меню",
    description: "Вкладки внизу экрана",
    icon: "grid",
    events: [],
    props: [{ key: "items", label: "Разделы", kind: "navItems", default: [] }],
    value: { kind: "none", prop: null },
    size: S([366, 64], [560, 64]),
    style: { fill: "#ffffff", text: "#27242f", radius: 22, fontSize: 11, border: "#ececf2" },
    styleFields: ["fill", "text", "radius", "border", "opacity"],
    constraints: { h: "stretch", v: "bottom" },
    shared: true,
    dock: "bottom",
    minSize: { width: 160, height: 48 },
  },
  sideNav: {
    type: "sideNav",
    category: "navigation",
    label: "Боковое меню",
    description: "Выдвижная навигация",
    icon: "menu",
    events: [],
    props: [
      { key: "title", label: "Заголовок меню", kind: "text", max: 40, default: "Приложение" },
      { key: "items", label: "Разделы", kind: "navItems", default: [] },
    ],
    value: { kind: "none", prop: null },
    size: S([44, 44], [44, 44]),
    style: { fill: "#ffffff", text: "#27242f", radius: 14, fontSize: 14, border: "#ececf2" },
    styleFields: ["fill", "text", "radius", "border"],
    constraints: { h: "left", v: "top" },
    shared: true,
    dock: "top",
    minSize: { width: 32, height: 32 },
  },
  back: {
    type: "back",
    category: "navigation",
    label: "Кнопка назад",
    description: "Возврат на прошлый экран",
    icon: "arrowLeft",
    events: [],
    props: [{ key: "label", label: "Текст", kind: "text", max: 24, default: "Назад" }],
    value: { kind: "none", prop: null },
    size: S([104, 44], [104, 44]),
    style: { fill: "#ffffff", text: "#27242f", radius: 14, fontSize: 14, border: "#ececf2" },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    shared: true,
    dock: "top",
    minSize: { width: 40, height: 32 },
  },
  topBar: {
    type: "topBar",
    category: "navigation",
    label: "Верхняя панель",
    description: "Заголовок экрана",
    icon: "list",
    events: [],
    props: [{ key: "title", label: "Заголовок", kind: "text", max: 60, default: "Заголовок" }],
    value: { kind: "none", prop: null },
    size: S([390, 56], [1280, 64]),
    style: { fill: "#ffffff", text: "#17171b", radius: 0, fontSize: 17, fontWeight: 600, border: "#ececf2", align: "center" },
    styleFields: ["fill", "text", "fontSize", "fontWeight", "align", "border"],
    constraints: { h: "stretch", v: "top" },
    dock: "top",
    minSize: { width: 120, height: 40 },
  },
  tabs: {
    type: "tabs",
    category: "navigation",
    label: "Вкладки",
    description: "Переключение разделов",
    icon: "grid",
    events: ["change"],
    props: [
      { key: "options", label: "Вкладки", kind: "options", max: 6, default: ["Все", "Новые", "Избранное"] },
      { key: "value", label: "Выбрана", kind: "number", min: 0, max: 5, step: 1, default: 0 },
    ],
    value: { kind: "number", prop: "value" },
    size: S([334, 40], [420, 40]),
    style: { fill: "#f1f0f6", text: "#27242f", radius: 12, fontSize: 14, fontWeight: 500 },
    styleFields: ["fill", "text", "radius", "fontSize"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 120, height: 32 },
  },
  // ---- buttons and controls ----------------------------------------------
  button: {
    type: "button",
    category: "controls",
    label: "Кнопка",
    description: "Текст, цвет и действие",
    icon: "bolt",
    events: ["press"],
    props: [
      { key: "label", label: "Текст", kind: "text", max: 60, default: "Продолжить" },
      {
        key: "variant",
        label: "Вид",
        kind: "select",
        options: [
          { value: "primary", label: "Основная" },
          { value: "secondary", label: "Дополнительная" },
          { value: "ghost", label: "Прозрачная" },
        ],
        default: "primary",
      },
    ],
    value: { kind: "none", prop: null },
    size: S([334, 52], [240, 48]),
    style: { fill: "#6c5cff", text: "#ffffff", radius: 14, fontSize: 16, fontWeight: 600, align: "center" },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 48, height: 28 },
  },
  iconButton: {
    type: "iconButton",
    category: "controls",
    label: "Кнопка-иконка",
    description: "Круглая кнопка",
    icon: "plus",
    events: ["press"],
    props: [
      { key: "icon", label: "Иконка", kind: "icon", default: "plus" },
      { key: "label", label: "Подпись для доступности", kind: "text", max: 40, default: "Добавить" },
    ],
    value: { kind: "none", prop: null },
    size: S([48, 48], [44, 44]),
    style: { fill: "#efedff", text: "#5b4af0", radius: 24, fontSize: 20 },
    styleFields: ["fill", "text", "radius", "border", "opacity"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 28, height: 28 },
  },
  toggle: {
    type: "toggle",
    category: "controls",
    label: "Переключатель",
    description: "Вкл. и выкл.",
    icon: "check",
    events: ["change"],
    props: [
      { key: "label", label: "Подпись", kind: "text", max: 60, default: "Уведомления" },
      { key: "value", label: "Включён", kind: "boolean", default: true },
    ],
    value: { kind: "boolean", prop: "value" },
    size: S([334, 52], [360, 48]),
    style: { fill: "#ffffff", text: "#17171b", radius: 14, fontSize: 15, border: "#ececf2" },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 60, height: 32 },
  },
  checkbox: {
    type: "checkbox",
    category: "controls",
    label: "Флажок",
    description: "Согласие или выбор",
    icon: "check",
    events: ["change"],
    props: [
      { key: "label", label: "Подпись", kind: "text", max: 80, default: "Я согласен с условиями" },
      { key: "value", label: "Отмечен", kind: "boolean", default: false },
    ],
    value: { kind: "boolean", prop: "value" },
    size: S([334, 32], [360, 32]),
    style: { fill: "#6c5cff", text: "#17171b", radius: 6, fontSize: 15 },
    styleFields: ["fill", "text", "radius", "fontSize"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 32, height: 24 },
  },
  slider: {
    type: "slider",
    category: "controls",
    label: "Ползунок",
    description: "Значение в диапазоне",
    icon: "settings",
    events: ["change"],
    props: [
      { key: "label", label: "Подпись", kind: "text", max: 40, default: "Громкость" },
      { key: "min", label: "Минимум", kind: "number", min: -100000, max: 100000, step: 1, default: 0 },
      { key: "max", label: "Максимум", kind: "number", min: -100000, max: 100000, step: 1, default: 100 },
      { key: "value", label: "Значение", kind: "number", min: -100000, max: 100000, step: 1, default: 60 },
    ],
    value: { kind: "number", prop: "value" },
    size: S([334, 56], [360, 56]),
    style: { fill: "#6c5cff", text: "#17171b", radius: 99, fontSize: 14 },
    styleFields: ["fill", "text", "fontSize"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 80, height: 32 },
  },
  segmented: {
    type: "segmented",
    category: "controls",
    label: "Сегменты",
    description: "Выбор одного варианта",
    icon: "list",
    events: ["change"],
    props: [
      { key: "options", label: "Варианты", kind: "options", max: 5, default: ["День", "Неделя", "Месяц"] },
      { key: "value", label: "Выбран", kind: "number", min: 0, max: 4, step: 1, default: 0 },
    ],
    value: { kind: "number", prop: "value" },
    size: S([334, 40], [320, 40]),
    style: { fill: "#f1f0f6", text: "#27242f", radius: 12, fontSize: 14, fontWeight: 500 },
    styleFields: ["fill", "text", "radius", "fontSize"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 100, height: 28 },
  },
  // ---- inputs ---------------------------------------------------------------
  textInput: {
    type: "textInput",
    category: "inputs",
    label: "Поле ввода",
    description: "Текст, почта, телефон, пароль",
    icon: "edit",
    events: ["change", "submit"],
    props: [
      { key: "label", label: "Подпись", kind: "text", max: 40, default: "Имя" },
      { key: "placeholder", label: "Подсказка", kind: "text", max: 60, default: "Введите имя" },
      {
        key: "inputType",
        label: "Тип",
        kind: "select",
        options: [
          { value: "text", label: "Текст" },
          { value: "email", label: "Почта" },
          { value: "tel", label: "Телефон" },
          { value: "number", label: "Число" },
          { value: "password", label: "Пароль" },
        ],
        default: "text",
      },
      { key: "value", label: "Значение", kind: "text", max: 200, default: "" },
    ],
    value: { kind: "string", prop: "value" },
    size: S([334, 72], [360, 72]),
    style: { fill: "#f5f5f7", text: "#17171b", radius: 12, fontSize: 15 },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 80, height: 40 },
  },
  searchField: {
    type: "searchField",
    category: "inputs",
    label: "Поиск",
    description: "Поле поиска",
    icon: "search",
    events: ["change", "submit"],
    props: [
      { key: "placeholder", label: "Подсказка", kind: "text", max: 60, default: "Поиск" },
      { key: "value", label: "Значение", kind: "text", max: 200, default: "" },
    ],
    value: { kind: "string", prop: "value" },
    size: S([334, 44], [360, 44]),
    style: { fill: "#f1f0f6", text: "#17171b", radius: 22, fontSize: 15 },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 80, height: 32 },
  },
  textArea: {
    type: "textArea",
    category: "inputs",
    label: "Многострочное поле",
    description: "Сообщение или заметка",
    icon: "file",
    events: ["change"],
    props: [
      { key: "placeholder", label: "Подсказка", kind: "text", max: 80, default: "Напишите сообщение" },
      { key: "value", label: "Значение", kind: "text", max: 2000, default: "", multiline: true },
    ],
    value: { kind: "string", prop: "value" },
    size: S([334, 120], [420, 140]),
    style: { fill: "#f5f5f7", text: "#17171b", radius: 14, fontSize: 15 },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 80, height: 56 },
  },
  // ---- text and images ------------------------------------------------------
  heading: {
    type: "heading",
    category: "content",
    label: "Заголовок",
    description: "Крупный текст",
    icon: "edit",
    events: [],
    props: [{ key: "text", label: "Текст", kind: "text", max: 120, default: "Заголовок" }],
    value: { kind: "string", prop: "text" },
    size: S([334, 44], [640, 54]),
    style: { fill: "#ffffff", text: "#17171b", fontSize: 28, fontWeight: 700, align: "left" },
    styleFields: TEXT_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 40, height: 20 },
  },
  text: {
    type: "text",
    category: "content",
    label: "Текст",
    description: "Абзац или подпись",
    icon: "file",
    events: [],
    props: [{ key: "text", label: "Текст", kind: "text", max: 1000, default: "Расскажите, что умеет приложение.", multiline: true }],
    value: { kind: "string", prop: "text" },
    size: S([334, 48], [640, 48]),
    style: { fill: "#ffffff", text: "#55555f", fontSize: 15, fontWeight: 400, align: "left" },
    styleFields: TEXT_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 40, height: 16 },
  },
  image: {
    type: "image",
    category: "content",
    label: "Изображение",
    description: "Обложка или аватар",
    icon: "image",
    events: ["press"],
    props: [
      {
        key: "shape",
        label: "Вид",
        kind: "select",
        options: [
          { value: "cover", label: "Обложка" },
          { value: "avatar", label: "Аватар" },
        ],
        default: "cover",
      },
      { key: "label", label: "Подпись или инициалы", kind: "text", max: 40, default: "" },
      { key: "icon", label: "Иконка", kind: "icon", default: "image" },
    ],
    value: { kind: "none", prop: null },
    size: S([334, 180], [420, 240]),
    style: { fill: "#e9e4ff", text: "#6c5cff", radius: 20, fontSize: 28 },
    styleFields: ["fill", "text", "radius", "border", "opacity"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 24, height: 24 },
  },
  icon: {
    type: "icon",
    category: "content",
    label: "Иконка",
    description: "Символ из набора Voidex",
    icon: "star",
    events: ["press"],
    props: [{ key: "icon", label: "Иконка", kind: "icon", default: "star" }],
    value: { kind: "none", prop: null },
    size: S([32, 32], [32, 32]),
    style: { fill: "#ffffff", text: "#6c5cff", fontSize: 24 },
    styleFields: ["text", "opacity"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 16, height: 16 },
  },
  badge: {
    type: "badge",
    category: "content",
    label: "Метка",
    description: "Короткий статус",
    icon: "star",
    events: [],
    props: [{ key: "text", label: "Текст", kind: "text", max: 24, default: "Новое" }],
    value: { kind: "string", prop: "text" },
    size: S([72, 26], [72, 26]),
    style: { fill: "#efedff", text: "#5b4af0", radius: 13, fontSize: 12, fontWeight: 600, align: "center" },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 24, height: 18 },
  },
  // ---- containers -----------------------------------------------------------
  panel: {
    type: "panel",
    category: "containers",
    label: "Панель",
    description: "Фон для группы элементов",
    icon: "grid",
    events: [],
    props: [],
    value: { kind: "none", prop: null },
    size: S([334, 160], [480, 200]),
    style: { fill: "#f5f5f7", text: "#17171b", radius: 20, border: null },
    styleFields: ["fill", "radius", "border", "opacity"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 16, height: 16 },
  },
  card: {
    type: "card",
    category: "containers",
    label: "Карточка",
    description: "Заголовок, описание, иконка",
    icon: "folder",
    events: ["press"],
    props: [
      { key: "title", label: "Заголовок", kind: "text", max: 60, default: "Карточка" },
      { key: "subtitle", label: "Описание", kind: "text", max: 160, default: "Короткое описание" },
      { key: "icon", label: "Иконка", kind: "icon", default: "star" },
    ],
    value: { kind: "none", prop: null },
    size: S([334, 88], [360, 96]),
    style: { fill: "#ffffff", text: "#17171b", radius: 18, fontSize: 16, fontWeight: 600, border: "#ececf2" },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 80, height: 48 },
  },
  dialog: {
    type: "dialog",
    category: "containers",
    label: "Модальное окно",
    description: "Открывается действием",
    icon: "info",
    events: ["confirm", "cancel"],
    props: [
      { key: "title", label: "Заголовок", kind: "text", max: 60, default: "Подтвердите действие" },
      { key: "message", label: "Текст", kind: "text", max: 400, default: "Изменения будут сохранены.", multiline: true },
      { key: "confirmLabel", label: "Кнопка подтверждения", kind: "text", max: 30, default: "Готово" },
      { key: "cancelLabel", label: "Кнопка отмены (пусто, если не нужна)", kind: "text", max: 30, default: "Отмена" },
    ],
    value: { kind: "none", prop: null },
    size: S([334, 200], [400, 210]),
    style: { fill: "#ffffff", text: "#17171b", radius: 24, fontSize: 18, fontWeight: 600 },
    styleFields: BOX_STYLE,
    constraints: { h: "center", v: "center" },
    minSize: { width: 200, height: 120 },
  },
  divider: {
    type: "divider",
    category: "containers",
    label: "Разделитель",
    description: "Тонкая линия",
    icon: "list",
    events: [],
    props: [],
    value: { kind: "none", prop: null },
    size: S([334, 8], [640, 8]),
    style: { fill: "#e4e4e8", text: "#17171b" },
    styleFields: ["fill", "opacity"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 8, height: 8 },
  },
  // ---- lists and cards -----------------------------------------------------
  list: {
    type: "list",
    category: "lists",
    label: "Список",
    description: "Строки с иконками",
    icon: "list",
    events: ["itemPress"],
    props: [
      {
        key: "variant",
        label: "Вид",
        kind: "select",
        options: [
          { value: "plain", label: "Обычный" },
          { value: "settings", label: "Меню параметров" },
        ],
        default: "plain",
      },
      {
        key: "items",
        label: "Пункты",
        kind: "listItems",
        max: 20,
        default: [item("Профиль", "Имя и фото", "user"), item("Уведомления", "Звук и баннеры", "bell"), item("Конфиденциальность", "Кто видит профиль", "lock")],
      },
    ],
    value: { kind: "number", prop: null },
    size: S([334, 192], [420, 192]),
    style: { fill: "#ffffff", text: "#17171b", radius: 18, fontSize: 15, border: "#ececf2" },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 120, height: 56 },
  },
  grid: {
    type: "grid",
    category: "lists",
    label: "Сетка",
    description: "Плитки в несколько колонок",
    icon: "grid",
    events: ["itemPress"],
    props: [
      { key: "columns", label: "Колонки", kind: "number", min: 1, max: 6, step: 1, default: 2 },
      {
        key: "items",
        label: "Плитки",
        kind: "listItems",
        max: 24,
        default: [item("Фото", "", "image"), item("Музыка", "", "music"), item("Файлы", "", "folder"), item("Заметки", "", "edit")],
      },
    ],
    value: { kind: "number", prop: null },
    size: S([334, 232], [520, 232]),
    style: { fill: "#f5f5f7", text: "#17171b", radius: 18, fontSize: 14 },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 80, height: 80 },
  },
  appCard: {
    type: "appCard",
    category: "lists",
    label: "Карточка приложения",
    description: "Как в Appex Store",
    icon: "store",
    events: ["press"],
    props: [
      { key: "title", label: "Название", kind: "text", max: 40, default: "Приложение" },
      { key: "subtitle", label: "Описание", kind: "text", max: 80, default: "Инструменты" },
      { key: "buttonLabel", label: "Кнопка", kind: "text", max: 20, default: "Загрузить" },
      { key: "icon", label: "Иконка", kind: "icon", default: "star" },
    ],
    value: { kind: "none", prop: null },
    size: S([334, 76], [360, 76]),
    style: { fill: "#ffffff", text: "#17171b", radius: 18, fontSize: 15, fontWeight: 600, border: "#ececf2" },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 160, height: 56 },
  },
  progress: {
    type: "progress",
    category: "lists",
    label: "Прогресс",
    description: "Загрузка или шаги",
    icon: "download",
    events: [],
    props: [
      { key: "label", label: "Подпись", kind: "text", max: 60, default: "Загрузка" },
      { key: "value", label: "Процент", kind: "number", min: 0, max: 100, step: 1, default: 40 },
    ],
    value: { kind: "number", prop: "value" },
    size: S([334, 40], [360, 40]),
    style: { fill: "#6c5cff", text: "#55555f", radius: 99, fontSize: 13 },
    styleFields: ["fill", "text", "fontSize"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 60, height: 12 },
  },
  // ---- time -------------------------------------------------------------------
  timer: {
    type: "timer",
    category: "time",
    label: "Таймер",
    description: "Обратный отсчёт",
    icon: "timer",
    events: ["finish"],
    props: [
      { key: "seconds", label: "Длительность, сек", kind: "number", min: 1, max: 86400, step: 1, default: 60 },
      { key: "showControls", label: "Кнопки управления", kind: "boolean", default: true },
    ],
    value: { kind: "number", prop: "seconds" },
    size: S([334, 168], [360, 168]),
    style: { fill: "#ffffff", text: "#17171b", radius: 24, fontSize: 44, fontWeight: 600, border: "#ececf2" },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 120, height: 64 },
  },
  stopwatch: {
    type: "stopwatch",
    category: "time",
    label: "Секундомер",
    description: "Отсчёт времени",
    icon: "clock",
    events: [],
    props: [{ key: "showControls", label: "Кнопки управления", kind: "boolean", default: true }],
    value: { kind: "none", prop: null },
    size: S([334, 168], [360, 168]),
    style: { fill: "#ffffff", text: "#17171b", radius: 24, fontSize: 40, fontWeight: 600, border: "#ececf2" },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 120, height: 64 },
  },
  timePicker: {
    type: "timePicker",
    category: "time",
    label: "Выбор времени",
    description: "Барабаны часов и минут",
    icon: "clock",
    events: ["change"],
    props: [{ key: "value", label: "Время", kind: "time", default: "07:30" }],
    value: { kind: "string", prop: "value" },
    size: S([240, 168], [240, 168]),
    style: { fill: "#ffffff", text: "#17171b", radius: 20, fontSize: 24, fontWeight: 600, border: "#ececf2" },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 140, height: 120 },
  },
  clock: {
    type: "clock",
    category: "time",
    label: "Часы",
    description: "Текущее время",
    icon: "clock",
    events: [],
    props: [{ key: "showSeconds", label: "Секунды", kind: "boolean", default: false }],
    value: { kind: "none", prop: null },
    size: S([200, 56], [200, 56]),
    style: { fill: "#ffffff", text: "#17171b", fontSize: 40, fontWeight: 600, align: "left" },
    styleFields: TEXT_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 60, height: 24 },
  },
  // ---- system -------------------------------------------------------------------
  notice: {
    type: "notice",
    category: "system",
    label: "Уведомление",
    description: "Сообщение на экране",
    icon: "bell",
    events: ["press"],
    props: [
      { key: "text", label: "Текст", kind: "text", max: 200, default: "Изменения сохранены" },
      {
        key: "tone",
        label: "Тон",
        kind: "select",
        options: [
          { value: "info", label: "Информация" },
          { value: "success", label: "Успех" },
          { value: "warning", label: "Внимание" },
          { value: "danger", label: "Ошибка" },
        ],
        default: "info",
      },
    ],
    value: { kind: "string", prop: "text" },
    size: S([334, 52], [420, 52]),
    style: { fill: "#efedff", text: "#3b2fc0", radius: 14, fontSize: 14 },
    styleFields: BOX_STYLE,
    constraints: { h: "left", v: "top" },
    minSize: { width: 80, height: 32 },
  },
  spinner: {
    type: "spinner",
    category: "system",
    label: "Индикатор загрузки",
    description: "Вращающийся круг",
    icon: "settings",
    events: [],
    props: [],
    value: { kind: "none", prop: null },
    size: S([32, 32], [32, 32]),
    style: { fill: "#6c5cff", text: "#6c5cff" },
    styleFields: ["fill", "opacity"],
    constraints: { h: "left", v: "top" },
    minSize: { width: 16, height: 16 },
  },
};

export const COMPONENT_TYPES = Object.keys(COMPONENTS) as ComponentType[];

export function isComponentType(v: unknown): v is ComponentType {
  return typeof v === "string" && v in COMPONENTS;
}

export const DEFAULT_STYLE: Style = {
  fill: "#ffffff",
  text: "#17171b",
  radius: 0,
  fontSize: 15,
  fontWeight: 400,
  align: "left",
  border: null,
  opacity: 1,
};

/** Components grouped by library category, in library order. */
export function componentsByCategory(): { category: ComponentCategory; label: string; items: ComponentSpec[] }[] {
  return COMPONENT_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: COMPONENT_TYPES.map((t) => COMPONENTS[t]).filter((c) => c.category === category),
  }));
}

/** Public contract of a component for AI agents: props, events, value. */
export function componentContract(type: ComponentType) {
  const c = COMPONENTS[type];
  return {
    type: c.type,
    category: c.category,
    label: c.label,
    events: c.events,
    value: c.value,
    props: c.props.map((p) => ({ key: p.key, kind: p.kind, label: p.label, default: p.default })),
  };
}
