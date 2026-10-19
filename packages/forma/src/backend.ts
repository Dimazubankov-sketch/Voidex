import { COMPONENTS } from "./components.js";
import { allElements, findElement, findScreen, parseActions } from "./project.js";
import type { Action, Backend, Binding, Contract, ContractField, EventName, InputSource, Operation, OperationTest, Project } from "./types.js";
import { FormaError, arr, bool, clone, id, isRecord, nowIso, num, oneOf, str, uid, utf8Bytes } from "./util.js";

export const BACKEND_LIMITS = {
  operations: 100,
  bindings: 300,
  fields: 40,
  sourceBytes: 64_000,
  tests: 20,
  errors: 20,
} as const;

/** `auth.login`, `notes.list`, `demo.greet`: dotted lowerCamel segments. */
export const OPERATION_NAME_RE = /^[a-z][a-zA-Z0-9]{0,39}(\.[a-z][a-zA-Z0-9]{0,39}){0,3}$/;
const FIELD_NAME_RE = /^[a-z][a-zA-Z0-9_]{0,39}$/;
const ERROR_CODE_RE = /^[a-z][a-z0-9_]{0,47}$/;

// ---------------------------------------------------------------------------
// Contracts

export function parseContract(v: unknown, path: string): Contract {
  if (!isRecord(v)) throw new FormaError("Контракт: объект с полями.", path);
  const names = new Set<string>();
  const fields = arr(v.fields ?? [], `${path}.fields`, BACKEND_LIMITS.fields).map((f, i): ContractField => {
    const fp = `${path}.fields.${i}`;
    if (!isRecord(f)) throw new FormaError("Некорректное поле контракта.", fp);
    const name = str(f.name, `${fp}.name`, 40);
    if (!FIELD_NAME_RE.test(name)) throw new FormaError("Имя поля: латиница, цифры и _ с маленькой буквы.", `${fp}.name`);
    if (names.has(name)) throw new FormaError("Поле контракта повторяется.", `${fp}.name`);
    names.add(name);
    const field: ContractField = { name, type: oneOf(f.type, ["string", "number", "boolean", "string[]"], `${fp}.type`), required: f.required === undefined ? true : bool(f.required, `${fp}.required`) };
    if (f.description !== undefined) field.description = str(f.description, `${fp}.description`, 200);
    if (f.min !== undefined) field.min = num(f.min, `${fp}.min`, -1e12, 1e12);
    if (f.max !== undefined) field.max = num(f.max, `${fp}.max`, -1e12, 1e12);
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) throw new FormaError("min больше max.", `${fp}.min`);
    if (f.pattern !== undefined) {
      field.pattern = str(f.pattern, `${fp}.pattern`, 200);
      try {
        new RegExp(field.pattern, "u");
      } catch {
        throw new FormaError("Некорректное регулярное выражение.", `${fp}.pattern`);
      }
    }
    if (f.enum !== undefined) field.enum = arr(f.enum, `${fp}.enum`, 50).map((e, j) => str(e, `${fp}.enum.${j}`, 80));
    return field;
  });
  return { fields };
}

export interface ContractIssue {
  field: string;
  code: "required" | "type" | "min" | "max" | "pattern" | "enum" | "unknown";
  message: string;
}

/** Checks a value against a contract (the same rules on the client, the server and in tests). */
export function validateAgainst(contract: Contract, value: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!isRecord(value)) return [{ field: "", code: "type", message: "Ожидается объект." }];
  const known = new Set(contract.fields.map((f) => f.name));
  for (const key of Object.keys(value)) if (!known.has(key)) issues.push({ field: key, code: "unknown", message: "Поле не описано в контракте." });
  for (const f of contract.fields) {
    const v = value[f.name];
    if (v === undefined || v === null || v === "") {
      if (f.required) issues.push({ field: f.name, code: "required", message: "Обязательное поле." });
      continue;
    }
    const typeOk = f.type === "string[]" ? Array.isArray(v) && v.every((x) => typeof x === "string") : f.type === "number" ? typeof v === "number" && Number.isFinite(v) : typeof v === f.type;
    if (!typeOk) {
      issues.push({ field: f.name, code: "type", message: `Ожидается ${TYPE_LABEL[f.type]}.` });
      continue;
    }
    const size = typeof v === "number" ? v : typeof v === "string" ? v.length : (v as unknown[]).length;
    if (f.min !== undefined && size < f.min) issues.push({ field: f.name, code: "min", message: typeof v === "number" ? `Не меньше ${f.min}.` : `Не короче ${f.min}.` });
    if (f.max !== undefined && size > f.max) issues.push({ field: f.name, code: "max", message: typeof v === "number" ? `Не больше ${f.max}.` : `Не длиннее ${f.max}.` });
    if (f.pattern && typeof v === "string" && !new RegExp(f.pattern, "u").test(v)) issues.push({ field: f.name, code: "pattern", message: "Неверный формат." });
    if (f.enum && typeof v === "string" && !f.enum.includes(v)) issues.push({ field: f.name, code: "enum", message: "Недопустимое значение." });
  }
  return issues;
}

