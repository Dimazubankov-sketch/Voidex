import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizeLayout, type AppId, type InstalledAppDto, type WorkspaceLayout } from "@voidex/shared";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { toast } from "@/ui/overlays";

/**
 * The desktop layout lives on the server with the account's preferences
 * (`preferences.workspace.layout`), so it follows the user to every device and
 * survives sign-out, reloads and updates. Edits apply instantly (optimistic)
 * and are saved shortly after; other devices get a `preferences.updated` event
 * and refresh.
 */

export function useInstalledApps() {
  const order = useSession((s) => s.user?.preferences.workspace.appOrder) ?? [];
  const q = useQuery({ queryKey: qk.apps, queryFn: () => api.get<InstalledAppDto[]>("/api/apps"), staleTime: 60_000 });
  const apps = [...(q.data ?? [])].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return { ...q, apps };
}

let installedIds: AppId[] = [];
let saveTimer: number | undefined;
let pending: WorkspaceLayout | null = null;

export function useWorkspaceLayout() {
  const { apps, isLoading } = useInstalledApps();
  const stored = useSession((s) => s.user?.preferences.workspace.layout);
  const ids = apps.map((a) => a.id);
  const key = ids.join(",");
  installedIds = ids;
  const layout = useMemo(() => normalizeLayout(stored, ids), [stored, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => Object.fromEntries(apps.map((a) => [a.id, a])) as Partial<Record<AppId, InstalledAppDto>>, [apps]);
  return { layout, apps, byId, ready: !isLoading && apps.length > 0 };
}

/** The latest layout (including edits not yet saved). */
export function currentLayout(): WorkspaceLayout {
  return normalizeLayout(pending ?? useSession.getState().user?.preferences.workspace.layout, installedIds);
}

/** Applies an edit to the desktop: instant on this device, saved to the account right after. */
export function updateLayout(edit: (l: WorkspaceLayout) => WorkspaceLayout) {
  const user = useSession.getState().user;
  if (!user) return;
  const next = normalizeLayout(edit(currentLayout()), installedIds);
  pending = next;
  useSession.getState().setUser({ ...user, preferences: { ...user.preferences, workspace: { ...user.preferences.workspace, layout: next } } });
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flush, 350);
}

async function flush() {
  const layout = pending;
  if (!layout) return;
  try {
    await api.patch("/api/preferences", { workspace: { layout } });
    if (pending === layout) pending = null;
  } catch {
    toast({ title: t("home.saveFailed"), tone: "danger" });
    // Keep the local edit; the next change (or reload) retries.
  }
}

/** Saves right away (e.g. before the page unloads). */
export function flushLayout() {
  window.clearTimeout(saveTimer);
  void flush();
}

if (typeof window !== "undefined") window.addEventListener("pagehide", flushLayout);
