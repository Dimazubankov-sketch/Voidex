import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiArrowLeftSLine, RiCheckLine, RiCloseLine, RiGroupLine, RiLinkM, RiSearchLine, RiSendPlaneFill } from "@remixicon/react";
import type { NotesRole, NotesShareKind, VibexMessageDto } from "@voidex/shared";
import { Avatar, MailGlyph, VibexGlyph } from "@/brand/brand";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { Spinner, Switch } from "@/ui/controls";
import { Sheet, toast } from "@/ui/overlays";
import { draftsApi, useContacts } from "@/apps/mail/data";
import { openDirect, useChats, usePeople, vk } from "@/apps/vibex/data";
import { invalidateNotes, notesApi, shareLink, useLinks, useMembers, type ResourceType } from "./data";
import { FileIcon } from "./kit";

/** What is being shared. */
export interface ShareTarget {
  type: ResourceType;
  id: string;
  name: string;
  ext: ".txt" | ".prsn";
  kind: NotesShareKind;
  role: NotesRole;
}

type Dest = "vibex" | "mail";

interface Pick {
  key: string;
  name: string;
  /** Vibex: a chat (group) or a person (direct chat opened on send). */
  chatId?: string;
  userId?: string;
  avatar?: { userId?: string; version: number };
  /** Mail: the address. */
  address?: string;
}

/**
 * Share a note, presentation or project (Step 2.6), the way Vibex shares a
 * post: search on top, choose where (Vibex or VoidOps Mail), then who. It
 * arrives as a "Name.txt" / "Name.prsn" file card. "Разрешить редактирование"
 * off: the person adds their own copy. On: they work in the original
 * (Editor; the owner can make them a Viewer or remove them in Users).
 */
export function ShareSheet({ target, onClose, onUsers }: { target: ShareTarget | null; onClose: () => void; onUsers: (t: ShareTarget) => void }) {
  const t = useT();
  const last = useRef<ShareTarget | null>(null);
  if (target) last.current = target;
  return (
    <Sheet open={!!target} onClose={onClose} width={520} testId="notes-share-sheet">
      {last.current && <ShareBody key={`${last.current.type}:${last.current.id}`} target={last.current} onClose={onClose} onUsers={onUsers} t={t} />}
    </Sheet>
  );
}

