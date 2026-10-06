'use client';
import { useEffect, useState } from 'react';
import { Search, Link2, Users, ChevronLeft, User } from 'lucide-react';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Switch } from '../../components/ui/switch';
import { toast } from 'sonner';
import { FileModal } from './FileModal';
import type { FilesAdapter, FilesHost, ShareRecipient } from './adapter';
import type { OpenFile } from './model';
export function FileShare({
  file,
  adapter,
  host,
  onClose,
}: {
  file: OpenFile;
  adapter: FilesAdapter;
  host?: FilesHost;
  onClose: () => void;
}) {
  const [page, setPage] = useState<'main' | 'vibex' | 'voidops' | 'users'>('main'),
    [query, setQuery] = useState(''),
    [editable, setEditable] = useState(false),
    [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [recipients, setRecipients] = useState<ShareRecipient[]>([]),
    [loading, setLoading] = useState(false),
    [links, setLinks] = useState<Awaited<ReturnType<FilesAdapter['shares']>>>([]);
  useEffect(() => {
    if (page === 'users') {
      adapter
        .shares()
        .then((v) => setLinks(v.filter((l) => l.file === file.file.id)))
        .catch((e) => toast.error(e.message));
      return;
    }
    let live = true;
    setRecipients([]);
    if (!host?.searchRecipients || page === 'main') return;
    setLoading(true);
    const timer = setTimeout(
      () =>
        host.searchRecipients!(page, query)
          .then((v) => {
            if (live) setRecipients(v);
          })
          .catch((e) => {
            if (live) toast.error(e.message);
          })
          .finally(() => {
            if (live) setLoading(false);
          }),
      150,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [page, query, file.file.id, adapter, host]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function link() {
    if (url) return url;
    const r = await adapter.share(file.file.id, editable),
      u = new URL(location.href);
    u.search = '';
    u.searchParams.set('share', r.token);
    setUrl(u.toString());
    return u.toString();
  }
  async function send(channel: 'vibex' | 'voidops', recipient?: ShareRecipient) {
    await run(async () => {
      if (!host?.shareTo) {
        toast('Отправка через ' + (channel === 'vibex' ? 'Vibex' : 'VoidOps') + ' доступна внутри Voidex');
        return;
      }
      await host.shareTo(channel, { url: await link(), name: file.file.name, editable, recipientId: recipient?.id });
    });
  }
  const owner = host?.currentUser;
  return (
    <FileModal open onClose={onClose} share>
      <div className="vf-share-view" key={page}>
        {page === 'users' ? (
          <>
            <DialogTitle>Пользователи</DialogTitle>
            <DialogDescription>{file.file.name}</DialogDescription>
            <div className="vf-share-owner">
              <span className="vf-avatar">
                <User />
              </span>
              <div>
                <strong>
                  {owner?.name || 'Вы'}
                  {owner?.name ? ' · вы' : ''}
                </strong>
                {owner?.email && <small>{owner.email}</small>}
              </div>
              <span className="vf-owner-badge">Владелец</span>
            </div>
            <p className="vf-muted">{links.length ? 'Доступ также предоставлен по созданным ссылкам.' : 'Доступ есть только у вас.'}</p>
            {links.map((l) => (
              <div className="vf-share-row" key={l.token}>
                <Link2 />
                <div>
                  <strong>{l.editable ? 'Редактирование оригинала' : 'Копия для просмотра'}</strong>
                  <small>Ссылка на файл</small>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await adapter.revoke(l.token);
                      setLinks((v) => v.filter((x) => x.token !== l.token));
                      toast.success('Доступ отозван');
                    })
                  }
                >
                  Отозвать
                </button>
              </div>
            ))}
            <button className="vf-share-back" onClick={() => setPage('main')}>
              <ChevronLeft /> Назад
            </button>
          </>
        ) : (
          <>
            <div className="vf-share-heading">
              <img src={'/assets/' + file.file.kind + '.webp'} alt="" />
              <div>
                <DialogTitle>{file.file.name}</DialogTitle>
                <DialogDescription>
                  {editable ? 'Люди работают с вами в оригинале' : 'Получатель сможет добавить свою копию'}
                </DialogDescription>
              </div>
            </div>
            <label className="vf-share-search">
              <Search />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && page === 'main') setPage('vibex');
                }}
                placeholder={page === 'voidops' ? 'Имя или адрес Почты VoidOps' : 'Поиск людей и чатов'}
                aria-label="Поиск получателя"
              />
            </label>
            {page === 'main' ? (
              <div className="vf-share-targets">
                <button
                  onClick={() => {
                    setPage('vibex');
                    setQuery('');
                  }}
                >
                  <span className="vf-channel-icon vibex" />
                  Vibex
                </button>
                <button
                  onClick={() => {
                    setPage('voidops');
                    setQuery('');
                  }}
                >
                  <span className="vf-channel-icon voidops" />
                  Почта VoidOps
                </button>
              </div>
            ) : (
              <>
                <button
                  className="vf-share-back"
                  onClick={() => {
                    setPage('main');
                    setQuery('');
                  }}
                >
                  <ChevronLeft />
                  {page === 'vibex' ? 'Vibex' : 'Почта VoidOps'}
                </button>
                <div className="vf-recipient-list">
                  {loading ? (
                    <p className="vf-muted">Поиск…</p>
                  ) : (
                    recipients.map((r) => (
                      <button key={r.id} disabled={busy} onClick={() => send(page as 'vibex' | 'voidops', r)}>
                        <span className="vf-avatar">{r.avatar ? <img src={r.avatar} alt="" /> : r.name.slice(0, 2).toUpperCase()}</span>
                        <span>{r.name}</span>
                      </button>
                    ))
                  )}
                  {!loading && !recipients.length && (
                    <p className="vf-muted">{host?.searchRecipients ? 'Получатели не найдены.' : 'Контакты доступны внутри Voidex.'}</p>
                  )}
                  {!host?.searchRecipients && host?.shareTo && (
                    <button className="vf-secondary" onClick={() => send(page as 'vibex' | 'voidops')}>
                      Выбрать получателя
                    </button>
                  )}
                </div>
              </>
            )}
            <div className="vf-permission">
              <div>
                <strong>Разрешить редактирование</strong>
                <p>Включено: люди работают с вами в этом оригинале. Выключено: получат свою копию.</p>
              </div>
              <Switch
                disabled={busy}
                checked={editable}
                onCheckedChange={(v) => {
                  setEditable(v);
                  setUrl('');
                }}
                aria-label="Разрешить редактирование"
              />
            </div>
            <div className="vf-share-buttons">
              <button
                className="vf-secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const u = await link();
                    try {
                      await navigator.clipboard.writeText(u);
                      toast.success('Ссылка скопирована');
                    } catch {
                      toast('Скопируйте ссылку из поля ниже');
                    }
                  })
                }
              >
                <Link2 />
                Копировать ссылку
              </button>
              <button className="vf-secondary" onClick={() => setPage('users')}>
                <Users />
                Пользователи
              </button>
            </div>
            {url && <input className="vf-share-url" readOnly aria-label="Ссылка на файл" value={url} onFocus={(e) => e.target.select()} />}
          </>
        )}
      </div>
    </FileModal>
  );
}
