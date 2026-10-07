'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { flushSync } from 'react-dom';
import {
  Folder,
  Clock,
  Heart,
  Trash2,
  
  Plus,
  LayoutGrid,
  List,
  MoreHorizontal,
  FileText,
  Presentation,
  Download,
  Cloud,
  CloudOff,
  ChevronRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  Share2,
  Pencil,
  FolderInput,
  ArrowDownUp,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu';
import { FileContextMenu } from './FileContextMenu';
import { FileShare } from './FileShare';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from '../../components/ui/sidebar';
import { Skeleton } from '../../components/ui/skeleton';
import { Progress } from '../../components/ui/progress';
import { Toaster, toast } from 'sonner';
import type { Entry, FileData, Listing, OpenFile } from './model';
import { byteSize, QUOTA, nameStem, withExtension, fileExtension } from './model';
import { httpAdapter } from './adapter';
import type { FilesAdapter, FilesHost } from './adapter';
import { Editor, canvasBackground } from './Editor';
import { FileModal } from './FileModal';
import { FileDock, keyboardInset } from './FileDock';
import { useFileSelection } from './useFileSelection';
import './files.css';
const categories = [
  ['all', 'Все', LayoutGrid],
  ['txt', '.txt', FileText],
  ['prsn', '.prsn', Presentation],
  ['downloaded', 'Скачанные', Download],
  ['folders', 'Папки', Folder],
] as const;
const sections = [
  ['files', 'Файлы', Folder],
  ['recent', 'Недавние', Clock],
  ['favorite', 'Избранное', Heart],
  ['trash', 'Корзина', Trash2],
] as const;
const date = (n: number) => new Date(n).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const cache = new Map<string, Promise<OpenFile>>();
function ContentPreview({ entry, adapter, onOpen }: { entry: Entry; adapter: FilesAdapter; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null),
    [data, setData] = useState<FileData | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    const ob = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        ob.disconnect();
        const key = entry.id + ':' + entry.revision;
        if (!cache.has(key)) cache.set(key, adapter.open(entry.id));
        cache
          .get(key)!
          .then((d) => {
            if (live) setData(d.data);
          })
          .catch(() => {
            cache.delete(key);
            if (live) setFailed(true);
          });
      },
      { rootMargin: '100px' },
    );
    if (ref.current) ob.observe(ref.current);
    return () => {
      live = false;
      ob.disconnect();
    };
  }, [entry.id, entry.revision, adapter]);
  const p = data && typeof data !== 'string' ? data.slides[0] : null;
  return (
    <button
      ref={ref}
      className={'vf-preview ' + (entry.kind === 'prsn' ? 'presentation' : '')}
      onClick={onOpen}
      aria-label={'Открыть ' + entry.name}
    >
      <div
        className={'vf-preview-sheet ' + (p && ['wave', 'graphite'].includes(p.background) ? 'dark' : '')}
        style={p ? { background: canvasBackground[p.background] } : undefined}
      >
        {data === null ? (
          failed ? (
            <span>Открыть файл</span>
          ) : (
            <>
              <Skeleton className="h-3 w-3/5 mb-4" />
              <Skeleton className="h-2 w-full mb-2" />
              <Skeleton className="h-2 w-4/5 mb-2" />
              <Skeleton className="h-2 w-full" />
            </>
          )
        ) : typeof data === 'string' ? (
          <div className="vf-txt-preview">{data || 'Пустой документ'}</div>
        ) : (
          p?.blocks
            .filter((b) => !b.hidden)
            .slice(0, 4)
            .map((b) => (
              <div key={b.id} className={b.kind}>
                {b.text || 'Новый слайд'}
              </div>
            ))
        )}
      </div>
      {entry.kind === 'prsn' && (
        <span className="vf-format">
          <Presentation size={12} /> PRSN
        </span>
      )}
    </button>
  );
}
export function FilesApp({
  adapter = httpAdapter,
  host,
  embedded = false,
}: {
  adapter?: FilesAdapter;
  host?: FilesHost;
  embedded?: boolean;
}) {
  const [listing, setListing] = useState<Listing>({ files: [], folders: [], used: 0, quota: QUOTA }),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState('');
  const [section, setSection] = useState('files'),
    [folder, setFolder] = useState<string | null>(null),
    [category, setCategory] = useState('all'),
    [query, setQuery] = useState(''),
    [layout, setLayout] = useState('grid'),
    [descending, setDescending] = useState(true);
  const [selection, setSelection] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [contextFile, setContextFile] = useState<string | null>(null),
    [contextAnchor, setContextAnchor] = useState<HTMLElement | null>(null);
  const [opened, setOpened] = useState<OpenFile | null>(null),
    [shareToken, setShareToken] = useState<string>(),
    [sharing, setSharing] = useState<OpenFile | null>(null),
    [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'folder' | 'rename' | 'move' | 'cloud' | null>(null),
    [name, setName] = useState(''),
    [target, setTarget] = useState<Entry | null>(null),
    [destination, setDestination] = useState('root'),
    [mobileSearch, setMobileSearch] = useState(false),
    [keyboard, setKeyboard] = useState(0);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null),
    suppressOpen = useRef(0),
    categoryRef = useRef<HTMLDivElement>(null),
    searchRef = useRef<HTMLInputElement>(null),
    scrollRef = useRef<HTMLDivElement>(null),
    folderTrack = useRef<HTMLDivElement>(null);
  const cloudOff = host?.cloud?.available === false;
  const openCloud = () => (host?.onOpenCloud ? host.onOpenCloud() : setModal('cloud'));
  async function reload() {
    setLoadError('');
    try {
      const l = await adapter.list();
      setListing(l);
      return l;
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reload();
    const unsubscribe = adapter.subscribe?.((openId) => {
      void reload();
      if (openId)
        adapter
          .open(openId)
          .then((f) => {
            setShareToken(undefined);
            setOpened(f);
          })
          .catch((e) => toast.error(e.message));
    });
    if (host?.initialOpen)
      adapter
        .open(host.initialOpen)
        .then(setOpened)
        .catch((e) => toast.error(e.message));
    const token = cloudOff ? null : new URLSearchParams(location.search).get('share');
    if (token) {
      setShareToken(token);
      adapter
        .open('shared', token)
        .then(setOpened)
        .catch((e) => toast.error(e.message));
    }
    return unsubscribe;
  }, [adapter]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        startSearch();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => setKeyboard(keyboardInset(window.innerHeight, v.height, v.offsetTop, v.scale));
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  function navigate(s: string, f: string | null = null) {
    setSection(s);
    setFolder(f);
    setQuery('');
    if (f || (s !== 'files' && category === 'folders')) setCategory('all');
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const visible = useMemo(
    () =>
      listing.files
        .filter(
          (f) =>
            f.trashed === (section === 'trash') &&
            (folder ? f.folder === folder : true) &&
            (section !== 'favorite' || f.favorite) &&
            (category === 'all' || (category === 'downloaded' && f.downloaded) || f.kind === category) &&
            f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        )
        .sort((a, b) => (descending ? b.updated - a.updated : a.updated - b.updated)),
    [listing, section, folder, category, query, descending],
  );
  useEffect(() => {
    categoryRef.current
      ?.querySelector<HTMLElement>('[data-state=active]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [category]);
  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current.timer);
    },
    [],
  );
  const paint = useFileSelection(
    visible.map((f) => f.id),
    selected,
    setSelected,
    scrollRef,
    selection,
  );
  const currentFolder = listing.folders.find((f) => f.id === folder),
    title = currentFolder?.name || sections.find((s) => s[0] === section)?.[1] || 'Файлы';
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await action();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(f: Entry) {
    if (Date.now() < suppressOpen.current || paint.consumeClick()) return;
    if (selection) {
      toggle(f.id);
      return;
    }
    if (f.trashed) return;
    await run(async () => {
      setShareToken(undefined);
      setOpened(await adapter.open(f.id));
    });
  }
  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  async function patch(f: Entry, c: Parameters<FilesAdapter['patch']>[1]) {
    await run(async () => {
      const next = await adapter.patch(f.id, c);
      setListing((l) => ({ ...l, files: l.files.map((a) => (a.id === next.id ? next : a)) }));
    });
  }
  function share(f: OpenFile) {
    if (host?.onShare) host.onShare(f);
    else setSharing(f);
  }
  async function shareEntry(f: Entry) {
    await run(async () => share(await adapter.open(f.id)));
  }
  async function submit() {
    await run(async () => {
      if (modal === 'folder') {
        await adapter.folder(name);
      } else if (modal === 'rename' && target) {
        await adapter.patch(target.id, { name: withExtension(name, target.name, target.kind) });
      } else if (modal === 'move') {
        for (const f of target ? [target] : listing.files.filter((f) => selected.has(f.id)))
          await adapter.patch(f.id, { folder: destination === 'root' ? null : destination });
      }
      setModal(null);
      await reload();
    });
  }
  function startSearch() {
    flushSync(() => setMobileSearch(true));
    searchRef.current?.focus({ preventScroll: true });
  }
  function closeSearch() {
    searchRef.current?.blur();
    setMobileSearch(false);
    setQuery('');
  }
  const categoryDrag = useRef<{ x: number; left: number; active: boolean; pointer: number } | null>(null),
    suppressCategory = useRef(false);
  const gesture = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      categoryDrag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, active: false, pointer: e.pointerId };
      suppressCategory.current = false;
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = categoryDrag.current;
      if (!d) return;
      if (Math.abs(e.clientX - d.x) > 6) {
        d.active = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.scrollLeft = d.left + d.x - e.clientX;
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      suppressCategory.current = !!categoryDrag.current?.active;
      categoryDrag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel: () => {
      categoryDrag.current = null;
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (suppressCategory.current) {
        e.preventDefault();
        e.stopPropagation();
        suppressCategory.current = false;
      }
    },
  };
  function stopHold() {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }
  function showContext(f: Entry, node: HTMLElement) {
    stopHold();
    suppressOpen.current = Date.now() + 750;
    setContextAnchor(node);
    setContextFile(f.id);
  }
  function closeContext() {
    setContextFile(null);
    setContextAnchor(null);
  }
  function card(f: Entry) {
    return (
      <article
        key={f.id}
        className={'vf-file ' + (selected.has(f.id) ? 'selected ' : '') + (contextFile === f.id ? 'vf-context-raised' : '')}
        data-file-id={f.id}
        onContextMenu={(e) => {
          e.preventDefault();
          showContext(f, e.currentTarget);
        }}
        onPointerDown={(e) => {
          paint.down(e, f.id);
          if (!selection && e.pointerType === 'touch') {
            const node = e.currentTarget;
            stopHold();
            hold.current = { x: e.clientX, y: e.clientY, timer: setTimeout(() => showContext(f, node), 500) };
          }
        }}
        onPointerMove={(e) => {
          paint.move(e);
          if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) stopHold();
        }}
        onPointerUp={(e) => {
          stopHold();
          paint.end(e);
        }}
        onPointerCancel={() => {
          stopHold();
          paint.cancel();
        }}
      >
        {selection && <span className="vf-check">{selected.has(f.id) ? <Check size={16} /> : null}</span>}
        {f.favorite && !selection && <Heart className="vf-favorite" size={15} fill="currentColor" />}
        <ContentPreview entry={f} adapter={adapter} onOpen={() => open(f)} />
        <div className="vf-file-caption">
          <button title={f.name} onClick={() => open(f)}>
            <span>{nameStem(f.name)}</span>
            <b>{fileExtension(f.name, f.kind)}</b>
          </button>
        </div>
        <small>
          {date(f.updated)} · {byteSize(f.size)}
        </small>
      </article>
    );
  }
  const contextEntry = listing.files.find((f) => f.id === contextFile);
  const showFolders = !folder && section === 'files' && (category === 'all' || category === 'folders');
  return (
    <div className={'vf-app ' + (contextFile ? 'context-active ' : '') + (embedded ? 'vf-embedded' : '')}>
      <Toaster richColors position="top-center" />
      <SidebarProvider className="vf-shell">
        <Sidebar className="vf-sidebar" collapsible="none">
          <SidebarHeader>
            <div className="vf-brand">V O I D E X</div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu>
              {sections.map(([id, label, Icon]) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton isActive={section === id && !folder} onClick={() => navigate(id)}>
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            <div className="vf-side-label">ПАПКИ</div>
            <SidebarMenu>
              {listing.folders.map((f) => (
                <SidebarMenuItem key={f.id}>
                  <SidebarMenuButton isActive={folder === f.id} onClick={() => navigate('files', f.id)}>
                    <Folder />
                    <span>{f.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            <button
              className="vf-side-new"
              onClick={() => {
                setName('');
                setModal('folder');
              }}
            >
              <Plus size={17} /> Новая папка
            </button>
          </SidebarContent>
          <SidebarFooter>
            {cloudOff ? (
              <button className="vf-cloud-card" onClick={openCloud} data-testid="files-cloud-card">
                <span>
                  <CloudOff size={17} /> ViCloud
                </span>
                <strong>Пока недоступно</strong>
                <small>Файлы этого сеанса не сохраняются в облаке</small>
              </button>
            ) : (
              <button className="vf-cloud-card" onClick={openCloud}>
                <span>
                  <Cloud size={17} /> Облако Voidex
                </span>
                <strong>{byteSize(listing.used)} из 5 ГБ</strong>
                <Progress value={(listing.used / QUOTA) * 100} />
                <small>Документы доступны на всех устройствах</small>
              </button>
            )}
          </SidebarFooter>
        </Sidebar>
        <main className="vf-main">
          <header className="vf-header">
            <div className="vf-head-row">
              <div className="vf-heading">
                {folder && (
                  <button className="vf-icon" onClick={() => navigate('files')} aria-label="Назад к файлам">
                    <ArrowLeft />
                  </button>
                )}
                <div>
                  <h1>{title}</h1>
                  <button className="vf-cloud-link" onClick={openCloud} data-testid="files-cloud-link">
                    {cloudOff ? <CloudOff size={15} /> : <Cloud size={15} />} {cloudOff ? 'ViCloud' : 'Облако · 5 ГБ'}{' '}
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
              <div className="vf-head-actions">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="vf-icon" aria-label="Вид и порядок">
                      <LayoutGrid />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="vf-menu" align="end">
                    <DropdownMenuItem onSelect={() => setLayout('grid')}>
                      <LayoutGrid /> Сетка {layout === 'grid' && <Check />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setLayout('list')}>
                      <List /> Список {layout === 'list' && <Check />}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setDescending(!descending)}>
                      <ArrowDownUp /> {descending ? 'Новые сверху' : 'Новые снизу'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => navigate('files')}>
                      <Folder /> Все файлы
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate('favorite')}>
                      <Heart /> Избранное
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate('trash')}>
                      <Trash2 /> Корзина
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        setName('');
                        setModal('folder');
                      }}
                    >
                      <FolderInput /> Новая папка
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  className={'vf-icon ' + (selection ? 'active' : '')}
                  onClick={() => {
                    setSelection(!selection);
                    setSelected(new Set());
                  }}
                  aria-label="Выбрать файлы"
                  aria-pressed={selection}
                >
                  <CheckCircle2 />
                </button>
              </div>
            </div>
            <div className="vf-filter-row">
              <div ref={categoryRef} className="vf-category-scroll" {...gesture}>
                <Tabs
                  value={category}
                  onValueChange={(v) => {
                    setCategory(v);
                    if (v === 'folders') {
                      setSection('files');
                      setFolder(null);
                    }
                  }}
                >
                  <TabsList className="vf-filters">
                    {categories.map(([id, label, Icon]) => (
                      <TabsTrigger key={id} value={id}>
                        <Icon size={16} />
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              <span className="vf-file-count">
                {selection
                  ? 'Выбрано: ' + selected.size
                  : category === 'folders'
                    ? listing.folders.length + ' папок'
                    : visible.length + ' файлов'}
              </span>
              {selection && (
                <button className="vf-link" onClick={() => setSelected(new Set([...selected, ...visible.map((f) => f.id)]))}>
                  Выбрать все
                </button>
              )}
            </div>
          </header>
          <div className="vf-scroll" ref={scrollRef}>
            {host?.notice}
            {loadError && (
              <div className="vf-error" role="alert">
                {loadError}
                <button onClick={reload}>Повторить</button>
              </div>
            )}
            {showFolders && (
              <section className="vf-folders-section">
                <div className="vf-section-head">
                  <h2>Папки</h2>
                  <button
                    className="vf-link"
                    onClick={() => {
                      setName('');
                      setModal('folder');
                    }}
                  >
                    <Plus size={16} /> Папка
                  </button>
                </div>
                <div className={'vf-folders ' + (layout === 'list' ? 'vf-folders-list' : 'vf-folders-grid')} ref={folderTrack}>
                  {listing.folders
                    .filter((f) => f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
                    .map((f) => (
                      <button key={f.id} className="vf-folder-card" onClick={() => navigate('files', f.id)}>
                        <Folder className="vf-folder-icon" fill="#a58aff" />
                        <div>
                          <strong>{f.name}</strong>
                          <small>{listing.files.filter((a) => a.folder === f.id && !a.trashed).length} файлов</small>
                        </div>
                        <ChevronRight className="vf-folder-arrow" />
                      </button>
                    ))}
                  {!listing.folders.length && (
                    <button
                      className="vf-folder-card vf-folder-placeholder"
                      onClick={() => {
                        setName('');
                        setModal('folder');
                      }}
                    >
                      <Folder className="vf-folder-icon" />
                      <div>
                        <strong>Новая папка</strong>
                        <small>Для ваших документов</small>
                      </div>
                      <Plus />
                    </button>
                  )}
                </div>
              </section>
            )}
            {category !== 'folders' && (
              <>
                <div className="vf-section-head">
                  <h2>{folder ? 'В этой папке' : section === 'files' ? 'Файлы' : title}</h2>
                  {folder && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="vf-icon" aria-label="Действия с папкой">
                          <MoreHorizontal />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="vf-menu">
                        <DropdownMenuItem
                          onSelect={() =>
                            run(async () => {
                              await adapter.folder('', folder, true);
                              navigate('files');
                              await reload();
                            })
                          }
                        >
                          <Trash2 /> Удалить папку, оставить файлы
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {loading ? (
                  <div className="vf-grid">
                    {Array.from({ length: 6 }, (_, i) => (
                      <Skeleton key={i} className="h-52 rounded-2xl" />
                    ))}
                  </div>
                ) : visible.length ? (
                  <div
                    key={section + '-' + folder + '-' + layout + '-' + category}
                    className={'vf-grid vf-view-enter ' + (layout === 'list' ? 'vf-list' : '')}
                  >
                    {visible.slice(0, section === 'recent' ? 50 : 2000).map(card)}
                  </div>
                ) : (
                  <div className="vf-empty vf-view-enter">
                    <FileText className="vf-empty-symbol" />
                    <h2>
                      {query
                        ? 'Ничего не найдено'
                        : section === 'trash'
                          ? 'Корзина пуста'
                          : section === 'favorite'
                            ? 'Здесь будет избранное'
                            : 'Здесь будут ваши файлы'}
                    </h2>
                    <p>
                      {query
                        ? 'Попробуйте другое название'
                        : section === 'trash'
                          ? 'Удалённые документы можно восстановить здесь.'
                          : cloudOff
                            ? 'Файлы .txt и .prsn из Vibex и Почты VoidOps открываются здесь.'
                            : 'Скачанные документы и презентации сохраняются здесь, в облаке Voidex.'}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
          {selection && (
            <div className="vf-selection-bar">
              <strong>{selected.size} выбрано</strong>
              <button
                disabled={!selected.size}
                onClick={() => {
                  setTarget(null);
                  setDestination('root');
                  setModal('move');
                }}
              >
                <FolderInput /> В папку
              </button>
              <button
                disabled={!selected.size}
                onClick={() =>
                  run(async () => {
                    for (const f of listing.files.filter((f) => selected.has(f.id))) await adapter.patch(f.id, { favorite: true });
                    await reload();
                    toast.success('Добавлено в избранное');
                  })
                }
              >
                <Heart /> Избранное
              </button>
              <button
                disabled={!selected.size}
                onClick={() =>
                  run(async () => {
                    for (const f of listing.files.filter((f) => selected.has(f.id)))
                      await adapter.patch(f.id, { trashed: section !== 'trash' });
                    setSelected(new Set());
                    await reload();
                  })
                }
              >
                <Trash2 /> {section === 'trash' ? 'Восстановить' : 'В корзину'}
              </button>
              <button
                onClick={() => {
                  setSelection(false);
                  setSelected(new Set());
                }}
              >
                Готово
              </button>
            </div>
          )}
          <FileDock
            section={section}
            searchOpen={mobileSearch}
            keyboard={keyboard}
            query={query}
            setQuery={setQuery}
            navigate={navigate}
            openSearch={startSearch}
            closeSearch={closeSearch}
            inputRef={searchRef}
          />
        </main>
      </SidebarProvider>
      {opened && (
        <Editor
          key={opened.file.id + (shareToken || '')}
          opened={opened}
          adapter={adapter}
          token={shareToken}
          host={host}
          onClose={() => {
            setOpened(null);
            setShareToken(undefined);
            if (new URLSearchParams(location.search).has('share')) history.replaceState(null, '', location.pathname);
            reload();
          }}
          onSaved={(f) => {
            cache.set(f.file.id + ':' + f.file.revision, Promise.resolve(f));
            reload();
          }}
          onShare={share}
        />
      )}
      <FileModal open={modal !== null} onClose={() => setModal(null)}>
        <DialogTitle>
          {modal === 'folder'
            ? 'Новая папка'
            : modal === 'rename'
              ? 'Название файла'
              : modal === 'move'
                ? 'Переместить в папку'
                : 'Облако Voidex'}
        </DialogTitle>
        <DialogDescription>
          {modal === 'cloud'
            ? 'Документы и презентации хранятся в облаке.'
            : modal === 'move'
              ? 'Выберите место для выбранных файлов.'
              : 'Сохранится в вашем облаке Voidex.'}
        </DialogDescription>
        {modal === 'cloud' ? (
          <>
            <div className="vf-cloud-big">
              <Cloud />
              <strong>
                {byteSize(listing.used)} <small>из 5 ГБ</small>
              </strong>
              <Progress value={(listing.used / QUOTA) * 100} />
            </div>
            <p className="vf-muted">Стартовый пакет: 5 ГБ. Фото, видео и скриншоты находятся в медиатеке.</p>
          </>
        ) : (
          <>
            {modal === 'move' ? (
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Все файлы</SelectItem>
                  {listing.folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <label className="vf-rename-field">
                <input
                  className="vf-name-input"
                  value={name}
                  autoFocus
                  placeholder={modal === 'folder' ? 'Название папки' : 'Название файла'}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                  }}
                />
                {modal === 'rename' && target && <span>{fileExtension(target.name, target.kind)}</span>}
              </label>
            )}
            <button className="vf-primary" disabled={busy || ((modal === 'folder' || modal === 'rename') && !name.trim())} onClick={submit}>
              <Check size={18} /> {modal === 'rename' ? 'Сохранить' : modal === 'move' ? 'Переместить' : 'Готово'}
            </button>
          </>
        )}
      </FileModal>
      {sharing && <FileShare key={sharing.file.id} file={sharing} adapter={adapter} host={host} onClose={() => setSharing(null)} />}
      {contextEntry && (
        <FileContextMenu anchor={contextAnchor} name={contextEntry.name} onClose={closeContext}>
          {!contextEntry.trashed ? (
            <>
              <button
                onClick={() =>
                  run(async () => {
                    setShareToken(undefined);
                    setOpened(await adapter.open(contextEntry.id));
                  })
                }
              >
                <FileText />
                Открыть
              </button>
              <button onClick={() => shareEntry(contextEntry)}>
                <Share2 />
                Поделиться
              </button>
              <button onClick={() => patch(contextEntry, { favorite: !contextEntry.favorite })}>
                <Heart />
                {contextEntry.favorite ? 'Убрать из избранного' : 'В избранное'}
              </button>
              <hr />
              <button
                onClick={() => {
                  setTarget(contextEntry);
                  setName(nameStem(contextEntry.name));
                  setModal('rename');
                }}
              >
                <Pencil />
                Переименовать
              </button>
              <button
                onClick={() => {
                  setTarget(contextEntry);
                  setDestination(contextEntry.folder || 'root');
                  setModal('move');
                }}
              >
                <FolderInput />
                Переместить
              </button>
              <button onClick={() => navigate('files', contextEntry.folder)}>
                <FolderOpen />
                Показать в папке
              </button>
              <hr />
              <button className="vf-danger" onClick={() => patch(contextEntry, { trashed: true })}>
                <Trash2 />В корзину
              </button>
            </>
          ) : (
            <button onClick={() => patch(contextEntry, { trashed: false })}>
              <RefreshCw />
              Восстановить
            </button>
          )}
        </FileContextMenu>
      )}
    </div>
  );
}
