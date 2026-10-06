import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiArrowLeftLine, RiCameraLine, RiCheckLine, RiCloseLine, RiGroupLine, RiLogoutBoxRLine, RiPencilLine } from "@remixicon/react";
import { VIBEX_GROUP_MEMBERS_MAX, VIBEX_GROUP_TITLE_MAX, type VibexChatDto, type VibexFileDto, type VibexPersonDto } from "@voidex/shared";
import { Avatar, initials } from "@/brand/brand";
import { ApiError, api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { Button, Spinner } from "@/ui/controls";
import { ConfirmDialog, Sheet, toast } from "@/ui/overlays";
import { filesApi, openDirect, useChats, useFileUrl, usePeople, vk } from "./data";
import { useVibex } from "./store";
import { VoidexSearchField } from "@/ui/search-field";

const GROUP_PICTURE = "image/jpeg,image/png,image/webp";

/** A group's picture, or its initials on the VOIDEX violet. */
export function GroupAvatar({ title, fileId, size = 40, className }: { title: string; fileId: string | null; size?: number; className?: string }) {
  const url = useFileUrl(fileId).data;
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.36, background: url ? undefined : "linear-gradient(135deg, #a996ff, #6a4df5)" }}
      aria-hidden
      data-testid="group-avatar"
    >
      {url ? <img src={url} alt="" className="size-full object-cover" draggable={false} /> : initials(title) || <RiGroupLine className="size-1/2" />}
    </span>
  );
}

/** A chat's avatar: the person, or the group. */
export function ChatAvatar({ chat, size }: { chat: VibexChatDto; size: number }) {
  if (chat.group) return <GroupAvatar title={chat.group.title} fileId={chat.group.avatarFileId} size={size} />;
  const p = chat.peer!;
  return <Avatar name={p.name} userId={p.id} version={p.avatarVersion} size={size} />;
}

export const chatTitle = (chat: VibexChatDto) => chat.group?.title ?? chat.peer?.name ?? "";

