import { describe, expect, it } from "vitest";
import {
  COMPONENTS,
  COMPONENT_TYPES,
  FormaError,
  applyBackendCommands,
  applyCommand,
  applyCommands,
  checkProject,
  commitHistory,
  componentsByCategory,
  createProject,
  diffBackend,
  findElement,
  parseBackendLayer,
  parseFrontendDocument,
  parseProject,
  redoHistory,
  runContractTests,
  sampleBackendCommands,
  sampleProject,
  startScreen,
  undoHistory,
  validateAgainst,
  type ComponentType,
  type Project,
} from "../src/index.js";

const mainId = (p: Project) => p.frontend.screens[0]!.id;
const add = (p: Project, component: ComponentType) => {
  const r = applyCommand(p, { type: "addElement", component, screenId: mainId(p) });
  return { p: r.project, id: r.selectedId! };
};

describe("project", () => {
  it("creates an app (never a site) with one main screen and both device frames", () => {
    const p = createProject("  Моё приложение ");
    expect(p.kind).toBe("app");
    expect(p.name).toBe("Моё приложение");
    expect(p.schemaVersion).toBe(2);
    expect(p.frontend.screens).toHaveLength(1);
    expect(p.frontend.screens[0]!.role).toBe("main");
    expect(p.settings.frames).toEqual({ phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } });
    expect(p.backend.operations).toEqual([]);
    expect(() => createProject("   ")).toThrow(FormaError);
  });

  it("every library component can be added, validated and round-tripped", () => {
    let p = createProject("Все компоненты");
    for (const t of COMPONENT_TYPES) {
      const r = applyCommand(p, { type: "addElement", component: t, screenId: mainId(p) });
      p = r.project;
      const n = findElement(p, r.selectedId!)!;
      expect(n.type).toBe(t);
      for (const d of ["phone", "desktop"] as const) {
        const l = n.layouts[d];
        expect(l.x % 8 === 0 || COMPONENTS[t].constraints.h === "stretch").toBe(true);
        expect(l.width).toBeGreaterThan(0);
      }
    }
    const again = parseProject(JSON.parse(JSON.stringify(p)), parseBackendLayer);
    // Server ids are UUIDs, which may start with a digit.
    expect(parseProject({ ...JSON.parse(JSON.stringify(p)), id: "41e9ce10-24c1-44f1-9a22-7560302a2620" }, parseBackendLayer).id).toBe("41e9ce10-24c1-44f1-9a22-7560302a2620");
    expect(again.frontend).toEqual(p.frontend);
    // 9 library categories including sounds: 8 component categories, none empty.
    expect(componentsByCategory().every((c) => c.items.length > 0)).toBe(true);
  });

  it("rejects broken documents with a path, drops unknown keys", () => {
    const p = createProject("X");
    const doc = JSON.parse(JSON.stringify({ name: p.name, settings: p.settings, frontend: p.frontend }));
    doc.frontend.screens[0].elements.push({ id: "b1", type: "button", layouts: { phone: { x: 0, y: 0, width: 10, height: 10 }, desktop: { x: 0, y: 0, width: 10, height: 10 } }, props: { label: 5 } });
    expect(() => parseFrontendDocument(doc)).toThrow(/текст/);
    doc.frontend.screens[0].elements[0].props = { label: "ok", evil: "<script>" };
    const parsed = parseFrontendDocument(doc);
    expect(parsed.frontend.screens[0]!.elements[0]!.props).toEqual({ label: "ok", variant: "primary" });
    doc.frontend.screens[0].elements[0].type = "website";
    expect(() => parseFrontendDocument(doc)).toThrow(/Неизвестный компонент/);
  });

  it("duplicate ids are refused", () => {
    const p = createProject("X");
    const { p: p2, id } = add(p, "button");
    const doc = JSON.parse(JSON.stringify({ name: p2.name, settings: p2.settings, frontend: p2.frontend }));
    doc.frontend.screens[0].elements.push({ ...doc.frontend.screens[0].elements[0] });
    expect(() => parseFrontendDocument(doc)).toThrow(/Повторяющийся/);
    expect(id).toBeTruthy();
  });

  it("migrates a Forma 0.1 project: buttons with sounds and transitions, shared menus", () => {
    const v1 = {
      schemaVersion: 1,
      id: "project_old",
      name: "Старый",
      type: "site",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      screens: [
        {
          id: "screen_a",
          name: "Главный экран",
          background: "#ffffff",
          frames: { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } },
          elements: [
            { id: "heading_1", kind: "heading", name: "Заголовок", text: "Привет", layouts: { phone: { x: 28, y: 48, width: 334, height: 44 }, desktop: { x: 80, y: 64, width: 900, height: 54 } }, style: { fill: "#ffffff", textColor: "#24222b", radius: 0, fontSize: 28 }, actions: [] },
            { id: "button_1", kind: "button", name: "Кнопка 1", text: "Дальше", layouts: { phone: { x: 28, y: 120, width: 334, height: 52 }, desktop: { x: 80, y: 140, width: 240, height: 52 } }, style: { fill: "#8060e9", textColor: "#ffffff", radius: 14, fontSize: 16 }, actions: [{ id: "action_1", event: "press", type: "playSound", resourceId: "res_1" }], navigateTo: "screen_b" },
            { id: "bottomNav_1", kind: "bottomNav", name: "Нижнее меню", text: "Старый", layouts: { phone: { x: 12, y: 756, width: 366, height: 64 }, desktop: { x: 12, y: 712, width: 1256, height: 64 } }, style: { fill: "#ffffff", textColor: "#27242f", radius: 22, fontSize: 12 }, actions: [], items: [{ id: "n1", label: "Главная", screenId: "screen_a" }, { id: "n2", label: "Чаты", screenId: "screen_b" }] },
          ],
        },
        { id: "screen_b", name: "Чаты", background: "#ffffff", frames: { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } }, elements: [] },
      ],
      resources: [{ id: "res_1", name: "Soft ping", type: "audio", file: "audio/voidex/soft-ping.wav", previewFile: "audio/preview/soft-ping.mp3", origin: "voidex-original", sha256: "x" }],
      settings: { device: "phone", views: {} },
    };
    const p = parseProject(v1, parseBackendLayer);
    expect(p.kind).toBe("app");
    expect(p.frontend.shared.map((n) => n.type)).toEqual(["bottomNav"]);
    const b = findElement(p, "button_1")!;
    expect(b.props.label).toBe("Дальше");
    expect(b.style.fill).toBe("#8060e9");
    expect(b.events.press!.map((a) => a.type)).toEqual(["playSound", "navigate"]);
    expect(p.frontend.resources[0]!.libraryId).toBe("soft-ping");
    expect((findElement(p, "bottomNav_1")!.props.items as { icon: string }[]).map((i) => i.icon)).toEqual(["home", "chat"]);
  });
});

