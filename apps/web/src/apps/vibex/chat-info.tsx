import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { QrIcon } from "./qr-icon";
import {
  RiArrowLeftSLine,
  RiBellLine,
  RiNotificationOffLine,
  RiDeleteBin6Line,
  RiEraserLine,
  RiFileLine,
  RiLinkM,
  RiMic2Line,
  RiMoreFill,
  RiMusic2Line,
  RiPhoneFill,
  RiNotification3Fill,
  RiNotificationOffFill,
  RiVidiconFill,
  RiVidiconLine,
  RiSearch2Line,
  RiProhibited2Line,
  RiSearchLine,
  RiShareForwardLine,
  RiUserLine,
} from "@remixicon/react";
import { VIBEX_CHAT_MEDIA_KINDS, canDeleteChatForAll, type VibexChatDto, type VibexChatMediaKind, type VibexMessageDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { DragStrip } from "@/ui/drag-strip";
import { errorMessage } from "@/lib/errors";
import { formatShortDate, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { IconButton, Spinner } from "@/ui/controls";
import { ConfirmDialog, MenuList, Popover, toast, type MenuItem } from "@/ui/overlays";
import { formatBytes } from "@/apps/mail/attachments";
import { AvatarViewer } from "./avatar-viewer";
import { useChatMedia, useChatSearchIn, useClearChat, useDeleteChat, useFileUrl, useMuteChat, useProfile, useUpdateSettings, useVibexMe } from "./data";
import { formatDuration } from "./recorder";
import { PresenceDot, PresenceLine } from "./presence";
import { ProfileQrSheet, shareProfile } from "./qr";

const EASE = [0.22, 1, 0.36, 1] as const;
const TAB_LABEL: Record<VibexChatMediaKind, MessageKey> = {
  media: "vibex.info.tabMedia",
  files: "vibex.info.tabFiles",
  music: "vibex.info.tabMusic",
  voice: "vibex.info.tabVoice",
  links: "vibex.info.tabLinks",
  gifs: "vibex.info.tabGifs",
};

/**
 * Update 2 · C4 / C5: the info page of a direct chat (a tap on the name in the header). The person
 * (avatar, name, presence, @username with its QR code, about), five actions — call, video, sound,
 * search in this chat, more (block, clear the history for me / for everyone, delete the chat, share
 * the profile) — and the chat's media, files, music, voice and video messages, links and GIFs, a page
 * at a time. A tap on any of them goes to that message in the chat.
 */
export function ChatInfo({ chat, onClose, onJump, onCall, onProfile, onDeleted }: { chat: VibexChatDto; onClose: () => void; onJump: (messageId: string) => void; onCall: (kind: "audio" | "video") => void; onProfile: () => void; onDeleted: () => void }) {
  const t = useT();
  const reduced = useReducedMotion();
  const peer = chat.peer!;
  const profile = useProfile(peer.id).data;
  const me = useVibexMe().data;
  const blocked = !!me?.settings.privacy.blocked.includes(peer.id);
  const [viewer, setViewer] = useState(false);
  const [qr, setQr] = useState(false);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<VibexChatMediaKind>("media");
  const [confirm, setConfirm] = useState<null | "block" | "clear-me" | "clear-all" | "delete">(null);
  const soundRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<null | "sound" | "more">(null);
  const mute = useMuteChat();
  const clear = useClearChat();
  const del = useDeleteChat();
  const settings = useUpdateSettings();
  const presence = profile?.person.presence ?? peer.presence;
  const bio = profile?.bio ?? "";
  const go = (id: string) => {
    onClose();
    onJump(id);
  };

  const soundItems: MenuItem[] = [
    chat.muted
      ? { id: "unmute", label: t("vibex.info.muteOff"), icon: <RiBellLine />, onSelect: () => mute.mutate({ id: chat.id, muted: false }) }
      : { id: "mute", label: t("vibex.info.muteOn"), icon: <RiNotificationOffLine />, onSelect: () => mute.mutate({ id: chat.id, muted: true }) },
  ];
  const moreItems: MenuItem[] = [
    blocked
      ? { id: "unblock", label: t("vibex.info.unblock"), icon: <RiProhibited2Line />, onSelect: () => settings.mutate({ privacy: { blocked: me!.settings.privacy.blocked.filter((x) => x !== peer.id) } }) }
      : { id: "block", label: t("vibex.info.block"), icon: <RiProhibited2Line />, onSelect: () => setConfirm("block"), danger: true },
    { id: "clear-me", label: t("vibex.info.clearMe"), icon: <RiEraserLine />, onSelect: () => setConfirm("clear-me") },
    ...(canDeleteChatForAll(chat) ? [{ id: "clear-all", label: t("vibex.info.clearAll"), icon: <RiEraserLine />, onSelect: () => setConfirm("clear-all"), danger: true } as MenuItem] : []),
    { id: "delete-chat", label: t("vibex.info.deleteChat"), icon: <RiDeleteBin6Line />, onSelect: () => setConfirm("delete"), danger: true },
    { id: "share-profile", label: t("vibex.info.shareProfile"), icon: <RiShareForwardLine />, onSelect: () => void shareProfile(t, peer) },
  ];

  const runConfirm = () => {
    const c = confirm;
    setConfirm(null);
    const fail = (e: unknown) => toast({ title: errorMessage(t, e), tone: "danger" });
    if (c === "block") settings.mutate({ privacy: { blocked: [...(me?.settings.privacy.blocked ?? []), peer.id] } }, { onError: fail });
    else if (c === "clear-me" || c === "clear-all") clear.mutate({ id: chat.id, scope: c === "clear-me" ? "me" : "all" }, { onError: fail, onSuccess: () => toast({ title: t("vibex.info.cleared") }) });
    else if (c === "delete")
      del.mutate(
        { id: chat.id, scope: "me" },
        {
          onError: fail,
          onSuccess: () => {
            toast({ title: t("vibex.chats.deletedForMe") });
            onDeleted();
          },
        },
      );
  };

  const action = (id: string, icon: ReactNode, label: string, onClick: () => void, ref?: React.Ref<HTMLButtonElement>) => (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      // Update 4 · E1 (the reference): solid icons of one size and weight in even tiles; a light press.
      className="flex h-[62px] min-w-0 flex-1 flex-col items-center justify-center gap-[5px] rounded-[18px] bg-surface-secondary text-primary transition-[transform,background-color] duration-150 ease-out active:scale-[0.94] active:bg-surface-hover motion-reduce:active:scale-100 [@media(hover:hover)]:hover:bg-surface-hover"
      data-testid={`info-${id}`}
    >
      <span className="flex h-6 items-center [&_svg]:size-6">{icon}</span>
      <span className="max-w-full truncate px-1 text-[11.5px] font-medium leading-none text-text-secondary">{label}</span>
    </button>
  );

  return (
    <motion.div
      className="absolute inset-0 z-30 flex flex-col bg-surface"
      initial={reduced ? { opacity: 0 } : { x: "100%" }}
      animate={reduced ? { opacity: 1 } : { x: 0 }}
      exit={reduced ? { opacity: 0 } : { x: "100%" }}
      transition={{ duration: 0.28, ease: EASE }}
      data-testid="chat-info"
    >
      <div className="flex h-14 shrink-0 items-center gap-1 border-b px-1.5">
        <IconButton label={t("common.back")} onClick={searching ? () => setSearching(false) : onClose} data-testid="chat-info-back">
          <RiArrowLeftSLine className="size-7" />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{searching ? t("vibex.info.search") : t("vibex.info.title")}</span>
      </div>
      {searching ? (
        <ChatSearch chat={chat} onPick={go} />
      ) : (
        <div className="scroll-area min-h-0 flex-1 overflow-x-hidden">
          <div className="flex flex-col items-center px-4 pb-3 pt-5 text-center">
            <button type="button" className="relative rounded-full" onClick={() => setViewer(true)} aria-label={peer.name} data-testid="chat-info-avatar">
              <Avatar name={peer.name} userId={peer.id} version={peer.avatarVersion} size={96} />
              <PresenceDot presence={presence} size={20} className="bottom-1 right-1" />
            </button>
            <h2 className="mt-3 max-w-full truncate text-[21px] font-semibold" data-testid="chat-info-name">
              {peer.name}
            </h2>
            <PresenceLine presence={presence} className="mt-0.5 justify-center text-[13px]" />
          </div>
          <div className="flex gap-2 px-3 pb-3" role="group">
            {action("call", <RiPhoneFill />, t("vibex.info.call"), () => onCall("audio"))}
            {action("video", <RiVidiconFill />, t("vibex.info.video"), () => onCall("video"))}
            {action("sound", chat.muted ? <RiNotificationOffFill /> : <RiNotification3Fill />, t("vibex.info.sound"), () => setMenu("sound"), soundRef)}
            {action("search", <RiSearch2Line className="[stroke:currentColor] [stroke-width:0.6]" />, t("vibex.info.search"), () => setSearching(true))}
            {action("more", <RiMoreFill />, t("vibex.info.more"), () => setMenu("more"), moreRef)}
          </div>
          <div className="mx-3 mb-3 overflow-hidden rounded-2xl bg-surface-secondary">
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-text-tertiary">{t("vibex.info.username")}</span>
                <span className="block truncate text-[15px] text-primary" data-testid="chat-info-handle">
                  @{peer.handle}
                </span>
              </span>
              <IconButton label={t("vibex.qr.title")} onClick={() => setQr(true)} data-testid="chat-info-qr">
                <QrIcon className="size-[23px] text-primary" />
              </IconButton>
            </div>
            {bio && (
              <div className="border-t px-4 py-2.5">
                <span className="block text-[12px] text-text-tertiary">{t("vibex.info.about")}</span>
                <span className="block whitespace-pre-wrap break-words text-[15px]" data-testid="chat-info-bio">
                  {bio}
                </span>
              </div>
            )}
            <button type="button" onClick={onProfile} className="flex w-full items-center gap-3 border-t px-4 py-3 text-left text-[15px] text-primary hover:bg-surface-hover" data-testid="chat-info-profile">
              <RiUserLine className="size-5" />
              {t("vibex.info.openProfile")}
            </button>
          </div>
          <MediaTabs chat={chat} tab={tab} onTab={setTab} onPick={go} />
        </div>
      )}
      <Popover open={menu === "sound"} onClose={() => setMenu(null)} anchor={soundRef} align="start" testId="info-sound-menu">
        <MenuList items={soundItems} onDone={() => setMenu(null)} />
      </Popover>
      <Popover open={menu === "more"} onClose={() => setMenu(null)} anchor={moreRef} testId="info-more-menu">
        <MenuList items={moreItems} onDone={() => setMenu(null)} />
      </Popover>
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        title={
          confirm === "block"
            ? t("vibex.info.blockTitle", { name: peer.name })
            : confirm === "clear-me"
              ? t("vibex.info.clearMeTitle")
              : confirm === "clear-all"
                ? t("vibex.info.clearAllTitle")
                : t("vibex.info.deleteChat")
        }
        message={confirm === "block" ? t("vibex.info.blockBody") : confirm === "clear-me" ? t("vibex.info.clearMeBody") : confirm === "clear-all" ? t("vibex.info.clearAllBody") : t("vibex.info.deleteChatBody")}
        confirmLabel={confirm === "block" ? t("vibex.info.block") : confirm === "delete" ? t("vibex.info.deleteChat") : t("vibex.info.clear")}
        danger
        testId="chat-info-confirm"
      />
      <AvatarViewer person={viewer ? peer : null} onClose={() => setViewer(false)} />
      <ProfileQrSheet person={qr ? peer : null} onClose={() => setQr(false)} />
    </motion.div>
  );
}

/** C4: search in this chat (newest first); a tap goes to the message. */
function ChatSearch({ chat, onPick }: { chat: VibexChatDto; onPick: (id: string) => void }) {
  const t = useT();
  const lang = useLanguage();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 220);
    return () => window.clearTimeout(id);
  }, [q]);
  const res = useChatSearchIn(chat.id, debounced);
  const items = useMemo(() => res.data?.pages.flatMap((p) => p.items) ?? [], [res.data]);
  const more = useLoadMore(res.hasNextPage && !res.isFetchingNextPage, () => void res.fetchNextPage());
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="m-3 flex h-10 shrink-0 items-center gap-2 rounded-xl bg-surface-secondary px-3">
        <RiSearchLine className="size-[18px] text-text-tertiary" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("vibex.info.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" data-testid="chat-search-input" />
      </label>
      <div className="scroll-area min-h-0 flex-1 px-1.5">
        {debounced && res.isPending && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {debounced && !res.isPending && !items.length && <p className="py-8 text-center text-[14px] text-text-tertiary">{t("vibex.info.nothingFound")}</p>}
        {items.map((m) => (
          <button key={m.id} type="button" onClick={() => onPick(m.id)} className="flex w-full flex-col rounded-xl px-3 py-2.5 text-left hover:bg-surface-hover" data-testid="chat-search-result" data-message-id={m.id}>
            <span className="text-[12px] text-text-tertiary">{formatShortDate(m.createdAt, lang)}</span>
            <span className="line-clamp-2 text-[14.5px]">{highlight(m.text, debounced)}</span>
          </button>
        ))}
        <div ref={more} />
      </div>
    </div>
  );
}