function ShareBody({ target, onClose, onUsers, t }: { target: ShareTarget; onClose: () => void; onUsers: (t: ShareTarget) => void; t: ReturnType<typeof useT> }) {
  const [dest, setDest] = useState<Dest | null>(null);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(false);
  const [picked, setPicked] = useState<Pick[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const create = (recipientIds?: string[]) =>
    notesApi.createShare({ resourceType: target.type, resourceId: target.id, mode: edit ? "access" : "copy", role: "editor", ...(recipientIds?.length ? { recipientIds } : {}) });

  const send = async () => {
    if (!dest || !picked.length) return;
    setSending(true);
    try {
      const share = await create(dest === "vibex" ? picked.flatMap((p) => (p.userId ? [p.userId] : [])) : undefined);
      if (dest === "vibex") {
        for (const p of picked) {
          const chatId = p.chatId ?? (await openDirect(p.userId!)).id;
          await api.post<VibexMessageDto>(`/api/vibex/chats/${chatId}/messages`, { text: text.trim(), notesToken: share.token });
        }
        void queryClient.invalidateQueries({ queryKey: vk.chats });
      } else {
        const draft = await draftsApi.create({
          to: picked.map((p) => p.address!),
          subject: `${target.name}${target.ext}`,
          body: text.trim(),
          notesTokens: [share.token],
        } as Parameters<typeof draftsApi.create>[0]);
        await draftsApi.send(draft.id);
        void queryClient.invalidateQueries({ queryKey: ["mail"] });
      }
      void invalidateNotes();
      toast({ title: t("notes.shareSent"), body: picked.map((p) => p.name).join(", "), tone: "success" });
      onClose();
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    try {
      const share = await create();
      await navigator.clipboard?.writeText(shareLink(share.token)).catch(() => undefined);
      void invalidateNotes();
      toast({ title: t("notes.linkCopied"), body: edit ? t("notes.share.accessHint") : t("notes.share.copyHint"), tone: "success" });
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="notes-share" data-dest={dest ?? ""}>
      <div className="flex items-center gap-3">
        <FileIcon ext={target.ext} className="size-12 rounded-[12px]" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[16px] font-semibold text-text" data-testid="notes-share-file">
            {target.name}
            {target.ext}
          </span>
          <span className="text-[13px] text-text-tertiary">{edit ? t("notes.share.accessHint") : t("notes.share.copyHint")}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="grid size-9 place-items-center rounded-full bg-surface-secondary text-text-secondary">
          <RiCloseLine className="size-5" />
        </button>
      </div>

      <label className="flex h-11 items-center gap-2 rounded-2xl bg-surface-secondary px-3.5">
        <RiSearchLine className="size-[18px] shrink-0 text-text-tertiary" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!dest && e.target.value) setDest("vibex");
          }}
          placeholder={dest === "mail" ? t("notes.share.searchMail") : t("notes.share.search")}
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-text-tertiary"
          data-testid="notes-share-search"
        />
      </label>

      {!dest ? (
        <div className="grid grid-cols-2 gap-3" data-testid="notes-share-apps">
          {(
            [
              ["vibex", t("vibex.title"), <VibexGlyph key="v" className="size-9" />],
              ["mail", t("mail.title"), <MailGlyph key="m" className="size-9" />],
            ] as const
          ).map(([id, label, glyph]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDest(id)}
              className="pressable flex flex-col items-center gap-2 rounded-[22px] border border-border bg-surface px-2 py-4 hover:bg-surface-hover"
              data-testid={`notes-share-app-${id}`}
            >
              <span className="grid size-14 place-items-center rounded-[16px] bg-surface-secondary">{glyph}</span>
              <span className="text-[14px] font-medium text-text">{label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setDest(null);
              setPicked([]);
              setQ("");
            }}
            className="flex w-fit items-center gap-1 rounded-full bg-surface-secondary py-1 pl-1.5 pr-3 text-[13.5px] font-medium text-text-secondary"
            data-testid="notes-share-back"
          >
            <RiArrowLeftSLine className="size-[18px]" />
            {dest === "vibex" ? t("vibex.title") : t("mail.title")}
          </button>
          {dest === "vibex" ? <VibexContacts q={q} picked={picked} setPicked={setPicked} t={t} /> : <MailContacts q={q} picked={picked} setPicked={setPicked} t={t} />}
        </div>
      )}

      <AnimatePresence initial={false}>
        {picked.length > 0 && (
          <motion.div className="flex items-center gap-2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("notes.share.comment")}
              className="h-11 min-w-0 flex-1 rounded-2xl bg-surface-secondary px-3.5 text-[16px] outline-none placeholder:text-text-tertiary"
              onKeyDown={(e) => e.key === "Enter" && !sending && void send()}
              data-testid="notes-share-comment"
            />
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="pressable flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-primary px-4 text-[15px] font-semibold text-white shadow-glow disabled:opacity-60"
              data-testid="notes-share-send"
            >
              {sending ? <Spinner size={16} /> : <RiSendPlaneFill className="size-[18px]" />}
              {t("notes.share.send")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-1 border-t pt-3">
        <div className="flex min-h-12 items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-medium text-text">{t("notes.share.allowEdit")}</span>
            <span className="text-[12.5px] leading-snug text-text-tertiary">{t("notes.share.allowEditHint")}</span>
          </span>
          <span data-testid="notes-share-edit" data-on={edit}>
            <Switch checked={edit} onChange={setEdit} label={t("notes.share.allowEdit")} />
          </span>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void copy()} className="pressable flex h-11 items-center justify-center gap-2 rounded-2xl bg-surface-secondary text-[14.5px] font-medium text-text" data-testid="notes-share-copy">
            <RiLinkM className="size-[18px]" />
            {t("notes.share.copyLink")}
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onUsers(target);
            }}
            className="pressable flex h-11 items-center justify-center gap-2 rounded-2xl bg-surface-secondary text-[14.5px] font-medium text-text"
            data-testid="notes-share-users"
          >
            <RiGroupLine className="size-[18px]" />
            {t("notes.users")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactGrid({ items, picked, setPicked, empty }: { items: Pick[]; picked: Pick[]; setPicked: (f: (p: Pick[]) => Pick[]) => void; empty: string }) {
  const toggle = (p: Pick) => setPicked((x) => (x.some((y) => y.key === p.key) ? x.filter((y) => y.key !== p.key) : [...x, p]));
  return (
    <div className="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-5" data-testid="notes-share-contacts">
      {items.map((p) => {
        const on = picked.some((x) => x.key === p.key);
        return (
          <button key={p.key} type="button" onClick={() => toggle(p)} className="pressable flex min-w-0 flex-col items-center gap-1.5" data-testid="notes-share-contact" aria-pressed={on} title={p.address ?? p.name}>
            <span className="relative">
              <Avatar name={p.name} userId={p.avatar?.userId} version={p.avatar?.version ?? 0} size={56} className={cx("transition", on && "ring-[3px] ring-primary ring-offset-2 ring-offset-surface")} />
              {on && (
                <span className="absolute -bottom-0.5 -right-0.5 flex size-[22px] items-center justify-center rounded-full border-2 border-surface bg-primary text-white">
                  <RiCheckLine className="size-3.5" />
                </span>
              )}
            </span>
            <span className="w-full truncate text-center text-[12px] leading-tight text-text">{p.name}</span>
          </button>
        );
      })}
      {!items.length && <div className="col-span-full py-4 text-center text-[14px] text-text-tertiary">{empty}</div>}
    </div>
  );
}

function VibexContacts({ q, picked, setPicked, t }: { q: string; picked: Pick[]; setPicked: (f: (p: Pick[]) => Pick[]) => void; t: ReturnType<typeof useT> }) {
  const me = useSession((s) => s.user?.id);
  const chats = useChats();
  const people = usePeople(q.trim());
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: Pick[] = [];
    const seen = new Set<string>();
    for (const c of chats.data ?? []) {
      if (c.peer) {
        const p = c.peer;
        if (needle && !(p.name.toLowerCase().includes(needle) || p.handle.includes(needle) || p.address.includes(needle))) continue;
        seen.add(p.id);
        out.push({ key: `u:${p.id}`, name: p.firstName || p.name, userId: p.id, chatId: c.id, avatar: { userId: p.id, version: p.avatarVersion } });
      } else if (c.group) {
        if (needle && !c.group.title.toLowerCase().includes(needle)) continue;
        out.push({ key: `c:${c.id}`, name: c.group.title, chatId: c.id, avatar: { version: 0 } });
      }
    }
    for (const p of people.data ?? []) {
      if (seen.has(p.id) || p.id === me) continue;
      out.push({ key: `u:${p.id}`, name: p.firstName || p.name, userId: p.id, avatar: { userId: p.id, version: p.avatarVersion } });
    }
    return out.slice(0, 30);
  }, [chats.data, people.data, q, me]);
  return <ContactGrid items={items} picked={picked} setPicked={setPicked} empty={q.trim() ? t("notes.share.noPeople") : t("vibex.people.hint")} />;
}

function MailContacts({ q, picked, setPicked, t }: { q: string; picked: Pick[]; setPicked: (f: (p: Pick[]) => Pick[]) => void; t: ReturnType<typeof useT> }) {
  const chats = useChats();
  const contacts = useContacts(q.trim());
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: Pick[] = [];
    const seen = new Set<string>();
    const add = (address: string, name: string | null, userId?: string, version = 0) => {
      const a = address.toLowerCase();
      if (seen.has(a)) return;
      seen.add(a);
      out.push({ key: `m:${a}`, name: name || a.split("@")[0]!, address: a, avatar: { userId, version } });
    };
    for (const c of contacts.data ?? []) add(c.address, c.name);
    for (const c of chats.data ?? []) {
      const p = c.peer;
      if (p && (!needle || p.name.toLowerCase().includes(needle) || p.address.includes(needle))) add(p.address, p.name, p.id, p.avatarVersion);
    }
    // A full address typed in: offer it as is.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(needle)) add(needle, null);
    return out.slice(0, 30);
  }, [contacts.data, chats.data, q]);
  return <ContactGrid items={items} picked={picked} setPicked={setPicked} empty={q.trim() ? t("notes.share.noPeople") : t("notes.share.mailHint")} />;
}