const TYPE_LABEL: Record<ContractField["type"], string> = { string: "текст", number: "число", boolean: "да или нет", "string[]": "список строк" };

// ---------------------------------------------------------------------------
// Operations

function parseTest(v: unknown, path: string): OperationTest {
  if (!isRecord(v)) throw new FormaError("Некорректный тест.", path);
  const expect = isRecord(v.expect) ? v.expect : {};
  if (!isRecord(v.input)) throw new FormaError("input теста: объект.", `${path}.input`);
  const ok = bool(expect.ok, `${path}.expect.ok`);
  return {
    name: str(v.name, `${path}.name`, 80, { min: 1 }),
    input: clone(v.input),
    expect: ok ? { ok: true, output: isRecord(expect.output) ? clone(expect.output) : {} } : { ok: false, error: str(expect.error, `${path}.expect.error`, 48, { min: 1 }) },
  };
}

export function parseOperation(v: unknown, path: string, by: string, prev?: Operation): Operation {
  if (!isRecord(v)) throw new FormaError("Некорректная операция.", path);
  const name = str(v.name, `${path}.name`, 120);
  if (!OPERATION_NAME_RE.test(name)) throw new FormaError("Имя операции вида auth.login (латиница, через точку).", `${path}.name`);
  const handler = isRecord(v.handler) ? v.handler : { language: "javascript", source: v.source ?? "" };
  const source = str(handler.source, `${path}.handler.source`, BACKEND_LIMITS.sourceBytes);
  if (utf8Bytes(source) > BACKEND_LIMITS.sourceBytes) throw new FormaError("Код операции больше 64 КБ.", `${path}.handler.source`);
  const errors = arr(v.errors ?? [], `${path}.errors`, BACKEND_LIMITS.errors).map((e, i) => {
    if (!isRecord(e)) throw new FormaError("Некорректная ошибка.", `${path}.errors.${i}`);
    const code = str(e.code, `${path}.errors.${i}.code`, 48);
    if (!ERROR_CODE_RE.test(code)) throw new FormaError("Код ошибки: латиница в нижнем регистре.", `${path}.errors.${i}.code`);
    return { code, message: str(e.message, `${path}.errors.${i}.message`, 200, { min: 1 }) };
  });
  return {
    id: prev?.id ?? (v.id === undefined ? uid("op") : id(v.id, `${path}.id`)),
    name,
    description: str(v.description ?? "", `${path}.description`, 1000),
    input: parseContract(v.input ?? { fields: [] }, `${path}.input`),
    output: parseContract(v.output ?? { fields: [] }, `${path}.output`),
    errors,
    handler: { language: oneOf(handler.language ?? "javascript", ["javascript"], `${path}.handler.language`), source },
    tests: arr(v.tests ?? [], `${path}.tests`, BACKEND_LIMITS.tests).map((t, i) => parseTest(t, `${path}.tests.${i}`)),
    // Stored operations keep their stamp; an agent write stamps who and when.
    updatedAt: by ? nowIso() : typeof v.updatedAt === "string" && Number.isFinite(Date.parse(v.updatedAt)) ? v.updatedAt : nowIso(),
    updatedBy: by ? by.slice(0, 80) : typeof v.updatedBy === "string" ? v.updatedBy.slice(0, 80) : "",
  };
}

