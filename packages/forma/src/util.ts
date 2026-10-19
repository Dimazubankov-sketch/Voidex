/** Thrown for every invalid command, document or contract: `path` points at the offending part. */
export class FormaError extends Error {
  constructor(
    message: string,
    readonly path: string = "",
    readonly code: string = "invalid",
  ) {
    super(message);
    this.name = "FormaError";
  }
}

/** Deep copy of plain JSON data (projects are JSON). */
export const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** UTF-8 size of a string in bytes. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

let counter = 0;
/** Stable, URL-safe id with a readable prefix (`button_3k9x…`). */
export function uid(prefix: string): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  const random =
    typeof c?.randomUUID === "function"
      ? c.randomUUID().replace(/-/g, "").slice(0, 16)
      : Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 8);
  return `${prefix}_${random}`;
}

export const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function str(v: unknown, path: string, max: number, opts: { min?: number; trim?: boolean } = {}): string {
  if (typeof v !== "string") throw new FormaError("Ожидается текст.", path);
  const s = opts.trim ? v.trim() : v;
  if (s.length > max) throw new FormaError(`Не длиннее ${max} символов.`, path);
  if ((opts.min ?? 0) > s.length) throw new FormaError("Поле не может быть пустым.", path);
  return s;
}

export function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new FormaError("Ожидается число.", path);
  return clamp(v, min, max);
}

export function bool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") throw new FormaError("Ожидается да или нет.", path);
  return v;
}

export function id(v: unknown, path: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new FormaError("Некорректный идентификатор.", path);
  return v;
}

export function color(v: unknown, path: string): string {
  if (typeof v !== "string" || !COLOR_RE.test(v)) throw new FormaError("Цвет в формате #RRGGBB.", path);
  return v.toLowerCase();
}

export function oneOf<T extends string>(v: unknown, options: readonly T[], path: string): T {
  if (typeof v !== "string" || !(options as readonly string[]).includes(v)) throw new FormaError("Недопустимое значение.", path);
  return v as T;
}

export function arr(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) throw new FormaError("Ожидается список.", path);
  if (v.length > max) throw new FormaError(`Не больше ${max} элементов.`, path);
  return v;
}

export const nowIso = () => new Date().toISOString();