/**
 * "Пользователи": who has access — avatar, name, address, role. The owner
 * switches Viewer ↔ Editor and removes people (their open editor closes at
 * once), and sees / revokes the links.
 */
export function MembersSheet({ target, onClose }: { target: ShareTarget | null; onClose: () => void }) {
  const t = useT();
  const last = useRef<ShareTarget | null>(null);
  if (target) last.current = target;
  return (
    <Sheet open={!!target} onClose={onClose} title={t("notes.users")} width={480} testId="notes-members-sheet">
      {last.current && <MembersBody key={`${last.current.type}:${last.current.id}`} target={last.current} />}
    </Sheet>
  );
}

function MembersBody({ target }: { target: ShareTarget }) {
  const t = useT();
  const me = useSession((s) => s.user?.id);
  const members = useMembers(target.type, target.id);
  const owner = target.role === "owner";
  const links = useLinks(target.type, target.id, owner);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await invalidateNotes();
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  };
  if (members.isLoading)
    return (
      <div className="grid place-items-center py-8">
        <Spinner />
      </div>
    );
  return (
    <div className="flex flex-col gap-1" data-testid="notes-members">
      <p className="mb-1 text-[13.5px] text-text-tertiary">
        {target.name}
        {target.ext}
      </p>
      {(members.data ?? []).map((m) => (
        <div key={m.id} className="flex min-h-[60px] items-center gap-3" data-testid="notes-member" data-user={m.id} data-role={m.role}>
          <Avatar name={m.name} userId={m.id} version={m.avatarVersion} size={42} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-medium text-text">
              {m.name}
              {m.id === me && <span className="text-text-tertiary"> · {t("notes.you")}</span>}
            </span>
            <span className="truncate text-[12.5px] text-text-tertiary">{m.mailAddress || `@${m.username}`}</span>
          </span>
          {m.role === "owner" || !owner ? (
            <span className="shrink-0 rounded-full bg-surface-secondary px-2.5 py-1 text-[12.5px] font-medium text-text-secondary" data-testid="notes-member-role">
              {t(`notes.role.${m.role}`)}
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="flex rounded-full bg-surface-secondary p-0.5" role="radiogroup" aria-label={t("notes.role.label")}>
                {(["viewer", "editor"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={m.role === r}
                    disabled={busy !== null}
                    onClick={() => m.role !== r && void run(`${m.id}:role`, () => notesApi.setRole(target.type, target.id, m.id, r))}
                    className={cx("h-7 rounded-full px-2.5 text-[12.5px] font-medium transition-colors", m.role === r ? "bg-surface text-text shadow-sm" : "text-text-tertiary")}
                    data-testid={`notes-member-${r}`}
                  >
                    {t(`notes.role.${r}`)}
                  </button>
                ))}
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run(`${m.id}:rm`, () => notesApi.removeMember(target.type, target.id, m.id))}
                aria-label={t("notes.removeAccess")}
                title={t("notes.removeAccess")}
                className="grid size-8 place-items-center rounded-full text-danger hover:bg-danger-soft"
                data-testid="notes-member-remove"
              >
                {busy === `${m.id}:rm` ? <Spinner size={14} /> : <RiCloseLine className="size-[18px]" />}
              </button>
            </span>
          )}
        </div>
      ))}
      {(members.data ?? []).length <= 1 && <p className="py-2 text-[14px] text-text-tertiary">{t("notes.noMembers")}</p>}
      {owner && (links.data ?? []).length > 0 && (
        <div className="mt-3 border-t pt-3" data-testid="notes-links">
          <p className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-text-tertiary">{t("notes.links")}</p>
          {links.data!.map((l, i) => (
            <div key={i} className="flex min-h-11 items-center gap-3" data-testid="notes-link">
              <RiLinkM className="size-[18px] shrink-0 text-text-tertiary" />
              <span className="min-w-0 flex-1 truncate text-[14px] text-text">
                {l.mode === "copy" ? t("notes.link.copy") : t("notes.link.access", { role: t(`notes.role.${l.role}`) })} · {new Date(l.createdAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run(`link:${i}`, () => notesApi.revokeShare(l.token))}
                className="h-8 rounded-full px-3 text-[13px] font-medium text-danger hover:bg-danger-soft"
                data-testid="notes-link-revoke"
              >
                {t("notes.link.revoke")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
