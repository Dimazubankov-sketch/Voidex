import { RiArrowLeftSLine } from "@remixicon/react";
import type { VibexChatDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { WindowHeader } from "@/os/window-context";
import { useChats } from "./data";
import { GroupAvatar } from "./groups";
import { PresenceDot, PresenceLine } from "./presence";

/**
 * Update 3 · C1 (SR2488): the chat header as three glass capsules over the history (phones: the messages
 * scroll under it). Left: back, with the unread count of the other chats. Centre: the name and the
 * presence in one compact capsule; a tap opens the chat's info page. Right: the avatar (36 px, with its
 * presence dot); a tap opens the profile. Long names are cut, never the buttons; on a PC the window's
 * own controls keep their place.
 */
export function ChatHeader({ chat, onBack, onInfo, onProfile, floating }: { chat: VibexChatDto; onBack?: () => void; onInfo: () => void; onProfile: () => void; floating?: boolean }) {
  const t = useT();
  const peer = chat.peer;
  const title = chat.group?.title ?? peer?.name ?? "";
  const unread = (useChats().data ?? []).reduce((n, c) => (c.id === chat.id || c.muted ? n : n + (c.unread ?? 0)), 0);
  return (
    <WindowHeader
      className={cx("h-[52px] gap-1.5 px-2", floating && "[&_button]:pointer-events-auto")}
      right={
        <button
          type="button"
          onClick={chat.group ? onInfo : onProfile}
          className="vx-glass-strong relative flex size-10 shrink-0 items-center justify-center rounded-full p-[2px] shadow-tile transition-transform active:scale-95"
          aria-label={chat.group ? t("vibex.info.title") : t("vibex.info.openProfile")}
          data-testid="chat-header-avatar"
        >
          {chat.group ? (
            <GroupAvatar title={chat.group.title} fileId={chat.group.avatarFileId} size={36} />
          ) : (
            <>
              <Avatar name={peer!.name} userId={peer!.id} version={peer!.avatarVersion} size={36} />
              <PresenceDot presence={peer!.presence} size={10} />
            </>
          )}
        </button>
      }
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={t("common.back")}
          className="vx-glass-strong flex h-10 shrink-0 items-center gap-0.5 rounded-full pl-1 pr-2 text-primary shadow-tile transition-transform active:scale-95"
          data-testid="chat-back"
        >
          <RiArrowLeftSLine className="size-[26px]" />
          {unread > 0 && (
            <span className="min-w-[22px] rounded-full bg-primary px-1.5 text-center text-[12px] font-semibold leading-[20px] text-white tabular-nums" data-testid="chat-back-unread">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      ) : null}
      <span className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          onClick={onInfo}
          className="vx-glass-strong flex h-10 min-w-0 max-w-full flex-col items-center justify-center rounded-full px-4 text-center shadow-tile transition-transform active:scale-[0.98]"
          data-testid={chat.group ? "group-header" : "chat-header-title"}
        >
          <span className="block max-w-full truncate text-[15px] font-semibold leading-[1.15]">{title}</span>
          {chat.group ? (
            <span className="block max-w-full truncate text-[11.5px] leading-[1.2] text-text-tertiary">{t("vibex.group.members", { n: chat.group.members.length })}</span>
          ) : (
            <PresenceLine presence={peer!.presence} className="max-w-full text-[11.5px] leading-[1.2]" />
          )}
        </button>
      </span>
    </WindowHeader>
  );
}