/** The round pencil button of the chat list (like the "+" of the feed): a new conversation. */
export function NewChatFab({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        className={cx("absolute z-10 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-float", className)}
        style={style}
        whileTap={{ scale: 0.94 }}
        aria-label={t("vibex.chats.new")}
        title={t("vibex.chats.new")}
        data-testid="vibex-new-chat"
      >
        <RiPencilLine className="size-6" />
      </motion.button>
      <NewChatSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * New conversation: pick people (one → a direct chat, as before; two or more →
 * a group), then the group's name and an optional picture.
 */
export function NewChatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const openChat = useVibex((s) => s.openChat);
  const [step, setStep] = useState<"people" | "group">("people");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<VibexPersonDto[]>([]);
  const [title, setTitle] = useState("");
  const [picture, setPicture] = useState<VibexFileDto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const chats = useChats();
  const people = usePeople(q.trim());
  const fileInput = useRef<HTMLInputElement>(null);
  const pictureUrl = useFileUrl(picture?.id ?? null).data;

  const contacts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromChats = (chats.data ?? []).flatMap((c) => (c.peer ? [c.peer] : [])).filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.address.includes(needle));
    const seen = new Set(fromChats.map((p) => p.id));
    return [...fromChats, ...(people.data ?? []).filter((p) => !seen.has(p.id))].slice(0, 30);
  }, [chats.data, people.data, q]);

  const reset = () => {
    setStep("people");
    setQ("");
    setPicked([]);
    setTitle("");
    setPicture(null);
  };
  const close = (created = false) => {
    // A picture uploaded for a group that was never created is not kept.
    if (!created && picture) void filesApi.discard(picture.id).catch(() => undefined);
    reset();
    onClose();
  };

  const toggle = (p: VibexPersonDto) =>
    setPicked((x) => (x.some((y) => y.id === p.id) ? x.filter((y) => y.id !== p.id) : x.length >= VIBEX_GROUP_MEMBERS_MAX ? x : [...x, p]));

  const next = async () => {
    if (picked.length === 1) {
      setBusy(true);
      try {
        const chat = await openDirect(picked[0]!.id);
        queryClient.setQueryData(vk.chat(chat.id), chat);
        void queryClient.invalidateQueries({ queryKey: vk.chats });
        openChat(chat.id);
        close(true);
      } catch (e) {
        toast({ title: errorMessage(t, e), tone: "danger" });
      } finally {
        setBusy(false);
      }
      return;
    }
    setStep("group");
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const f = await filesApi.upload(file, "group");
      if (picture) void filesApi.discard(picture.id).catch(() => undefined);
      setPicture(f);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setUploading(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const chat = await api.post<VibexChatDto>("/api/vibex/groups", { title: title.trim(), memberIds: picked.map((p) => p.id), ...(picture ? { avatarFileId: picture.id } : {}) });
      queryClient.setQueryData(vk.chat(chat.id), chat);
      void queryClient.invalidateQueries({ queryKey: vk.chats });
      openChat(chat.id);
      close(true);
    } catch (e) {
      const who = e instanceof ApiError && typeof e.details.userId === "string" ? picked.find((p) => p.id === e.details.userId) : null;
      toast({ title: who ? t("vibex.group.cantAdd", { name: who.name }) : errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => close()}
      title={step === "people" ? t("vibex.chats.new") : t("vibex.group.new")}
      width={520}
      testId="new-chat"
      footer={
        step === "people" ? (
          <Button onClick={() => void next()} disabled={!picked.length} loading={busy} data-testid="new-chat-next">
            {picked.length === 1 ? t("vibex.group.write") : t("common.next")}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setStep("people")}>
              <RiArrowLeftLine className="size-4" /> {t("common.back")}
            </Button>
            <Button onClick={() => void create()} disabled={!title.trim() || uploading} loading={busy} data-testid="new-group-create">
              {t("vibex.group.create")}
            </Button>
          </>
        )
      }
    >
      {step === "people" ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13.5px] text-text-secondary">{t("vibex.group.pickHint")}</p>
          <VoidexSearchField
            autoFocus
            value={q}
            onChange={setQ}
            placeholder={t("vibex.people.search")}
            testId="new-chat-search"
            trailing={people.isFetching ? <Spinner size={14} /> : undefined}
          />
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="new-chat-picked">
              {picked.map((p) => (
                <button key={p.id} type="button" onClick={() => toggle(p)} className="flex items-center gap-1.5 rounded-full bg-primary-soft py-1 pl-1 pr-2 text-[13px] font-medium text-primary-strong">
                  <Avatar name={p.name} userId={p.id} version={p.avatarVersion} size={22} />
                  {p.firstName || p.name}
                  <RiCloseLine className="size-3.5" />
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col" data-testid="new-chat-contacts">
            {contacts.map((p) => {
              const on = picked.some((x) => x.id === p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p)}
                  aria-pressed={on}
                  className="flex items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-surface-hover"
                  data-testid="new-chat-contact"
                >
                  <Avatar name={p.name} userId={p.id} version={p.avatarVersion} size={42} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{p.name}</span>
                    <span className="block truncate text-[12.5px] text-text-tertiary">{p.address}</span>
                  </span>
                  <span className={cx("flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition", on ? "border-primary bg-primary text-white" : "border-border-strong")}>
                    {on && <RiCheckLine className="size-4" />}
                  </span>
                </button>
              );
            })}
            {!contacts.length && !people.isFetching && <div className="py-6 text-center text-[14px] text-text-tertiary">{q.trim() ? t("vibex.people.empty") : t("vibex.people.hint")}</div>}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 pb-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="relative grid size-24 place-items-center overflow-hidden rounded-full bg-primary-soft text-primary"
            aria-label={t("vibex.group.picture")}
            data-testid="new-group-picture"
          >
            {pictureUrl ? <img src={pictureUrl} alt="" className="size-full object-cover" /> : <RiCameraLine className="size-8" />}
            {uploading && (
              <span className="absolute inset-0 grid place-items-center bg-white/60">
                <Spinner />
              </span>
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={GROUP_PICTURE}
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
            data-testid="new-group-file"
          />
          <span className="-mt-2 text-[12.5px] text-text-tertiary">{t("vibex.group.pictureHint")}</span>
          <input
            autoFocus
            value={title}
            maxLength={VIBEX_GROUP_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("vibex.group.titlePlaceholder")}
            className="h-12 w-full rounded-2xl border border-border bg-surface-secondary px-4 text-[16px] outline-none focus:border-primary"
            data-testid="new-group-title"
            onKeyDown={(e) => e.key === "Enter" && title.trim() && !busy && void create()}
          />
          <div className="w-full">
            <div className="px-1 pb-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{t("vibex.group.members", { n: picked.length + 1 })}</div>
            <div className="flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-surface-secondary py-1 pl-1 pr-2.5 text-[13px]">
                  <Avatar name={p.name} userId={p.id} version={p.avatarVersion} size={22} />
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Group details: members, rename and picture (creator), leave. */
export function GroupInfoSheet({ chat, open, onClose }: { chat: VibexChatDto; open: boolean; onClose: () => void }) {
  const t = useT();
  const push = useVibex((s) => s.push);
  const openChat = useVibex((s) => s.openChat);
  const g = chat.group!;
  const owner = g.role === "owner";
  const [title, setTitle] = useState(g.title);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const apply = (c: VibexChatDto) => {
    queryClient.setQueryData(vk.chat(c.id), c);
    void queryClient.invalidateQueries({ queryKey: vk.chats });
  };
  const save = async (patch: { title?: string; avatarFileId?: string | null }) => {
    setSaving(true);
    try {
      apply(await api.patch<VibexChatDto>(`/api/vibex/groups/${chat.id}`, patch));
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setSaving(false);
    }
  };
  const changePicture = async (file: File | undefined) => {
    if (!file) return;
    try {
      const f = await filesApi.upload(file, "group");
      await save({ avatarFileId: f.id });
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };
  const leave = async () => {
    setLeaving(true);
    try {
      await api.post(`/api/vibex/groups/${chat.id}/leave`);
      queryClient.removeQueries({ queryKey: vk.chat(chat.id) });
      void queryClient.invalidateQueries({ queryKey: vk.chats });
      setConfirmLeave(false);
      onClose();
      openChat(null);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setLeaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("vibex.group.info")} width={460} testId="group-info">
      <div className="flex flex-col items-center gap-3">
        <button type="button" disabled={!owner} onClick={() => fileInput.current?.click()} className="relative rounded-full" aria-label={t("vibex.group.picture")} data-testid="group-info-picture">
          <GroupAvatar title={g.title} fileId={g.avatarFileId} size={84} />
          {owner && (
            <span className="absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full border-2 border-surface bg-primary text-white">
              <RiCameraLine className="size-3.5" />
            </span>
          )}
        </button>
        <input ref={fileInput} type="file" accept={GROUP_PICTURE} className="hidden" onChange={(e) => (void changePicture(e.target.files?.[0]), (e.target.value = ""))} />
        {owner ? (
          <div className="flex w-full gap-2">
            <input
              value={title}
              maxLength={VIBEX_GROUP_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-2xl border border-border bg-surface-secondary px-4 text-[15px] outline-none focus:border-primary"
              data-testid="group-info-title"
            />
            <Button onClick={() => void save({ title: title.trim() })} disabled={!title.trim() || title.trim() === g.title} loading={saving} data-testid="group-info-save">
              {t("common.save")}
            </Button>
          </div>
        ) : (
          <div className="text-[19px] font-semibold">{g.title}</div>
        )}
      </div>
      <div className="mt-5 px-1 pb-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{t("vibex.group.members", { n: g.members.length })}</div>
      <div className="flex flex-col" data-testid="group-members">
        {g.members.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              onClose();
              push({ kind: "person", id: m.id });
            }}
            className="flex items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-surface-hover"
          >
            <Avatar name={m.name} userId={m.id} version={m.avatarVersion} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{m.name}</span>
              <span className="block truncate text-[12.5px] text-text-tertiary">{m.address}</span>
            </span>
            {i === 0 && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11.5px] font-medium text-primary-strong">{t("vibex.group.owner")}</span>}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setConfirmLeave(true)}
        className="mt-4 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-[15px] text-danger hover:bg-danger-soft"
        data-testid="group-leave"
      >
        <RiLogoutBoxRLine className="size-5" /> {t("vibex.group.leave")}
      </button>
      <AnimatePresence />
      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => void leave()}
        title={t("vibex.group.leaveTitle", { name: g.title })}
        message={owner ? t("vibex.group.leaveOwner") : t("vibex.group.leaveBody")}
        confirmLabel={t("vibex.group.leave")}
        danger
        loading={leaving}
      />
    </Sheet>
  );
}
