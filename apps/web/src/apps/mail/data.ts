import { useInfiniteQuery, useMutation, useQuery, type InfiniteData } from "@tanstack/react-query";
import type { DraftDto, MailAddressDto, MailView, Paginated, ThreadDetailDto, ThreadSummaryDto } from "@voidex/shared";
import { api, qs } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";

export type ThreadAction = "archive" | "trash" | "restore" | "delete_forever" | "read" | "unread" | "star" | "unstar" | "inbox";

export function useThreadList(view: MailView, q: string) {
  return useInfiniteQuery({
    queryKey: qk.mailList(view, q),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Paginated<ThreadSummaryDto>>(`/api/mail/threads${qs({ view, q, cursor: pageParam, limit: 40 })}`),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 10_000,
  });
}

export function useThread(id: string | null, view: MailView) {
  return useQuery({
    queryKey: qk.mailThread(id ?? "", view),
    enabled: !!id,
    queryFn: () => api.get<ThreadDetailDto>(`/api/mail/threads/${id}${qs({ view })}`),
  });
}

type ListData = InfiniteData<Paginated<ThreadSummaryDto>>;

/** Actions that take a conversation out of the current view. */
const LEAVES_VIEW: Partial<Record<ThreadAction, (view: MailView) => boolean>> = {
  archive: (v) => v === "inbox",
  trash: (v) => v !== "trash",
  restore: (v) => v === "trash",
  delete_forever: (v) => v === "trash",
  inbox: (v) => v === "archive",
  unstar: (v) => v === "starred",
};

/** Thread actions with optimistic list updates; the server event then confirms on every device. */
export function useThreadAction() {
  return useMutation({
    mutationFn: (v: { threadIds: string[]; action: ThreadAction; view: MailView }) => api.post<{ changed: number }>("/api/mail/threads/actions", v),
    onMutate: async ({ threadIds, action, view }) => {
      await queryClient.cancelQueries({ queryKey: ["mail", "list", view] });
      const snapshots = queryClient.getQueriesData<ListData>({ queryKey: ["mail", "list", view] });
      const ids = new Set(threadIds);
      for (const [key, data] of snapshots) {
        if (!data) continue;
        queryClient.setQueryData<ListData>(key, {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: LEAVES_VIEW[action]?.(view)
              ? p.items.filter((i) => !ids.has(i.id))
              : p.items.map((i) =>
                  ids.has(i.id)
                    ? {
                        ...i,
                        unread: action === "read" ? false : action === "unread" ? true : i.unread,
                        starred: action === "star" ? true : action === "unstar" ? false : i.starred,
                      }
                    : i,
                ),
          })),
        });
      }
      return { snapshots };
    },
    onError: (_e, _v, ctx) => ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.mail }),
  });
}

export function useFlagMessage() {
  return useMutation({
    mutationFn: (v: { id: string; read?: boolean; starred?: boolean }) => api.patch(`/api/mail/messages/${v.id}`, { read: v.read, starred: v.starred }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.mail }),
  });
}

export interface ComposeDefaults {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  replyToMessageId?: string;
  forwardOfMessageId?: string;
}

export function fetchComposeDefaults(messageId: string, mode: "reply" | "reply_all" | "forward", lang: string) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return api.get<ComposeDefaults>(`/api/mail/messages/${messageId}/compose${qs({ mode, lang, tz })}`);
}

export const draftsApi = {
  create: (body: Partial<DraftDto> & { replyToMessageId?: string; forwardOfMessageId?: string }) => api.post<DraftDto>("/api/mail/drafts", body),
  update: (id: string, body: Pick<DraftDto, "to" | "cc" | "bcc" | "subject" | "body">) => api.put<DraftDto>(`/api/mail/drafts/${id}`, body),
  get: (id: string) => api.get<DraftDto>(`/api/mail/drafts/${id}`),
  remove: (id: string) => api.delete(`/api/mail/drafts/${id}`),
  send: (id: string) => api.post<{ messageId: string; threadId: string }>(`/api/mail/drafts/${id}/send`),
};

export function resolveAddress(address: string) {
  return api.get<{ address: string; exists: boolean; internal: boolean; name: string | null }>(`/api/mail/resolve${qs({ address })}`);
}

/** Recipient search: mail correspondents and Vibex chat partners (Step 2.8); an empty query lists the recent ones. */
export function useContacts(q: string, enabled = true) {
  return useQuery({
    queryKey: ["mail", "contacts", q.trim()],
    enabled,
    queryFn: () => api.get<MailAddressDto[]>(`/api/mail/contacts${qs({ q: q.trim() })}`),
    staleTime: 60_000,
  });
}
