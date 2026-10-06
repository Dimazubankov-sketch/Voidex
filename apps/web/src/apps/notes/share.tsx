import { useEffect, useRef, useState } from "react";
import { RiCloseLine, RiGroupLine, RiLinkM } from "@remixicon/react";
import type { NotesRole, NotesShareKind, VibexMessageDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { Spinner, Switch } from "@/ui/controls";
import { Sheet, toast } from "@/ui/overlays";
import { draftsApi } from "@/apps/mail/data";
import { openDirect, vk } from "@/apps/vibex/data";
import { VoidexShareDialog, type ShareSendInput } from "@/os/share/share-dialog";
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

/**
 * Share a note, presentation or project (Step 2.6) through the common
 * VoidexShareDialog (Step 2.7): app, search, people, send. It arrives as a
 * "Name.txt" / "Name.prsn" file card. Notes adds its own options below:
 * "Разрешить редактирование" off, the person adds their own copy; on, they
 * work in the original (Editor; the owner can make them a Viewer or remove
 * them in Users). Plus the link and Users.
 */
export function ShareSheet({ target, onClose, onUsers }: { target: ShareTarget | null; onClose: () => void; onUsers: (t: ShareTarget) => void }) {
  const t = useT();
  const [edit, setEdit] = useState(false);
  const key = target ? `${target.type}:${target.id}` : null;
  useEffect(() => {
    if (key) setEdit(false);
  }, [key]);
  const last = useRef<ShareTarget | null>(null);
  if (target) last.current = target;
  const cur = last.current;

  const create = (tg: ShareTarget, recipientIds?: string[]) =>
    notesApi.createShare({ resourceType: tg.type, resourceId: tg.id, mode: edit ? "access" : "copy", role: "editor", ...(recipientIds?.length ? { recipientIds } : {}) });

  const send = async ({ dest, picked, text }: ShareSendInput) => {
    const tg = last.current!;
    const share = await create(tg, dest === "vibex" ? picked.flatMap((p) => (p.userId ? [p.userId] : [])) : undefined);
    if (dest === "vibex") {
      for (const p of picked) {
        const chatId = p.chatId ?? (await openDirect(p.userId!)).id;
        await api.post<VibexMessageDto>(`/api/vibex/chats/${chatId}/messages`, { text, notesToken: share.token });
      }
      void queryClient.invalidateQueries({ queryKey: vk.chats });
    } else {
      const draft = await draftsApi.create({
        to: picked.map((p) => p.address!),
        subject: `${tg.name}${tg.ext}`,
        body: text,
        notesTokens: [share.token],
      } as Parameters<typeof draftsApi.create>[0]);
      await draftsApi.send(draft.id);
      void queryClient.invalidateQueries({ queryKey: ["mail"] });
    }
    void invalidateNotes();
  };

  const copy = async () => {
    try {
      const share = await create(last.current!);
      await navigator.clipboard?.writeText(shareLink(share.token)).catch(() => undefined);
      void invalidateNotes();
      toast({ title: t("notes.linkCopied"), body: edit ? t("notes.share.accessHint") : t("notes.share.copyHint"), tone: "success" });
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };

  return (
    <VoidexShareDialog
      subject={
        target && cur
          ? {
              key: key!,
              icon: <FileIcon ext={cur.ext} className="size-12 shrink-0 rounded-[12px]" />,
              title: `${cur.name}${cur.ext}`,
              hint: edit ? t("notes.share.accessHint") : t("notes.share.copyHint"),
            }
          : null
      }
      onClose={onClose}
      onSend={send}
      testId="notes-share"
      sentTitle={t("notes.shareSent")}
      extras={
        cur && (
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
              <button type="button" onClick={() => void copy()} className="pressable flex h-11 items-center justify-center gap-2 rounded-full bg-surface-secondary text-[14.5px] font-medium text-text" data-testid="notes-share-copy">
                <RiLinkM className="size-[18px]" />
                {t("notes.share.copyLink")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onUsers(cur);
                }}
                className="pressable flex h-11 items-center justify-center gap-2 rounded-full bg-surface-secondary text-[14.5px] font-medium text-text"
                data-testid="notes-share-users"
              >
                <RiGroupLine className="size-[18px]" />
                {t("notes.users")}
              </button>
            </div>
          </div>
        )
      }
    />
  );
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
    <Sheet open={!!target} onClose={onClose} title={t("notes.users")} width={480} testId="notes-members-sheet" centered>
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
