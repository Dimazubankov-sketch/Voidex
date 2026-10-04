"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus,
  Search,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Folder,
  FileText,
  Presentation,
  ImagePlus,
  Play,
  Share2,
  Grid2X2,
  List,
  Check,
  Cloud,
  Undo2,
  Redo2,
  Type,
  Bold,
  Italic,
  Quote,
  Code,
  CheckSquare,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Layers,
  Palette,
  Settings2,
  Upload,
  Camera,
  Download,
  X,
  PanelLeft,
  Mic,
  Pause,
  Monitor,
  Smartphone,
  GripVertical,
  Maximize2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "../../components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
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
import { SidebarProvider, Sidebar, SidebarContent } from "../../components/ui/sidebar";
import { Slider } from "../../components/ui/slider";
import { Switch } from "../../components/ui/switch";
import { Toaster } from "../../components/ui/sonner";
import { toast } from "sonner";
import {
  Workspace,
  Project,
  Space,
  Slide,
  Block,
  BlockKind,
  uid,
  slide,
  space,
  block,
  demoProject,
  plainText,
  backgrounds,
  transitions,
  validWorkspace,
} from "./model";
import { NotesAdapter, httpAdapter } from "./adapter";
import { download, exportHTML, exportProject } from "./export";
import "./notes.css";
const names: Record<string, string> = {
  text: "Текст",
  heading: "Заголовок",
  quote: "Цитата",
  checklist: "Чек-лист",
  code: "Код",
  image: "Изображение",
};
function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button className={"vn-icon " + (active ? "active" : "")} title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly (readonly [string, string])[];
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
function Editable({
  value,
  onChange,
  className,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (s: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerText !== value) ref.current.innerText = value;
  }, [value]);
  return (
    <div
      ref={ref}
      className={"vn-editable " + (className || "")}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-label={placeholder || "Текст"}
      aria-multiline
      data-placeholder={placeholder}
      onInput={(e) => onChange(e.currentTarget.innerText)}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        const sel = window.getSelection();
        if (!sel?.rangeCount) return;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const n = document.createTextNode(text);
        range.insertNode(n);
        range.setStartAfter(n);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        if (ref.current) onChange(ref.current.innerText);
      }}
    />
  );
}
function Cover({ value, className = "" }: { value: string; className?: string }) {
  return (
    <div
      className={"vn-cover bg-" + value + " " + className}
      style={value.startsWith("/api/") ? { backgroundImage: `url("${value}")` } : undefined}
    >
      <FileText strokeWidth={1} />
    </div>
  );
}
function PageCanvas({
  page,
  orientation = "landscape",
  selected,
  onSelect,
  onChange,
  readOnly = false,
  notes = false,
}: {
  page: Slide;
  orientation?: string;
  selected?: string;
  onSelect?: (id: string) => void;
  onChange?: (id: string, patch: Partial<Block>) => void;
  readOnly?: boolean;
  notes?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflow(!notes && el.scrollHeight > el.clientHeight + 3);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    check();
    return () => observer.disconnect();
  }, [page, notes, orientation]);
  return (
    <div className="vn-canvas-wrap">
      <div
        ref={ref}
        className={`vn-canvas bg-${page.background} ${orientation} ${notes ? "note-canvas" : ""}`}
        style={
          page.background.startsWith("/api/")
            ? { backgroundImage: `linear-gradient(#ffffffbd,#ffffffbd),url("${page.background}")`, backgroundSize: "cover" }
            : undefined
        }
      >
        {page.blocks
          .filter((b) => !b.hidden)
          .map((b) => (
            <div
              key={b.id}
              className={`vn-block vn-${b.kind} ${selected === b.id && !readOnly ? "selected" : ""} ${b.locked ? "locked" : ""}`}
              style={
                b.kind === "image"
                  ? {
                      width: `${((orientation === "portrait" ? b.portraitSize || 12 : b.size) / 12) * 100}%`,
                      float: b.align === "center" ? "none" : b.align,
                      marginLeft: b.align === "center" ? "auto" : undefined,
                      marginRight: b.align === "center" ? "auto" : undefined,
                    }
                  : { fontWeight: b.bold ? 700 : undefined, fontStyle: b.italic ? "italic" : undefined, textAlign: b.align }
              }
              onClick={() => onSelect?.(b.id)}
            >
              {b.kind === "image" ? (
                <figure>
                  <img src={b.src} alt={b.text || "Изображение"} draggable={false} />
                  {b.text && <figcaption>{b.text}</figcaption>}
                </figure>
              ) : (
                <>
                  {b.kind === "checklist" && (
                    <button
                      className={"vn-check " + (b.checked ? "done" : "")}
                      onClick={() => !readOnly && !b.locked && onChange?.(b.id, { checked: !b.checked })}
                      aria-label="Отметить пункт"
                      role="checkbox"
                      aria-checked={!!b.checked}
                    >
                      {b.checked && <Check size={14} />}
                    </button>
                  )}
                  {readOnly ? (
                    <div className="vn-text">{b.text}</div>
                  ) : (
                    <Editable
                      value={b.text}
                      onChange={(text) => onChange?.(b.id, { text })}
                      placeholder={b.kind === "heading" ? "Заголовок" : "Начните писать…"}
                      disabled={b.locked}
                    />
                  )}
                </>
              )}
            </div>
          ))}
      </div>
      {overflow && <div className="vn-overflow">Содержимое выходит за слайд. Перенесите часть на новую страницу.</div>}
    </div>
  );
}
export default function NotesApp({
  adapter = httpAdapter,
  logoUrl = "/notes-logo.jpeg",
  embedded = false,
}: {
  adapter?: NotesAdapter;
  logoUrl?: string;
  embedded?: boolean;
}) {
  const [data, setData] = useState<Workspace>({ version: 1, projects: [] });
  const current = useRef(data);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const revision = useRef(0);
  const [status, setStatus] = useState("Сохранено");
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const history = useRef<Workspace[]>([]);
  const future = useRef<Workspace[]>([]);
  const historyAt = useRef(0);
  const [projectId, setProjectId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [listView, setListView] = useState(false);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [sideTab, setSideTab] = useState("slides");
  const [sideOpen, setSideOpen] = useState(true);
  const [mobileSide, setMobileSide] = useState(false);
  const [panel, setPanel] = useState("");
  const [create, setCreate] = useState<"project" | "space" | null>(null);
  const [name, setName] = useState("");
  const [cover, setCover] = useState("lavender");
  const [newMode, setNewMode] = useState<"notes" | "presentation">("notes");
  const [newFormat, setNewFormat] = useState<Space["format"]>("both");
  const [editingName, setEditingName] = useState<"project" | "space" | null>(null);
  const [remove, setRemove] = useState<{
    label: string;
    run: () => void;
  } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(35);
  const [fontSize, setFontSize] = useState(36);
  const prompter = useRef<HTMLDivElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareToken, setShareToken] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [links, setLinks] = useState<
    {
      token: string;
      name: string;
      created: number;
    }[]
  >([]);
  const [readOnly, setReadOnly] = useState(false);
  const [direction, setDirection] = useState(1);
  const touch = useRef(0);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const coverFile = useRef<HTMLInputElement>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const project = data.projects.find((p) => p.id === projectId);
  const doc = project?.spaces.find((s) => s.id === spaceId);
  const page = doc?.slides[Math.min(pageIndex, (doc?.slides.length || 1) - 1)];
  const selectedBlock = page?.blocks.find((b) => b.id === selected);
  const flush = useCallback(async () => {
    if (saving.current || !dirty.current) return;
    saving.current = true;
    const snapshot = current.current;
    setStatus("Сохраняем…");
    try {
      revision.current = await adapter.save(snapshot, revision.current);
      if (snapshot === current.current) {
        dirty.current = false;
        setStatus("Сохранено");
      } else {
        setStatus("Есть изменения");
      }
    } catch (e) {
      setStatus("Не сохранено");
      toast.error((e as Error).message);
    } finally {
      saving.current = false;
      if (dirty.current && snapshot !== current.current) timer.current = setTimeout(() => void flush(), 700);
    }
  }, [adapter]);
  const change = useCallback(
    (next: Workspace, group = false) => {
      if (readOnly) return;
      if (!group || Date.now() - historyAt.current > 1000) {
        history.current = [...history.current.slice(-39), current.current];
        historyAt.current = Date.now();
      }
      future.current = [];
      current.current = next;
      setData(next);
      dirty.current = true;
      setStatus("Есть изменения");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 850);
    },
    [flush, readOnly],
  );
  useEffect(() => {
    let cancelled = false;
    const token = new URLSearchParams(location.search).get("share");
    (async () => {
      try {
        if (token) {
          const shared = await adapter.readShare(token);
          if (cancelled) return;
          const p: Project =
            "spaces" in shared ? shared : { id: "shared", name: shared.name, cover: shared.cover, updated: 0, spaces: [shared] };
          const w: Workspace = { version: 1, projects: [p] };
          current.current = w;
          setData(w);
          setProjectId(p.id);
          if (p.spaces.length === 1) {
            setSpaceId(p.spaces[0].id);
            setPlaying(true);
          }
          setReadOnly(true);
        } else {
          const result = await adapter.load();
          if (cancelled) return;
          current.current = result.data;
          setData(result.data);
          revision.current = result.revision;
        }
        setLoaded(true);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter]);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, []);
  useEffect(() => {
    if (doc) setSideOpen(doc.mode === "presentation");
  }, [doc?.id, doc?.mode]);
  useEffect(() => {
    if (doc?.format !== "both" && doc) setOrientation(doc.format);
    else if (doc) setOrientation((document.querySelector(".vn-app")?.clientWidth || window.innerWidth) < 560 ? "portrait" : "landscape");
  }, [doc?.id, doc?.format]);
  const updateDoc = (fn: (s: Space) => Space, group = false) => {
    if (!project || !doc) return;
    change(
      {
        ...current.current,
        projects: current.current.projects.map((p) =>
          p.id === project.id
            ? { ...p, updated: Date.now(), spaces: p.spaces.map((s) => (s.id === doc.id ? { ...fn(s), updated: Date.now() } : s)) }
            : p,
        ),
      },
      group,
    );
  };
  const updatePage = (fn: (p: Slide) => Slide) =>
    updateDoc((s) => ({ ...s, slides: s.slides.map((p) => (p.id === page?.id ? fn(p) : p)) }));
  const updateBlock = (id: string, patch: Partial<Block>, pageId = page?.id) =>
    updateDoc(
      (s) => ({
        ...s,
        slides: s.slides.map((p) =>
          p.id === pageId
            ? {
                ...p,
                blocks: p.blocks.map((b) =>
                  b.id === id && (!b.locked || Object.keys(patch).every((k) => ["locked", "hidden", "label"].includes(k)))
                    ? { ...b, ...patch }
                    : b,
                ),
              }
            : p,
        ),
      }),
      true,
    );
  const openSpace = (pid: string, sid: string) => {
    setProjectId(pid);
    setSpaceId(sid);
    setPageIndex(0);
    setSelected("");
    setQuery("");
  };
  const movePage = (delta: number) => {
    if (!doc) return;
    setDirection(delta);
    setPageIndex((i) => {
      const next = Math.max(0, Math.min(doc.slides.length - 1, i + delta));
      if (doc.mode === "notes" && doc.flow === "vertical" && !playing)
        document
          .querySelector('[data-page-index="' + next + '"]')
          ?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      return next;
    });
    setSelected("");
  };
  const addBlock = (kind: BlockKind) => {
    const b = block(kind);
    if (kind === "heading") b.text = "Заголовок";
    updatePage((p) => ({ ...p, blocks: [...p.blocks, b] }));
    setSelected(b.id);
  };
  const addPage = () => {
    if (!doc) return;
    const next = slide();
    updateDoc((s) => ({ ...s, slides: [...s.slides.slice(0, pageIndex + 1), next, ...s.slides.slice(pageIndex + 1)] }));
    setPageIndex(pageIndex + 1);
    setSelected("");
  };
  const reorderBlock = (id: string, d: number) =>
    updatePage((p) => {
      const bs = [...p.blocks];
      const from = bs.findIndex((b) => b.id === id);
      const to = Math.max(0, Math.min(bs.length - 1, from + d));
      bs.splice(to, 0, bs.splice(from, 1)[0]);
      return { ...p, blocks: bs };
    });
  const undo = (redo = false) => {
    const stack = redo ? future : history;
    const next = stack.current.pop();
    if (!next) return;
    (redo ? history : future).current.push(current.current);
    current.current = next;
    setData(next);
    dirty.current = true;
    setStatus("Есть изменения");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlaying(false);
        setPrompting(false);
        setRunning(false);
      }
      if (playing && !(e.target instanceof HTMLInputElement)) {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          movePage(1);
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          movePage(-1);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [playing, doc, flush]);
  useEffect(() => {
    if (!prompting || !running) return;
    let last = 0,
      id = 0,
      position = prompter.current?.scrollTop || 0;
    const tick = (t: number) => {
      if (last && prompter.current) {
        position += ((t - last) / 1000) * speed;
        prompter.current.scrollTop = position;
        if (position >= prompter.current.scrollHeight - prompter.current.clientHeight) {
          setRunning(false);
          return;
        }
      }
      last = t;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [prompting, running, speed]);
  useEffect(() => {
    const ctx = (
      document as unknown as {
        modelContext?: {
          registerTool: Function;
        };
      }
    ).modelContext;
    if (!ctx) return;
    const abort = new AbortController();
    try {
      Promise.resolve(
        ctx.registerTool(
          {
            name: "list_note_projects",
            description: "List saved projects and note titles currently visible in Voidex Notes.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: () => ({
              projects: current.current.projects.map((p) => ({
                id: p.id,
                name: p.name,
                spaces: p.spaces.map((s) => ({ id: s.id, name: s.name })),
              })),
            }),
          },
          { signal: abort.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => abort.abort();
  }, []);
  async function uploadImage(f?: File, asCover = false) {
    if (!f) return;
    if (f.size > 12000000) {
      toast.error("Изображение должно быть меньше 12 МБ");
      return;
    }
    setUploading(true);
    try {
      const src = await adapter.upload(f);
      if (asCover) setCover(src);
      else {
        const b = { ...block("image"), src, size: 6, text: "" };
        updatePage((p) => ({ ...p, blocks: [...p.blocks, b] }));
        setSelected(b.id);
        setPanel("image");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  function createItem() {
    if (!name.trim()) return;
    if (editingName) {
      if (editingName === "project" && project)
        change({ ...data, projects: data.projects.map((p) => (p.id === project.id ? { ...p, name: name.trim(), cover } : p)) });
      else updateDoc((s) => ({ ...s, name: name.trim(), cover }));
      setEditingName(null);
      return;
    }
    if (create === "project") {
      const p: Project = { id: uid(), name: name.trim(), cover, updated: Date.now(), spaces: [] };
      change({ ...data, projects: [...data.projects, p] });
      setProjectId(p.id);
    } else if (project) {
      const s = { ...space(name.trim(), newMode, newFormat), cover };
      change({ ...data, projects: data.projects.map((p) => (p.id === project.id ? { ...p, spaces: [...p.spaces, s] } : p)) });
      setSpaceId(s.id);
      setPageIndex(0);
    }
    setCreate(null);
    setName("");
  }
  function startCreate(kind: "project" | "space") {
    setName("");
    setCover("lavender");
    setCreate(kind);
  }
  async function exportCurrent() {
    const target = doc || project;
    if (!target) return;
    try {
      await exportHTML(target);
      toast.success("Файл HTML готов");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function importProject(f?: File) {
    if (!f) return;
    try {
      if (f.size > 80000000) throw new Error("Файл проекта должен быть меньше 80 МБ");
      const w = JSON.parse(await f.text());
      if (!validWorkspace(w)) throw new Error("Этот файл не является проектом Voidex");
      const assets =
        (
          w as Workspace & {
            assets?: Record<string, string>;
          }
        ).assets || {};
      const replacements: Record<string, string> = {};
      for (const [url, encoded] of Object.entries(assets)) {
        if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(encoded)) throw new Error("Неподдерживаемое изображение в проекте");
        const blob = await (await fetch(encoded)).blob();
        if (blob.size > 12000000) throw new Error("Фото в проекте превышает 12 МБ");
        replacements[url] = await adapter.upload(blob);
      }
      for (const p of w.projects) {
        p.cover = replacements[p.cover] || p.cover;
        for (const s of p.spaces) {
          s.cover = replacements[s.cover] || s.cover;
          for (const a of s.slides) {
            a.background = replacements[a.background] || a.background;
            for (const b of a.blocks) if (b.src) b.src = replacements[b.src] || b.src;
          }
        }
      }
      const projects = w.projects.map((p: Project) => ({ ...p, id: uid(), spaces: p.spaces.map((s) => ({ ...s, id: uid() })) }));
      change({ ...data, projects: [...data.projects, ...projects] });
      toast.success("Проекты импортированы");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  useEffect(() => {
    if (shareOpen && adapter.listShares && !readOnly)
      adapter
        .listShares()
        .then(setLinks)
        .catch(() => {});
  }, [shareOpen, shareToken, adapter, readOnly]);
  const renderPages = () => (
    <>
      {doc?.slides.map((p, i) => (
        <div key={p.id} className={"vn-mini " + (i === pageIndex ? "active" : "")}>
          <button
            className="vn-mini-main"
            onClick={() => {
              setPageIndex(i);
              setSelected("");
              setMobileSide(false);
            }}
          >
            <span className="vn-mini-number">{String(i + 1).padStart(2, "0")}</span>
            <div className={"vn-mini-preview bg-" + p.background}>
              <strong>{p.blocks.find((b) => b.kind === "heading")?.text || "Без заголовка"}</strong>
              <span>{p.blocks.find((b) => b.kind === "text")?.text.slice(0, 85)}</span>
            </div>
          </button>
          <div className="vn-mini-actions">
            <IconButton
              label="Переместить вверх"
              disabled={i === 0}
              onClick={() =>
                updateDoc((s) => {
                  const a = [...s.slides];
                  [a[i - 1], a[i]] = [a[i], a[i - 1]];
                  setPageIndex(i - 1);
                  return { ...s, slides: a };
                })
              }
            >
              <ArrowUp size={14} />
            </IconButton>
            <IconButton
              label="Дублировать страницу"
              onClick={() => {
                const copy = structuredClone(p);
                copy.id = uid();
                copy.blocks.forEach((b) => (b.id = uid()));
                updateDoc((s) => ({ ...s, slides: [...s.slides.slice(0, i + 1), copy, ...s.slides.slice(i + 1)] }));
                setPageIndex(i + 1);
              }}
            >
              <Copy size={14} />
            </IconButton>
            <IconButton
              label="Удалить страницу"
              disabled={doc.slides.length === 1}
              onClick={() =>
                setRemove({
                  label: "Удалить страницу?",
                  run: () => {
                    updateDoc((s) => ({ ...s, slides: s.slides.filter((a) => a.id !== p.id) }));
                    setPageIndex(Math.max(0, i - 1));
                  },
                })
              }
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
        </div>
      ))}
      <button className="vn-add-page" onClick={addPage}>
        <Plus size={17} /> Новая страница
      </button>
    </>
  );
  const renderLayers = () => (
    <div className="vn-layers">
      {page?.blocks.map((b, i) => (
        <div
          className={"vn-layer " + (selected === b.id ? "active" : "")}
          key={b.id}
          draggable={!b.locked}
          onDragStart={(e) => e.dataTransfer.setData("text/block", b.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const id = e.dataTransfer.getData("text/block");
            const from = page.blocks.findIndex((a) => a.id === id);
            if (from >= 0) reorderBlock(id, i - from);
          }}
        >
          <button
            onClick={() => {
              setSelected(b.id);
              setPanel(b.kind === "image" ? "image" : "text");
            }}
          >
            <GripVertical size={14} />
            <span>{b.label || b.text.slice(0, 26) || names[b.kind]}</span>
          </button>
          <div>
            <IconButton label={b.hidden ? "Показать" : "Скрыть"} onClick={() => updateBlock(b.id, { hidden: !b.hidden })}>
              {b.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </IconButton>
            <IconButton label={b.locked ? "Разблокировать" : "Заблокировать"} onClick={() => updateBlock(b.id, { locked: !b.locked })}>
              {b.locked ? <Lock size={14} /> : <Unlock size={14} />}
            </IconButton>
          </div>
        </div>
      ))}
    </div>
  );
  const sideContent = (
    <>
      <Tabs value={sideTab} onValueChange={setSideTab}>
        <TabsList className="vn-side-tabs">
          <TabsTrigger value="slides">Страницы</TabsTrigger>
          <TabsTrigger value="layers">Слои</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="vn-side-scroll">{sideTab === "slides" ? renderPages() : renderLayers()}</div>
    </>
  );
  const backgroundPanel = (
    <>
      <h3>Фон страницы</h3>
      <div className="vn-backgrounds">
        {backgrounds.map(([v, l]) => (
          <button className={page?.background === v ? "chosen" : ""} key={v} onClick={() => updatePage((p) => ({ ...p, background: v }))}>
            <span className={"bg-" + v} />
            {l}
          </button>
        ))}
      </div>
      <button
        className="vn-secondary"
        onClick={() => updateDoc((s) => ({ ...s, slides: s.slides.map((p) => ({ ...p, background: page!.background })) }))}
      >
        Применить ко всем страницам
      </button>
    </>
  );
  const settingsPanel = (
    <>
      <h3>Страницы и показ</h3>
      <label>
        Формат презентации
        <Choice
          label="Формат"
          value={doc?.format || "both"}
          onChange={(v) => updateDoc((s) => ({ ...s, format: v as Space["format"] }))}
          options={[
            ["both", "Компьютер и телефон"],
            ["landscape", "Горизонтальный 16:9"],
            ["portrait", "Вертикальный 9:16"],
          ]}
        />
      </label>
      <label>
        Листание заметки
        <Choice
          label="Листание"
          value={doc?.flow || "vertical"}
          onChange={(v) => updateDoc((s) => ({ ...s, flow: v as Space["flow"] }))}
          options={[
            ["vertical", "Вверх / вниз"],
            ["horizontal", "Влево / вправо"],
          ]}
        />
      </label>
      <label className="vn-switch-row">
        Разделять заметку на страницы
        <Switch checked={doc?.paged || false} onCheckedChange={(v) => updateDoc((s) => ({ ...s, paged: v }))} />
      </label>
      <label>
        Переход на эту страницу
        <Choice
          label="Переход"
          value={page?.transition || "fade"}
          onChange={(v) => updatePage((p) => ({ ...p, transition: v }))}
          options={transitions}
        />
      </label>
      <button
        className="vn-secondary"
        onClick={() => updateDoc((s) => ({ ...s, slides: s.slides.map((p) => ({ ...p, transition: page!.transition })) }))}
      >
        Один переход для всех
      </button>
      <label>
        Заметки для выступления
        <textarea
          value={page?.speaker || ""}
          placeholder="Этот текст виден только в промтере"
          onChange={(e) => updatePage((p) => ({ ...p, speaker: e.target.value }))}
        />
      </label>
    </>
  );
  const imagePanel =
    selectedBlock?.kind === "image" ? (
      <>
        <h3>Изображение</h3>
        <label>
          Размер по сетке · {orientation === "portrait" ? "телефон" : "компьютер"}
          <div className="vn-size-options">
            {[4, 6, 12].map((n) => (
              <button
                key={n}
                className={(orientation === "portrait" ? selectedBlock.portraitSize || 12 : selectedBlock.size) === n ? "active" : ""}
                onClick={() => updateBlock(selected, { [orientation === "portrait" ? "portraitSize" : "size"]: n })}
              >
                {n === 4 ? "⅓" : n === 6 ? "½" : "Вся ширина"}
              </button>
            ))}
          </div>
        </label>
        <label>
          Обтекание
          <Choice
            label="Размещение"
            value={selectedBlock.align}
            onChange={(v) => updateBlock(selected, { align: v as Block["align"] })}
            options={[
              ["left", "Слева от текста"],
              ["right", "Справа от текста"],
              ["center", "Отдельным блоком"],
            ]}
          />
        </label>
        <label>
          Подпись
          <input value={selectedBlock.text} onChange={(e) => updateBlock(selected, { text: e.target.value })} />
        </label>
        <button
          className="vn-secondary"
          onClick={() => {
            updatePage((p) => ({ ...p, background: selectedBlock.src!, blocks: p.blocks.filter((b) => b.id !== selected) }));
            setSelected("");
            setPanel("");
          }}
        >
          Сделать фоном слайда
        </button>
      </>
    ) : (
      <>
        <h3>Добавить изображение</h3>
        <button className="vn-secondary" onClick={() => file.current?.click()}>
          <ImagePlus size={18} /> Из галереи
        </button>
        <button className="vn-secondary" onClick={() => camera.current?.click()}>
          <Camera size={18} /> Сделать фото
        </button>
      </>
    );
  if (!loaded)
    return (
      <div className="vn-app vn-loading">
        <img src={logoUrl} alt="Заметки Voidex" />
        <h1>{loadError ? "Не удалось открыть заметки" : "Открываем ваше пространство"}</h1>
        <p>{loadError || "Загружаем проекты…"}</p>
        {loadError && (
          <button className="vn-primary" onClick={() => location.reload()}>
            Повторить
          </button>
        )}
      </div>
    );
  return (
    <div className={"vn-app " + (doc ? "is-editor" : "") + (playing ? " is-playing" : "") + (embedded ? " is-embedded" : "")}>
      <Toaster position="bottom-center" />
      <input
        hidden
        type="file"
        ref={file}
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => {
          void uploadImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        type="file"
        ref={camera}
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          void uploadImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        type="file"
        ref={coverFile}
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => {
          void uploadImage(e.target.files?.[0], true);
          e.target.value = "";
        }}
      />
      <input
        hidden
        type="file"
        ref={importFile}
        accept="application/json,.json"
        onChange={(e) => {
          void importProject(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {!playing && (
        <header className="vn-header">
          <div className="vn-brand">
            {(project || doc) && (
              <IconButton
                label="Назад"
                onClick={() => {
                  if (doc) {
                    setSpaceId("");
                    setSelected("");
                  } else setProjectId("");
                  setQuery("");
                }}
              >
                <ArrowLeft />
              </IconButton>
            )}
            <img src={logoUrl} alt="" />
            <div>
              <strong>{doc ? doc.name : "Заметки"}</strong>
              <span>{doc ? project?.name : "VOIDEX"}</span>
            </div>
          </div>
          {doc ? (
            <Tabs
              className="vn-mode"
              value={doc.mode}
              onValueChange={(v) => {
                updateDoc((s) => ({ ...s, mode: v as Space["mode"] }));
                setSelected("");
              }}
            >
              <TabsList>
                <TabsTrigger value="notes">
                  <FileText size={16} /> Заметки
                </TabsTrigger>
                <TabsTrigger value="presentation">
                  <Presentation size={16} /> Презентация
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : (
            <div className="vn-search">
              <Search size={18} />
              <input placeholder="Поиск по проектам и заметкам" value={query} onChange={(e) => setQuery(e.target.value)} />
              {query && (
                <IconButton label="Очистить поиск" onClick={() => setQuery("")}>
                  <X size={16} />
                </IconButton>
              )}
            </div>
          )}
          <div className="vn-header-actions">
            {!readOnly && (
              <button
                className={"vn-save " + (status === "Не сохранено" ? "error" : "")}
                title="Сохранить сейчас"
                onClick={() => void flush()}
              >
                <Cloud size={17} />
                <span>{status}</span>
              </button>
            )}
            {doc && (
              <>
                <IconButton
                  label="Начать показ"
                  onClick={() => {
                    setPlaying(true);
                    setSelected("");
                  }}
                >
                  <Play />
                </IconButton>
                <button
                  className="vn-primary vn-share"
                  onClick={() => {
                    setShareOpen(true);
                    setShareToken("");
                  }}
                >
                  <Share2 size={16} />
                  <span>Поделиться</span>
                </button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="vn-icon" aria-label="Ещё">
                  <MoreHorizontal />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(doc || project) && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        setName(doc?.name || project!.name);
                        setCover(doc?.cover || project!.cover);
                        setEditingName(doc ? "space" : "project");
                      }}
                      disabled={readOnly}
                    >
                      Название и обложка
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void exportCurrent()}>Скачать HTML для просмотра</DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void exportProject(project ? [project] : data.projects).catch((e) => toast.error(e.message))}
                    >
                      Экспорт исходного проекта
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {!doc && history.current.length > 0 && (
                  <DropdownMenuItem onClick={() => undo()}>Отменить последнее изменение</DropdownMenuItem>
                )}
                {!doc && (
                  <DropdownMenuItem onClick={() => importFile.current?.click()} disabled={readOnly}>
                    Импорт проекта
                  </DropdownMenuItem>
                )}
                {doc && (
                  <DropdownMenuItem
                    onClick={() => {
                      setPrompting(true);
                      setRunning(false);
                    }}
                  >
                    Открыть промтер
                  </DropdownMenuItem>
                )}
                {(doc || project) && !readOnly && (
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={() =>
                      setRemove({
                        label: doc ? "Удалить пространство?" : "Удалить проект со всеми заметками?",
                        run: () => {
                          if (doc) {
                            change({
                              ...data,
                              projects: data.projects.map((p) =>
                                p.id === project!.id ? { ...p, spaces: p.spaces.filter((s) => s.id !== doc.id) } : p,
                              ),
                            });
                            setSpaceId("");
                          } else {
                            change({ ...data, projects: data.projects.filter((p) => p.id !== project!.id) });
                            setProjectId("");
                          }
                        },
                      })
                    }
                  >
                    Удалить
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
      )}
      {!doc ? (
        <main className="vn-library">
          <div className="vn-library-heading">
            <div>
              <p className="vn-eyebrow">{query ? "РЕЗУЛЬТАТЫ ПОИСКА" : project ? "ПРОЕКТ" : "ВАШЕ ПРОСТРАНСТВО"}</p>
              <h1>{query ? "Нашлось в заметках" : project ? project.name : "Мои проекты"}</h1>
              <p>{project ? "Каждая папка — отдельное рабочее пространство." : "Мысли, планы и истории. Всё начинается с проекта."}</p>
            </div>
            <div className="vn-library-tools">
              <div className="vn-view-switch">
                <IconButton label="Карточки" active={!listView} onClick={() => setListView(false)}>
                  <Grid2X2 size={18} />
                </IconButton>
                <IconButton label="Список" active={listView} onClick={() => setListView(true)}>
                  <List size={18} />
                </IconButton>
              </div>
              {!readOnly && (
                <button className="vn-primary" onClick={() => startCreate(project ? "space" : "project")}>
                  <Plus size={18} />
                  {project ? "Новое пространство" : "Новый проект"}
                </button>
              )}
            </div>
          </div>
          {query ? (
            <div className="vn-results">
              {data.projects.flatMap((p) =>
                p.spaces
                  .filter((s) => (p.name + " " + s.name + " " + plainText(s)).toLowerCase().includes(query.toLowerCase()))
                  .map((s) => (
                    <button key={s.id} className="vn-result" onClick={() => openSpace(p.id, s.id)}>
                      <FileText />
                      <div>
                        <strong>{s.name}</strong>
                        <p>{plainText(s).slice(0, 180)}</p>
                        <small>
                          {p.name} · {s.mode === "notes" ? "Заметка" : "Презентация"}
                        </small>
                      </div>
                      <ChevronRight />
                    </button>
                  )),
              )}
              {!data.projects.some((p) =>
                p.spaces.some((s) => (p.name + " " + s.name + " " + plainText(s)).toLowerCase().includes(query.toLowerCase())),
              ) && (
                <div className="vn-empty">
                  <Search />
                  <h2>Ничего не найдено</h2>
                  <p>Попробуйте другое название или слово из текста.</p>
                </div>
              )}
            </div>
          ) : (
            <div className={"vn-cards " + (listView ? "list" : "")}>
              {(project ? project.spaces : data.projects).map((item) => (
                <button
                  className="vn-card"
                  key={item.id}
                  onClick={() => (project ? openSpace(project.id, item.id) : setProjectId(item.id))}
                >
                  <Cover value={item.cover} />
                  <div className="vn-card-info">
                    <div className="vn-card-title">
                      {"spaces" in item ? (
                        <Folder size={18} />
                      ) : item.mode === "presentation" ? (
                        <Presentation size={18} />
                      ) : (
                        <FileText size={18} />
                      )}
                      <h2>{item.name}</h2>
                    </div>
                    <p>
                      {"spaces" in item
                        ? `${item.spaces.length} пространств`
                        : `${item.slides.length} стр. · ${item.mode === "notes" ? "Заметки" : "Презентация"}`}
                    </p>
                    <small>Изменено {new Date(item.updated).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</small>
                  </div>
                </button>
              ))}
              {!readOnly && (
                <button className="vn-card vn-new-card" onClick={() => startCreate(project ? "space" : "project")}>
                  <span>
                    <Plus />
                  </span>
                  <strong>{project ? "Новое пространство" : "Новый проект"}</strong>
                  <p>{project ? "Заметка или презентация" : "С чистого листа"}</p>
                </button>
              )}
            </div>
          )}
          {!project && data.projects.length === 0 && !query && (
            <div className="vn-welcome">
              <div>
                <span className="vn-eyebrow">ПОПРОБУЙТЕ В ДЕЛЕ</span>
                <h2>Одна идея. Два способа рассказать.</h2>
                <p>Откройте пример, чтобы попробовать заметки, слайды и оформление.</p>
                <button
                  className="vn-secondary"
                  onClick={() => {
                    const p = demoProject();
                    change({ ...data, projects: [...data.projects, p] });
                    openSpace(p.id, p.spaces[0].id);
                  }}
                >
                  Открыть пример
                </button>
              </div>
              <div className="vn-preview-stack">
                <div className="bg-lavender">
                  <span>01 / VOIDEX</span>
                  <strong>
                    Пространство
                    <br />
                    для ваших идей.
                  </strong>
                  <i />
                </div>
                <div className="bg-wave" />
              </div>
            </div>
          )}
        </main>
      ) : (
        <>
          {!playing && !readOnly && (
            <div className="vn-toolbar">
              <div className="vn-tool-group">
                <IconButton
                  label="Страницы и слои"
                  active={sideOpen}
                  onClick={() => {
                    if ((document.querySelector(".vn-app")?.clientWidth || window.innerWidth) < 850) setMobileSide(true);
                    else setSideOpen(!sideOpen);
                  }}
                >
                  <PanelLeft size={19} />
                </IconButton>
                <IconButton label="Отменить" disabled={!history.current.length} onClick={() => undo()}>
                  <Undo2 size={18} />
                </IconButton>
                <IconButton label="Повторить" disabled={!future.current.length} onClick={() => undo(true)}>
                  <Redo2 size={18} />
                </IconButton>
              </div>
              <div className="vn-tool-group">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="vn-tool">
                      <Type size={18} />
                      <span>Текст</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {(["text", "heading", "quote", "checklist", "code"] as BlockKind[]).map((k) => (
                      <DropdownMenuItem key={k} onClick={() => addBlock(k)}>
                        {names[k]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button className="vn-tool" onClick={() => setPanel("image")}>
                  <ImagePlus size={18} />
                  <span>Фото</span>
                </button>
                <button className="vn-tool" onClick={addPage}>
                  <Plus size={18} />
                  <span>Страница</span>
                </button>
              </div>
              <div className="vn-tool-group">
                <button className="vn-tool" onClick={() => setPanel("background")}>
                  <Palette size={18} />
                  <span>Фон</span>
                </button>
                <button className="vn-tool" onClick={() => setPanel("settings")}>
                  <Settings2 size={18} />
                  <span>Настройки</span>
                </button>
              </div>
              <div className="vn-toolbar-end">
                {doc.format === "both" && (
                  <div className="vn-view-switch">
                    <IconButton
                      label="Горизонтальный формат"
                      active={orientation === "landscape"}
                      onClick={() => setOrientation("landscape")}
                    >
                      <Monitor size={17} />
                    </IconButton>
                    <IconButton label="Вертикальный формат" active={orientation === "portrait"} onClick={() => setOrientation("portrait")}>
                      <Smartphone size={17} />
                    </IconButton>
                  </div>
                )}
                <span className="vn-format">{orientation === "landscape" ? "16:9" : "9:16"}</span>
              </div>
            </div>
          )}
          <div className={"vn-workspace " + (doc.mode === "notes" ? "notes-mode" : "presentation-mode")}>
            {!playing && !readOnly && sideOpen && (
              <SidebarProvider className="vn-sidebar-provider" style={{ "--sidebar-width": "220px" } as React.CSSProperties}>
                <Sidebar collapsible="none" className="vn-sidebar">
                  <SidebarContent>{sideContent}</SidebarContent>
                </Sidebar>
              </SidebarProvider>
            )}
            <div
              className={"vn-stage " + (playing ? "viewer" : "") + (doc.mode === "notes" && !doc.paged ? " continuous" : "")}
              onTouchStart={(e) => {
                touch.current = e.touches[0].clientX;
              }}
              onTouchEnd={(e) => {
                if ((playing || doc.flow === "horizontal") && Math.abs(e.changedTouches[0].clientX - touch.current) > 65)
                  movePage(e.changedTouches[0].clientX < touch.current ? 1 : -1);
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) e.preventDefault();
              }}
              onDrop={(e) => {
                if (!readOnly && e.dataTransfer.files.length) {
                  e.preventDefault();
                  void uploadImage(e.dataTransfer.files[0]);
                }
              }}
            >
              {playing ? (
                <div className="vn-viewer-top">
                  <strong>{doc.name}</strong>
                  <div>
                    {doc.format === "both" && (
                      <IconButton
                        label="Переключить ориентацию"
                        onClick={() => setOrientation(orientation === "landscape" ? "portrait" : "landscape")}
                      >
                        {orientation === "landscape" ? <Smartphone /> : <Monitor />}
                      </IconButton>
                    )}
                    {!readOnly && (
                      <IconButton label="Промтер" onClick={() => setPrompting(true)}>
                        <Mic />
                      </IconButton>
                    )}
                    <IconButton label="Закрыть показ" onClick={() => setPlaying(false)}>
                      <X />
                    </IconButton>
                  </div>
                </div>
              ) : (
                <div className="vn-stage-caption">
                  <span>{doc.mode === "presentation" ? "ПРЕЗЕНТАЦИЯ" : "ЗАМЕТКА"}</span>
                  <span>{doc.mode === "presentation" ? "Автоматическая компоновка по сетке" : "Изменения сохраняются автоматически"}</span>
                </div>
              )}
              {doc.mode === "notes" && doc.flow === "vertical" && !playing ? (
                doc.slides.map((p, i) => (
                  <div
                    key={p.id}
                    className="vn-note-page"
                    data-page-index={i}
                    onFocus={() => setPageIndex(i)}
                    onClick={() => setPageIndex(i)}
                  >
                    <PageCanvas
                      page={p}
                      notes
                      orientation={orientation}
                      selected={selected}
                      onSelect={setSelected}
                      onChange={(id, patch) => updateBlock(id, patch, p.id)}
                      readOnly={readOnly}
                    />
                    {doc.paged && (
                      <span className="vn-page-label">
                        {i + 1} / {doc.slides.length}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div
                  key={page!.id + "-" + orientation}
                  style={{ "--direction": direction } as React.CSSProperties}
                  className={"vn-slide-holder " + (playing ? "transition-" + page!.transition : "")}
                >
                  <PageCanvas
                    page={page!}
                    orientation={orientation}
                    notes={doc.mode === "notes"}
                    selected={selected}
                    onSelect={setSelected}
                    onChange={updateBlock}
                    readOnly={readOnly || playing}
                  />
                </div>
              )}
              {!playing && selectedBlock && !selectedBlock.locked && !readOnly && (
                <div className="vn-selection-tools">
                  {selectedBlock.kind !== "image" && (
                    <>
                      <Choice
                        label="Тип блока"
                        value={selectedBlock.kind}
                        options={Object.entries(names).filter(([k]) => k !== "image")}
                        onChange={(v) => updateBlock(selected, { kind: v as BlockKind })}
                      />
                      <IconButton
                        label="Жирный"
                        active={selectedBlock.bold}
                        onClick={() => updateBlock(selected, { bold: !selectedBlock.bold })}
                      >
                        <Bold size={17} />
                      </IconButton>
                      <IconButton
                        label="Курсив"
                        active={selectedBlock.italic}
                        onClick={() => updateBlock(selected, { italic: !selectedBlock.italic })}
                      >
                        <Italic size={17} />
                      </IconButton>
                    </>
                  )}
                  {selectedBlock.kind === "image" && (
                    <button className="vn-tool" onClick={() => setPanel("image")}>
                      Размер и обтекание
                    </button>
                  )}
                  <IconButton label="Выше" onClick={() => reorderBlock(selected, -1)}>
                    <ArrowUp size={16} />
                  </IconButton>
                  <IconButton label="Ниже" onClick={() => reorderBlock(selected, 1)}>
                    <ArrowDown size={16} />
                  </IconButton>
                  <IconButton
                    label="Удалить блок"
                    onClick={() => {
                      updatePage((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== selected) }));
                      setSelected("");
                    }}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                  <IconButton label="Снять выделение" onClick={() => setSelected("")}>
                    <X size={16} />
                  </IconButton>
                </div>
              )}
            </div>
          </div>
          <footer className="vn-editor-footer">
            <span>
              {readOnly
                ? "Только просмотр"
                : uploading
                  ? "Загружаем изображение…"
                  : doc.mode === "notes"
                    ? "Заметки / " + doc.slides.length + " стр."
                    : "Слайды / " + doc.slides.length}
            </span>
            <div>
              <IconButton label="Предыдущая страница" disabled={pageIndex === 0} onClick={() => movePage(-1)}>
                <ChevronLeft size={18} />
              </IconButton>
              <span>
                {pageIndex + 1} / {doc.slides.length}
              </span>
              <IconButton label="Следующая страница" disabled={pageIndex === doc.slides.length - 1} onClick={() => movePage(1)}>
                <ChevronRight size={18} />
              </IconButton>
            </div>
            <button
              className="vn-tool"
              onClick={() => {
                setPrompting(true);
                setRunning(false);
              }}
            >
              <Mic size={16} />
              <span>Промтер</span>
            </button>
          </footer>
        </>
      )}
      <Dialog
        open={!!create || !!editingName}
        onOpenChange={(v) => {
          if (!v) {
            setCreate(null);
            setEditingName(null);
          }
        }}
      >
        <DialogContent className="vn-dialog">
          <DialogTitle>{editingName ? "Название и обложка" : create === "project" ? "Новый проект" : "Новое пространство"}</DialogTitle>
          <DialogDescription>
            {create === "project"
              ? "Объедините связанные заметки и презентации."
              : "Назовите пространство так, чтобы его было легко найти."}
          </DialogDescription>
          <label>
            Название
            <input
              autoFocus
              value={name}
              maxLength={120}
              placeholder={create === "project" ? "Например, запуск Voidex" : "Например, идеи и планы"}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createItem();
              }}
            />
          </label>
          <label>Обложка</label>
          <div className="vn-cover-choices">
            {backgrounds.map(([v, l]) => (
              <button key={v} aria-label={l} className={"bg-" + v + (cover === v ? " chosen" : "")} onClick={() => setCover(v)}>
                {cover === v && <Check size={18} />}
              </button>
            ))}
            <button aria-label="Загрузить обложку" onClick={() => coverFile.current?.click()}>
              <Upload size={18} />
            </button>
          </div>
          {cover.startsWith("/api/") && <img className="vn-cover-upload" src={cover} alt="Обложка" />}
          {create === "space" && (
            <>
              <label>
                Режим
                <Choice
                  value={newMode}
                  onChange={(v) => setNewMode(v as "notes" | "presentation")}
                  options={[
                    ["notes", "Заметки"],
                    ["presentation", "Презентация"],
                  ]}
                  label="Режим"
                />
              </label>
              {newMode === "presentation" && (
                <label>
                  Формат
                  <Choice
                    value={newFormat}
                    onChange={(v) => setNewFormat(v as Space["format"])}
                    options={[
                      ["both", "Компьютер и телефон"],
                      ["landscape", "Горизонтальный 16:9"],
                      ["portrait", "Вертикальный 9:16"],
                    ]}
                    label="Формат"
                  />
                </label>
              )}
            </>
          )}
          <button className="vn-primary" disabled={!name.trim() || uploading} onClick={createItem}>
            {uploading ? "Загрузка…" : editingName ? "Сохранить" : "Создать"}
          </button>
        </DialogContent>
      </Dialog>
      <Sheet open={!!panel} onOpenChange={(v) => !v && setPanel("")}>
        <SheetContent className="vn-sheet">
          <SheetTitle>
            {panel === "background"
              ? "Оформление"
              : panel === "settings"
                ? "Настройки страницы"
                : panel === "image"
                  ? "Изображение"
                  : "Текст"}
          </SheetTitle>
          <SheetDescription>Настройки выбранной страницы</SheetDescription>
          {panel === "background" ? (
            backgroundPanel
          ) : panel === "settings" ? (
            settingsPanel
          ) : panel === "image" ? (
            imagePanel
          ) : (
            <>
              <label>
                Название слоя
                <input value={selectedBlock?.label || ""} onChange={(e) => updateBlock(selected, { label: e.target.value })} />
              </label>
              <p>Выберите текст на холсте, чтобы редактировать его.</p>
            </>
          )}
        </SheetContent>
      </Sheet>
      <Sheet open={mobileSide} onOpenChange={setMobileSide}>
        <SheetContent side="left" className="vn-sheet vn-mobile-sidebar">
          <SheetTitle>Страницы и слои</SheetTitle>
          <SheetDescription>Управление содержимым</SheetDescription>
          {sideContent}
        </SheetContent>
      </Sheet>
      <AlertDialog open={!!remove} onOpenChange={(v) => !v && setRemove(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{remove?.label}</AlertDialogTitle>
          <AlertDialogDescription>Действие можно отменить кнопкой «Отменить» в редакторе.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                remove?.run();
                setRemove(null);
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="vn-dialog">
          <DialogTitle>Поделиться {doc ? "пространством" : "проектом"}</DialogTitle>
          <DialogDescription>
            Публикуется копия на момент создания ссылки. Другие заметки проекта не попадут в публикацию.
          </DialogDescription>
          <button className="vn-secondary" onClick={() => void exportCurrent()}>
            <Download size={18} /> Скачать HTML с изображениями
          </button>
          <p className="vn-help">Файл можно отправить любому человеку и открыть без аккаунта.</p>
          <button
            className="vn-primary"
            disabled={shareBusy || readOnly}
            onClick={async () => {
              setShareBusy(true);
              try {
                const published = structuredClone(doc || project!);
                const spaces = "spaces" in published ? published.spaces : [published];
                spaces.forEach((s) => s.slides.forEach((p) => (p.speaker = "")));
                const token = await adapter.createShare(published);
                setShareToken(token);
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setShareBusy(false);
              }
            }}
          >
            {shareBusy ? "Создаём…" : "Создать ссылку для просмотра"}
          </button>
          <p className="vn-help">
            Ссылка работает для людей с доступом к этому приложению. Доступ по аккаунтам Voidex подключается при интеграции.
          </p>
          {shareToken && (
            <>
              <input aria-label="Ссылка для просмотра" readOnly value={location.origin + location.pathname + "?share=" + shareToken} />
              <button
                className="vn-secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(location.origin + location.pathname + "?share=" + shareToken);
                    toast.success("Ссылка скопирована");
                  } catch {
                    toast.error("Выделите и скопируйте ссылку вручную");
                  }
                }}
              >
                Скопировать ссылку
              </button>
              <button
                className="vn-text-button"
                onClick={async () => {
                  try {
                    await adapter.revokeShare(shareToken);
                    setShareToken("");
                    toast.success("Ссылка отозвана");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Отозвать эту ссылку
              </button>
            </>
          )}
          {links.length > 0 && (
            <div className="vn-saved-links">
              <h3>Созданные ссылки</h3>
              {links
                .filter((l) => l.token !== shareToken)
                .map((l) => (
                  <div key={l.token}>
                    <span>
                      {l.name}
                      <small>{new Date(l.created).toLocaleDateString("ru-RU")}</small>
                    </span>
                    <IconButton
                      label="Скопировать ссылку"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(location.origin + location.pathname + "?share=" + l.token)
                          .then(() => toast.success("Ссылка скопирована"))
                          .catch(() => toast.error("Не удалось скопировать"));
                      }}
                    >
                      <Copy size={16} />
                    </IconButton>
                    <IconButton
                      label="Отозвать ссылку"
                      onClick={() => {
                        void adapter
                          .revokeShare(l.token)
                          .then(() => setLinks(links.filter((a) => a.token !== l.token)))
                          .catch((e) => toast.error(e.message));
                      }}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {prompting && doc && (
        <div className="vn-prompter">
          <header>
            <button
              className="vn-icon"
              aria-label="Закрыть промтер"
              onClick={() => {
                setPrompting(false);
                setRunning(false);
              }}
            >
              <X />
            </button>
            <strong>{doc.name}</strong>
            <button className="vn-primary" onClick={() => setRunning(!running)}>
              {running ? <Pause size={18} /> : <Play size={18} />} {running ? "Пауза" : "Начать"}
            </button>
          </header>
          <div className="vn-prompter-text" ref={prompter} onClick={() => setRunning(!running)} style={{ fontSize }}>
            {doc.slides.map((p, i) => (
              <section key={p.id}>
                <small>СТРАНИЦА {i + 1}</small>
                {p.speaker ? (
                  <p>{p.speaker}</p>
                ) : (
                  p.blocks.filter((b) => b.kind !== "image" && !b.hidden).map((b) => <p key={b.id}>{b.text}</p>)
                )}
              </section>
            ))}
          </div>
          <footer>
            <label>
              Скорость {speed}
              <Slider aria-label="Скорость промтера" min={10} max={100} step={5} value={[speed]} onValueChange={(v) => setSpeed(v[0])} />
            </label>
            <label>
              Размер текста {fontSize}
              <Slider
                aria-label="Размер текста промтера"
                min={24}
                max={64}
                step={2}
                value={[fontSize]}
                onValueChange={(v) => setFontSize(v[0])}
              />
            </label>
            <button
              className="vn-secondary"
              onClick={() => {
                if (prompter.current) prompter.current.scrollTop = 0;
                setRunning(false);
              }}
            >
              В начало
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
