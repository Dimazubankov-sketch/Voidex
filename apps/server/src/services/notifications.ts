import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  NOTIFICATIONS_KEEP,
  type NotificationApp,
  type NotificationDto,
  type NotificationListDto,
  type NotificationType,
} from "@voidex/shared";
import type { Db, Tx } from "../db/client.js";
import { notifications, users } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";

type Row = typeof notifications.$inferSelect;

export interface NewNotification {
  userId: string;
  app: NotificationApp;
  type: NotificationType;
  title: string;
  body?: string;
  actorId?: string | null;
  target?: Record<string, string>;
  /**
   * Collapse: an unread notification of the same type with the same target
   * value (e.g. the same chat) is updated instead of adding another one.
   */
  collapseOn?: string;
}

function encodeCursor(at: Date, id: string) {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
    const at = new Date(iso!);
    if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? "")) return null;
    return { at, id: id! };
  } catch {
    return null;
  }
}

/**
 * Notification Center: stores notifications per account and pushes new ones
 * live (Server-Sent Events) to every device of that account. Apps call
 * `notify`; everything else is the user's own list (read, clear).
 */
export class NotificationService {
  constructor(private readonly ctx: Ctx) {}

  private async dtos(rows: Row[], db: Db | Tx = this.ctx.db): Promise<NotificationDto[]> {
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, avatarVersion: users.avatarVersion }).from(users).where(inArray(users.id, actorIds))
      : [];
    const byId = new Map(actors.map((a) => [a.id, { id: a.id, name: `${a.firstName} ${a.lastName}`.trim(), avatarVersion: a.avatarVersion }]));
    return rows.map((r) => ({
      id: r.id,
      app: r.app as NotificationApp,
      type: r.type as NotificationType,
      title: r.title,
      body: r.body,
      actor: (r.actorId && byId.get(r.actorId)) || null,
      target: r.target ?? {},
      read: !!r.readAt,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Creates a notification and shows it on the account's devices right away. */
  async notify(input: NewNotification): Promise<NotificationDto> {
    const key = input.collapseOn;
    const value = key ? input.target?.[key] : undefined;
    if (key && value) {
      const [same] = await this.ctx.db
        .update(notifications)
        .set({ title: input.title.slice(0, 200), body: (input.body ?? "").slice(0, 500), actorId: input.actorId ?? null, target: input.target ?? {}, createdAt: this.ctx.now() })
        .where(and(eq(notifications.userId, input.userId), eq(notifications.type, input.type), isNull(notifications.readAt), sql`${notifications.target} ->> ${key} = ${value}`))
        .returning();
      if (same) {
        const [dto] = await this.dtos([same]);
        this.ctx.events.toUser(input.userId, { type: "notification.new", notification: dto! });
        return dto!;
      }
    }
    const [row] = await this.ctx.db
      .insert(notifications)
      .values({
        userId: input.userId,
        app: input.app,
        type: input.type,
        title: input.title.slice(0, 200),
        body: (input.body ?? "").slice(0, 500),
        actorId: input.actorId ?? null,
        target: input.target ?? {},
        createdAt: this.ctx.now(),
      })
      .returning();
    const [dto] = await this.dtos([row!]);
    this.ctx.events.toUser(input.userId, { type: "notification.new", notification: dto! });
    // Keep the list bounded: the oldest beyond the limit go.
    await this.ctx.db.execute(sql`
      DELETE FROM notifications WHERE user_id = ${input.userId}::uuid AND id IN (
        SELECT id FROM notifications WHERE user_id = ${input.userId}::uuid ORDER BY created_at DESC, id DESC OFFSET ${NOTIFICATIONS_KEEP}
      )`);
    return dto!;
  }

  /** Best effort: a failing notification never breaks the action that caused it. */
  async tryNotify(input: NewNotification) {
    try {
      await this.notify(input);
    } catch (err) {
      console.error("notification failed", err);
    }
  }

  async list(userId: string, cursor: string | undefined, limit: number): Promise<NotificationListDto> {
    const c = decodeCursor(cursor);
    const rows = await this.ctx.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          c ? or(lt(notifications.createdAt, c.at), and(eq(notifications.createdAt, c.at), lt(notifications.id, c.id))) : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    return { items: await this.dtos(items), unread: await this.unread(userId), next: more ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id) : null };
  }

  async unread(userId: string): Promise<number> {
    const [r] = (await this.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))) as [{ n: number }];
    return r.n;
  }

  private changed(userId: string) {
    this.ctx.events.toUser(userId, { type: "notifications.changed" });
  }

  async markRead(userId: string, id: string) {
    const [row] = await this.ctx.db
      .update(notifications)
      .set({ readAt: this.ctx.now() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });
    if (!row) throw notFound("Notification");
    this.changed(userId);
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.ctx.db
      .update(notifications)
      .set({ readAt: this.ctx.now() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    this.changed(userId);
    return { ok: true };
  }

  /** Read everything about one subject (e.g. a chat that was opened). */
  async markTargetRead(userId: string, key: string, value: string) {
    const res = await this.ctx.db
      .update(notifications)
      .set({ readAt: this.ctx.now() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), sql`${notifications.target} ->> ${key} = ${value}`))
      .returning({ id: notifications.id });
    if (res.length) this.changed(userId);
  }

  async remove(userId: string, id: string) {
    const [row] = await this.ctx.db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });
    if (!row) throw notFound("Notification");
    this.changed(userId);
    return { ok: true };
  }

  async clear(userId: string) {
    await this.ctx.db.delete(notifications).where(eq(notifications.userId, userId));
    this.changed(userId);
    return { ok: true };
  }

  /** VOIDEX update notice to one account or to everyone (operators only — CLI / dev tools). */
  async systemUpdate(input: { title: string; body: string; version?: string }, userId?: string) {
    const ids = userId ? [userId] : (await this.ctx.db.select({ id: users.id }).from(users).where(eq(users.status, "active"))).map((u) => u.id);
    for (const id of ids) {
      await this.notify({ userId: id, app: "system", type: "system.update", title: input.title, body: input.body, target: input.version ? { version: input.version } : {} });
    }
    return { sent: ids.length };
  }
}