export function parseBackend(v: unknown, path = "backend"): Backend {
  const b = isRecord(v) ? v : {};
  const operations = arr(b.operations ?? [], `${path}.operations`, BACKEND_LIMITS.operations).map((o, i) => parseOperation(o, `${path}.operations.${i}`, ""));
  const names = new Set<string>();
  for (const o of operations) {
    if (names.has(o.name)) throw new FormaError("Имя операции повторяется.", o.name);
    names.add(o.name);
  }
  return { runtime: "sandbox-pending", operations };
}

// ---------------------------------------------------------------------------
// Bindings

function parseInputSource(v: unknown, path: string): InputSource {
  if (!isRecord(v)) throw new FormaError("Источник поля: элемент или константа.", path);
  if (v.from === "element") return { from: "element", elementId: id(v.elementId, `${path}.elementId`) };
  if (v.from === "const") {
    const value = v.value;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new FormaError("Константа: текст, число или да/нет.", `${path}.value`);
    if (typeof value === "string") str(value, `${path}.value`, 1000);
    return { from: "const", value };
  }
  throw new FormaError("Источник поля: element или const.", `${path}.from`);
}

const EVENTS: EventName[] = ["press", "change", "submit", "itemPress", "confirm", "cancel", "finish"];

export function parseBinding(v: unknown, path: string): Binding {
  if (!isRecord(v)) throw new FormaError("Некорректная привязка.", path);
  const input: Record<string, InputSource> = {};
  if (v.input !== undefined) {
    if (!isRecord(v.input)) throw new FormaError("input: объект поле -> источник.", `${path}.input`);
    const entries = Object.entries(v.input);
    if (entries.length > BACKEND_LIMITS.fields) throw new FormaError("Слишком много полей.", `${path}.input`);
    for (const [k, src] of entries) {
      if (!FIELD_NAME_RE.test(k)) throw new FormaError("Некорректное имя поля.", `${path}.input.${k}`);
      input[k] = parseInputSource(src, `${path}.input.${k}`);
    }
  }
  const output = isRecord(v.output) ? { targetId: id(v.output.targetId, `${path}.output.targetId`), field: str(v.output.field, `${path}.output.field`, 40, { min: 1 }) } : null;
  const loading = isRecord(v.loading) ? v.loading : {};
  const operation = str(v.operation, `${path}.operation`, 120);
  if (!OPERATION_NAME_RE.test(operation)) throw new FormaError("Некорректное имя операции.", `${path}.operation`);
  return {
    id: v.id === undefined ? uid("binding") : id(v.id, `${path}.id`),
    elementId: id(v.elementId, `${path}.elementId`),
    event: oneOf(v.event, EVENTS, `${path}.event`),
    operation,
    input,
    output,
    loading: { disable: loading.disable === undefined ? true : bool(loading.disable, `${path}.loading.disable`), text: str(loading.text ?? "", `${path}.loading.text`, 40) },
    errorTargetId: v.errorTargetId === undefined || v.errorTargetId === null ? null : id(v.errorTargetId, `${path}.errorTargetId`),
    onSuccess: v.onSuccess === undefined ? [] : parseActions(v.onSuccess, `${path}.onSuccess`),
    onError: v.onError === undefined ? [] : parseActions(v.onError, `${path}.onError`),
  };
}

export function parseBindings(v: unknown, path = "bindings"): Binding[] {
  const list = arr(v ?? [], path, BACKEND_LIMITS.bindings).map((b, i) => parseBinding(b, `${path}.${i}`));
  const ids = new Set<string>();
  for (const b of list) {
    if (ids.has(b.id)) throw new FormaError("Повторяющийся идентификатор привязки.", b.id);
    ids.add(b.id);
  }
  return list;
}

/** The backend layer of a stored project (used by parseProject). */
export function parseBackendLayer(v: Record<string, unknown>): Pick<Project, "backend" | "bindings"> {
  return { backend: parseBackend(v.backend), bindings: parseBindings(v.bindings) };
}

// ---------------------------------------------------------------------------
// Agent commands: the only way the backend layer and bindings change.

export type BackendCommand =
  | { type: "upsertOperation"; operation: unknown }
  | { type: "deleteOperation"; name: string }
  | { type: "upsertBinding"; binding: unknown }
  | { type: "deleteBinding"; id: string };

