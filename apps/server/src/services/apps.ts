import { eq } from "drizzle-orm";
import { APP_IDS, APP_REGISTRY, isAppId, type InstalledAppDto } from "@voidex/shared";
import { installedApps } from "../db/schema.js";
import type { Ctx } from "./context.js";

/**
 * Installed apps per account. The registry (shared/apps.ts) is the closed list
 * of what can exist; this table is what a given account has. Because it lives
 * on the server, every device shows the same set of apps.
 */
export class AppsService {
  constructor(private readonly ctx: Ctx) {}

  async list(userId: string): Promise<InstalledAppDto[]> {
    // System apps added in a newer VOIDEX release appear for existing accounts too.
    const preinstalled = Object.values(APP_REGISTRY).filter((a) => a.preinstalled);
    await this.ctx.db
      .insert(installedApps)
      .values(preinstalled.map((a) => ({ userId, appId: a.id, version: a.version })))
      .onConflictDoNothing();

    const rows = await this.ctx.db.query.installedApps.findMany({ where: eq(installedApps.userId, userId) });
    // Registry order, not row order (PostgreSQL returns rows in no guaranteed order):
    // apps the desktop doesn't know yet are appended in this order.
    return rows
      .filter((r) => isAppId(r.appId) && APP_REGISTRY[r.appId].status === "available")
      .sort((a, b) => APP_IDS.indexOf(a.appId as InstalledAppDto["id"]) - APP_IDS.indexOf(b.appId as InstalledAppDto["id"]))
      .map((r) => ({
        id: r.appId as InstalledAppDto["id"],
        installedAt: r.installedAt.toISOString(),
        manifest: APP_REGISTRY[r.appId as InstalledAppDto["id"]],
      }));
  }
}