describe("commands", () => {
  it("adding the bottom menu creates its sections as screens, stored once as shared", () => {
    const p0 = createProject("Меню");
    const { p } = add(p0, "bottomNav");
    expect(p.frontend.shared).toHaveLength(1);
    expect(p.frontend.screens.map((s) => s.name)).toEqual(["Главный экран", "Поиск", "Уведомления", "Чаты", "Профиль"]);
    expect(() => add(p, "bottomNav")).toThrow(/уже есть/);
  });

  it("a batch is atomic", () => {
    const p = createProject("X");
    expect(() =>
      applyCommands(p, [
        { type: "addElement", component: "button", screenId: mainId(p) },
        { type: "updateElement", id: "nope", name: "x" },
      ]),
    ).toThrow(FormaError);
    expect(p.frontend.screens[0]!.elements).toHaveLength(0);
  });

  it("layout per device, snapped and kept inside the frame; copy phone -> desktop", () => {
    const { p, id } = add(createProject("X"), "button");
    const r = applyCommand(p, { type: "setLayout", id, device: "phone", layout: { x: 5000, width: 20 } });
    const l = findElement(r.project, id)!.layouts.phone;
    expect(l.width).toBe(48);
    expect(l.x).toBe(390 - 48);
    expect(findElement(r.project, id)!.layouts.desktop).toEqual(findElement(p, id)!.layouts.desktop);
    const c = applyCommand(r.project, { type: "copyLayout", id, from: "phone", to: "desktop" });
    expect(findElement(c.project, id)!.layouts.desktop.x).toBeGreaterThan(l.x);
  });

  it("events: actions must point at existing things; deleting a screen cleans references", () => {
    let p = createProject("X");
    p = applyCommand(p, { type: "addScreen", name: "Второй" }).project;
    const second = p.frontend.screens[1]!.id;
    const { p: p2, id } = add(p, "button");
    expect(() => applyCommand(p2, { type: "setEvent", id, event: "press", actions: [{ id: "a1", type: "navigate", screenId: "screen_none" }] })).toThrow(/не найден/);
    expect(() => applyCommand(p2, { type: "setEvent", id, event: "change", actions: [] })).toThrow(/не поддерживает/);
    const p3 = applyCommand(p2, { type: "setEvent", id, event: "press", actions: [{ id: "a1", type: "navigate", screenId: second }, { id: "a2", type: "showToast", text: "Готово" }] }).project;
    const p4 = applyCommand(p3, { type: "deleteScreen", id: second }).project;
    expect(findElement(p4, id)!.events.press!.map((a) => a.type)).toEqual(["showToast"]);
  });

  it("sounds: one resource per library sound, assigned to an event, removed with its actions", () => {
    const { p, id } = add(createProject("X"), "button");
    const res = { id: "s1", name: "Ping", kind: "audio", libraryId: "soft-ping", file: "audio/preview/soft-ping.mp3", sha256: "", durationMs: 500 };
    const p2 = applyCommand(p, { type: "addResource", resource: res, assignTo: { id, event: "press" } }).project;
    const p3 = applyCommand(p2, { type: "addResource", resource: { ...res, id: "s2" }, assignTo: { id, event: "press" } }).project;
    expect(p3.frontend.resources).toHaveLength(1);
    expect(findElement(p3, id)!.events.press).toHaveLength(1);
    expect(() => applyCommand(p, { type: "addResource", resource: { ...res, file: "../../etc/passwd" } })).toThrow(/путь/);
    const p4 = applyCommand(p3, { type: "removeResource", id: "s1" }).project;
    expect(findElement(p4, id)!.events.press).toBeUndefined();
  });

  it("undo / redo restore the frontend and keep the server's backend", () => {
    const p = createProject("X");
    let h = { past: [], present: p, future: [] } as Parameters<typeof undoHistory>[0];
    const { p: p2 } = add(p, "button");
    h = commitHistory(h, p2);
    const withBackend = applyBackendCommands(h.present, sampleOp(), "agent");
    h = { ...h, present: withBackend };
    const u = undoHistory(h);
    expect(u.present.frontend.screens[0]!.elements).toHaveLength(0);
    expect(u.present.backend.operations).toHaveLength(1);
    expect(redoHistory(u).present.frontend.screens[0]!.elements).toHaveLength(1);
  });
});