export function applyBackendCommand(input: Project, cmd: BackendCommand, by: string): Project {
  if (!isRecord(cmd)) throw new FormaError("Некорректная команда.");
  const p = clone(input);
  switch (cmd.type) {
    case "upsertOperation": {
      const raw = isRecord(cmd.operation) ? cmd.operation : {};
      const prev = p.backend.operations.find((o) => o.name === raw.name);
      const op = parseOperation(cmd.operation, "operation", by || "agent", prev);
      if (prev) p.backend.operations = p.backend.operations.map((o) => (o.name === op.name ? op : o));
      else {
        if (p.backend.operations.length >= BACKEND_LIMITS.operations) throw new FormaError("Слишком много операций.");
        p.backend.operations.push(op);
      }
      break;
    }
    case "deleteOperation": {
      if (!p.backend.operations.some((o) => o.name === cmd.name)) throw new FormaError("Операция не найдена.", cmd.name, "not_found");
      p.backend.operations = p.backend.operations.filter((o) => o.name !== cmd.name);
      break;
    }
    case "upsertBinding": {
      const b = parseBinding(cmd.binding, "binding");
      const el = findElement(p, b.elementId);
      if (!el) throw new FormaError("Элемент привязки не найден.", "binding.elementId", "not_found");
      if (!COMPONENTS[el.type].events.includes(b.event)) throw new FormaError(`${COMPONENTS[el.type].label} не поддерживает событие ${b.event}.`, "binding.event");
      const i = p.bindings.findIndex((x) => x.id === b.id);
      if (i >= 0) p.bindings[i] = b;
      else {
        if (p.bindings.length >= BACKEND_LIMITS.bindings) throw new FormaError("Слишком много привязок.");
        p.bindings.push(b);
      }
      break;
    }
    case "deleteBinding": {
      if (!p.bindings.some((b) => b.id === cmd.id)) throw new FormaError("Привязка не найдена.", cmd.id, "not_found");
      p.bindings = p.bindings.filter((b) => b.id !== cmd.id);
      break;
    }
    default:
      throw new FormaError("Неизвестная команда.", "type", "unknown_command");
  }
  p.updatedAt = nowIso();
  return p;
}

