import { and, eq } from "drizzle-orm";
import { APP_IDS, APP_REGISTRY, compareVersions, isAppId, type AppId, type InstalledAppDto, type LanguageCode } from "@voidex/shared";
import { installedApps, userPreferences, users } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { mergePreferences } from "./accounts.js";
import type { Ctx } from "./context.js";
import type { NotificationService } from "./notifications.js";

type Row = typeof installedApps.$inferSelect;

const dto = (r: Row): InstalledAppDto => ({
  id: r.appId as AppId,
  installedAt: r.installedAt.toISOString(),
  manifest: APP_REGISTRY[r.appId as AppId],
  version: r.version,
  updatedAt: r.updatedAt?.toISOString() ?? null,
  autoUpdate: r.autoUpdate ?? null,
});

/**
 * Installed apps per account. The registry (shared/apps.ts) is the closed list
 * of what can exist; this table is what a given account has. Because it lives
 * on the server, every device shows the same set of apps.
 */
export class AppsService {
  constructor(
    private readonly ctx: Ctx,
    private readonly notifications?: NotificationService,
  ) {}

  async list(userId: string): Promise<InstalledAppDto[]> {
    // System apps added in a newer VOIDEX release appear for existing accounts too.
    const preinstalled = Object.values(APP_REGISTRY).filter((a) => a.preinstalled);
    await this.ctx.db
      .insert(installedApps)
      .values(preinstalled.map((a) => ({ userId, appId: a.id, version: a.version })))
      .onConflictDoNothing();

    let rows = await this.ctx.db.query.installedApps.findMany({ where: eq(installedApps.userId, userId) });
    rows = await this.reconcile(userId, rows);
    // Registry order, not row order (PostgreSQL returns rows in no guaranteed order):
    // apps the desktop doesn't know yet are appended in this order.
    return rows
      .filter((r) => isAppId(r.appId) && APP_REGISTRY[r.appId].status === "available")
      .sort((a, b) => APP_IDS.indexOf(a.appId as AppId) - APP_IDS.indexOf(b.appId as AppId))
      .map(dto);
  }

  /**
   * Step 2.12: apps whose recorded version is older than the registry's.
   * With auto-update on (the app's own choice, else the Store's global one;
   * Settings and the Store always) the new version is recorded right away: the code is
   * the one VOIDEX serves, so nothing else has to be fetched. Otherwise the
   * update waits for the person, and one "update available" notification per
   * new version is sent while update notifications are on. An app taken off
   * the desktop is not installed for the person: it is left alone.
   */
  private async reconcile(userId: string, rows: Row[]): Promise<Row[]> {
    const stale = rows.filter((r) => isAppId(r.appId) && APP_REGISTRY[r.appId].status === "available" && compareVersions(r.version, APP_REGISTRY[r.appId].version) < 0);
    if (!stale.length) return rows;
    const prefRow = await this.ctx.db.query.userPreferences.findFirst({ where: eq(userPreferences.userId, userId) });
    const prefs = mergePreferences(prefRow?.data);
    const hidden = new Set(prefs.workspace.layout?.hidden ?? []);
    const [user] = await this.ctx.db.select({ language: users.language }).from(users).where(eq(users.id, userId));
    const lang = (user?.language ?? "en") as LanguageCode;
    const now = this.ctx.now();
    const out = new Map(rows.map((r) => [r.appId, r]));
    for (const r of stale) {
      const id = r.appId as AppId;
      if (hidden.has(id)) continue;
      const manifest = APP_REGISTRY[id];
      // Settings and the Store itself are not in the catalog (nothing to choose there): they always update.
      const auto = id === "settings" || id === "store" ? true : (r.autoUpdate ?? prefs.store.autoUpdate);
      const notify = prefs.store.updateNotifications && r.notifiedVersion !== manifest.version;
      const set = auto ? { version: manifest.version, updatedAt: now, ...(notify ? { notifiedVersion: manifest.version } : {}) } : notify ? { notifiedVersion: manifest.version } : null;
      if (!set) continue;
      const [next] = await this.ctx.db
        .update(installedApps)
        .set(set)
        .where(and(eq(installedApps.userId, userId), eq(installedApps.appId, id), eq(installedApps.version, r.version)))
        .returning();
      if (!next) continue; // another request got there first
      out.set(id, next);
      if (notify)
        await this.notifications?.tryNotify({
          userId,
          app: "store",
          type: "store.update",
          title: manifest.name[lang] ?? manifest.name.en,
          body: manifest.version,
          target: { appId: id, version: manifest.version, kind: auto ? "updated" : "available" },
          collapseOn: "appId",
        });
    }
    if (stale.some((r) => out.get(r.appId) !== r)) this.ctx.events.toUser(userId, { type: "apps.updated" });
    return [...out.values()];
  }

  /**
   * Step 2.11 (Appex Store): install or update an app to the registry's
   * current version. Only registered, available apps; the version recorded
   * changes only here, after the client finished loading the app.
   */
  async install(userId: string, id: string): Promise<InstalledAppDto> {
    if (!isAppId(id) || APP_REGISTRY[id].status !== "available") throw notFound("App");
    const version = APP_REGISTRY[id].version;
    const [before] = await this.ctx.db.select().from(installedApps).where(and(eq(installedApps.userId, userId), eq(installedApps.appId, id)));
    // Step 2.12: "recently updated" means the version really changed (a reinstall of the same one is not an update).
    const updated = before && compareVersions(before.version, version) < 0 ? { updatedAt: this.ctx.now() } : {};
    await this.ctx.db
      .insert(installedApps)
      .values({ userId, appId: id, version })
      .onConflictDoUpdate({ target: [installedApps.userId, installedApps.appId], set: { version, ...updated } });
    const [row] = await this.ctx.db.select().from(installedApps).where(and(eq(installedApps.userId, userId), eq(installedApps.appId, id)));
    this.ctx.events.toUser(userId, { type: "apps.updated" });
    return dto(row!);
  }

  /** Step 2.12: this app's own auto-update choice (null: follow the Store's global choice). */
  async setAutoUpdate(userId: string, id: string, autoUpdate: boolean | null): Promise<InstalledAppDto> {
    if (!isAppId(id) || APP_REGISTRY[id].status !== "available") throw notFound("App");
    const [row] = await this.ctx.db
      .update(installedApps)
      .set({ autoUpdate })
      .where(and(eq(installedApps.userId, userId), eq(installedApps.appId, id)))
      .returning();
    if (!row) throw notFound("App");
    this.ctx.events.toUser(userId, { type: "apps.updated" });
    return dto(row);
  }
}
