import { useMutation, useQuery } from "@tanstack/react-query";
import { APP_REGISTRY, type AppId, type InstalledAppDto, type StoreReportReason, type StoreReviewDto, type StoreReviewSort, type StoreReviewStatsDto, type StoreReviewsDto } from "@voidex/shared";
import { api, qs } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { offloadApp } from "@/lib/app-storage";
import { APP_LOADERS } from "@/os/app-registry";
import { addToDesktop, removeAppsFromDesktop } from "@/os/home/actions";
import { currentLayout, useWorkspaceLayout } from "@/os/home/layout";
import { create } from "zustand";
import type { StoreAppId } from "./catalog";

export const sk = {
  stats: ["store", "stats"] as const,
  reviews: (id: string, sort: StoreReviewSort) => ["store", "reviews", id, sort] as const,
};

export function useStoreStats() {
  return useQuery({ queryKey: sk.stats, queryFn: () => api.get<Record<string, StoreReviewStatsDto>>("/api/store/stats"), staleTime: 60_000 });
}

export function useReviews(id: string, sort: StoreReviewSort = "date") {
  return useQuery({ queryKey: sk.reviews(id, sort), queryFn: () => api.get<StoreReviewsDto>(`/api/store/apps/${id}/reviews${qs({ sort })}`), staleTime: 15_000 });
}

const refreshReviews = (id: string) => {
  void queryClient.invalidateQueries({ queryKey: ["store", "reviews", id] });
  void queryClient.invalidateQueries({ queryKey: sk.stats });
};

export function useSaveReview(id: string) {
  return useMutation({
    mutationFn: (body: { rating: number; title: string; text: string }) => api.put<StoreReviewDto>(`/api/store/apps/${id}/review`, body),
    onSuccess: () => refreshReviews(id),
  });
}

export function useDeleteReview(id: string) {
  return useMutation({ mutationFn: () => api.delete(`/api/store/apps/${id}/review`), onSuccess: () => refreshReviews(id) });
}

export async function voteReview(appId: string, reviewId: string, vote: 1 | -1 | 0) {
  const r = await api.post<{ vote: number; likes: number; dislikes: number }>(`/api/store/apps/${appId}/reviews/${reviewId}/vote`, { vote });
  // The canonical counters, in every sort of this app's list.
  queryClient.setQueriesData<StoreReviewsDto>({ queryKey: ["store", "reviews", appId] }, (d) =>
    d && { ...d, items: d.items.map((x) => (x.id === reviewId ? { ...x, myVote: r.vote, likes: r.likes, dislikes: r.dislikes } : x)) },
  );
  return r;
}

export async function reportReview(appId: string, reviewId: string, reason: StoreReportReason, description: string) {
  await api.post(`/api/store/apps/${appId}/reviews/${reviewId}/report`, { reason, description });
  queryClient.setQueriesData<StoreReviewsDto>({ queryKey: ["store", "reviews", appId] }, (d) => d && { ...d, items: d.items.map((x) => (x.id === reviewId ? { ...x, reported: true } : x)) });
}

// ------------------------------------------------------------- install state

export type AppState = "get" | "open" | "update";

/**
 * Where an app stands for this account: on the desktop and current ("open"),
 * on the desktop with an older version recorded ("update"), or removed from
 * the desktop with the system's own Remove ("get"). The desktop layout and the
 * installed versions both live on the server, so every device agrees.
 */
export function useAppStates(): Record<StoreAppId, AppState> {
  const { layout, byId } = useWorkspaceLayout();
  const hidden = new Set(layout.hidden);
  const out = {} as Record<StoreAppId, AppState>;
  for (const id of Object.keys(APP_REGISTRY) as AppId[]) {
    if (id === "store" || id === "settings") continue;
    const row = byId[id];
    out[id as StoreAppId] = !row || hidden.has(id) ? "get" : row.version && row.version !== row.manifest.version ? "update" : "open";
  }
  return out;
}

/** Installs in flight (the buttons show their progress; a second press waits for it). */
export const useInstalls = create<{ busy: Partial<Record<StoreAppId, true>>; set: (id: StoreAppId, on: boolean) => void }>((set) => ({
  busy: {},
  set: (id, on) => set((s) => ({ busy: { ...s.busy, [id]: on || undefined } })),
}));

/**
 * Install / update for real: the app's code is downloaded (its chunk, the
 * same one opening it would load), then the server records the registry's
 * version for this account, then the app is put back on the desktop and in
 * the launcher. Progress is honest: the browser does not report how far a
 * code download is, so the button shows a spinner (never made-up percents).
 * On an error nothing changes (the old version stays recorded).
 */
export async function installApp(id: StoreAppId) {
  const s = useInstalls.getState();
  if (s.busy[id]) return;
  s.set(id, true);
  try {
    await APP_LOADERS[id]();
    const dto = await api.post<InstalledAppDto>(`/api/store/apps/${id}/install`);
    queryClient.setQueryData<InstalledAppDto[]>(qk.apps, (list) => (list ? [...list.filter((a) => a.id !== id), dto] : list));
    if (currentLayout().hidden.includes(id)) addToDesktop(id);
  } finally {
    useInstalls.getState().set(id, false);
  }
}

/** Remove: the system's own way (its windows close as on a normal close; it leaves the desktop and the launcher). */
export async function removeApp(id: StoreAppId): Promise<boolean> {
  if (!(await offloadApp(id))) return false;
  removeAppsFromDesktop([id]);
  return true;
}