export function applyBackendCommands(p: Project, commands: BackendCommand[], by: string): Project {
  if (!Array.isArray(commands) || !commands.length || commands.length > 50) throw new FormaError("Допускается от 1 до 50 команд за раз.");
  let out = p;
  for (const [i, c] of commands.entries()) {
    try {
      out = applyBackendCommand(out, c, by);
    } catch (e) {
      if (e instanceof FormaError) throw new FormaError(e.message, `commands.${i}${e.path ? "." + e.path : ""}`, e.code);
      throw e;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks: what an agent (and the person) can run at any time. Nothing executes.

export interface Diagnostic {
  level: "error" | "warning";
  code: string;
  message: string;
  path: string;
}

/** Optional syntax checker for handler source (the server passes a parser; the browser does not). */
export type SyntaxChecker = (source: string) => string | null;

const VALUE_TYPE: Record<string, ContractField["type"] | null> = { string: "string", number: "number", boolean: "boolean", none: null };

export function checkProject(p: Project, syntax?: SyntaxChecker): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (level: Diagnostic["level"], code: string, message: string, path: string) => out.push({ level, code, message, path });
  const ops = new Map(p.backend.operations.map((o) => [o.name, o]));

  for (const o of p.backend.operations) {
    const path = `backend.operations.${o.name}`;
    if (!o.handler.source.trim()) add("warning", "empty_handler", "У операции нет кода.", `${path}.handler`);
    else if (syntax) {
      const err = syntax(o.handler.source);
      if (err) add("error", "syntax", `Синтаксическая ошибка: ${err}`, `${path}.handler`);
    }
    if (!o.tests.length) add("warning", "no_tests", "У операции нет тестов контракта.", `${path}.tests`);
    for (const t of o.tests) {
      for (const i of validateAgainst(o.input, t.input)) add("error", "test_input", `Тест «${t.name}»: ${i.field || "input"}: ${i.message}`, `${path}.tests`);
      if (t.expect.ok) for (const i of validateAgainst(o.output, t.expect.output)) add("error", "test_output", `Тест «${t.name}»: ${i.field || "output"}: ${i.message}`, `${path}.tests`);
      else if (!o.errors.some((e) => e.code === (t.expect as { error: string }).error)) add("error", "test_error", `Тест «${t.name}»: ошибка ${(t.expect as { error: string }).error} не описана.`, `${path}.tests`);
    }
  }

  const validActions = (actions: Action[], path: string) => {
    for (const a of actions) {
      if (a.type === "navigate" && !findScreen(p, a.screenId)) add("error", "missing_screen", "Экран перехода не найден.", path);
      if ("targetId" in a && !findElement(p, a.targetId)) add("error", "missing_target", "Целевой элемент не найден.", path);
      if (a.type === "playSound" && !p.frontend.resources.some((r) => r.id === a.resourceId)) add("error", "missing_sound", "Звук не найден в ресурсах.", path);
    }
  };

  for (const b of p.bindings) {
    const path = `bindings.${b.id}`;
    const el = findElement(p, b.elementId);
    const op = ops.get(b.operation);
    if (!el) add("error", "missing_element", "Элемент привязки удалён из интерфейса.", path);
    else if (!COMPONENTS[el.type].events.includes(b.event)) add("error", "bad_event", `У компонента «${el.name}» нет события ${b.event}.`, path);
    if (!op) {
      add("error", "missing_operation", `Операция ${b.operation} не создана.`, path);
      continue;
    }
    for (const f of op.input.fields) {
      const src = b.input[f.name];
      if (!src) {
        if (f.required) add("error", "unmapped_field", `Поле ${f.name} операции не связано с интерфейсом.`, path);
        continue;
      }
      if (src.from === "element") {
        const s = findElement(p, src.elementId);
        if (!s) add("error", "missing_source", `Источник поля ${f.name} удалён.`, path);
        else {
          const kind = VALUE_TYPE[COMPONENTS[s.type].value.kind];
          if (!kind) add("error", "no_value", `Компонент «${s.name}» не даёт значения для поля ${f.name}.`, path);
          else if (kind !== f.type) add("error", "type_mismatch", `Поле ${f.name}: ${f.type}, а «${s.name}» даёт ${kind}.`, path);
        }
      } else if (typeof src.value !== (f.type === "string[]" ? "object" : f.type)) add("error", "type_mismatch", `Константа поля ${f.name} не ${f.type}.`, path);
    }
    for (const k of Object.keys(b.input)) if (!op.input.fields.some((f) => f.name === k)) add("warning", "extra_field", `Поле ${k} не описано во входе операции.`, path);
    if (b.output) {
      if (!findElement(p, b.output.targetId)) add("error", "missing_target", "Элемент для результата не найден.", path);
      if (!op.output.fields.some((f) => f.name === b.output!.field)) add("error", "missing_output", `Поля ${b.output.field} нет в ответе операции.`, path);
    }
    if (b.errorTargetId && !findElement(p, b.errorTargetId)) add("error", "missing_target", "Элемент для ошибки не найден.", path);
    validActions(b.onSuccess, `${path}.onSuccess`);
    validActions(b.onError, `${path}.onError`);
  }

  for (const n of allElements(p)) for (const [ev, list] of Object.entries(n.events)) validActions(list ?? [], `frontend.${n.id}.events.${ev}`);
  return out;
}

export interface TestReport {
  operation: string;
  test: string;
  /** Contract checks of the test passed. */
  contract: "passed" | "failed";
  /** Whether the handler ran: never, until the isolated runtime exists. */
  executed: false;
  reason: "sandbox_unavailable";
  issues: string[];
}

/**
 * Runs the allowed tests: the contract half of every operation test (input
 * and expected output against the contracts, error codes declared). The
 * handler itself is not executed: Forma has no isolated runtime yet, and
 * agent-written code never runs inside the Voidex server process.
 */
export function runContractTests(p: Project, only?: string): TestReport[] {
  const reports: TestReport[] = [];
  for (const o of p.backend.operations) {
    if (only && o.name !== only) continue;
    for (const t of o.tests) {
      const issues = [
        ...validateAgainst(o.input, t.input).map((i) => `input.${i.field}: ${i.message}`),
        ...(t.expect.ok
          ? validateAgainst(o.output, t.expect.output).map((i) => `output.${i.field}: ${i.message}`)
          : o.errors.some((e) => e.code === (t.expect as { error: string }).error)
            ? []
            : [`ошибка ${(t.expect as { error: string }).error} не описана`]),
      ];
      reports.push({ operation: o.name, test: t.name, contract: issues.length ? "failed" : "passed", executed: false, reason: "sandbox_unavailable", issues });
    }
  }
  return reports;
}