function highlight(text: string, q: string): ReactNode {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-primary/15 px-0.5 text-text">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** Calls `load` when the returned element comes near the viewport. */
function useLoadMore(enabled: boolean, load: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const fn = useRef(load);
  fn.current = load;
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && fn.current(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}

/** C5: the chat's content by kind, a page at a time (pictures and GIFs in a grid, the rest as rows). */
function MediaTabs({ chat, tab, onTab, onPick }: { chat: VibexChatDto; tab: VibexChatMediaKind; onTab: (k: VibexChatMediaKind) => void; onPick: (id: string) => void }) {
  const t = useT();
  const q = useChatMedia(chat.id, tab);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const more = useLoadMore(!!q.hasNextPage && !q.isFetchingNextPage, () => void q.fetchNextPage());
  return (
    <div className="pb-6">
      {/* Update 3 · E2: moved by the finger (no native scroll, so no scroll indicator), owns its sideways
          drags (the page's swipe back stays out); the chosen tab comes into view; on a PC one line. */}
      <div className="sticky top-0 z-[1] bg-surface py-2">
        <DragStrip activeKey={tab} fill className="px-3" innerClassName="gap-1.5" testId="chat-info-tabs" label={t("vibex.info.title")}>
          {VIBEX_CHAT_MEDIA_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => onTab(k)}
              className={cx("h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-[14px] font-medium transition-colors duration-200", tab === k ? "bg-primary text-white" : "bg-surface-secondary text-text-secondary hover:bg-surface-hover")}
              data-strip-key={k}
              data-testid={`chat-tab-${k}`}
            >
              {t(TAB_LABEL[k])}
            </button>
          ))}
        </DragStrip>
      </div>
      {q.isPending ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : !items.length ? (
        <p className="py-10 text-center text-[14px] text-text-tertiary" data-testid="chat-tab-empty">
          {t("vibex.info.empty")}
        </p>
      ) : tab === "media" || tab === "gifs" ? (
        <div className="grid grid-cols-3 gap-0.5 px-0.5" data-testid="chat-tab-grid">
          {items
            .filter((m) => m.kind === "text")
            .flatMap((m) => m.files.filter((f) => (tab === "gifs" ? f.mimeType === "image/gif" : (f.kind === "image" || f.kind === "video") && f.mimeType !== "image/gif")).map((f) => <Thumb key={f.id} fileId={f.id} video={f.kind === "video"} onClick={() => onPick(m.id)} />))}
        </div>
      ) : (
        <div className="flex flex-col px-1.5" data-testid="chat-tab-list">
          {items.map((m) => (
            <TabRow key={m.id} msg={m} kind={tab} onClick={() => onPick(m.id)} />
          ))}
        </div>
      )}
      <div ref={more} className="flex justify-center py-2">
        {q.isFetchingNextPage && <Spinner />}
      </div>
    </div>
  );
}

