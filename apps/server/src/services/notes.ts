import { randomBytes } from "node:crypto";
import { and, arrayContains, desc, eq, inArray, sql } from "drizzle-orm";
import {
  ErrorCode,
  NOTES_DOC_MAX_BYTES,
  NOTES_MEDIA_PREFIX,
  NOTES_SHARES_MAX,
  notesMediaIds,
  validNotesProject,
  validNotesSpace,
  validNotesWorkspace,
  withoutSpeakerNotes,
  type NotesDocDto,
  type NotesShareDto,
} from "@voidex/shared";
import { notesMedia, notesShares, notesWorkspaces } from "../db/schema.js";
import { fail, notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";

const EMPTY = { version: 1, projects: [] };

/**
 * Voidex Notes storage (Step 2.5). Everything is scoped to the signed-in
 * account: the user id always comes from the session, never from the client.
 *
 * - The workspace is one JSON document per account with a revision. A save
 *   names the revision it was based on; when another device saved in between,
 *   the save is refused (409 notes_conflict) instead of overwriting it.
 * - Images are stored as blobs ("notes") and served only to their owner, or
 *   to signed-in users opening a share that shows that image.
 * - A share is a read-only snapshot of a space or project without speaker
 *   notes, opened by its unguessable token. Only its owner can list or revoke it.
 */
export class NotesService {
  constructor(private readonly ctx: Ctx) {}

  async load(userId: string): Promise<NotesDocDto> {
    const [row] = await this.ctx.db.select().from(notesWorkspaces).where(eq(notesWorkspaces.userId, userId));
    return row ? { data: row.data, revision: row.revision } : { data: EMPTY, revision: 0 };
  }

  async save(userId: string, data: unknown, revision: number, sessionId?: string): Promise<{ revision: number }> {
    if (!validNotesWorkspace(data)) throw fail(ErrorCode.ValidationFailed, "This is not a Notes workspace.");
    if (Buffer.byteLength(JSON.stringify(data)) > NOTES_DOC_MAX_BYTES) throw fail(ErrorCode.NotesTooLarge, "The notes are too large.");
    const now = this.ctx.now();
    const doc = data as Record<string, unknown>;
    let next: number | null = null;
    if (revision === 0) {
      const rows = await this.ctx.db.insert(notesWorkspaces).values({ userId, data: doc, revision: 1, updatedAt: now }).onConflictDoNothing().returning({ revision: notesWorkspaces.revision });
      next = rows[0]?.revision ?? null;
    } else {
      const rows = await this.ctx.db
        .update(notesWorkspaces)
        .set({ data: doc, revision: sql`${notesWorkspaces.revision} + 1`, updatedAt: now })
        .where(and(eq(notesWorkspaces.userId, userId), eq(notesWorkspaces.revision, revision)))
        .returning({ revision: notesWorkspaces.revision });
      next = rows[0]?.revision ?? null;
    }
    if (next === null) {
      const current = await this.load(userId);
      throw fail(ErrorCode.NotesConflict, "The notes were changed on another device.", { details: { revision: current.revision } });
    }
    this.ctx.events.toUser(userId, { type: "notes.changed", revision: next }, { exceptSessionId: sessionId });
    return { revision: next };
  }

  async upload(userId: string, mimeType: string, data: Buffer): Promise<{ url: string }> {
    const row = await this.ctx.db.transaction(async (tx) => {
      const storageKey = await this.ctx.blobs.put({ ownerUserId: userId, purpose: "notes", mimeType, data }, tx);
      const [m] = await tx.insert(notesMedia).values({ ownerId: userId, mimeType, sizeBytes: data.length, storageKey }).returning();
      return m!;
    });
    return { url: `${NOTES_MEDIA_PREFIX}${row.id}` };
  }

  /** An image: to its owner, or to anyone signed in when one of the owner's shares shows it. */
  async media(userId: string, id: string): Promise<{ mimeType: string; data: Buffer }> {
    const [m] = await this.ctx.db.select().from(notesMedia).where(eq(notesMedia.id, id));
    if (!m) throw notFound("Image");
    if (m.ownerId !== userId) {
      const [shared] = await this.ctx.db
        .select({ token: notesShares.token })
        .from(notesShares)
        .where(and(eq(notesShares.ownerId, m.ownerId), arrayContains(notesShares.mediaIds, [m.id])))
        .limit(1);
      if (!shared) throw notFound("Image");
    }
    const blob = await this.ctx.blobs.get(m.storageKey);
    if (!blob) throw notFound("Image");
    return { mimeType: m.mimeType, data: blob.data };
  }

  async createShare(userId: string, data: unknown): Promise<{ token: string }> {
    if (!validNotesSpace(data) && !validNotesProject(data)) throw fail(ErrorCode.ValidationFailed, "Only a space or a project can be shared.");
    const snapshot = withoutSpeakerNotes(data) as Record<string, unknown>;
    if (Buffer.byteLength(JSON.stringify(snapshot)) > NOTES_DOC_MAX_BYTES) throw fail(ErrorCode.NotesTooLarge, "The notes are too large.");
    const [{ n }] = (await this.ctx.db.select({ n: sql<number>`count(*)::int` }).from(notesShares).where(eq(notesShares.ownerId, userId))) as [{ n: number }];
    if (n >= NOTES_SHARES_MAX) throw fail(ErrorCode.ValidationFailed, "Too many shared links. Remove some first.");
    // Only my own images become visible through the link.
    const wanted = [...notesMediaIds(snapshot)];
    const owned = wanted.length
      ? (await this.ctx.db.select({ id: notesMedia.id }).from(notesMedia).where(and(eq(notesMedia.ownerId, userId), inArray(notesMedia.id, wanted)))).map((r) => r.id)
      : [];
    const token = randomBytes(24).toString("base64url");
    await this.ctx.db.insert(notesShares).values({ token, ownerId: userId, name: String(snapshot.name ?? "").slice(0, 200), data: snapshot, mediaIds: owned });
    return { token };
  }

  /** A shared snapshot (any signed-in VOIDEX user with the link). */
  async readShare(token: string): Promise<unknown> {
    const [row] = await this.ctx.db.select({ data: notesShares.data }).from(notesShares).where(eq(notesShares.token, token));
    if (!row) throw notFound("Share");
    return row.data;
  }

  async listShares(userId: string): Promise<NotesShareDto[]> {
    const rows = await this.ctx.db
      .select({ token: notesShares.token, name: notesShares.name, createdAt: notesShares.createdAt })
      .from(notesShares)
      .where(eq(notesShares.ownerId, userId))
      .orderBy(desc(notesShares.createdAt));
    return rows.map((r) => ({ token: r.token, name: r.name, created: r.createdAt.getTime() }));
  }

  async revokeShare(userId: string, token: string) {
    const rows = await this.ctx.db.delete(notesShares).where(and(eq(notesShares.token, token), eq(notesShares.ownerId, userId))).returning({ token: notesShares.token });
    if (!rows.length) throw notFound("Share");
    return { ok: true };
  }
}
