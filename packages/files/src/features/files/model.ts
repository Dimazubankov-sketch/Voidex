import type { Space } from './presentation';
import { validWorkspace, space } from './presentation';
export type Kind = 'txt' | 'prsn' | 'book';
/** Step 2.13: a VOIDEX book (.book) as a file: its pages of text blocks (pictures stay in Notes). */
export type BookBlock = { id: string; kind: string; text: string; checked?: boolean };
export type BookFile = { kind: 'book'; pages: { id: string; blocks: BookBlock[] }[] };
export type FileData = string | Space | BookFile;
export const isBook = (d: unknown): d is BookFile => !!d && typeof d === 'object' && (d as BookFile).kind === 'book';
export type Entry = {
  id: string;
  name: string;
  kind: Kind;
  folder: string | null;
  favorite: boolean;
  trashed: boolean;
  downloaded: boolean;
  updated: number;
  revision: number;
  size: number;
};
export type Folder = { id: string; name: string };
export type Listing = { files: Entry[]; folders: Folder[]; used: number; quota: number };
export type OpenFile = { file: Entry; data: FileData; editable: boolean; shared?: boolean };
export const QUOTA = 5 * 1024 ** 3;
export const MAX_FILE = 1024 * 1024;
export const newData = (kind: Kind, name: string): FileData =>
  kind === 'txt' ? '' : kind === 'book' ? { kind: 'book', pages: [{ id: 'p1', blocks: [] }] } : space(name, 'presentation', 'landscape');
const validBook = (d: unknown) =>
  isBook(d) &&
  Array.isArray(d.pages) &&
  d.pages.length >= 1 &&
  d.pages.length <= 1000 &&
  d.pages.every(
    (p) =>
      !!p &&
      typeof p.id === 'string' &&
      Array.isArray(p.blocks) &&
      p.blocks.length <= 3000 &&
      p.blocks.every((b) => !!b && typeof b.id === 'string' && typeof b.kind === 'string' && b.kind.length <= 20 && typeof b.text === 'string'),
  ) &&
  JSON.stringify(d).length <= MAX_FILE;
export function validData(kind: Kind, data: unknown): data is FileData {
  if (kind === 'book') return validBook(data);
  if (kind === 'txt') return typeof data === 'string' && !data.includes('\u0000') && new TextEncoder().encode(data).length <= MAX_FILE;
  if (!data || typeof data !== 'object') return false;
  const s = data as Space;
  return (
    s.mode === 'presentation' &&
    validWorkspace({ version: 1, projects: [{ id: 'file', name: 'file', cover: 'white', updated: 0, spaces: [s] }] }) &&
    s.slides.every((p) => !p.background.startsWith('/api/') && p.blocks.every((b) => b.kind !== 'image' && !b.src)) &&
    JSON.stringify(s).length <= MAX_FILE
  );
}
export function parseFile(name: string, raw: string): { kind: Kind; data: FileData } {
  const lower = name.toLowerCase();
  const kind = lower.endsWith('.txt') ? 'txt' : lower.endsWith('.prsn') ? 'prsn' : lower.endsWith('.book') ? 'book' : null;
  if (!kind) throw new Error('Поддерживаются только .txt, .prsn и .book');
  let data: unknown = raw;
  if (kind === 'book') {
    const x = JSON.parse(raw);
    data = x?.format === 'voidex.book' && x.version === 1 ? x.book : x;
    if (!validData(kind, data)) throw new Error('Некорректный файл книги Voidex.');
    return { kind, data: data as BookFile };
  }
  if (kind === 'prsn') {
    const x = JSON.parse(raw);
    data = x?.format === 'voidex.prsn' && x.version === 1 ? x.space : x;
  }
  if (!validData(kind, data)) throw new Error('Некорректный файл. Презентация должна содержать текстовые слайды Voidex.');
  return { kind, data };
}
export function serialize(kind: Kind, data: FileData) {
  if (kind === 'book') return JSON.stringify({ format: 'voidex.book', version: 1, book: data }, null, 2);
  return kind === 'txt' ? String(data) : JSON.stringify({ format: 'voidex.prsn', version: 1, space: data }, null, 2);
}
export const fileText = (data: FileData) =>
  typeof data === 'string'
    ? data
    : isBook(data)
      ? data.pages.flatMap((p) => p.blocks.map((b) => b.text)).join(' ')
      : data.slides.flatMap((s) => s.blocks.map((b) => b.text)).join(' ');
export const cleanName = (s: string, kind: Kind) =>
  (s
    .replace(/\.(txt|prsn|book)$/i, '')
    .trim()
    .slice(0, 150) || 'Без названия') +
  '.' +
  kind;
export function byteSize(n: number) {
  return n < 1024
    ? n + ' Б'
    : n < 1024 ** 2
      ? (n / 1024).toFixed(1) + ' КБ'
      : n < 1024 ** 3
        ? (n / 1024 ** 2).toFixed(1) + ' МБ'
        : (n / 1024 ** 3).toFixed(1) + ' ГБ';
}

export function nameStem(name: string) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
export function withExtension(stem: string, original: string, fallback: string) {
  const i = original.lastIndexOf('.'),
    extension = i > 0 ? original.slice(i) : '.' + fallback;
  let base = stem.trim();
  if (base.toLowerCase().endsWith(extension.toLowerCase())) base = base.slice(0, -extension.length);
  return (base.trim().slice(0, 150) || 'Без названия') + extension;
}

export function fileExtension(name: string, fallback: string) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '.' + fallback;
}