function sampleOp() {
  return [
    {
      type: "upsertOperation" as const,
      operation: {
        name: "auth.login",
        input: {
          fields: [
            { name: "phone", type: "string", required: true, pattern: "^\\+?[0-9 ()-]{6,20}$" },
            { name: "password", type: "string", required: true, min: 8 },
          ],
        },
        output: { fields: [{ name: "userName", type: "string", required: true }] },
        errors: [{ code: "invalid_credentials", message: "Неверный телефон или пароль." }],
        handler: { language: "javascript", source: "export default async () => ({ userName: 'x' })" },
        tests: [{ name: "ok", input: { phone: "+79000000000", password: "12345678" }, expect: { ok: true, output: { userName: "A" } } }],
      },
    },
  ];
}

describe("backend contracts and bindings", () => {
  it("contracts validate values on every side", () => {
    const p = applyBackendCommands(createProject("X"), sampleOp(), "Claude Code");
    const op = p.backend.operations[0]!;
    expect(op.updatedBy).toBe("Claude Code");
    expect(validateAgainst(op.input, { phone: "+7 900", password: "123" }).map((i) => i.code).sort()).toEqual(["min", "pattern"]);
    expect(validateAgainst(op.input, { phone: "+79000000000", password: "12345678" })).toEqual([]);
    expect(validateAgainst(op.input, { phone: "+79000000000", password: "12345678", admin: true })[0]!.code).toBe("unknown");
    expect(() => applyBackendCommands(p, [{ type: "upsertOperation", operation: { name: "Bad Name" } }], "x")).toThrow(/Имя операции/);
    expect(() => applyBackendCommands(p, [{ type: "upsertOperation", operation: { name: "big.op", handler: { language: "javascript", source: "x".repeat(70_000) } } }], "x")).toThrow(/64/);
  });

  it("the sample app wires a button to demo.greet with no check errors", () => {
    const fe = sampleProject();
    expect(fe.frontend.screens.map((s) => s.name)).toEqual(["Главный экран", "Настройки"]);
    const p = applyBackendCommands(fe, sampleBackendCommands(fe), "agent");
    expect(checkProject(p).filter((d) => d.level === "error")).toEqual([]);
    const reports = runContractTests(p);
    expect(reports).toHaveLength(2);
    expect(reports.every((r) => r.contract === "passed" && r.executed === false && r.reason === "sandbox_unavailable")).toBe(true);
    expect(diffBackend(fe, p)).toEqual(["+ операция demo.greet", expect.stringContaining("+ привязка")]);
  });

  it("check finds broken wiring: missing operation, unmapped field, type mismatch, deleted element", () => {
    const fe = sampleProject();
    let p = applyBackendCommands(fe, sampleBackendCommands(fe), "agent");
    const toggle = p.frontend.screens[1]!.elements.find((e) => e.type === "toggle")!;
    p = applyBackendCommands(p, [{ type: "upsertBinding", binding: { ...p.bindings[0], input: { name: { from: "element", elementId: toggle.id } } } }], "agent");
    expect(checkProject(p).map((d) => d.code)).toContain("type_mismatch");
    p = applyBackendCommands(p, [{ type: "upsertBinding", binding: { ...p.bindings[0], input: {} } }], "agent");
    expect(checkProject(p).map((d) => d.code)).toContain("unmapped_field");
    p = applyBackendCommands(p, [{ type: "deleteOperation", name: "demo.greet" }], "agent");
    expect(checkProject(p).map((d) => d.code)).toContain("missing_operation");
    const button = p.bindings[0]!.elementId;
    p = applyCommand(p, { type: "deleteElement", id: button }).project;
    expect(checkProject(p).map((d) => d.code)).toContain("missing_element");
  });

  it("a binding must target an event the component has", () => {
    const fe = sampleProject();
    const heading = fe.frontend.screens[0]!.elements.find((e) => e.type === "heading")!;
    expect(() => applyBackendCommands(fe, [{ type: "upsertBinding", binding: { elementId: heading.id, event: "press", operation: "demo.greet" } }], "x")).toThrow(/не поддерживает/);
  });

  it("start screen: registration first, then the chosen start screen", () => {
    let p = createProject("X");
    p = applyCommand(p, { type: "addScreen", name: "Второй" }).project;
    p = applyCommand(p, { type: "setStartScreen", id: p.frontend.screens[1]!.id }).project;
    expect(startScreen(p).name).toBe("Второй");
    p = applyCommand(p, { type: "addScreen", name: "Регистрация", role: "registration" }).project;
    expect(startScreen(p).name).toBe("Регистрация");
    expect(startScreen(p).hideShared).toBe(true);
  });
});
