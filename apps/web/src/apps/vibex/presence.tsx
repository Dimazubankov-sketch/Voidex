import type { VibexPresenceDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useLanguage, useT } from "@/lib/i18n";

/**
 * Update 2 · C3: one presence indicator for the chat header, the chat list and profiles. Green: online
 * now; grey: offline, or hidden by its owner (the server sends no more than that). A tiny dot sits at
 * the bottom right of an avatar; nothing at all when presence is unknown.
 */
export function PresenceDot({ presence, size = 12, className, ring = "var(--surface)" }: { presence?: VibexPresenceDto; size?: number; className?: string; ring?: string }) {
  const t = useT();
  if (!presence) return null;
  const online = presence.state === "online";
  return (
    <span
      className={cx("absolute bottom-0 right-0 block rounded-full", online ? "bg-[#34c759]" : "bg-[color-mix(in_srgb,var(--text)_28%,var(--surface))]", className)}
      style={{ width: size, height: size, boxShadow: `0 0 0 ${Math.max(2, Math.round(size / 5))}px ${ring}` }}
      role="img"
      aria-label={online ? t("vibex.presence.online") : t("vibex.presence.offline")}
      data-testid="presence-dot"
      data-state={presence.state}
    />
  );
}

/** «в сети», «был(а) недавно», «был(а) в 15:07», «был(а) 12 октября» — as the person allows. */
export function usePresenceText(presence?: VibexPresenceDto): string | null {
  const t = useT();
  const lang = useLanguage();
  if (!presence) return null;
  if (presence.state === "online") return t("vibex.presence.online");
  if (presence.state === "hidden" || !presence.lastSeenAt) return t("vibex.presence.recently");
  const at = new Date(presence.lastSeenAt);
  const now = new Date();
  const locale = lang === "ru" ? "ru-RU" : lang;
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return t("vibex.presence.justNow");
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return t("vibex.presence.at", { time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at) });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return t("vibex.presence.yesterday", { time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at) });
  return t("vibex.presence.on", { date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(at) });
}

/** The status line: a green dot before «в сети», plain grey text otherwise. */
export function PresenceLine({ presence, className }: { presence?: VibexPresenceDto; className?: string }) {
  const text = usePresenceText(presence);
  if (!text) return null;
  const online = presence?.state === "online";
  return (
    <span className={cx("flex min-w-0 items-center gap-1.5 text-[12px] leading-tight", online ? "text-[#2fa84f]" : "text-text-tertiary", className)} data-testid="presence-text" data-state={presence?.state}>
      {online && <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-[#34c759]" />}
      <span className="truncate">{text}</span>
    </span>
  );
}