function Thumb({ fileId, video, onClick }: { fileId: string; video: boolean; onClick: () => void }) {
  const { data: src } = useFileUrl(fileId);
  return (
    <button type="button" onClick={onClick} className="relative aspect-square overflow-hidden bg-surface-secondary" data-testid="chat-tab-thumb">
      {src && (video ? <video src={src} muted playsInline preload="metadata" className="size-full object-cover" /> : <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />)}
      {video && <RiVidiconLine className="absolute bottom-1.5 left-1.5 size-4 text-white drop-shadow" />}
    </button>
  );
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

function TabRow({ msg, kind, onClick }: { msg: VibexMessageDto; kind: VibexChatMediaKind; onClick: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const date = formatShortDate(msg.createdAt, lang);
  const row = (icon: ReactNode, title: string, sub: string, key?: string, extra?: ReactNode) => (
    <div key={key} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-hover" data-testid="chat-tab-row" data-message-id={msg.id}>
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px]">{title}</span>
          <span className="block truncate text-[12px] text-text-tertiary">{sub}</span>
        </span>
      </button>
      {extra}
    </div>
  );
  if (kind === "voice") return row(msg.kind === "circle" ? <RiVidiconLine /> : <RiMic2Line />, msg.kind === "circle" ? t("vibex.circle.message") : t("vibex.voice.message"), `${msg.durationMs ? formatDuration(msg.durationMs) + " · " : ""}${date}`);
  if (kind === "links") {
    const urls = [...new Set(msg.text.match(URL_RE) ?? [])];
    return (
      <>
        {urls.map((u) =>
          row(<RiLinkM />, u.replace(/^https?:\/\//, ""), date, u, (
            <a href={u} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full px-2 py-1 text-[12.5px] font-medium text-primary hover:bg-primary/10" data-testid="chat-tab-link">
              {t("home.open")}
            </a>
          )),
        )}
      </>
    );
  }
  const f = msg.files.find((x) => (kind === "music" ? x.kind === "audio" : x.kind === "file")) ?? msg.files[0];
  return row(kind === "music" ? <RiMusic2Line /> : <RiFileLine />, f?.filename ?? "", `${f ? formatBytes(f.size, lang) + " · " : ""}${date}`);
}
