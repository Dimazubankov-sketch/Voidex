import { useQuery } from "@tanstack/react-query";
import type { AppId, VibexChatDto } from "@voidex/shared";
import { api } from "./api";
import { useMailSummary } from "./mail-summary";

/**
 * Step 2.5: the unread count an app's icon shows (desktop, phone, dock).
 * Only real unread items count — no badge otherwise.
 * Mail: unread inbox letters. Vibex: unread chat messages (the same query
 * the Vibex chat list uses, so both stay in sync).
 */
export function useAppBadge(id: AppId, enabled = true): number {
  const mail = useMailSummary(enabled && id === "mail").data?.unread.inbox ?? 0;
  const chats = useQuery({
    queryKey: ["vibex", "chats"],
    queryFn: () => api.get<VibexChatDto[]>("/api/vibex/chats"),
    staleTime: 15_000,
    enabled: enabled && id === "vibex",
  }).data;
  if (id === "mail") return mail;
  if (id === "vibex") return chats?.reduce((n, c) => n + c.unread, 0) ?? 0;
  return 0;
}

export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));
