export type Kind = "photo" | "video" | "screenshot";
export type Region = {
  x: number;
  y: number;
  w: number;
  h: number;
  sw: number;
  sh: number;
};
export type MediaItem = {
  id: string;
  name: string;
  kind: Kind;
  src: string;
  originalSrc?: string;
  originalWidth?: number;
  originalHeight?: number;
  originalBytes?: number;
  originalMime?: string;
  originalDuration?: number;
  region?: Region;
  originalRegion?: Region;
  width: number;
  height: number;
  bytes: number;
  mime: string;
  duration?: number;
  capturedAt: number;
  addedAt: number;
  favorite: boolean;
  hidden: boolean;
  deletedAt?: number;
  edited: boolean;
  tags: string[];
  place: string;
  demo?: boolean;
};
export type Album = {
  coverId?: string;
  id: string;
  name: string;
  itemIds: string[];
  pinned: boolean;
  group: "album" | "memory";
};
export type MediaLibrary = {
  version: 1;
  items: MediaItem[];
  albums: Album[];
};
export type ViewOptions = {
  layout: "mosaic" | "grid" | "list";
  order: "newest-top" | "newest-bottom";
  dateBy: "addedAt" | "capturedAt";
  filter: "all" | "favorites" | "edited" | "unfiled" | "hidden" | "trash";
  kind: "all" | Kind;
};
export const defaultView: ViewOptions = { layout: "mosaic", order: "newest-top", dateBy: "addedAt", filter: "all", kind: "all" };
export const uid = () => crypto.randomUUID();
export const sampleRects = [
  [44, 477, 284, 199, "Альпы на закате"],
  [348, 512, 146, 159, "Тёплый вечер дома"],
  [516, 477, 149, 201, "Кот у окна"],
  [681, 478, 142, 170, "Облака"],
  [34, 720, 238, 370, "Вечерний город"],
  [294, 752, 238, 135, "Белые тюльпаны"],
  [559, 721, 268, 165, "Горный хребет"],
  [294, 935, 191, 153, "Тихий час"],
  [507, 912, 319, 128, "У моря"],
  [35, 1115, 247, 210, "Луна"],
  [306, 1145, 247, 182, "Полевые цветы"],
  [575, 1115, 249, 178, "Свет и тени"],
] as const;
export function seedLibrary(): MediaLibrary {
  const now = Date.now();
  const items: MediaItem[] = sampleRects.map((r, i) => ({
    id: "demo-" + i,
    name: r[4],
    kind: "photo",
    src: "/demo/reference.jpeg",
    region: { x: r[0], y: r[1], w: r[2], h: r[3], sw: 864, sh: 1536 },
    width: r[2],
    height: r[3],
    bytes: 348348,
    mime: "image/jpeg",
    capturedAt: now - i * 86400000,
    addedAt: now - i * 86400000,
    favorite: [0, 5, 7, 10].includes(i),
    hidden: false,
    edited: false,
    tags: [2, 7].includes(i) ? ["Барсик"] : [],
    place: [0, 6].includes(i) ? "Альпы" : "",
    demo: true,
  }));
  items.push({
    id: "demo-screen",
    name: "Концепт Voidex · ПК",
    kind: "screenshot",
    src: "/demo/desktop.jpeg",
    width: 1536,
    height: 1024,
    bytes: 493413,
    mime: "image/jpeg",
    capturedAt: now - 13 * 86400000,
    addedAt: now - 13 * 86400000,
    favorite: false,
    hidden: false,
    edited: false,
    tags: [],
    place: "",
    demo: true,
  });
  items.push({
    id: "demo-video",
    name: "Демонстрация медиатеки",
    kind: "video",
    src: "/demo/gallery.webm",
    width: 360,
    height: 640,
    duration: 6,
    bytes: 180400,
    mime: "video/webm",
    capturedAt: now - 14 * 86400000,
    addedAt: now - 14 * 86400000,
    favorite: false,
    hidden: false,
    edited: false,
    tags: [],
    place: "",
    demo: true,
  });
  return {
    version: 1,
    items,
    albums: [
      { id: "album-travel", name: "Путешествия", itemIds: ["demo-0", "demo-4", "demo-6", "demo-8"], pinned: true, group: "album" },
      { id: "album-cats", name: "Котики", itemIds: ["demo-2", "demo-7"], pinned: true, group: "album" },
      {
        id: "album-aesthetic",
        name: "Эстетика",
        itemIds: ["demo-3", "demo-5", "demo-9", "demo-10", "demo-11"],
        pinned: true,
        group: "album",
      },
      { id: "memory-mountains", name: "Вечер в горах", itemIds: ["demo-0", "demo-6", "demo-8"], pinned: false, group: "memory" },
    ],
  };
}
export function visibleItems(lib: MediaLibrary, view: ViewOptions, query = "", albumId = ""): MediaItem[] {
  const album = lib.albums.find((a) => a.id === albumId);
  return lib.items
    .filter((m) => {
      if (view.filter === "trash") {
        if (!m.deletedAt) return false;
      } else if (m.deletedAt) return false;
      if (view.filter === "hidden") {
        if (!m.hidden) return false;
      } else if (m.hidden && view.filter !== "trash") return false;
      if (album && !album.itemIds.includes(m.id)) return false;
      if (view.kind !== "all" && m.kind !== view.kind) return false;
      if (view.filter === "favorites" && !m.favorite) return false;
      if (view.filter === "edited" && !m.edited) return false;
      if (view.filter === "unfiled" && lib.albums.some((a) => a.itemIds.includes(m.id))) return false;
      return (m.name + " " + m.place + " " + m.tags.join(" ")).toLowerCase().includes(query.toLowerCase());
    })
    .sort((a, b) => (view.order === "newest-top" ? -1 : 1) * (a[view.dateBy] - b[view.dateBy]) || a.id.localeCompare(b.id));
}
const samples = new Set(["/demo/reference.jpeg", "/demo/desktop.jpeg", "/demo/gallery.webm"]);
export const safeSrc = (s: unknown) => typeof s === "string" && (samples.has(s) || /^\/api\/assets\?id=[a-f0-9-]{36}$/.test(s));
const mimes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"]);
const finite = (n: unknown, max = Number.MAX_SAFE_INTEGER) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
function validRegion(r: Region | undefined, src: string | undefined) {
  if (r === undefined) return true;
  return (
    src === "/demo/reference.jpeg" &&
    [r.x, r.y, r.w, r.h, r.sw, r.sh].every((n) => finite(n, 50000)) &&
    r.w > 0 &&
    r.h > 0 &&
    r.sw === 864 &&
    r.sh === 1536 &&
    r.x + r.w <= r.sw &&
    r.y + r.h <= r.sh
  );
}
export function validLibrary(x: unknown): x is MediaLibrary {
  try {
    const w = x as MediaLibrary;
    if (!w || w.version !== 1 || !Array.isArray(w.items) || !Array.isArray(w.albums) || w.items.length > 10000 || w.albums.length > 500)
      return false;
    const ids = new Set(w.items.map((m) => m?.id));
    return (
      ids.size === w.items.length &&
      w.items.every(
        (m) =>
          m &&
          typeof m.id === "string" &&
          m.id.length > 0 &&
          m.id.length <= 120 &&
          typeof m.name === "string" &&
          m.name.length <= 240 &&
          ["photo", "video", "screenshot"].includes(m.kind) &&
          safeSrc(m.src) &&
          (m.originalSrc === undefined || safeSrc(m.originalSrc)) &&
          [m.width, m.height, m.bytes, m.capturedAt, m.addedAt].every((n) => finite(n)) &&
          m.width > 0 &&
          m.height > 0 &&
          m.width <= 50000 &&
          m.height <= 50000 &&
          mimes.has(m.mime) &&
          (m.kind === "video") === m.mime.startsWith("video/") &&
          (m.duration === undefined || finite(m.duration)) &&
          (m.deletedAt === undefined || finite(m.deletedAt)) &&
          [m.originalWidth, m.originalHeight, m.originalBytes, m.originalDuration].every((n) => n === undefined || finite(n)) &&
          (m.originalMime === undefined || mimes.has(m.originalMime)) &&
          (m.demo === undefined || typeof m.demo === "boolean") &&
          typeof m.favorite === "boolean" &&
          typeof m.hidden === "boolean" &&
          typeof m.edited === "boolean" &&
          typeof m.place === "string" &&
          m.place.length <= 240 &&
          Array.isArray(m.tags) &&
          m.tags.length < 100 &&
          m.tags.every((t) => typeof t === "string" && t.length <= 80) &&
          validRegion(m.region, m.src) &&
          validRegion(m.originalRegion, m.originalSrc),
      ) &&
      new Set(w.albums.map((a) => a?.id)).size === w.albums.length &&
      w.albums.every(
        (a) =>
          a &&
          typeof a.id === "string" &&
          a.id.length > 0 &&
          a.id.length <= 120 &&
          typeof a.name === "string" &&
          a.name.length <= 120 &&
          Array.isArray(a.itemIds) &&
          a.itemIds.length <= 10000 &&
          new Set(a.itemIds).size === a.itemIds.length &&
          a.itemIds.every((id) => ids.has(id)) &&
          (a.coverId === undefined || (typeof a.coverId === "string" && a.itemIds.includes(a.coverId))) &&
          typeof a.pinned === "boolean" &&
          ["album", "memory"].includes(a.group),
      )
    );
  } catch {
    return false;
  }
}
export const humanBytes = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + " ГБ" : n >= 1e6 ? (n / 1e6).toFixed(1) + " МБ" : Math.round(n / 1000) + " КБ";
export const durationLabel = (n = 0) => Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2, "0");
