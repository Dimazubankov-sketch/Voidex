export type BlockKind = "text" | "heading" | "quote" | "checklist" | "code" | "image";
export type Block = {
  id: string;
  kind: BlockKind;
  text: string;
  src?: string;
  size: number;
  align: "left" | "right" | "center";
  bold?: boolean;
  italic?: boolean;
  hidden?: boolean;
  locked?: boolean;
  checked?: boolean;
  label?: string;
  portraitSize?: number;
};
export type Slide = {
  id: string;
  blocks: Block[];
  background: string;
  transition: string;
  speaker: string;
};
export type Space = {
  id: string;
  name: string;
  cover: string;
  mode: "notes" | "presentation";
  format: "landscape" | "portrait" | "both";
  flow: "vertical" | "horizontal";
  paged: boolean;
  slides: Slide[];
  updated: number;
};
export type Project = {
  id: string;
  name: string;
  cover: string;
  spaces: Space[];
  updated: number;
};
export type Workspace = {
  version: 1;
  projects: Project[];
};
export const uid = () => crypto.randomUUID();
export const backgrounds = [
  ["white", "Чистый лист"],
  ["milk", "Молочная волна"],
  ["lavender", "Лавандовый свет"],
  ["split", "Две поверхности"],
  ["wave", "Фиолетовая волна"],
  ["graphite", "Графит"],
] as const;
export const transitions = [
  ["none", "Без перехода"],
  ["fade", "Растворение"],
  ["slide", "Сдвиг"],
  ["zoom", "Приближение"],
  ["page", "Перелистывание"],
] as const;
export function block(kind: BlockKind = "text", text = ""): Block {
  return { id: uid(), kind, text, size: 12, align: "left" };
}
export function slide(): Slide {
  return {
    id: uid(),
    blocks: [block("heading", "Новая страница"), block("text", "")],
    background: "white",
    transition: "fade",
    speaker: "",
  };
}
export function space(name: string, mode: "notes" | "presentation" = "notes", format: Space["format"] = "both"): Space {
  return { id: uid(), name, cover: "lavender", mode, format, flow: "vertical", paged: false, slides: [slide()], updated: Date.now() };
}
export function demoProject(): Project {
  const s = space("Знакомство с пространством");
  s.slides = [
    {
      ...slide(),
      background: "lavender",
      blocks: [
        block("heading", "Место для следующей идеи"),
        block(
          "text",
          "Здесь начинается ваш проект. Соберите мысли, добавьте изображения и превратите заметку в презентацию — всё в одном пространстве.",
        ),
        block("quote", "Меньше инструментов перед глазами. Больше пространства для мысли."),
        block("checklist", "Назовите проект и добавьте обложку"),
        block("checklist", "Попробуйте режим «Презентация»"),
      ],
    },
    {
      ...slide(),
      background: "milk",
      blocks: [
        block("heading", "От мысли — к истории"),
        block(
          "text",
          "Каждая страница станет отдельным слайдом. Выберите фон, добавьте фотографию и настройте её размер. Текст подстроится под изображение.",
        ),
        block("text", "Кнопка «Показ» откроет презентацию без инструментов. Стрелки и свайпы переключают слайды."),
      ],
    },
    {
      ...slide(),
      background: "wave",
      blocks: [
        block("heading", "Идеи, которыми хочется делиться"),
        block(
          "text",
          "Сохраните презентацию в HTML, чтобы отправить её человеку и открыть в любом браузере. Или создайте ссылку для пользователей, которым доступно приложение.",
        ),
      ],
    },
  ];
  return { id: uid(), name: "Мой первый проект", cover: "lavender", spaces: [s], updated: Date.now() };
}
export const plainText = (s: Space) => s.slides.flatMap((p) => p.blocks.map((b) => b.text)).join(" ");
const mediaPath = (s: unknown) => typeof s === "string" && /^\/api\/media\?id=[a-f0-9-]{36}$/.test(s);
const coverOK = (s: unknown) => typeof s === "string" && (backgrounds.some(([v]) => v === s) || mediaPath(s));
export function validWorkspace(x: unknown): x is Workspace {
  try {
    const w = x as Workspace;
    return (
      !!w &&
      w.version === 1 &&
      Array.isArray(w.projects) &&
      w.projects.length <= 300 &&
      w.projects.every(
        (p) =>
          p &&
          typeof p.id === "string" &&
          typeof p.name === "string" &&
          p.name.length <= 200 &&
          coverOK(p.cover) &&
          Array.isArray(p.spaces) &&
          p.spaces.length <= 500 &&
          p.spaces.every(
            (s) =>
              s &&
              typeof s.name === "string" &&
              s.name.length <= 200 &&
              typeof s.id === "string" &&
              coverOK(s.cover) &&
              ["notes", "presentation"].includes(s.mode) &&
              ["landscape", "portrait", "both"].includes(s.format) &&
              ["vertical", "horizontal"].includes(s.flow) &&
              Array.isArray(s.slides) &&
              s.slides.length > 0 &&
              s.slides.length <= 500 &&
              s.slides.every(
                (a) =>
                  a &&
                  typeof a.id === "string" &&
                  coverOK(a.background) &&
                  transitions.some(([v]) => v === a.transition) &&
                  typeof a.speaker === "string" &&
                  Array.isArray(a.blocks) &&
                  a.blocks.length <= 500 &&
                  a.blocks.every(
                    (b) =>
                      b &&
                      typeof b.id === "string" &&
                      typeof b.text === "string" &&
                      b.text.length <= 100000 &&
                      ["text", "heading", "quote", "checklist", "code", "image"].includes(b.kind) &&
                      ["left", "right", "center"].includes(b.align) &&
                      Number.isFinite(b.size) &&
                      b.size >= 1 &&
                      b.size <= 12 &&
                      (!b.portraitSize || (Number.isFinite(b.portraitSize) && b.portraitSize >= 1 && b.portraitSize <= 12)) &&
                      (!b.src || mediaPath(b.src)) &&
                      (!b.label || typeof b.label === "string"),
                  ),
              ),
          ),
      )
    );
  } catch {
    return false;
  }
}
