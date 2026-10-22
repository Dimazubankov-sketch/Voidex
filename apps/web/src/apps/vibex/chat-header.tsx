import { RiArrowLeftSLine } from "@remixicon/react";
import type { VibexChatDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { WindowHeader } from "@/os/window-context";
import { GroupAvatar } from "./groups";
import { PresenceDot, PresenceLine } from "./presence";

/**
 * Update 2 · C2: the chat header. Left: back to the chat list (phones). Centre: the name, and under it
 * the presence (a green dot with «в сети», or «был(а) …»); a tap opens the chat's info page. Right: the
 * avatar (with its presence dot); a tap opens the profile. Long names are cut, never the buttons; the
 * window's own controls keep their place on a PC.
 */
export function ChatHeader({ chat, onBack, onInfo, onProfile }: { chat: VibexChatDto; onBack?: () => void; onInfo: () => void; onProfile: () => void }) {
  const t = useT();
  const peer = chat.peer;
  const title = chat.group?.title ?? peer?.name ?? "";
  return (
    <WindowHeader className="border-b px-1.5 sm:px-2" right={
      <button type="button" onClick={chat.group ? onInfo : onProfile} className="relative ml-1 flex size-10 shrink-0 items-center justify-center rounded-full" aria-label={chat.group ? t("vibex.info.title") : t("vibex.info.openProfile")} data-testid="chat-header-avatar">
        {chat.group ? (
          <GroupAvatar title={chat.group.title} fileId={chat.group.avatarFileId} size={38} />
        ) : (
          <>
            <Avatar name={peer!.name} userId={peer!.id} version={peer!.avatarVersion} size={38} />
            <PresenceDot presence={peer!.presence} size={11} />
          </>
        )}
      </button>
    }>
      {onBack ? (
        <button type="button" onClick={onBack} aria-label={t("common.back")} className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full text-primary hover:bg-surface-hover" data-testid="chat-back">
          <RiArrowLeftSLine className="size-7" />
        </button>
      ) : (
        <span className="w-2 shrink-0" />
      )}
      <button
        type="button"
        onClick={onInfo}
        className={cx("flex min-w-0 flex-1 flex-col justify-center rounded-xl px-1 py-0.5 text-center", onBack ? "items-center" : "items-start text-left")}
        data-testid={chat.group ? "group-header" : "chat-header-title"}
      >
        <span className="block max-w-full truncate text-[15.5px] font-semibold leading-tight">{title}</span>
        {chat.group ? (
          <span className="block max-w-full truncate text-[12px] text-text-tertiary">{t("vibex.group.members", { n: chat.group.members.length })}</span>
        ) : (
          <PresenceLine presence={peer!.presence} className="max-w-full" />
        )}
      </button>
    </WindowHeader>
  );
}
