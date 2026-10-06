"use client";
import { flushSync } from "react-dom";
import { Dialog as DialogPrimitive } from "radix-ui";
import React, { useCallback, useEffect, useRef, useState, useId } from "react";
import {
  Image as ImageIcon,
  Images,
  Album as AlbumIcon,
  Video,
  Scan,
  Check,
  CheckCircle2,
  Grid2X2,
  LayoutGrid,
  List,
  Columns2,
  SlidersHorizontal,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Plus,
  MoreHorizontal,
  Search,
  Heart,
  
  Sparkles,
  Pin,
  
  
  
  Trash2,
  EyeOff,
  
  Upload,
  Download,
  Share2,
  Copy,
  Info,
  FolderPlus,
  Play,
  X,
  RotateCcw,
  Cloud,
  CloudOff,
  
  
  
  
  Pencil,
  
  Monitor,
  FileImage,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogPortal } from "../../components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "../../components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "../../components/ui/alert-dialog";
import { SidebarProvider, Sidebar, SidebarContent, SidebarFooter } from "../../components/ui/sidebar";
import { Toaster } from "../../components/ui/sonner";
import { toast } from "sonner";
import { type MediaItem, type MediaLibrary, type Album, type ViewOptions, defaultView, visibleItems, uid, humanBytes, durationLabel } from "./model";
import { type MediaAdapter, httpAdapter } from "./adapter";
import VideoPlayer from "./VideoPlayer";
import { usePaintSelection } from "./usePaintSelection";
import { readFileMetadata, itemBlob, saveBlob, fileName, shareItems, copyImage, zipFiles } from "./media-utils";
import "./media.css";
import { galleryDensity, pinchStep, swipeSection, swipeDirection, keyboardInset } from "./gestures";
// The editors load only when something is edited (their own chunks).
const PhotoEditor = React.lazy(() => import("./PhotoEditor"));
const VideoEditor = React.lazy(() => import("./VideoEditor"));
const kindNames = { all: "Все", photo: "Фото", video: "Видео", screenshot: "Скриншоты" };
const filterNames = {
  all: "Все объекты",
  favorites: "Избранные",
  edited: "Изменённые",
  unfiled: "Не в альбоме",
  hidden: "Скрытые",
  trash: "Недавно удалённые",
};
function Round({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button title={label} aria-label={label} className={"vm-round " + (active ? "active" : "")} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
function Choice({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: [string, string][];
  onChange: (s: string) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function MediaImage({
  item,
  resolveSrc,
  contain = false,
}: {
  item: MediaItem;
  resolveSrc: (s: string) => string;
  contain?: boolean;
}) {
  const clipId = useId().replace(/:/g, "");
  const r = item.region;
  if (r)
    return (
      <svg
        className="vm-region"
        viewBox={`${r.x} ${r.y} ${r.w} ${r.h}`}
        preserveAspectRatio={contain ? "xMidYMid meet" : "xMidYMid slice"}
        role="img"
        aria-label={item.name}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <image href={resolveSrc(item.src)} width={r.sw} height={r.sh} />
        </g>
      </svg>
    );
  if (item.kind === "video")
    return (
      <video src={resolveSrc(item.src)} muted playsInline preload="metadata" className={contain ? "contain" : ""} aria-label={item.name} />
    );
  return <img src={resolveSrc(item.src)} alt={item.name} draggable={false} loading="lazy" className={contain ? "contain" : ""} />;
}
function ScrollStrip({
  children,
  value,
  onChange,
}: {
  children: React.ReactNode;
  value: ViewOptions["kind"];
  onChange: (kind: ViewOptions["kind"]) => void;
}) {
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppress = useRef(false);
  return (
    <div
      className="vm-type-scroll"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        suppress.current = false;
        drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d && swipeDirection(e.clientX - d.x, e.clientY - d.y, 40)) e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const direction = swipeDirection(e.clientX - d.x, e.clientY - d.y, 40);
        if (direction) {
          suppress.current = true;
          const kinds: ViewOptions["kind"][] = ["all", "photo", "video", "screenshot"];
          onChange(kinds[Math.max(0, Math.min(3, kinds.indexOf(value) + direction))]!);
        }
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => (drag.current = null)}
      onClickCapture={(e) => {
        if (suppress.current) {
          e.preventDefault();
          e.stopPropagation();
          suppress.current = false;
        }
      }}
    >
      {children}
    </div>
  );
}
export default function MediaApp({
  adapter = httpAdapter,
  embedded = false,
  assetBase = "",
  onWallpaper,
  onSendToNotes,
  onDirtyChange,
  onOpenCloud,
  onShare,
  notice,
  cloudAvailable = true,
}: {
  adapter?: MediaAdapter;
  embedded?: boolean;
  assetBase?: string;
  onWallpaper?: (blob: Blob) => Promise<void>;
  onSendToNotes?: (item: MediaItem) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenCloud?: () => void;
  /** The host's own share flow (replaces the system share sheet / download). */
  onShare?: (items: MediaItem[]) => void;
  /** A host message under the header (e.g. "not saved to the cloud"). */
  notice?: React.ReactNode;
  /** false: the cloud is not running; the app shows that instead of a quota or "saved". */
  cloudAvailable?: boolean;
}) {
  const resolveSrc = useCallback((s: string) => (s.startsWith("/demo/") ? assetBase + s : s), [assetBase]);
  const [lib, setLib] = useState<MediaLibrary>({ version: 1, items: [], albums: [] });
  const current = useRef(lib);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Сохранено");
  const revision = useRef(0);
  const dirty = useRef(false);
  const busy = useRef(false);
  const disposed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [view, setView] = useState<ViewOptions>(defaultView);
  const [tab, setTab] = useState("library");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [albumId, setAlbumId] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewId, setViewId] = useState("");
  const [viewerClosing, setViewerClosing] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [slideshow, setSlideshow] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [renameAlbum, setRenameAlbum] = useState<string | null>(null);
  const [newAlbum, setNewAlbum] = useState(false);
  const [albumName, setAlbumName] = useState("");
  const [albumAdd, setAlbumAdd] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    text: string;
    run: () => void;
  } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [density, setDensity] = useState(3);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [contextId, setContextId] = useState("");
  const [albumCoverId, setAlbumCoverId] = useState("");
  const [coverForAlbum, setCoverForAlbum] = useState("");
  const [albumPicker, setAlbumPicker] = useState("");
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const press = useRef<{
    timer: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
  } | null>(null);
  const suppressOpen = useRef(0);
  const swipeStart = useRef<{
    x: number;
    y: number;
    blocked: boolean;
  } | null>(null);
  const pinch = useRef<number | null>(null);
  const densityRef = useRef(3);
  const uploadTarget = useRef("");
  const activePicker = useRef(albumPicker);
  activePicker.current = albumPicker;
  const root = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapse, setCollapse] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const viewerDrag = useRef<{ x: number; y: number; id: number } | null>(null);
  const filmstrip = useRef<HTMLDivElement>(null);
  const dockDrag = useRef<{ x: number; y: number } | null>(null);
  const dockSuppress = useRef(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const items = visibleItems(lib, view, query, albumId);
  const paintSelection = usePaintSelection(
    items.map((m) => m.id),
    selected,
    setSelected,
    stage,
    selecting,
  );
  const album = lib.albums.find((a) => a.id === albumId);
  const viewer = lib.items.find((m) => m.id === viewId);
  const viewerList = viewer ? (items.some((m) => m.id === viewer.id) ? items : lib.items.filter((m) => !m.deletedAt && !m.hidden)) : [];
  const activeIndex = viewerList.findIndex((m) => m.id === viewId);
  const chosen = lib.items.filter((m) => selected.has(m.id));
  const totalBytes = lib.items.reduce((n, m) => n + (m.demo ? 0 : m.bytes), 0);
  const flush = useCallback(async () => {
    if (busy.current || !dirty.current || disposed.current) return;
    busy.current = true;
    setStatus("Сохраняем…");
    const snapshot = current.current;
    try {
      revision.current = await adapter.save(snapshot, revision.current);
      if (disposed.current) return;
      if (snapshot === current.current) {
        dirty.current = false;
        setStatus("Сохранено");
      } else setStatus("Есть изменения");
    } catch (e) {
      if (!disposed.current) {
        setStatus("Не сохранено");
        toast.error((e as Error).message);
      }
    } finally {
      busy.current = false;
      if (!disposed.current && dirty.current && snapshot !== current.current) timer.current = setTimeout(() => void flush(), 650);
    }
  }, [adapter]);
  const change = useCallback(
    (next: MediaLibrary) => {
      current.current = next;
      setLib(next);
      dirty.current = true;
      setStatus("Есть изменения");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 600);
    },
    [flush],
  );
  useEffect(() => {
    disposed.current = false;
    adapter
      .load()
      .then((result) => {
        if (disposed.current) return;
        current.current = result.data;
        setLib(result.data);
        revision.current = result.revision;
        setLoaded(true);
      })
      .catch((e) => {
        if (!disposed.current) setError(e.message);
      });
    return () => {
      disposed.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [adapter]);
  useEffect(() => {
    onDirtyChange?.(status !== "Сохранено");
  }, [status, onDirtyChange]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("voidex-media-view") || "null");
      if (
        s &&
        ["mosaic", "grid", "list"].includes(s.layout) &&
        ["newest-top", "newest-bottom"].includes(s.order) &&
        ["capturedAt", "addedAt"].includes(s.dateBy)
      )
        setView((v) => ({ ...v, layout: s.layout, order: s.order, dateBy: s.dateBy }));
    } catch {}
  }, []);
  function setOptions(patch: Partial<ViewOptions>) {
    setView((v) => {
      const next = { ...v, ...patch };
      try {
        localStorage.setItem("voidex-media-view", JSON.stringify({ layout: next.layout, order: next.order, dateBy: next.dateBy }));
      } catch {}
      return next;
    });
  }
  function patchItems(ids: string[], patch: Partial<MediaItem>) {
    const set = new Set(ids);
    change({ ...current.current, items: current.current.items.map((m) => (set.has(m.id) ? { ...m, ...patch } : m)) });
  }
  function navigate(filter: ViewOptions["filter"] = "all", kind: ViewOptions["kind"] = "all") {
    setView((v) => ({ ...v, filter, kind }));
    setTab("library");
    setAlbumId("");
    setQuery("");
    setSelecting(false);
    setSelected(new Set());
    setCollapse(false);
  }
  function openAlbum(id: string) {
    setAlbumId(id);
    setTab("library");
    setView((v) => ({ ...v, filter: "all", kind: "all" }));
    setQuery("");
    setSelected(new Set());
    setSelecting(false);
  }
  function toggleSelect(id: string) {
    setSelected((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function closeViewer() {
    if (!viewId) return;
    setViewerClosing(true);
    setSlideshow(false);
    setZoom(false);
  }
  useEffect(() => {
    if (!viewerClosing) return;
    const timer = setTimeout(
      () => {
        setViewId("");
        setViewerClosing(false);
      },
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    );
    return () => clearTimeout(timer);
  }, [viewerClosing]);
  function move(delta: number) {
    if (!viewerList.length) return;
    const next = Math.max(0, Math.min(viewerList.length - 1, activeIndex + delta));
    setViewId(viewerList[next]!.id);
    setZoom(false);
  }
  useEffect(() => {
    const strip = filmstrip.current;
    const active = strip?.querySelector<HTMLElement>(".active");
    if (strip && active)
      strip.scrollTo({
        left: active.offsetLeft + active.offsetWidth / 2 - strip.clientWidth / 2,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
  }, [viewId]);
  useEffect(() => {
    if (!slideshow || !viewer) return;
    const id = setInterval(() => {
      if (activeIndex >= viewerList.length - 1) setSlideshow(false);
      else move(1);
    }, 3500);
    return () => clearInterval(id);
  }, [slideshow, activeIndex, viewerList.length]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        if (editing) return;
        closeViewer();
        setSelecting(false);
        setSlideshow(false);
        setZoom(false);
      }
      if (viewer && !editing && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        move(e.key === "ArrowRight" ? 1 : -1);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && selecting) {
        e.preventDefault();
        setSelected(new Set(items.map((m) => m.id)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [viewer, editing, items, selecting, activeIndex, flush]);
  useEffect(() => {
    const ctx = (
      document as unknown as {
        modelContext?: {
          registerTool: Function;
        };
      }
    ).modelContext;
    if (!ctx) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        ctx.registerTool(
          {
            name: "list_media_albums",
            description: "List the current Voidex media albums and counts.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: () => ({ albums: current.current.albums.map((a) => ({ id: a.id, name: a.name, count: a.itemIds.length })) }),
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  async function upload(files: FileList | File[] | null) {
    if (!files) return;
    const queue = Array.from(files);
    if (queue.length > 50) {
      toast.error("За один раз можно загрузить до 50 файлов");
      return;
    }
    if (!uploadTarget.current) {
      toast.error("Откройте альбом, чтобы добавить файлы");
      return;
    }
    const targetAlbum = uploadTarget.current;
    setUploading(queue.length);
    let success = 0;
    for (const f of queue) {
      try {
        const type = f.type;
        const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"];
        if (!allowed.includes(type)) throw new Error("Неподдерживаемый формат: " + f.name);
        const isVideo = type.startsWith("video/");
        if (f.size > (isVideo ? 70000000 : 20000000)) throw new Error(f.name + ": фото до 20 МБ, видео до 70 МБ");
        const metadata = await readFileMetadata(f);
        const src = await adapter.upload(f);
        const now = Date.now();
        const screenshot = !isVideo && /screenshot|скриншот|screen[-_ ]?shot/i.test(f.name);
        const m: MediaItem = {
          id: uid(),
          name: f.name.replace(/\.[^.]+$/, ""),
          kind: isVideo ? "video" : screenshot ? "screenshot" : "photo",
          src,
          ...metadata,
          bytes: f.size,
          mime: f.type,
          capturedAt: f.lastModified || now,
          addedAt: now,
          favorite: false,
          hidden: false,
          edited: false,
          tags: [],
          place: "",
        };
        change({
          ...current.current,
          items: [...current.current.items, m],
          albums: current.current.albums.map((a) => (a.id === targetAlbum ? { ...a, itemIds: [...a.itemIds, m.id] } : a)),
        });
        if (activePicker.current === targetAlbum) setPickerSelected((old) => new Set([...old, m.id]));
        success++;
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (success) toast.success(`Добавлено: ${success}`);
  }
  async function download(itemsToGet: MediaItem[]) {
    if (!itemsToGet.length) return;
    setShareBusy(true);
    try {
      if (itemsToGet.length === 1) saveBlob(await itemBlob(itemsToGet[0]!, resolveSrc), fileName(itemsToGet[0]!));
      else {
        if (itemsToGet.reduce((n, m) => n + m.bytes, 0) > 180000000)
          throw new Error("Скачайте большой набор несколькими частями до 180 МБ.");
        const files = await Promise.all(
          itemsToGet.map(async (m) => new File([await itemBlob(m, resolveSrc)], fileName(m), { type: m.mime })),
        );
        saveBlob(await zipFiles(files), "Voidex-медиатека.zip");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setShareBusy(false);
    }
  }
  async function share(ms: MediaItem[]) {
    if (ms.length > 50 || ms.reduce((n, m) => n + m.bytes, 0) > 180000000) {
      toast.error("Отправляйте до 50 файлов и 180 МБ за один раз");
      return;
    }
    if (onShare) {
      onShare(ms);
      return;
    }
    setShareBusy(true);
    try {
      const result = await shareItems(ms, resolveSrc);
      if (result === "downloaded") toast.success("Файлы скачаны, их можно отправить");
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error((e as Error).message);
    } finally {
      setShareBusy(false);
    }
  }
  function trash(ids: string[]) {
    setConfirm({
      title: "Удалить выбранные файлы?",
      text: "Они попадут в «Недавно удалённые». Их можно восстановить.",
      run: () => {
        patchItems(ids, { deletedAt: Date.now() });
        setSelected(new Set());
        setSelecting(false);
        closeViewer();
        toast.success("Перемещено в недавно удалённые");
      },
    });
  }
  function erase(ids: string[]) {
    setConfirm({
      title: "Удалить без возможности восстановления?",
      text: "Файлы исчезнут из медиатеки и альбомов. Это действие нельзя отменить.",
      run: () => {
        const set = new Set(ids);
        change({
          ...current.current,
          items: current.current.items.filter((m) => !set.has(m.id)),
          albums: current.current.albums.map((a) => ({
            ...a,
            itemIds: a.itemIds.filter((id) => !set.has(id)),
            coverId: a.coverId && set.has(a.coverId) ? undefined : a.coverId,
          })),
        });
        setSelected(new Set());
        setSelecting(false);
        closeViewer();
        toast.success("Удалено из медиатеки");
      },
    });
  }
  function duplicate(m: MediaItem) {
    const copy = { ...m, id: uid(), name: m.name + " · копия", addedAt: Date.now(), deletedAt: undefined };
    change({ ...current.current, items: [...current.current.items, copy] });
    toast.success("Копия создана");
  }
  async function saveEdit(blob: Blob, width: number, height: number, duration?: number) {
    if (!editingItem) return;
    const src = await adapter.upload(blob);
    patchItems([editingItem.id], {
      src,
      originalSrc: editingItem.originalSrc || editingItem.src,
      originalRegion: editingItem.originalRegion || editingItem.region,
      originalWidth: editingItem.originalWidth || editingItem.width,
      originalHeight: editingItem.originalHeight || editingItem.height,
      originalBytes: editingItem.originalBytes || editingItem.bytes,
      originalMime: editingItem.originalMime || editingItem.mime,
      region: undefined,
      width,
      height,
      bytes: blob.size,
      mime: blob.type,
      duration: duration ?? editingItem.duration,
      originalDuration: editingItem.originalDuration ?? editingItem.duration,
      edited: true,
    });
    setEditing(false);
    setEditingItem(null);
    toast.success("Изменения сохранены. Оригинал сохранён отдельно.");
  }
  function restoreOriginal(m: MediaItem) {
    if (!m.originalSrc) return;
    setConfirm({
      title: "Вернуть оригинал?",
      text: "Сохранённые изменения будут отменены.",
      run: () =>
        patchItems([m.id], {
          src: m.originalSrc,
          region: m.originalRegion,
          width: m.originalWidth || m.width,
          height: m.originalHeight || m.height,
          bytes: m.originalBytes || m.bytes,
          mime: m.originalMime || m.mime,
          duration: m.originalDuration ?? m.duration,
          originalDuration: undefined,
          originalWidth: undefined,
          originalHeight: undefined,
          originalBytes: undefined,
          originalMime: undefined,
          originalSrc: undefined,
          originalRegion: undefined,
          edited: false,
        }),
    });
  }
  function beginAlbum() {
    setAlbumName("");
    setAlbumCoverId(
      current.current.items.find((m) => !m.deletedAt && !m.hidden && m.kind !== "video" && (!albumAdd || albumAdd.includes(m.id)))?.id ||
        "",
    );
    setNewAlbum(true);
    setRenameAlbum(null);
  }
  function saveAlbum() {
    if (!albumName.trim()) return;
    if (renameAlbum) change({ ...lib, albums: lib.albums.map((a) => (a.id === renameAlbum ? { ...a, name: albumName.trim() } : a)) });
    else {
      const a: Album = {
        id: uid(),
        name: albumName.trim(),
        coverId: albumCoverId || undefined,
        itemIds: Array.from(new Set([...(albumAdd || []), ...(albumCoverId ? [albumCoverId] : [])])),
        pinned: false,
        group: "album",
      };
      change({ ...current.current, albums: [...current.current.albums, a] });
      if (!albumAdd) {
        openAlbum(a.id);
        setPickerSelected(new Set(a.itemIds));
        setAlbumPicker(a.id);
      }
    }
    setNewAlbum(false);
    setRenameAlbum(null);
    setAlbumAdd(null);
  }
  function card(m: MediaItem, index: number, extra = "") {
    return (
      <button
        key={m.id}
        className={`vm-media-card ${extra} ${selected.has(m.id) ? "selected" : ""} ${m.kind === "video" ? "video" : ""}`}
        style={view.layout === "mosaic" ? ({ "--ratio": m.width / (m.height || 1) } as React.CSSProperties) : undefined}
        aria-label={selecting ? `Выбрать ${m.name}` : `Открыть ${m.name}`}
        data-media-id={m.id}
        aria-pressed={selecting ? selected.has(m.id) : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          cancelPress();
          setContextId(m.id);
        }}
        onPointerDown={(e) => (selecting ? paintSelection.down(e, m.id) : startPress(e, m.id))}
        onPointerMove={(e) => {
          if (selecting) {
            paintSelection.move(e);
            return;
          }
          if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress();
        }}
        onPointerUp={(e) => {
          paintSelection.end(e);
          cancelPress();
        }}
        onPointerCancel={() => {
          paintSelection.cancel();
          cancelPress();
        }}
        onClick={() => {
          if (paintSelection.consumeClick()) return;
          if (suppressOpen.current > Date.now()) {
            suppressOpen.current = 0;
            return;
          }
          if (selecting) toggleSelect(m.id);
          else {
            setViewId(m.id);
            setInfoOpen(false);
          }
        }}
      >
        <MediaImage item={m} resolveSrc={resolveSrc} />
        {selecting ? (
          <span className="vm-pick">{selected.has(m.id) && <Check size={15} />}</span>
        ) : (
          m.favorite && (
            <span className="vm-favorite">
              <Heart size={16} fill="currentColor" />
            </span>
          )
        )}
        {m.kind === "video" && (
          <span className="vm-video-badge">
            <Video size={13} />
            {durationLabel(m.duration)}
          </span>
        )}
        {m.kind === "screenshot" && (
          <span className="vm-type-badge">
            <Scan size={14} />
          </span>
        )}
        {view.layout === "list" && (
          <div className="vm-list-caption">
            <strong>{m.name}</strong>
            <span>
              {kindNames[m.kind]} · {new Date(m.capturedAt).toLocaleDateString("ru-RU")} · {m.demo ? "Пример" : humanBytes(m.bytes)}
            </span>
          </div>
        )}
      </button>
    );
  }
  const albumCover = (a: Album) =>
    lib.items.find((m) => m.id === a.coverId && a.itemIds.includes(m.id) && !m.deletedAt && !m.hidden) ||
    lib.items.find((m) => a.itemIds.includes(m.id) && !m.deletedAt && !m.hidden);
  const albumCard = (a: Album) => (
    <div className="vm-album" key={a.id}>
      <button className="vm-album-main" onClick={() => openAlbum(a.id)}>
        {albumCover(a) ? (
          <MediaImage item={albumCover(a)!} resolveSrc={resolveSrc} />
        ) : (
          <div className="vm-album-empty">
            <AlbumIcon />
          </div>
        )}
        <div className="vm-album-caption">
          <strong>{a.name}</strong>
          <span>{a.itemIds.filter((id) => lib.items.some((m) => m.id === id && !m.deletedAt && !m.hidden)).length} объектов</span>
        </div>
        {a.pinned && (
          <span className="vm-pin">
            <Pin size={14} fill="currentColor" />
          </span>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="vm-album-more" aria-label={"Меню альбома " + a.name}>
            <MoreHorizontal size={18} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="vm-action-menu" align="end">
          <DropdownMenuItem onClick={() => openAlbumPicker(a.id)}>
            <Images />
            Добавить фотографии
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setAlbumCoverId(a.coverId || a.itemIds[0] || "");
              setCoverForAlbum(a.id);
            }}
          >
            <ImageIcon />
            Изменить обложку
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setAlbumName(a.name);
              setRenameAlbum(a.id);
            }}
          >
            <Pencil />
            Переименовать
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => change({ ...lib, albums: lib.albums.map((b) => (b.id === a.id ? { ...b, pinned: !b.pinned } : b)) })}
          >
            <Pin />
            {a.pinned ? "Открепить" : "Закрепить"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              setConfirm({
                title: "Удалить альбом?",
                text: "Фотографии останутся в медиатеке.",
                run: () => change({ ...lib, albums: lib.albums.filter((b) => b.id !== a.id) }),
              })
            }
            className="danger"
          >
            <Trash2 />
            Удалить альбом
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  const categoryButton = (filter: ViewOptions["filter"], label: string, icon: React.ReactNode) => (
    <button className={view.filter === filter && tab === "library" && !albumId ? "active" : ""} onClick={() => navigate(filter)}>
      {icon}
      <span>{label}</span>
    </button>
  );
  const menu = (
    <div className="vm-options">
      <div className="vm-option-layout">
        <button aria-label="Мозаика" className={view.layout === "mosaic" ? "active" : ""} onClick={() => setOptions({ layout: "mosaic" })}>
          <LayoutGrid />
        </button>
        <button aria-label="Сетка" className={view.layout === "grid" ? "active" : ""} onClick={() => setOptions({ layout: "grid" })}>
          <Grid2X2 />
        </button>
        <button aria-label="Список" className={view.layout === "list" ? "active" : ""} onClick={() => setOptions({ layout: "list" })}>
          <List />
        </button>
      </div>
      <div className="vm-date-options">
        <Choice
          label="Дата для сортировки"
          value={view.dateBy}
          onChange={(v) => setOptions({ dateBy: v as ViewOptions["dateBy"] })}
          options={[
            ["addedAt", "Добавлено"],
            ["capturedAt", "Снято"],
          ]}
        />
      </div>
      <p>Фильтровать</p>
      {Object.entries(filterNames)
        .filter(([value]) => value !== "unfiled")
        .map(([value, label]) => (
          <button
            className={"vm-option-row " + (view.filter === value ? "active" : "")}
            key={value}
            onClick={() => {
              setOptions({ filter: value as ViewOptions["filter"] });
              setTab("library");
              setDrawerOpen(false);
            }}
          >
            {value === "favorites" ? (
              <Heart />
            ) : value === "edited" ? (
              <SlidersHorizontal />
            ) : value === "hidden" ? (
              <EyeOff />
            ) : value === "trash" ? (
              <Trash2 />
            ) : value === "unfiled" ? (
              <AlbumIcon />
            ) : (
              <Images />
            )}
            <span>{label}</span>
            {view.filter === value && <Check size={17} />}
          </button>
        ))}
      <div className="vm-menu-separator" />
      <p>Порядок фотографий</p>
      <button
        className={"vm-option-row " + (view.order === "newest-top" ? "active" : "")}
        onClick={() => setOptions({ order: "newest-top" })}
      >
        <ArrowUpDown />
        <span>Самые новые сверху</span>
        {view.order === "newest-top" && <Check size={16} />}
      </button>
      <button
        className={"vm-option-row " + (view.order === "newest-bottom" ? "active" : "")}
        onClick={() => setOptions({ order: "newest-bottom" })}
      >
        <ArrowUpDown />
        <span>Самые новые снизу</span>
        {view.order === "newest-bottom" && <Check size={16} />}
      </button>
      {tab === "collections" && (
        <button className="vm-option-row" onClick={() => setCollapse(!collapse)}>
          <Columns2 />
          <span>{collapse ? "Развернуть разделы" : "Свернуть разделы"}</span>
        </button>
      )}
    </div>
  );
  const contextItem = lib.items.find((m) => m.id === contextId);
  const pickable = lib.items.filter((m) => !m.deletedAt && !m.hidden);
  const coverItem = lib.items.find((m) => m.id === albumCoverId) || pickable[0];
  function switchTab(next: string) {
    cancelPress();
    setTab(next);
    setAlbumId("");
    setQuery("");
    setSelecting(false);
    setSelected(new Set());
    stage.current?.scrollTo({ top: 0, behavior: "smooth" });
  }
  function changeDensity(delta: number) {
    const next = galleryDensity(densityRef.current + delta);
    densityRef.current = next;
    setDensity(next);
    setOptions({ layout: "grid" });
    try {
      localStorage.setItem("voidex-media-density", String(next));
    } catch {}
  }
  function cancelPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }
  function startPress(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return;
    cancelPress();
    suppressOpen.current = 0;
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        suppressOpen.current = Date.now() + 700;
        setContextId(id);
        press.current = null;
      }, 500),
    };
  }
  function startSwipe(e: React.TouchEvent) {
    const t = e.touches[0]!;
    swipeStart.current = {
      x: t.clientX,
      y: t.clientY,
      blocked: e.touches.length !== 1 || !!(e.target as Element).closest(".vm-type-scroll,input,textarea,[role=slider],.vm-album-banner"),
    };
  }
  function endSwipe(e: React.TouchEvent) {
    const p = swipeStart.current;
    swipeStart.current = null;
    if (!p || p.blocked || albumId || selecting || contextId) return;
    const t = e.changedTouches[0]!;
    const dx = t.clientX - p.x,
      dy = t.clientY - p.y;
    const next = swipeSection(dx, dy);
    if (next) {
      cancelPress();
      suppressOpen.current = Date.now() + 700;
      switchTab(next);
    }
  }
  function openAlbumPicker(id: string) {
    const a = current.current.albums.find((a) => a.id === id);
    setPickerSelected(new Set(a?.itemIds || []));
    setAlbumPicker(id);
  }
  function saveAlbumPicker() {
    change({
      ...current.current,
      albums: current.current.albums.map((a) =>
        a.id === albumPicker
          ? { ...a, itemIds: Array.from(pickerSelected), coverId: a.coverId && pickerSelected.has(a.coverId) ? a.coverId : undefined }
          : a,
      ),
    });
    setAlbumPicker("");
    toast.success("Альбом обновлён");
  }
  useEffect(() => {
    try {
      const n = Number(localStorage.getItem("voidex-media-density"));
      if (n >= 2 && n <= 8) {
        densityRef.current = n;
        setDensity(n);
      }
    } catch {}
    return cancelPress;
  }, []);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const distance = (ts: TouchList) => Math.hypot(ts[0]!.clientX - ts[1]!.clientX, ts[0]!.clientY - ts[1]!.clientY);
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        cancelPress();
        swipeStart.current = null;
        pinch.current = distance(e.touches);
        e.preventDefault();
      }
    };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinch.current === null) return;
      e.preventDefault();
      const d = distance(e.touches),
        ratio = d / pinch.current;
      const step = pinchStep(ratio);
      if (step) {
        changeDensity(step);
        pinch.current = d;
      }
    };
    const end = () => {
      pinch.current = null;
      cancelPress();
    };
    let last = 0;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (Date.now() - last < 140) return;
      last = Date.now();
      changeDensity(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("wheel", wheel);
    };
  }, [loaded, editing]);
  function openSearch() {
    // iOS requires focus inside the original user gesture, without a timeout.
    flushSync(() => setSearchOpen(true));
    searchInput.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardHeight(keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop, viewport.scale));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  useEffect(() => {
    if (!adapter.subscribe) return;
    return adapter.subscribe(async () => {
      if (dirty.current || busy.current) {
        toast.info("В медиатеке появились новые файлы. Сохраните изменения и обновите страницу.");
        return;
      }
      try {
        const snapshot = current.current;
        const next = await adapter.load();
        if (disposed.current || dirty.current || snapshot !== current.current || next.revision < revision.current) return;
        current.current = next.data;
        setLib(next.data);
        revision.current = next.revision;
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }, [adapter]);
  if (!loaded)
    return (
      <div className="vm-loading">
        <img src={assetBase + "/media-logo.jpeg"} alt="Медиатека Voidex" />
        <h1>{error ? "Не удалось открыть медиатеку" : "Медиатека"}</h1>
        <p>{error || "Открываем ваши фотографии…"}</p>
        {error && (
          <button className="vm-primary" onClick={() => location.reload()}>
            Повторить
          </button>
        )}
      </div>
    );
  if (editing && editingItem)
    return (
      <div className={"vm-app " + (embedded ? "embedded" : "")}>
        <Toaster />
        <React.Suspense fallback={null}>
        {editingItem.kind === "video" ? (
          <VideoEditor
            item={editingItem}
            resolveSrc={resolveSrc}
            onCancel={() => {
              setEditing(false);
              setEditingItem(null);
            }}
            onSave={saveEdit}
          />
        ) : (
          <PhotoEditor
            item={editingItem}
            resolveSrc={resolveSrc}
            onCancel={() => {
              setEditing(false);
              setEditingItem(null);
            }}
            onSave={saveEdit}
          />
        )}
        </React.Suspense>
      </div>
    );
  const overview =
    tab === "library" &&
    !query &&
    !albumId &&
    view.filter === "all" &&
    view.kind === "all" &&
    view.order === "newest-top" &&
    view.layout === "mosaic" &&
    !selecting;
  const recent = overview ? items.slice(0, 4) : [];
  const gridItems = overview ? items.slice(4) : items;
  return (
    <div
      ref={root}
      className={"vm-app " + (embedded ? "embedded" : "")}
      style={
        {
          "--vm-keyboard-inset": `${keyboardHeight}px`,
          "--vm-cols": density,
          "--vm-desktop-cols": Math.min(9, density + 1),
        } as React.CSSProperties
      }
    >
      <Toaster position="bottom-center" />
      <input
        hidden
        ref={file}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />
      <SidebarProvider className="vm-sidebar-provider" style={{ "--sidebar-width": "215px" } as React.CSSProperties}>
        <Sidebar collapsible="none" className="vm-sidebar">
          <div className="vm-wordmark">VOIDEX</div>
          <SidebarContent>
            <nav>
              {categoryButton("all", "Медиатека", <Images size={19} />)}
              <button
                className={tab === "collections" ? "active" : ""}
                onClick={() => {
                  setTab("collections");
                  setAlbumId("");
                  setQuery("");
                }}
              >
                <AlbumIcon size={19} />
                Коллекции
              </button>
              {categoryButton("favorites", "Избранное", <Heart size={19} />)}
              <div className="vm-nav-gap" />
              {categoryButton("edited", "Изменённые", <SlidersHorizontal size={18} />)}
              <button onClick={() => navigate("all", "screenshot")} className={view.kind === "screenshot" ? "active" : ""}>
                <Scan size={18} />
                Скриншоты
              </button>
              <button onClick={() => navigate("all", "video")} className={view.kind === "video" ? "active" : ""}>
                <Video size={18} />
                Видео
              </button>
              {categoryButton("hidden", "Скрытые", <EyeOff size={18} />)}
              {categoryButton("trash", "Удалённые", <Trash2 size={18} />)}
            </nav>
            <div className="vm-sidebar-albums">
              <span>ВАШИ АЛЬБОМЫ</span>
              {lib.albums
                .filter((a) => a.group === "album")
                .slice(0, 6)
                .map((a) => (
                  <button key={a.id} onClick={() => openAlbum(a.id)} className={albumId === a.id ? "active" : ""}>
                    <AlbumIcon size={16} />
                    {a.name}
                  </button>
                ))}
            </div>
          </SidebarContent>
          <SidebarFooter>
            <div className="vm-storage">
              <span>Файлы в медиатеке</span>
              <strong>{humanBytes(totalBytes)}</strong>
              <p>{lib.items.filter((m) => !m.demo).length} загружено вами</p>
            </div>
            {cloudAvailable ? (
              <button className={"vm-sync " + (status === "Не сохранено" ? "error" : "")} onClick={() => void flush()}>
                <Cloud size={17} />
                {status}
              </button>
            ) : (
              <button className="vm-sync" onClick={() => (onOpenCloud ? onOpenCloud() : setCloudOpen(true))} data-testid="media-cloud-status">
                <CloudOff size={17} />
                Облако VOIDEX недоступно
              </button>
            )}
          </SidebarFooter>
        </Sidebar>
      </SidebarProvider>
      <main
        className="vm-main"
        onTouchStart={startSwipe}
        onTouchEnd={endSwipe}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            if (!albumId) {
              toast.info("Файлы можно добавлять внутри альбома");
              return;
            }
            uploadTarget.current = albumId;
            void upload(e.dataTransfer.files);
          }
        }}
      >
        <div className="vm-sticky-controls">
          <header className="vm-main-header">
            <div className="vm-title">
              {album && (
                <Round
                  label="Назад к коллекциям"
                  onClick={() => {
                    setAlbumId("");
                    setTab("collections");
                  }}
                >
                  <ArrowLeft />
                </Round>
              )}
              <div>
                <h1>
                  {album?.name || (tab === "collections" ? "Коллекции" : view.filter === "all" ? "Медиатека" : filterNames[view.filter])}
                </h1>
                <p>
                  {tab === "collections"
                    ? `${lib.albums.length} коллекций`
                    : selecting
                      ? `Выбрано: ${selected.size}`
                      : `${items.length} объектов`}
                </p>
                {tab === "library" && !albumId && (
                  <button className="vm-cloud-link" onClick={() => (onOpenCloud ? onOpenCloud() : setCloudOpen(true))}>
                    {cloudAvailable ? <Cloud size={14} /> : <CloudOff size={14} />}
                    {cloudAvailable ? "Облако · 5 ГБ" : "Облако VOIDEX"}
                    <ChevronRight size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="vm-top-actions">
              {album && (
                <button className="vm-upload" onClick={() => openAlbumPicker(album.id)}>
                  <Plus size={20} />
                  <span>В альбом</span>
                </button>
              )}
              <Popover open={drawerOpen} onOpenChange={setDrawerOpen}>
                <PopoverTrigger asChild>
                  <button className="vm-round vm-curtain" aria-label="Фильтры и вид медиатеки">
                    <LayoutGrid />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="vm-menu">
                  {menu}
                </PopoverContent>
              </Popover>
              {tab === "library" ? (
                <Round
                  label={selecting ? "Завершить выбор" : "Выбрать файлы"}
                  active={selecting}
                  onClick={() => {
                    setSelecting(!selecting);
                    setSelected(new Set());
                  }}
                >
                  <CheckCircle2 />
                </Round>
              ) : (
                <Round label="Создать альбом" onClick={beginAlbum}>
                  <Plus />
                </Round>
              )}
            </div>
          </header>
          {tab === "library" && (
            <div className="vm-filter-line">
              <ScrollStrip value={view.kind} onChange={(kind) => setOptions({ kind })}>
                <Tabs value={view.kind} onValueChange={(v) => setOptions({ kind: v as ViewOptions["kind"] })}>
                  <TabsList>
                    <TabsTrigger value="all" onMouseDown={(e) => e.preventDefault()} onClick={() => setOptions({ kind: "all" })}>
                      <ImageIcon />
                      Все
                    </TabsTrigger>
                    <TabsTrigger value="photo" onMouseDown={(e) => e.preventDefault()} onClick={() => setOptions({ kind: "photo" })}>
                      <ImageIcon />
                      Фото
                    </TabsTrigger>
                    <TabsTrigger value="video" onMouseDown={(e) => e.preventDefault()} onClick={() => setOptions({ kind: "video" })}>
                      <Video />
                      Видео
                    </TabsTrigger>
                    <TabsTrigger
                      value="screenshot"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setOptions({ kind: "screenshot" })}
                    >
                      <Scan />
                      Скриншоты
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </ScrollStrip>
              {selecting && (
                <button
                  className="vm-text-link"
                  onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((m) => m.id)))}
                >
                  {selected.size === items.length ? "Снять выбор" : "Выбрать все"}
                </button>
              )}
            </div>
          )}
        </div>
        <div className={"vm-scroll " + (selecting ? "is-selecting" : "")} ref={stage}>
          <div className="vm-content" key={tab + view.kind + view.filter + view.layout + albumId}>
            {notice}
            {tab === "library" ? (
              <>
                {album && albumCover(album) && (
                  <div className="vm-album-banner">
                    <MediaImage item={albumCover(album)!} resolveSrc={resolveSrc} />
                    <div>
                      <p>ВАША КОЛЛЕКЦИЯ</p>
                      <h2>{album.name}</h2>
                      <button
                        className="vm-soft"
                        onClick={() => {
                          if (items.length) {
                            setViewId(items[0]!.id);
                            setSlideshow(true);
                          }
                        }}
                      >
                        <Play size={16} /> Слайд-шоу
                      </button>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="vm-round" aria-label="Настройки альбома">
                          <MoreHorizontal />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="vm-action-menu" align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setAlbumName(album.name);
                            setRenameAlbum(album.id);
                          }}
                        >
                          <Pencil />
                          Переименовать
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSelecting(true);
                            setSelected(new Set());
                          }}
                        >
                          Выбрать файлы
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
                {recent.length > 0 && (
                  <section className="vm-recent vm-glass">
                    <div className="vm-section-header">
                      <div>
                        <span className="vm-section-symbol">
                          <Sparkles />
                        </span>
                        <div>
                          <h2>Недавние</h2>
                          <p>Последние добавленные фотографии</p>
                        </div>
                      </div>
                      <button
                        className="vm-text-link"
                        onClick={() => {
                          setOptions({ layout: "grid" });
                          stage.current?.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Смотреть все <ChevronRight size={15} />
                      </button>
                    </div>
                    <div className="vm-recent-grid">{recent.map((m, i) => card(m, i))}</div>
                  </section>
                )}
                {query && (
                  <p className="vm-search-count">
                    По запросу «{query}» · {items.length} объектов
                  </p>
                )}
                {gridItems.length > 0 && <div className={"vm-gallery layout-" + view.layout}>{gridItems.map((m, i) => card(m, i))}</div>}
                {items.length === 0 && (
                  <div className="vm-empty">
                    <Images size={42} />
                    <h2>{query ? "Ничего не найдено" : view.filter === "trash" ? "Корзина пуста" : "Здесь пока нет файлов"}</h2>
                    <p>
                      {query
                        ? "Попробуйте название, место или метку."
                        : view.filter === "favorites"
                          ? "Нажмите на сердечко при просмотре фотографии."
                          : view.filter === "trash"
                            ? "Удалённые фотографии появятся здесь."
                            : albumId
                              ? "Добавьте фотографии из медиатеки в этот альбом."
                              : "Файлы, сохранённые в Voidex, будут появляться здесь после подключения облака."}
                    </p>
                    {albumId && (
                      <button className="vm-primary" onClick={() => openAlbumPicker(albumId)}>
                        Добавить в альбом
                      </button>
                    )}
                  </div>
                )}
                {overview && (
                  <section className="vm-overview-albums">
                    <div className="vm-section-header">
                      <h2>Альбомы</h2>
                      <button className="vm-text-link" onClick={() => setTab("collections")}>
                        Смотреть все <ChevronRight size={15} />
                      </button>
                    </div>
                    <div className="vm-album-grid">
                      {lib.albums.filter((a) => a.group === "album").map(albumCard)}
                      <button className="vm-new-album" onClick={beginAlbum}>
                        <Plus />
                        <strong>Новый альбом</strong>
                      </button>
                    </div>
                  </section>
                )}
              </>
            ) : (
              <div className="vm-collections">
                <div className="vm-quick-collections">
                  <button onClick={() => navigate("favorites")}>
                    <span>
                      <Heart fill="currentColor" />
                    </span>
                    <strong>Избранное</strong>
                    <small>{lib.items.filter((m) => m.favorite && !m.deletedAt && !m.hidden).length}</small>
                  </button>
                  <button onClick={() => navigate("all", "video")}>
                    <span>
                      <Video fill="currentColor" />
                    </span>
                    <strong>Видео</strong>
                    <small>{lib.items.filter((m) => m.kind === "video" && !m.deletedAt && !m.hidden).length}</small>
                  </button>
                  <button onClick={() => navigate("all", "screenshot")}>
                    <span>
                      <Scan />
                    </span>
                    <strong>Скриншоты</strong>
                    <small>{lib.items.filter((m) => m.kind === "screenshot" && !m.deletedAt && !m.hidden).length}</small>
                  </button>
                  <button onClick={() => navigate("trash")}>
                    <span>
                      <Trash2 />
                    </span>
                    <strong>Удалённые</strong>
                    <small>{lib.items.filter((m) => m.deletedAt).length}</small>
                  </button>
                </div>
                {(["memory", "pinned", "album"] as const).map((group) => {
                  const albums = lib.albums.filter((a) =>
                    group === "pinned" ? a.pinned : group === "memory" ? a.group === "memory" : a.group === "album",
                  );
                  if (!albums.length) return null;
                  return (
                    <section className="vm-collection-section vm-glass" key={group}>
                      <div className="vm-section-header">
                        <div>
                          <span className="vm-section-symbol">
                            {group === "memory" ? <Sparkles /> : group === "pinned" ? <Pin /> : <AlbumIcon />}
                          </span>
                          <div>
                            <h2>{group === "memory" ? "Воспоминания" : group === "pinned" ? "Закреплённые" : "Мои альбомы"}</h2>
                            <p>{albums.length} коллекций</p>
                          </div>
                        </div>
                        <button className="vm-text-link" onClick={() => setCollapse(!collapse)}>
                          {collapse ? "Развернуть" : "Свернуть"}
                        </button>
                      </div>
                      {!collapse && (
                        <div className={"vm-album-grid " + (view.layout === "list" ? "album-list" : "")}>
                          {albums.filter((a) => a.name.toLowerCase().includes(query.toLowerCase())).map(albumCard)}
                          {group === "album" && (
                            <button className="vm-new-album" onClick={beginAlbum}>
                              <Plus />
                              <strong>Новый альбом</strong>
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
                <section className="vm-people-section">
                  <div className="vm-section-header">
                    <h2>Люди и метки</h2>
                    <p>Добавьте метки в информации о фото</p>
                  </div>
                  <div className="vm-people">
                    {Array.from(new Set(lib.items.filter((m) => !m.hidden && !m.deletedAt).flatMap((m) => m.tags))).map((tag) => {
                      const m = lib.items.find((m) => m.tags.includes(tag) && !m.deletedAt && !m.hidden)!;
                      return (
                        <button
                          key={tag}
                          onClick={() => {
                            navigate();
                            setQuery(tag);
                          }}
                        >
                          <span>
                            <MediaImage item={m} resolveSrc={resolveSrc} />
                          </span>
                          <strong>{tag}</strong>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </main>
      <nav
        className={"vm-bottom vm-glass " + (searchOpen ? "searching" : "")}
        onPointerDown={(e) => {
          if (searchOpen || e.button !== 0) return;
          dockSuppress.current = false;
          dockDrag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const d = dockDrag.current;
          if (d && swipeDirection(e.clientX - d.x, e.clientY - d.y, 40)) e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          const d = dockDrag.current;
          dockDrag.current = null;
          if (d) {
            const direction = swipeDirection(e.clientX - d.x, e.clientY - d.y, 40);
            if (direction) {
              dockSuppress.current = true;
              switchTab(direction === 1 ? "collections" : "library");
            }
          }
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => (dockDrag.current = null)}
        onClickCapture={(e) => {
          if (dockSuppress.current) {
            e.preventDefault();
            e.stopPropagation();
            dockSuppress.current = false;
          }
        }}
        aria-label="Медиатека и поиск"
      >
        <div className="vm-bottom-tabs" inert={searchOpen}>
          <span className={"vm-dock-indicator " + (tab === "collections" ? "collections" : "")} />
          <button className={tab === "library" ? "active" : ""} onClick={() => switchTab("library")}>
            <Images />
            <span>Медиатека</span>
          </button>
          <button className={tab === "collections" ? "active" : ""} onClick={() => switchTab("collections")}>
            <AlbumIcon />
            <span>Коллекции</span>
          </button>
          <button className="vm-bottom-search-toggle" aria-label="Поиск" onClick={openSearch}>
            <Search />
          </button>
        </div>
        <div className="vm-bottom-search" inert={!searchOpen}>
          <Search size={20} />
          <input
            ref={searchInput}
            tabIndex={searchOpen ? 0 : -1}
            placeholder={tab === "collections" ? "Поиск коллекций" : "Название, место или метка"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Round
            label="Закрыть поиск"
            onClick={() => {
              searchInput.current?.blur();
              setSearchOpen(false);
              setQuery("");
            }}
          >
            <X size={18} />
          </Round>
        </div>
      </nav>
      {selecting && (
        <div className="vm-selection-bar vm-glass">
          <div>
            <strong>{selected.size} выбрано</strong>
            <button
              className="vm-text-link"
              onClick={() => {
                setSelecting(false);
                setSelected(new Set());
              }}
            >
              Готово
            </button>
          </div>
          <div>
            {view.filter === "trash" ? (
              <>
                <button
                  className="vm-action"
                  disabled={!chosen.length}
                  onClick={() => {
                    patchItems(
                      chosen.map((m) => m.id),
                      { deletedAt: undefined },
                    );
                    setSelected(new Set());
                    toast.success("Файлы восстановлены");
                  }}
                >
                  <RotateCcw />
                  Восстановить
                </button>
                <button className="vm-action danger" disabled={!chosen.length} onClick={() => erase(chosen.map((m) => m.id))}>
                  <Trash2 />
                  Удалить навсегда
                </button>
              </>
            ) : (
              <>
                <button className="vm-action" disabled={!chosen.length || shareBusy} onClick={() => void share(chosen)}>
                  <Share2 />
                  Поделиться
                </button>
                <button className="vm-action" disabled={!chosen.length} onClick={() => setAlbumAdd(chosen.map((m) => m.id))}>
                  <FolderPlus />В альбом
                </button>
                <button
                  className="vm-action"
                  disabled={!chosen.length}
                  onClick={() =>
                    patchItems(
                      chosen.map((m) => m.id),
                      { favorite: !chosen.every((m) => m.favorite) },
                    )
                  }
                >
                  <Heart />
                  Избранное
                </button>
                <button className="vm-action" disabled={!chosen.length || shareBusy} onClick={() => void download(chosen)}>
                  <Download />
                  Скачать
                </button>
                <button className="vm-action danger" disabled={!chosen.length} onClick={() => trash(chosen.map((m) => m.id))}>
                  <Trash2 />
                  Удалить
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={newAlbum || !!renameAlbum}
        onOpenChange={(v) => {
          if (!v) {
            setNewAlbum(false);
            setRenameAlbum(null);
          }
        }}
      >
        <DialogContent className="vm-album-create vm-dialog" showCloseButton={false}>
          <header>
            <Round
              label="Отмена"
              onClick={() => {
                setNewAlbum(false);
                setRenameAlbum(null);
              }}
            >
              <X />
            </Round>
            <DialogTitle>{renameAlbum ? "Название альбома" : "Новый альбом"}</DialogTitle>
            <Round label="Сохранить альбом" disabled={!albumName.trim()} onClick={saveAlbum}>
              <Check />
            </Round>
          </header>
          <DialogDescription className="sr-only">
            Назовите альбом и выберите его обложку. Затем добавьте фотографии из медиатеки.
          </DialogDescription>
          {!renameAlbum && (
            <>
              <div className="vm-cover-preview">
                {coverItem ? <MediaImage item={coverItem} resolveSrc={resolveSrc} /> : <AlbumIcon size={64} />}
              </div>
              <p className="vm-cover-label">Обложка альбома</p>
              <div className="vm-cover-strip">
                {pickable
                  .filter((m) => m.kind !== "video")
                  .map((m) => (
                    <button
                      key={m.id}
                      className={albumCoverId === m.id ? "active" : ""}
                      aria-label={"Обложка: " + m.name}
                      onClick={() => setAlbumCoverId(m.id)}
                    >
                      <MediaImage item={m} resolveSrc={resolveSrc} />
                    </button>
                  ))}
              </div>
            </>
          )}
          <input
            className="vm-album-name"
            autoFocus
            aria-label="Название альбома"
            placeholder="Название альбома"
            value={albumName}
            maxLength={120}
            onChange={(e) => setAlbumName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveAlbum()}
          />
          {!renameAlbum && <p className="vm-cover-label">Дальше: выбор фотографий</p>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!albumPicker && !newAlbum} onOpenChange={(v) => !v && setAlbumPicker("")}>
        <DialogContent className="vm-album-select vm-dialog" showCloseButton={false}>
          <header>
            <Round label="Отмена выбора" onClick={() => setAlbumPicker("")}>
              <X />
            </Round>
            <div>
              <DialogTitle>Добавить в альбом</DialogTitle>
              <DialogDescription>{pickerSelected.size} выбрано</DialogDescription>
            </div>
            <Round label="Готово" onClick={saveAlbumPicker}>
              <Check />
            </Round>
          </header>
          <div className="vm-album-select-grid">
            {pickable.map((m) => (
              <button
                className={"vm-media-card " + (pickerSelected.has(m.id) ? "selected" : "")}
                key={m.id}
                aria-label={"Выбрать " + m.name}
                aria-pressed={pickerSelected.has(m.id)}
                onClick={() =>
                  setPickerSelected((old) => {
                    const n = new Set(old);
                    n.has(m.id) ? n.delete(m.id) : n.add(m.id);
                    return n;
                  })
                }
              >
                <MediaImage item={m} resolveSrc={resolveSrc} />
                <span className="vm-pick">{pickerSelected.has(m.id) && <Check size={15} />}</span>
              </button>
            ))}
          </div>
          <button
            className="vm-soft"
            disabled={uploading > 0}
            onClick={() => {
              uploadTarget.current = albumPicker;
              file.current?.click();
            }}
          >
            <Upload size={16} />
            {uploading ? "Загрузка…" : "Загрузить файлы в альбом"}
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={!!coverForAlbum} onOpenChange={(v) => !v && setCoverForAlbum("")}>
        <DialogContent className="vm-dialog">
          <DialogTitle>Обложка альбома</DialogTitle>
          <DialogDescription>Выберите фотографию из альбома.</DialogDescription>
          <div className="vm-album-select-grid">
            {pickable
              .filter((m) => m.kind !== "video" && lib.albums.find((a) => a.id === coverForAlbum)?.itemIds.includes(m.id))
              .map((m) => (
                <button
                  key={m.id}
                  className="vm-media-card"
                  onClick={() => {
                    change({
                      ...current.current,
                      albums: current.current.albums.map((a) => (a.id === coverForAlbum ? { ...a, coverId: m.id } : a)),
                    });
                    setCoverForAlbum("");
                  }}
                >
                  <MediaImage item={m} resolveSrc={resolveSrc} />
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={cloudOpen} onOpenChange={setCloudOpen}>
        <DialogContent className="vm-dialog">
          <DialogTitle>Облако Voidex</DialogTitle>
          <DialogDescription>
            Стартовый пакет: 5 ГБ для каждого пользователя. Позже можно будет увеличить объём. Облако ещё не подключено.
          </DialogDescription>
          <p>После подключения все сохранённые в Voidex фото, видео и скриншоты будут автоматически появляться в медиатеке.</p>
        </DialogContent>
      </Dialog>
      <Dialog open={!!contextItem} onOpenChange={(v) => !v && setContextId("")}>
        <DialogContent className="vm-context-sheet" showCloseButton={false}>
          <DialogTitle className="sr-only">{contextItem?.name}</DialogTitle>
          <DialogDescription className="sr-only">Быстрые действия с выбранным файлом</DialogDescription>
          {contextItem && (
            <>
              <button
                className="vm-context-preview"
                aria-label="Открыть полностью"
                onClick={() => {
                  setViewId(contextItem.id);
                  setInfoOpen(false);
                  setContextId("");
                }}
              >
                <MediaImage item={contextItem} resolveSrc={resolveSrc} contain />
              </button>
              <div className="vm-context-menu vm-glass">
                <div className="vm-context-quick">
                  <button
                    disabled={contextItem.kind === "video"}
                    onClick={() => {
                      setContextId("");
                      void copyImage(contextItem, resolveSrc).catch((e) => toast.error(e.message));
                    }}
                  >
                    <Copy />
                    Скопировать
                  </button>
                  <button
                    onClick={() => {
                      duplicate(contextItem);
                      setContextId("");
                    }}
                  >
                    <Copy />
                    Дублировать
                  </button>
                  <button
                    onClick={() => {
                      patchItems([contextItem.id], { hidden: !contextItem.hidden });
                      setContextId("");
                    }}
                  >
                    <EyeOff />
                    {contextItem.hidden ? "Показать" : "Скрыть"}
                  </button>
                </div>
                <button
                  onClick={() => {
                    setContextId("");
                    void share([contextItem]);
                  }}
                >
                  <Share2 />
                  Поделиться
                </button>
                <button
                  onClick={() => {
                    patchItems([contextItem.id], { favorite: !contextItem.favorite });
                    setContextId("");
                  }}
                >
                  <Heart />
                  {contextItem.favorite ? "Убрать из избранного" : "В избранное"}
                </button>
                <button
                  onClick={() => {
                    setAlbumAdd([contextItem.id]);
                    setContextId("");
                  }}
                >
                  <FolderPlus />
                  Добавить в альбом
                </button>
                <button
                  onClick={() => {
                    setViewId(contextItem.id);
                    setInfoOpen(true);
                    setContextId("");
                  }}
                >
                  <Info />
                  Информация
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    setContextId("");
                    contextItem.deletedAt ? erase([contextItem.id]) : trash([contextItem.id]);
                  }}
                >
                  <Trash2 />
                  Удалить
                </button>
              </div>
              <button className="vm-context-close vm-round" aria-label="Закрыть меню" onClick={() => setContextId("")}>
                <X />
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!albumAdd && !newAlbum} onOpenChange={(v) => !v && setAlbumAdd(null)}>
        <DialogContent className="vm-dialog">
          <DialogTitle>Добавить в альбом</DialogTitle>
          <DialogDescription>Выбрано файлов: {albumAdd?.length || 0}</DialogDescription>
          <div className="vm-album-picker">
            {lib.albums
              .filter((a) => a.group === "album")
              .map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    const ids = albumAdd || [];
                    change({
                      ...lib,
                      albums: lib.albums.map((b) => (b.id === a.id ? { ...b, itemIds: Array.from(new Set([...b.itemIds, ...ids])) } : b)),
                    });
                    setAlbumAdd(null);
                    toast.success("Добавлено в «" + a.name + "»");
                  }}
                >
                  <AlbumIcon />
                  <span>{a.name}</span>
                  <ChevronRight size={18} />
                </button>
              ))}
          </div>
          <button className="vm-soft" onClick={beginAlbum}>
            <Plus /> Создать альбом
          </button>
          {albumId && (
            <button
              className="vm-reset"
              onClick={() => {
                const ids = new Set(albumAdd || []);
                change({
                  ...lib,
                  albums: lib.albums.map((a) =>
                    a.id === albumId
                      ? {
                          ...a,
                          itemIds: a.itemIds.filter((id) => !ids.has(id)),
                          coverId: a.coverId && ids.has(a.coverId) ? undefined : a.coverId,
                        }
                      : a,
                  ),
                });
                setAlbumAdd(null);
              }}
            >
              Убрать из текущего альбома
            </button>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent className="vm-dialog">
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.text}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirm?.run();
                setConfirm(null);
              }}
            >
              Подтвердить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {viewer && (
        <Dialog
          open={!!viewer && !viewerClosing}
          onOpenChange={(v) => {
            if (!v) {
              closeViewer();
              setSlideshow(false);
            }
          }}
        >
          <DialogPortal>
            <DialogPrimitive.Content className="vm-viewer" style={{ position: "fixed", inset: 0, translate: "none", transform: "none" }}>
              <DialogTitle className="sr-only">{viewer.name}</DialogTitle>
              <DialogDescription className="sr-only">Просмотр выбранного файла</DialogDescription>
              <div className={"vm-viewer-shell " + (infoOpen ? "with-info" : "")}>
                <div className="vm-viewer-left">
                  <header className="vm-viewer-header">
                    <Round
                      label="Назад в медиатеку"
                      onClick={() => {
                        closeViewer();
                        setSlideshow(false);
                        setZoom(false);
                      }}
                    >
                      <ChevronLeft />
                    </Round>
                    <div>
                      <strong>
                        {new Date(viewer.capturedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
                      </strong>
                      <span>{viewer.name}</span>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="vm-round" aria-label="Действия с файлом">
                          <MoreHorizontal />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="vm-action-menu" align="end">
                        <DropdownMenuItem onClick={() => setAlbumAdd([viewer.id])}>Сохранить в альбом</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => patchItems([viewer.id], { favorite: !viewer.favorite })}>
                          {viewer.favorite ? "Убрать из избранного" : "Добавить в избранное"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            void copyImage(viewer, resolveSrc)
                              .then(() => toast.success("Изображение скопировано"))
                              .catch((e) => toast.error(e.message))
                          }
                          disabled={viewer.kind === "video"}
                        >
                          Скопировать изображение
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => duplicate(viewer)}>Дублировать</DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            patchItems([viewer.id], { hidden: !viewer.hidden });
                            closeViewer();
                          }}
                        >
                          {viewer.hidden ? "Показать в медиатеке" : "Скрыть"}
                        </DropdownMenuItem>
                        {viewer.originalSrc && (
                          <DropdownMenuItem onClick={() => restoreOriginal(viewer)}>Вернуть оригинал</DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => void download([viewer])}>Скачать файл</DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => (viewer.deletedAt ? erase([viewer.id]) : trash([viewer.id]))}
                        >
                          Удалить
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </header>
                  <div
                    className={"vm-viewer-image " + (zoom ? "zoomed" : "")}
                    onPointerDown={(e) => {
                      if (zoom || e.button !== 0 || (e.target as Element).closest("button,input,[role=slider]")) return;
                      // Keep the native video's bottom playback controls usable.
                      if ((e.target as Element).tagName === "VIDEO" && e.clientY > e.currentTarget.getBoundingClientRect().bottom - 48)
                        return;
                      if (viewerDrag.current) {
                        viewerDrag.current = null;
                        return;
                      }
                      viewerDrag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
                    }}
                    onPointerMove={(e) => {
                      const d = viewerDrag.current;
                      if (d && d.id === e.pointerId && swipeDirection(e.clientX - d.x, e.clientY - d.y, 12))
                        e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerUp={(e) => {
                      const d = viewerDrag.current;
                      viewerDrag.current = null;
                      if (d && d.id === e.pointerId && !zoom) {
                        const direction = swipeDirection(e.clientX - d.x, e.clientY - d.y, 60);
                        if (direction) move(direction);
                      }
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                    }}
                    onPointerCancel={() => (viewerDrag.current = null)}
                    onDoubleClick={() => viewer.kind !== "video" && setZoom(!zoom)}
                  >
                    {viewer.kind === "video" ? (
                      <VideoPlayer key={viewer.id} src={resolveSrc(viewer.src)} name={viewer.name} durationHint={viewer.duration} />
                    ) : (
                      <MediaImage key={viewer.id} item={viewer} resolveSrc={resolveSrc} contain />
                    )}
                    {activeIndex > 0 && (
                      <button className="vm-viewer-prev" aria-label="Предыдущий файл" onClick={() => move(-1)}>
                        <ChevronLeft />
                      </button>
                    )}
                    {activeIndex < viewerList.length - 1 && (
                      <button className="vm-viewer-next" aria-label="Следующий файл" onClick={() => move(1)}>
                        <ChevronRight />
                      </button>
                    )}
                  </div>
                  <div className="vm-filmstrip" ref={filmstrip}>
                    {viewerList.map((m) => (
                      <button
                        key={m.id}
                        className={viewer.id === m.id ? "active" : ""}
                        onClick={() => {
                          setViewId(m.id);
                          setZoom(false);
                        }}
                        aria-label={m.name}
                      >
                        <MediaImage item={m} resolveSrc={resolveSrc} />
                      </button>
                    ))}
                  </div>
                  <footer className="vm-viewer-actions vm-glass">
                    <Round label="Поделиться" disabled={shareBusy} onClick={() => void share([viewer])}>
                      <Share2 />
                    </Round>
                    <Round
                      label={viewer.favorite ? "Убрать из избранного" : "В избранное"}
                      active={viewer.favorite}
                      onClick={() => patchItems([viewer.id], { favorite: !viewer.favorite })}
                    >
                      <Heart fill={viewer.favorite ? "currentColor" : "none"} />
                    </Round>
                    <Round label="Информация" active={infoOpen} onClick={() => setInfoOpen(!infoOpen)}>
                      <Info />
                    </Round>
                    <Round
                      label={viewer.kind === "video" ? "Редактировать видео" : "Редактировать фото"}
                      disabled={!!viewer.deletedAt}
                      onClick={() => {
                        setEditingItem(viewer);
                        setEditing(true);
                      }}
                    >
                      <SlidersHorizontal />
                    </Round>
                    {viewer.deletedAt ? (
                      <Round label="Восстановить" onClick={() => patchItems([viewer.id], { deletedAt: undefined })}>
                        <RotateCcw />
                      </Round>
                    ) : (
                      <Round label="Удалить" onClick={() => trash([viewer.id])}>
                        <Trash2 />
                      </Round>
                    )}
                  </footer>
                </div>
                {infoOpen && (
                  <aside className="vm-info-panel">
                    <header>
                      <h2>Информация</h2>
                      <Round label="Закрыть информацию" onClick={() => setInfoOpen(false)}>
                        <X size={18} />
                      </Round>
                    </header>
                    <label>
                      Название
                      <input value={viewer.name} maxLength={240} onChange={(e) => patchItems([viewer.id], { name: e.target.value })} />
                    </label>
                    <p className="vm-info-date">{new Date(viewer.capturedAt).toLocaleString("ru-RU")}</p>
                    <div className="vm-info-details">
                      <FileImage />
                      <div>
                        <strong>
                          {viewer.width} × {viewer.height}
                        </strong>
                        <span>
                          {viewer.mime} · {humanBytes(viewer.bytes)}
                        </span>
                        {viewer.demo && <small>Демонстрационный файл из макета</small>}
                      </div>
                    </div>
                    <label>
                      Тип
                      <Choice
                        label="Тип файла"
                        value={viewer.kind}
                        onChange={(v) => patchItems([viewer.id], { kind: v as MediaItem["kind"] })}
                        options={
                          viewer.kind === "video"
                            ? [["video", "Видео"]]
                            : [
                                ["photo", "Фото"],
                                ["screenshot", "Скриншот"],
                              ]
                        }
                      />
                    </label>
                    <label>
                      Место
                      <input
                        value={viewer.place}
                        maxLength={240}
                        placeholder="Укажите место"
                        onChange={(e) => patchItems([viewer.id], { place: e.target.value })}
                      />
                    </label>
                    <label>
                      Люди и метки
                      <input
                        value={viewer.tags.join(", ")}
                        placeholder="Имена или метки через запятую"
                        onChange={(e) =>
                          patchItems([viewer.id], {
                            tags: e.target.value
                              .split(",")
                              .map((s) => s.trim().slice(0, 80))
                              .filter(Boolean)
                              .slice(0, 99),
                          })
                        }
                      />
                    </label>
                    <button
                      className="vm-soft"
                      disabled={!!viewer.deletedAt}
                      onClick={() => {
                        setEditingItem(viewer);
                        setEditing(true);
                      }}
                    >
                      <Pencil size={16} /> Редактировать
                    </button>
                    <div className="vm-info-divider" />
                    <h3>Действия</h3>
                    <div className="vm-info-action-grid">
                      <button onClick={() => void share([viewer])}>
                        <Share2 />
                        Поделиться
                      </button>
                      <button onClick={() => setAlbumAdd([viewer.id])}>
                        <FolderPlus />В альбом
                      </button>
                      <button onClick={() => void download([viewer])}>
                        <Download />
                        Скачать
                      </button>
                      {onWallpaper && viewer.kind !== "video" && (
                        <button
                          onClick={() =>
                            void itemBlob(viewer, resolveSrc)
                              .then(onWallpaper)
                              .catch((e) => toast.error(e.message))
                          }
                        >
                          <Monitor />
                          Сделать обои
                        </button>
                      )}
                      {onSendToNotes && (
                        <button onClick={() => void onSendToNotes(viewer).catch((e) => toast.error(e.message))}>
                          <Pencil />В заметки
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const w = window.open("", "_blank");
                          if (!w) {
                            toast.error("Разрешите открытие окна для печати");
                            return;
                          }
                          void itemBlob(viewer, resolveSrc)
                            .then((blob) => {
                              const url = URL.createObjectURL(blob);
                              const img = w.document.createElement("img");
                              img.src = url;
                              img.style.maxWidth = "100%";
                              img.onload = () => {
                                w.print();
                                setTimeout(() => URL.revokeObjectURL(url), 30000);
                              };
                              w.document.body.appendChild(img);
                            })
                            .catch((e) => {
                              w.close();
                              toast.error(e.message);
                            });
                        }}
                        disabled={viewer.kind === "video"}
                      >
                        <FileImage />
                        Печать
                      </button>
                    </div>
                  </aside>
                )}
              </div>
            </DialogPrimitive.Content>
          </DialogPortal>
        </Dialog>
      )}
    </div>
  );
}
