import { create } from "zustand";
import { useQuery } from "@tanstack/react-query";
import type { NotificationDto, NotificationListDto } from "@voidex/shared";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";

/**
 * Notification Center state. The list lives in the query cache (one request
 * when the workspace starts); new notifications arrive live over the event
 * stream and are merged into the cache — no polling.
 */

export const NOTIFICATIONS_KEY = ["notifications"] as const;

export const useNotificationCenter = create<{ open: boolean; setOpen: (v: boolean) => void; toggle: () => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

export function useNotifications() {
  const signedIn = useSession((s) => s.status === "signedIn");
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => api.get<NotificationListDto>("/api/notifications"),
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });
}

export function useUnreadNotifications(): number {
  return useNotifications().data?.unread ?? 0;
}

function patch(fn: (d: NotificationListDto) => NotificationListDto) {
  queryClient.setQueryData<NotificationListDto>(NOTIFICATIONS_KEY, (d) => (d ? fn(d) : d));
}

/** A notification pushed by the server: new, or an update of one already listed (collapsed chat). */
export function receiveNotification(n: NotificationDto) {
  const cur = queryClient.getQueryData<NotificationListDto>(NOTIFICATIONS_KEY);
  if (!cur) return;
  const existing = cur.items.find((x) => x.id === n.id);
  patch((d) => ({
    ...d,
    items: [n, ...d.items.filter((x) => x.id !== n.id)],
    unread: d.unread + (n.read ? 0 : 1) - (existing && !existing.read ? 1 : 0),
  }));
}

export function notificationsChanged() {
  void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
}

export const notificationActions = {
  markRead(id: string) {
    const n = queryClient.getQueryData<NotificationListDto>(NOTIFICATIONS_KEY)?.items.find((x) => x.id === id);
    if (!n || n.read) return;
    patch((d) => ({ ...d, items: d.items.map((x) => (x.id === id ? { ...x, read: true } : x)), unread: Math.max(0, d.unread - 1) }));
    void api.post(`/api/notifications/${id}/read`).catch(notificationsChanged);
  },
  markAllRead() {
    patch((d) => ({ ...d, items: d.items.map((x) => ({ ...x, read: true })), unread: 0 }));
    void api.post("/api/notifications/read-all").catch(notificationsChanged);
  },
  remove(id: string) {
    patch((d) => {
      const n = d.items.find((x) => x.id === id);
      return { ...d, items: d.items.filter((x) => x.id !== id), unread: Math.max(0, d.unread - (n && !n.read ? 1 : 0)) };
    });
    void api.delete(`/api/notifications/${id}`).catch(notificationsChanged);
  },
  clear() {
    patch((d) => ({ ...d, items: [], unread: 0, next: null }));
    void api.delete("/api/notifications").catch(notificationsChanged);
  },
};
