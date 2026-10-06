'use client';
import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogPortal, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Dialog as Primitive } from 'radix-ui';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { ArrowLeft, Undo2, Redo2, Share2, Plus, ChevronLeft, ChevronRight, Trash2, Lock, Play, Copy } from 'lucide-react';
import type { OpenFile, FileData } from './model';
import type { FilesAdapter, FilesHost } from './adapter';
import { slide, block, backgrounds } from './presentation';
export const canvasBackground: Record<string, string> = {
  white: '#fff',
  milk: 'linear-gradient(145deg,#fff,#eeebf5)',
  lavender: 'radial-gradient(at 100% 0%,#d5c6ff,transparent 70%),#faf9ff',
  split: 'linear-gradient(120deg,#fff 50%,#ece4ff 50%)',
  wave: 'linear-gradient(140deg,#b299ff,#7046ef,#3e27b3)',
  graphite: 'linear-gradient(140deg,#383240,#18151e)',
};
export function Editor({
  opened,
  adapter,
  token,
  onClose,
  onSaved,
  onShare,
  host,
}: {
  opened: OpenFile;
  adapter: FilesAdapter;
  token?: string;
  onClose: () => void;
  onSaved: (f: OpenFile) => void;
  onShare: (f: OpenFile) => void;
  host?: FilesHost;
}) {
  const [file, setFile] = useState(opened),
    [data, setData] = useState<FileData>(structuredClone(opened.data)),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [page, setPage] = useState(0),
    [present, setPresent] = useState(false),
    [confirm, setConfirm] = useState(false);
  const history = useRef<FileData[]>([structuredClone(opened.data)]),
    position = useRef(0),
    textRef = useRef<HTMLTextAreaElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    host?.onDirtyChange?.(dirty);
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', fn);
    return () => {
      host?.onDirtyChange?.(false);
      window.removeEventListener('beforeunload', fn);
    };
  }, [dirty, host]);
  const change = (d: FileData) => {
    history.current = history.current.slice(0, position.current + 1);
    history.current.push(structuredClone(d));
    if (history.current.length > 100) history.current.shift();
    position.current = history.current.length - 1;
    setData(d);
    setDirty(true);
  };
  const undo = (d: number) => {
    position.current = Math.min(history.current.length - 1, Math.max(0, position.current + d));
    setData(structuredClone(history.current[position.current]!));
    setDirty(true);
  };
  async function save(close = false) {
    setBusy(true);
    setError('');
    try {
      const f = await adapter.save(file.file.id, data, file.file.revision, token);
      setFile(f);
      setDirty(false);
      onSaved(f);
      if (close) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exit() {
    if (dirty) setConfirm(true);
    else onClose();
  }
  async function copy() {
    setBusy(true);
    try {
      const f = await adapter.receive(file.file.name, file.file.kind, data);
      onSaved(f);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const s = typeof data === 'string' ? null : data,
    p = s?.slides[Math.min(page, s.slides.length - 1)],
    can = file.editable && !present;
  const setSlide = (next: Partial<NonNullable<typeof p>>) => {
    if (s && p) change({ ...s, slides: s.slides.map((a, i) => (i === page ? { ...a, ...next } : a)) });
  };
  function insert(prefix: string) {
    const t = textRef.current;
    if (!t || typeof data !== 'string') return;
    const from = t.selectionStart,
      to = t.selectionEnd;
    change(data.slice(0, from) + prefix + data.slice(from, to) + data.slice(to));
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(from + prefix.length, to + prefix.length);
    });
  }
  const next = (d: number) => {
    if (s) setPage((v) => Math.max(0, Math.min(s.slides.length - 1, v + d)));
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) exit();
      }}
    >
      <DialogPortal>
        <Primitive.Overlay className="vf-overlay" />
        <Primitive.Content
          className={'vf-editor ' + (present ? 'vf-present' : '')}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            present ? setPresent(false) : exit();
          }}
          onKeyDown={(e) => {
            if (present) {
              if (e.key === 'ArrowRight') next(1);
              if (e.key === 'ArrowLeft') next(-1);
            }
          }}
        >
          <DialogTitle className="sr-only">{file.file.name}</DialogTitle>
          <DialogDescription className="sr-only">Редактор документа Voidex</DialogDescription>
          <header className="vf-editor-header">
            <button className="vf-icon" onClick={present ? () => setPresent(false) : exit} aria-label="Назад">
              <ArrowLeft />
            </button>
            <div className="vf-editor-name">
              <strong>{file.file.name}</strong>
              <small>
                {!file.editable ? 'Только просмотр' : busy ? 'Сохраняем в облаке…' : dirty ? 'Есть изменения' : 'Сохранено в облаке'}
              </small>
            </div>
            <div className="vf-editor-actions">
              {can && (
                <>
                  <button className="vf-icon" disabled={position.current === 0} onClick={() => undo(-1)} aria-label="Отменить">
                    <Undo2 />
                  </button>
                  <button
                    className="vf-icon"
                    disabled={position.current === history.current.length - 1}
                    onClick={() => undo(1)}
                    aria-label="Повторить"
                  >
                    <Redo2 />
                  </button>
                </>
              )}
              {!file.shared && (
                <button className="vf-icon" disabled={dirty} onClick={() => onShare(file)} aria-label="Поделиться">
                  <Share2 />
                </button>
              )}
              {s && (
                <button className="vf-icon" onClick={() => setPresent(!present)} aria-label="Показать презентацию">
                  <Play />
                </button>
              )}
              {can && (
                <button className="vf-primary" disabled={busy || !dirty} onClick={() => save()}>
                  Сохранить
                </button>
              )}
            </div>
          </header>
          {error && (
            <div role="alert" className="vf-error">
              {error}
              <button onClick={() => navigator.clipboard.writeText(typeof data === 'string' ? data : JSON.stringify(data))}>
                Скопировать изменения
              </button>
            </div>
          )}
          {!file.editable && (
            <div className="vf-readonly">
              <Lock size={16} /> Владелец отключил редактирование оригинала.
              <button disabled={busy} onClick={copy}>
                <Copy size={16} /> Добавить свою копию
              </button>
            </div>
          )}
          <div className="vf-editor-body">
            {typeof data === 'string' ? (
              <div className="vf-paper">
                <textarea
                  ref={textRef}
                  aria-label="Текст документа"
                  placeholder="Начните писать…"
                  value={data}
                  readOnly={!can}
                  onChange={(e) => change(e.target.value)}
                  spellCheck
                />
              </div>
            ) : (
              <>
                <aside className="vf-slides">
                  {data.slides.map((a, i) => (
                    <button key={a.id} className={page === i ? 'active' : ''} onClick={() => setPage(i)}>
                      <span>{i + 1}</span>
                      <div
                        style={{
                          background: canvasBackground[a.background],
                          color: ['wave', 'graphite'].includes(a.background) ? '#fff' : undefined,
                        }}
                      >
                        <strong>{a.blocks.find((b) => b.kind === 'heading')?.text || 'Новый слайд'}</strong>
                        <small>
                          {a.blocks
                            .filter((b) => b.kind !== 'heading')
                            .map((b) => b.text)
                            .join(' ')}
                        </small>
                      </div>
                    </button>
                  ))}
                  {can && (
                    <button
                      className="vf-add-slide"
                      onClick={() => {
                        change({ ...data, slides: [...data.slides, slide()] });
                        setPage(data.slides.length);
                      }}
                    >
                      <Plus /> Добавить слайд
                    </button>
                  )}
                </aside>
                <div
                  className="vf-slide-stage"
                  onPointerDown={(e) => {
                    if (present) start.current = { x: e.clientX, y: e.clientY };
                  }}
                  onPointerUp={(e) => {
                    if (start.current) {
                      const dx = e.clientX - start.current.x;
                      if (Math.abs(dx) > 50) next(dx < 0 ? 1 : -1);
                      start.current = null;
                    }
                  }}
                >
                  {p && (
                    <div
                      key={p.id}
                      className={'vf-slide-canvas ' + (['wave', 'graphite'].includes(p.background) ? 'dark' : '')}
                      style={{ background: canvasBackground[p.background] || '#fff' }}
                    >
                      {p.blocks
                        .filter((b) => !b.hidden)
                        .map((b, i) =>
                          can ? (
                            <div key={b.id} className={'vf-edit-block ' + b.kind}>
                              <textarea
                                aria-label={b.kind === 'heading' ? 'Заголовок слайда' : 'Текст слайда'}
                                value={b.text}
                                placeholder={b.kind === 'heading' ? 'Заголовок' : 'Текст…'}
                                onChange={(e) =>
                                  setSlide({ blocks: p.blocks.map((a) => (a.id === b.id ? { ...a, text: e.target.value } : a)) })
                                }
                              />
                              <button
                                className="vf-block-delete"
                                aria-label="Удалить блок"
                                onClick={() => setSlide({ blocks: p.blocks.filter((a) => a.id !== b.id) })}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ) : (
                            <div className={'vf-view-block ' + b.kind} key={b.id}>
                              {b.text}
                            </div>
                          ),
                        )}
                    </div>
                  )}
                  <div className="vf-page-switch">
                    <button className="vf-icon" disabled={page === 0} onClick={() => next(-1)} aria-label="Предыдущий слайд">
                      <ChevronLeft />
                    </button>
                    <span>
                      {page + 1} / {data.slides.length}
                    </span>
                    <button
                      className="vf-icon"
                      disabled={page === data.slides.length - 1}
                      onClick={() => next(1)}
                      aria-label="Следующий слайд"
                    >
                      <ChevronRight />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          {can &&
            (typeof data === 'string' ? (
              <footer className="vf-text-tools">
                <button onClick={() => insert('• ')}>Список</button>
                <button onClick={() => insert('☐ ')}>Чек-лист</button>
                <span>{data.length} символов</span>
              </footer>
            ) : (
              <footer className="vf-slide-tools">
                <Tabs defaultValue="content">
                  <TabsList>
                    <TabsTrigger value="content">Содержимое</TabsTrigger>
                    <TabsTrigger value="background">Фон</TabsTrigger>
                  </TabsList>
                  <TabsContent value="content">
                    <button onClick={() => setSlide({ blocks: [...(p?.blocks || []), block('heading', '')] })}>+ Заголовок</button>
                    <button onClick={() => setSlide({ blocks: [...(p?.blocks || []), block('text', '')] })}>+ Текст</button>
                    <button onClick={() => setSlide({ blocks: [...(p?.blocks || []), block('quote', '')] })}>+ Цитата</button>
                    <button
                      disabled={data.slides.length === 1}
                      onClick={() => {
                        change({ ...data, slides: data.slides.filter((_, i) => i !== page) });
                        setPage(Math.max(0, page - 1));
                      }}
                    >
                      <Trash2 size={16} /> Слайд
                    </button>
                  </TabsContent>
                  <TabsContent value="background">
                    {backgrounds.map(([value, label]) => (
                      <button
                        title={label}
                        aria-label={label}
                        key={value}
                        className={'vf-swatch ' + (p?.background === value ? 'active' : '')}
                        style={{ background: canvasBackground[value] }}
                        onClick={() => setSlide({ background: value })}
                      />
                    ))}
                  </TabsContent>
                </Tabs>
              </footer>
            ))}
          {confirm && (
            <div className="vf-discard">
              <div>
                <strong>Сохранить изменения?</strong>
                <p>Документ ещё не сохранён в облаке.</p>
                <button disabled={busy} className="vf-primary" onClick={() => save(true)}>
                  Сохранить и закрыть
                </button>
                <button onClick={onClose}>Закрыть без сохранения</button>
                <button onClick={() => setConfirm(false)}>Вернуться</button>
              </div>
            </div>
          )}
        </Primitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
