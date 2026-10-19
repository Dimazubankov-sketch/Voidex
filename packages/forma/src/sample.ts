import { applyCommands, type Command } from "./commands.js";
import { createProject, findElement } from "./project.js";
import type { BackendCommand } from "./backend.js";
import type { ComponentType, Project } from "./types.js";

/**
 * The Forma example app (MVP check): a main screen with search, a list, a
 * timer with a sound and a greeting form; a settings screen; a bottom menu
 * between them. Built with the same commands as the editor.
 */
export function sampleProject(name = "Пример приложения"): Project {
  let p = createProject(name);
  const main = p.frontend.screens[0]!.id;
  const step = (cmds: Command[]) => {
    const r = applyCommands(p, cmds);
    p = r.project;
    return r;
  };
  const add = (component: ComponentType, screenId: string) => step([{ type: "addElement", component, screenId }]).selectedId!;

  step([{ type: "addScreen", name: "Настройки", role: "settings" }]);
  const settings = p.frontend.screens[1]!.id;

  // Main screen
  const heading = add("heading", main);
  const search = add("searchField", main);
  const list = add("list", main);
  const timer = add("timer", main);
  const nameInput = add("textInput", main);
  const greet = add("button", main);
  const result = add("text", main);
  step([
    { type: "updateElement", id: heading, props: { text: "Привет!" } },
    { type: "updateElement", id: search, name: "Поиск", props: { placeholder: "Найти в приложении" } },
    {
      type: "updateElement",
      id: list,
      name: "Подборка",
      props: {
        items: [
          { id: "item_news", title: "Новости", subtitle: "Что нового сегодня", icon: "bell" },
          { id: "item_music", title: "Музыка", subtitle: "Плейлист дня", icon: "music" },
        ],
      },
    },
    { type: "updateElement", id: timer, name: "Таймер", props: { seconds: 10 } },
    { type: "updateElement", id: nameInput, name: "Имя", props: { label: "Ваше имя", placeholder: "Например, Анна" } },
    { type: "updateElement", id: greet, name: "Поздороваться", props: { label: "Поздороваться" } },
    { type: "updateElement", id: result, name: "Ответ сервера", props: { text: "" } },
    {
      type: "addResource",
      resource: { id: "sound_ping", name: "Мягкий сигнал", kind: "audio", libraryId: "soft-ping", file: "audio/preview/soft-ping.mp3", sha256: "", durationMs: 600 },
      assignTo: { id: timer, event: "finish" },
    },
    { type: "setEvent", id: timer, event: "finish", actions: [{ id: "a_ping", type: "playSound", resourceId: "sound_ping" }, { id: "a_toast", type: "showToast", text: "Время вышло" }] },
  ]);

  // A tidy layout on both devices: one column on the phone, two on the computer.
  const place = (id: string, phone: [number, number, number, number], desktop: [number, number, number, number]): Command[] => [
    { type: "setLayout", id, device: "phone", layout: { x: phone[0], y: phone[1], width: phone[2], height: phone[3] } },
    { type: "setLayout", id, device: "desktop", layout: { x: desktop[0], y: desktop[1], width: desktop[2], height: desktop[3] } },
  ];
  step([
    ...place(heading, [28, 64, 334, 44], [80, 64, 520, 54]),
    ...place(search, [28, 120, 334, 44], [80, 136, 520, 44]),
    ...place(list, [28, 176, 334, 136], [80, 200, 520, 136]),
    ...place(timer, [28, 328, 334, 136], [680, 64, 520, 168]),
    ...place(nameInput, [28, 480, 334, 72], [680, 256, 520, 72]),
    ...place(greet, [28, 568, 334, 52], [680, 344, 240, 48]),
    ...place(result, [28, 632, 334, 48], [680, 408, 520, 48]),
  ]);

  // Settings screen
  const title = add("heading", settings);
  const notify = add("toggle", settings);
  const sounds = add("toggle", settings);
  const volume = add("slider", settings);
  step([
    { type: "updateElement", id: title, props: { text: "Настройки" } },
    { type: "updateElement", id: notify, name: "Уведомления", props: { label: "Уведомления", value: true } },
    { type: "updateElement", id: sounds, name: "Звуки", props: { label: "Звуки", value: true } },
    { type: "updateElement", id: volume, name: "Громкость", props: { label: "Громкость", value: 70 } },
  ]);

  // Bottom menu between the two screens
  const nav = add("bottomNav", main);
  step([
    {
      type: "updateElement",
      id: nav,
      props: {
        items: [
          { id: "nav_main", label: "Главная", icon: "home", screenId: main },
          { id: "nav_settings", label: "Настройки", icon: "settings", screenId: settings },
        ],
      },
    },
  ]);
  // The bottom menu created its standard sections; the example keeps only its two screens.
  const keep = new Set([main, settings]);
  for (const s of [...p.frontend.screens]) if (!keep.has(s.id)) p = applyCommands(p, [{ type: "deleteScreen", id: s.id }]).project;
  return p;
}

/** What an AI agent does for the example: the `demo.greet` operation and its binding to the button. */
export function sampleBackendCommands(p: Project): BackendCommand[] {
  const main = p.frontend.screens[0]!;
  const byName = (n: string) => main.elements.find((e) => e.name === n)?.id ?? "";
  const button = byName("Поздороваться");
  if (!findElement(p, button)) throw new Error("sample project expected");
  return [
    {
      type: "upsertOperation",
      operation: {
        name: "demo.greet",
        description: "Возвращает приветствие для имени из формы.",
        input: { fields: [{ name: "name", type: "string", required: true, min: 1, max: 40 }] },
        output: { fields: [{ name: "message", type: "string", required: true }] },
        errors: [{ code: "empty_name", message: "Введите имя." }],
        handler: {
          language: "javascript",
          source: [
            "export default async function handler(input) {",
            "  const name = input.name.trim();",
            "  if (!name) return { error: 'empty_name' };",
            "  return { message: `Привет, ${name}!` };",
            "}",
          ].join("\n"),
        },
        tests: [
          { name: "Приветствие", input: { name: "Анна" }, expect: { ok: true, output: { message: "Привет, Анна!" } } },
          { name: "Пустое имя", input: { name: " " }, expect: { ok: false, error: "empty_name" } },
        ],
      },
    },
    {
      type: "upsertBinding",
      binding: {
        id: "binding_greet",
        elementId: button,
        event: "press",
        operation: "demo.greet",
        input: { name: { from: "element", elementId: byName("Имя") } },
        output: { targetId: byName("Ответ сервера"), field: "message" },
        loading: { disable: true, text: "Отправка..." },
        errorTargetId: byName("Ответ сервера"),
        onSuccess: [],
        onError: [],
      },
    },
  ];
}
