import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import {
  ErrorCode,
  VIBEX_FILES_MAX,
  VIBEX_FILE_MAX_BYTES,
  VIBEX_POST_IMAGE_TYPES,
  attachmentMimeType,
  sanitizeFilename,
  detectLanguage,
  type VibexChatDto,
  type VibexCommentDto,
  type VibexMeDto,
  type VibexTranslationDto,
  type VibexFileDto,
  type VibexHistoryItemDto,
  type VibexMessageDto,
  type VibexPage,
  type VibexPersonDto,
  type VibexPostDto,
  type VibexProfileDto,
} from "@voidex/shared";
import type { Db, Tx } from "../db/client.js";
import {
  mailAccounts,
  users,
  vibexBookmarks,
  vibexComments,
  vibexConversations,
  vibexFiles,
  vibexHiddenPosts,
  vibexLikes,
  vibexMembers,
  vibexMessages,
  vibexPosts,
  vibexProfiles,
  vibexReports,
} from "../db/schema.js";
import { looksLike } from "../lib/file-types.js";
import { fail, notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";

type FileRow = typeof vibexFiles.$inferSelect;
type PostRow = typeof vibexPosts.$inferSelect;
type MessageRow = typeof vibexMessages.$inferSelect;

const IMAGE_PREVIEW = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
/** Uploaded but never sent files are removed after a day. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

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
/** Rows strictly older than the cursor, newest first (ties broken by id). */
function olderThan(col: { createdAt: typeof vibexPosts.createdAt; id: typeof vibexPosts.id } | { createdAt: typeof vibexMessages.createdAt; id: typeof vibexMessages.id }, cursor: { at: Date; id: string } | null): SQL | undefined {
  if (!cursor) return undefined;
  return or(lt(col.createdAt, cursor.at), and(eq(col.createdAt, cursor.at), lt(col.id, cursor.id)));
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const fileDto = (f: FileRow): VibexFileDto => ({
  id: f.id,
  filename: f.filename,
  mimeType: f.mimeType,
  size: f.sizeBytes,
  kind: IMAGE_PREVIEW.has(f.mimeType) ? "image" : "file",
});

/**
 * Vibex — chats and the social feed. Every call is scoped to the signed-in
 * user: you only read conversations you are a member of, only change your own
 * posts, likes, bookmarks and pins.
 */
export class VibexService {
  constructor(private readonly ctx: Ctx) {}

  /** Translations cache: post id + edit time + target → text (bounded). */
  private readonly translations = new Map<string, VibexTranslationDto>();

  // ---------------------------------------------------------------- profile

  async isActivated(userId: string): Promise<boolean> {
    const [p] = await this.ctx.db.select({ id: vibexProfiles.userId }).from(vibexProfiles).where(eq(vibexProfiles.userId, userId));
    return !!p;
  }

  async me(userId: string): Promise<VibexMeDto> {
    return { activated: await this.isActivated(userId), person: await this.person(userId) };
  }

  /** Turns Vibex on for this VOIDEX account (idempotent). Credentials are checked by the route. */
  async activate(userId: string): Promise<VibexMeDto> {
    await this.ctx.db.insert(vibexProfiles).values({ userId }).onConflictDoNothing();
    return this.me(userId);
  }

  // ------------------------------------------------------------------ people

  private async persons(ids: string[], db: Db | Tx = this.ctx.db): Promise<Map<string, VibexPersonDto>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await db
      .select({ u: users, address: mailAccounts.address, local: mailAccounts.localPart })
      .from(users)
      .leftJoin(mailAccounts, and(eq(mailAccounts.userId, users.id), eq(mailAccounts.isPrimary, true)))
      .where(inArray(users.id, unique));
    return new Map(
      rows.map((r) => [
        r.u.id,
        {
          id: r.u.id,
          firstName: r.u.firstName,
          lastName: r.u.lastName,
          name: `${r.u.firstName} ${r.u.lastName}`.trim(),
          handle: r.local ?? "",
          address: r.address ?? "",
          avatarVersion: r.u.avatarVersion,
        },
      ]),
    );
  }

  private async person(id: string): Promise<VibexPersonDto> {
    const p = (await this.persons([id])).get(id);
    if (!p) throw notFound("User");
    return p;
  }

  /** People search by name or @handle (other active VOIDEX users). */
  async people(viewerId: string, q: string): Promise<VibexPersonDto[]> {
    const query = q.replace(/^@/, "").trim();
    if (!query) return [];
    const like = `%${escapeLike(query)}%`;
    const prefix = `${escapeLike(query)}%`;
    const rows = await this.ctx.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(mailAccounts, and(eq(mailAccounts.userId, users.id), eq(mailAccounts.isPrimary, true)))
      // Only people who use Vibex can be found and messaged here.
      .innerJoin(vibexProfiles, eq(vibexProfiles.userId, users.id))
      .where(
        and(
          ne(users.id, viewerId),
          eq(users.status, "active"),
          or(
            ilike(users.firstName, prefix),
            ilike(users.lastName, prefix),
            ilike(mailAccounts.localPart, prefix),
            ilike(sql`${users.firstName} || ' ' || ${users.lastName}`, like),
            ilike(mailAccounts.address, `${escapeLike(query.toLowerCase())}%`),
          ),
        ),
      )
      .orderBy(asc(users.firstName), asc(users.lastName))
      .limit(20);
    const map = await this.persons(rows.map((r) => r.id));
    return rows.map((r) => map.get(r.id)!).filter(Boolean);
  }

  async profile(viewerId: string, userId: string): Promise<VibexProfileDto> {
    const person = await this.person(userId);
    const [{ n }] = (await this.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(vibexPosts)
      .where(and(eq(vibexPosts.authorId, userId), isNull(vibexPosts.deletedAt)))) as [{ n: number }];
    return { person, posts: n, me: userId === viewerId };
  }

  // ------------------------------------------------------------------- files

  /** Upload before sending: a chat file or a post picture, visible only to its owner until sent. */
  async upload(ownerId: string, purpose: "message" | "post", input: { filename: string; data: Buffer }): Promise<VibexFileDto> {
    const filename = sanitizeFilename(input.filename);
    const mimeType = attachmentMimeType(filename);
    if (!mimeType || (purpose === "post" && !VIBEX_POST_IMAGE_TYPES.includes(mimeType))) {
      throw fail(ErrorCode.AttachmentTypeNotAllowed, "This type of file can't be attached.", { status: 415, details: { filename } });
    }
    if (!input.data.length) throw fail(ErrorCode.ValidationFailed, "The file is empty.");
    if (input.data.length > VIBEX_FILE_MAX_BYTES) {
      throw fail(ErrorCode.AttachmentTooLarge, "The file is too large.", { status: 413, details: { maxBytes: VIBEX_FILE_MAX_BYTES } });
    }
    if (!looksLike(mimeType, input.data)) {
      throw fail(ErrorCode.AttachmentTypeNotAllowed, "The file content does not match its type.", { status: 415, details: { filename } });
    }
    const now = this.ctx.now();
    return this.ctx.db.transaction(async (tx) => {
      // Housekeeping: drop this person's files that were uploaded and never sent.
      const stale = await tx
        .delete(vibexFiles)
        .where(
          and(
            eq(vibexFiles.ownerId, ownerId),
            isNull(vibexFiles.messageId),
            isNull(vibexFiles.postId),
            lt(vibexFiles.createdAt, new Date(now.getTime() - PENDING_TTL_MS)),
          ),
        )
        .returning({ key: vibexFiles.storageKey });
      await this.ctx.blobs.delete(stale.map((s) => s.key), tx);
      const key = await this.ctx.blobs.put({ ownerUserId: ownerId, purpose: "vibex", mimeType, data: input.data }, tx);
      const [row] = await tx.insert(vibexFiles).values({ ownerId, purpose, filename, mimeType, sizeBytes: input.data.length, storageKey: key }).returning();
      return fileDto(row!);
    });
  }

  async discardUpload(ownerId: string, fileId: string) {
    const [row] = await this.ctx.db
      .delete(vibexFiles)
      .where(and(eq(vibexFiles.id, fileId), eq(vibexFiles.ownerId, ownerId), isNull(vibexFiles.messageId), isNull(vibexFiles.postId)))
      .returning();
    if (!row) throw notFound("File");
    await this.ctx.blobs.delete([row.storageKey]);
    return { ok: true };
  }

  /** Download: chat files for members of that chat, post pictures for any signed-in user. */
  async file(viewerId: string, fileId: string) {
    const [row] = await this.ctx.db.select().from(vibexFiles).where(eq(vibexFiles.id, fileId));
    if (!row) throw notFound("File");
    let allowed = false;
    if (row.messageId) {
      const [m] = await this.ctx.db
        .select({ id: vibexMembers.userId })
        .from(vibexMessages)
        .innerJoin(vibexMembers, and(eq(vibexMembers.conversationId, vibexMessages.conversationId), eq(vibexMembers.userId, viewerId)))
        .where(eq(vibexMessages.id, row.messageId));
      allowed = !!m;
    } else if (row.postId) {
      const [p] = await this.ctx.db.select().from(vibexPosts).where(eq(vibexPosts.id, row.postId));
      allowed = !!p && (!p.deletedAt || p.authorId === viewerId);
    } else {
      allowed = row.ownerId === viewerId;
    }
    if (!allowed) throw notFound("File");
    const blob = await this.ctx.blobs.get(row.storageKey);
    if (!blob) throw notFound("File");
    return { filename: row.filename, mimeType: row.mimeType, data: blob.data };
  }

  /** Claims uploaded files for a message / post (owner, purpose and "not yet sent" are enforced). */
  private async claimFiles(tx: Tx, ownerId: string, purpose: "message" | "post", ids: string[], target: { messageId: string } | { postId: string }) {
    if (!ids.length) return;
    const unique = [...new Set(ids)];
    if (unique.length > VIBEX_FILES_MAX) throw fail(ErrorCode.AttachmentLimit, "Too many files.", { status: 422, details: { max: VIBEX_FILES_MAX } });
    const rows = await tx
      .select()
      .from(vibexFiles)
      .where(and(inArray(vibexFiles.id, unique), eq(vibexFiles.ownerId, ownerId), eq(vibexFiles.purpose, purpose), isNull(vibexFiles.messageId), isNull(vibexFiles.postId)));
    if (rows.length !== unique.length) throw notFound("File");
    for (const [i, id] of unique.entries()) {
      await tx
        .update(vibexFiles)
        .set({ ...target, position: i })
        .where(eq(vibexFiles.id, id));
    }
  }

  private async filesOf(column: "messageId" | "postId", ids: string[]): Promise<Map<string, VibexFileDto[]>> {
    const map = new Map<string, VibexFileDto[]>();
    if (!ids.length) return map;
    const col = column === "messageId" ? vibexFiles.messageId : vibexFiles.postId;
    const rows = await this.ctx.db.select().from(vibexFiles).where(inArray(col, ids)).orderBy(asc(vibexFiles.position));
    for (const r of rows) {
      const key = (column === "messageId" ? r.messageId : r.postId)!;
      map.set(key, [...(map.get(key) ?? []), fileDto(r)]);
    }
    return map;
  }

  // ------------------------------------------------------------------- posts

  /** Builds post DTOs as seen by `viewerId` (counts, my like / bookmark / repost, originals of reposts). */
  private async postDtos(viewerId: string, rows: PostRow[]): Promise<Map<string, VibexPostDto>> {
    const out = new Map<string, VibexPostDto>();
    if (!rows.length) return out;
    // Originals of reposts (they may be deleted → "unavailable").
    const originalIds = [...new Set(rows.filter((r) => r.kind === "repost" && r.repostOfId).map((r) => r.repostOfId!))].filter((id) => !rows.some((r) => r.id === id));
    const originals = originalIds.length ? await this.ctx.db.select().from(vibexPosts).where(inArray(vibexPosts.id, originalIds)) : [];
    const all = [...rows, ...originals];
    const ids = all.map((r) => r.id);
    const [people, media, likeCounts, repostCounts, myLikes, myMarks, myReposts, commentCounts] = await Promise.all([
      this.persons(all.map((r) => r.authorId)),
      this.filesOf("postId", ids),
      this.ctx.db
        .select({ id: vibexLikes.postId, n: sql<number>`count(*)::int` })
        .from(vibexLikes)
        .where(inArray(vibexLikes.postId, ids))
        .groupBy(vibexLikes.postId),
      this.ctx.db
        .select({ id: vibexPosts.repostOfId, n: sql<number>`count(*)::int` })
        .from(vibexPosts)
        .where(and(inArray(vibexPosts.repostOfId, ids), eq(vibexPosts.kind, "repost"), isNull(vibexPosts.deletedAt)))
        .groupBy(vibexPosts.repostOfId),
      this.ctx.db.select({ id: vibexLikes.postId }).from(vibexLikes).where(and(inArray(vibexLikes.postId, ids), eq(vibexLikes.userId, viewerId))),
      this.ctx.db.select({ id: vibexBookmarks.postId }).from(vibexBookmarks).where(and(inArray(vibexBookmarks.postId, ids), eq(vibexBookmarks.userId, viewerId))),
      this.ctx.db
        .select({ id: vibexPosts.repostOfId })
        .from(vibexPosts)
        .where(and(inArray(vibexPosts.repostOfId, ids), eq(vibexPosts.authorId, viewerId), eq(vibexPosts.kind, "repost"), isNull(vibexPosts.deletedAt))),
      this.ctx.db
        .select({ id: vibexComments.postId, n: sql<number>`count(*)::int` })
        .from(vibexComments)
        .where(and(inArray(vibexComments.postId, ids), isNull(vibexComments.deletedAt)))
        .groupBy(vibexComments.postId),
    ]);
    const comments = new Map(commentCounts.map((r) => [r.id, r.n]));
    const likes = new Map(likeCounts.map((r) => [r.id, r.n]));
    const reposts = new Map(repostCounts.map((r) => [r.id!, r.n]));
    const liked = new Set(myLikes.map((r) => r.id));
    const marked = new Set(myMarks.map((r) => r.id));
    const reposted = new Set(myReposts.map((r) => r.id!));
    const base = (r: PostRow): VibexPostDto => ({
      id: r.id,
      kind: r.kind,
      author: people.get(r.authorId)!,
      text: r.text,
      media: media.get(r.id) ?? [],
      createdAt: r.createdAt.toISOString(),
      likes: likes.get(r.id) ?? 0,
      reposts: reposts.get(r.id) ?? 0,
      liked: liked.has(r.id),
      bookmarked: marked.has(r.id),
      reposted: reposted.has(r.id),
      mine: r.authorId === viewerId,
      comments: comments.get(r.id) ?? 0,
      editedAt: r.editedAt?.toISOString() ?? null,
    });
    const byId = new Map(all.map((r) => [r.id, r]));
    for (const r of rows) {
      const dto = base(r);
      if (r.kind === "repost") {
        const orig = r.repostOfId ? byId.get(r.repostOfId) : undefined;
        dto.repostOf = orig && !orig.deletedAt ? base(orig) : null;
      }
      out.set(r.id, dto);
    }
    return out;
  }

  private async page(viewerId: string, where: SQL | undefined, cursor: string | undefined, limit: number): Promise<VibexPage<VibexPostDto>> {
    const c = decodeCursor(cursor);
    const rows = await this.ctx.db
      .select()
      .from(vibexPosts)
      .where(and(isNull(vibexPosts.deletedAt), where, olderThan(vibexPosts, c)))
      .orderBy(desc(vibexPosts.createdAt), desc(vibexPosts.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const dtos = await this.postDtos(viewerId, items);
    return { items: items.map((r) => dtos.get(r.id)!), next: more ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id) : null };
  }

  /** Everyone's posts and reposts, newest first — minus what I marked "not interested". */
  feed(viewerId: string, cursor?: string, limit = 30) {
    const hidden = this.ctx.db.select({ id: vibexHiddenPosts.postId }).from(vibexHiddenPosts).where(eq(vibexHiddenPosts.userId, viewerId));
    return this.page(
      viewerId,
      and(
        sql`${vibexPosts.id} NOT IN (${hidden})`,
        or(isNull(vibexPosts.repostOfId), sql`${vibexPosts.repostOfId} NOT IN (${hidden})`),
      ),
      cursor,
      limit,
    );
  }

  personPosts(viewerId: string, userId: string, cursor?: string, limit = 30) {
    return this.page(viewerId, eq(vibexPosts.authorId, userId), cursor, limit);
  }

  private async livePost(id: string, db: Db | Tx = this.ctx.db): Promise<PostRow> {
    const [row] = await db.select().from(vibexPosts).where(and(eq(vibexPosts.id, id), isNull(vibexPosts.deletedAt)));
    if (!row) throw notFound("Post");
    return row;
  }

  async post(viewerId: string, id: string): Promise<VibexPostDto> {
    const row = await this.livePost(id);
    return (await this.postDtos(viewerId, [row])).get(row.id)!;
  }

  async createPost(authorId: string, input: { text: string; mediaIds: string[] }): Promise<VibexPostDto> {
    const row = await this.ctx.db.transaction(async (tx) => {
      const [p] = await tx.insert(vibexPosts).values({ authorId, kind: "post", text: input.text.trim() }).returning();
      await this.claimFiles(tx, authorId, "post", input.mediaIds, { postId: p!.id });
      return p!;
    });
    this.feedChanged(row.id);
    return this.post(authorId, row.id);
  }

  /** The author edits the text of their post (not of a repost). */
  async editPost(authorId: string, id: string, text: string): Promise<VibexPostDto> {
    const [row] = await this.ctx.db
      .update(vibexPosts)
      .set({ text: text.trim(), editedAt: this.ctx.now() })
      .where(and(eq(vibexPosts.id, id), eq(vibexPosts.authorId, authorId), eq(vibexPosts.kind, "post"), isNull(vibexPosts.deletedAt)))
      .returning();
    if (!row) throw notFound("Post");
    const media = await this.filesOf("postId", [row.id]);
    if (!row.text && !(media.get(row.id)?.length ?? 0)) throw fail(ErrorCode.ValidationFailed, "Empty post", { fields: { text: "required" } });
    this.feedChanged(row.id);
    return this.post(authorId, row.id);
  }

  /** "Not interested": the post (and reposts of it) leave my feed. */
  async hidePost(userId: string, id: string) {
    const post = await this.target(id);
    if (post.authorId === userId) throw fail(ErrorCode.ValidationFailed, "You can't hide your own post.");
    await this.ctx.db.insert(vibexHiddenPosts).values({ userId, postId: post.id }).onConflictDoNothing();
    return { ok: true };
  }

  /** A report for moderation (one per person per post). */
  async report(userId: string, id: string, reason: "spam" | "abuse" | "other") {
    const post = await this.target(id);
    if (post.authorId === userId) throw fail(ErrorCode.ValidationFailed, "You can't report your own post.");
    await this.ctx.db.insert(vibexReports).values({ reporterId: userId, postId: post.id, reason }).onConflictDoNothing();
    return { ok: true };
  }

  // --------------------------------------------------------------- comments

  async comments(viewerId: string, postId: string): Promise<VibexCommentDto[]> {
    const post = await this.target(postId);
    const rows = await this.ctx.db
      .select()
      .from(vibexComments)
      .where(and(eq(vibexComments.postId, post.id), isNull(vibexComments.deletedAt)))
      .orderBy(asc(vibexComments.createdAt), asc(vibexComments.id))
      .limit(500);
    const people = await this.persons(rows.map((r) => r.authorId));
    return rows.map((r) => ({ id: r.id, postId: r.postId, author: people.get(r.authorId)!, text: r.text, createdAt: r.createdAt.toISOString(), mine: r.authorId === viewerId }));
  }

  async addComment(authorId: string, postId: string, text: string): Promise<VibexCommentDto> {
    const post = await this.target(postId);
    const [row] = await this.ctx.db.insert(vibexComments).values({ postId: post.id, authorId, text: text.trim() }).returning();
    this.feedChanged(post.id);
    return { id: row!.id, postId: post.id, author: await this.person(authorId), text: row!.text, createdAt: row!.createdAt.toISOString(), mine: true };
  }

  /** The comment's author or the post's author removes a comment. */
  async deleteComment(userId: string, commentId: string) {
    const [c] = await this.ctx.db.select().from(vibexComments).where(and(eq(vibexComments.id, commentId), isNull(vibexComments.deletedAt)));
    if (!c) throw notFound("Comment");
    const [p] = await this.ctx.db.select({ authorId: vibexPosts.authorId }).from(vibexPosts).where(eq(vibexPosts.id, c.postId));
    if (c.authorId !== userId && p?.authorId !== userId) throw notFound("Comment");
    await this.ctx.db.update(vibexComments).set({ deletedAt: this.ctx.now() }).where(eq(vibexComments.id, commentId));
    this.feedChanged(c.postId);
    return { ok: true };
  }

  // ------------------------------------------------------------- translation

  /** Translates a post the reader can see into their language. */
  async translate(viewerId: string, postId: string): Promise<VibexTranslationDto> {
    const post = await this.target(postId);
    const [viewer] = await this.ctx.db.select({ language: users.language }).from(users).where(eq(users.id, viewerId));
    const target = viewer?.language ?? "en";
    if (!post.text.trim()) throw fail(ErrorCode.ValidationFailed, "Nothing to translate.");
    const key = `${post.id}|${post.editedAt?.getTime() ?? 0}|${target}`;
    const cached = this.translations.get(key);
    if (cached) return cached;
    const source = detectLanguage(post.text);
    if (source === target) return { text: post.text, source, target };
    const text = await this.ctx.translator.translate(post.text, source, target);
    const dto = { text, source, target };
    if (this.translations.size > 2000) this.translations.delete(this.translations.keys().next().value!);
    this.translations.set(key, dto);
    return dto;
  }

  /** Feed-wide change (new post, edit, comment, delete): every signed-in Vibex refreshes. */
  private feedChanged(postId?: string) {
    this.ctx.events.toAll({ type: "vibex.feed", ...(postId ? { postId } : {}) });
  }

  async deletePost(authorId: string, id: string) {
    const [row] = await this.ctx.db
      .update(vibexPosts)
      .set({ deletedAt: this.ctx.now() })
      .where(and(eq(vibexPosts.id, id), eq(vibexPosts.authorId, authorId), isNull(vibexPosts.deletedAt)))
      .returning();
    if (!row) throw notFound("Post");
    this.feedChanged(row.id);
    return { ok: true };
  }

  /** Likes and bookmarks always apply to the original post, never to a repost wrapper. */
  private async target(id: string) {
    const row = await this.livePost(id);
    if (row.kind === "repost") {
      if (!row.repostOfId) throw notFound("Post");
      return this.livePost(row.repostOfId);
    }
    return row;
  }

  async like(userId: string, id: string, on: boolean) {
    const post = await this.target(id);
    if (on) await this.ctx.db.insert(vibexLikes).values({ postId: post.id, userId }).onConflictDoNothing();
    else await this.ctx.db.delete(vibexLikes).where(and(eq(vibexLikes.postId, post.id), eq(vibexLikes.userId, userId)));
    this.feedChanged(post.id);
    return this.post(userId, post.id);
  }

  async bookmark(userId: string, id: string, on: boolean) {
    const post = await this.target(id);
    if (on) await this.ctx.db.insert(vibexBookmarks).values({ postId: post.id, userId }).onConflictDoNothing();
    else await this.ctx.db.delete(vibexBookmarks).where(and(eq(vibexBookmarks.postId, post.id), eq(vibexBookmarks.userId, userId)));
    return this.post(userId, post.id);
  }

  /** "Share on my page": a repost that points at the original (one per person). */
  async repost(userId: string, id: string): Promise<VibexPostDto> {
    const original = await this.target(id);
    await this.ctx.db.insert(vibexPosts).values({ authorId: userId, kind: "repost", repostOfId: original.id }).onConflictDoNothing();
    this.feedChanged(original.id);
    const [mine] = await this.ctx.db
      .select()
      .from(vibexPosts)
      .where(and(eq(vibexPosts.authorId, userId), eq(vibexPosts.repostOfId, original.id), eq(vibexPosts.kind, "repost"), isNull(vibexPosts.deletedAt)));
    return (await this.postDtos(userId, [mine!])).get(mine!.id)!;
  }

  async unrepost(userId: string, id: string) {
    const original = await this.target(id);
    await this.ctx.db
      .update(vibexPosts)
      .set({ deletedAt: this.ctx.now() })
      .where(and(eq(vibexPosts.authorId, userId), eq(vibexPosts.repostOfId, original.id), eq(vibexPosts.kind, "repost"), isNull(vibexPosts.deletedAt)));
    this.feedChanged(original.id);
    return this.post(userId, original.id);
  }

  /** Liked or bookmarked posts, most recent first; deleted ones stay as "unavailable". */
  async history(userId: string, kind: "liked" | "bookmarks", cursor?: string, limit = 30): Promise<VibexPage<VibexHistoryItemDto>> {
    const table = kind === "liked" ? vibexLikes : vibexBookmarks;
    const c = decodeCursor(cursor);
    const rows = await this.ctx.db
      .select({ postId: table.postId, at: table.createdAt })
      .from(table)
      .where(and(eq(table.userId, userId), c ? or(lt(table.createdAt, c.at), and(eq(table.createdAt, c.at), lt(table.postId, c.id))) : undefined))
      .orderBy(desc(table.createdAt), desc(table.postId))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const posts = items.length ? await this.ctx.db.select().from(vibexPosts).where(inArray(vibexPosts.id, items.map((r) => r.postId))) : [];
    const dtos = await this.postDtos(userId, posts.filter((p) => !p.deletedAt));
    return {
      items: items.map((r) => ({ postId: r.postId, at: r.at.toISOString(), post: dtos.get(r.postId) ?? null })),
      next: more ? encodeCursor(items.at(-1)!.at, items.at(-1)!.postId) : null,
    };
  }

  // ------------------------------------------------------------------- chats

  private async membership(userId: string, conversationId: string, db: Db | Tx = this.ctx.db) {
    const [m] = await db
      .select()
      .from(vibexMembers)
      .where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
    if (!m) throw notFound("Chat");
    return m;
  }

  /** The direct chat with someone, created on first use. */
  async openDirect(userId: string, otherId: string): Promise<VibexChatDto> {
    if (otherId === userId) throw fail(ErrorCode.ValidationFailed, "You can't chat with yourself.");
    const [other] = await this.ctx.db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, otherId));
    if (!other || other.status !== "active" || !(await this.isActivated(otherId))) throw notFound("User");
    const directKey = [userId, otherId].sort().join(":");
    const id = await this.ctx.db.transaction(async (tx) => {
      await tx.insert(vibexConversations).values({ kind: "direct", directKey }).onConflictDoNothing();
      const [conv] = await tx.select().from(vibexConversations).where(eq(vibexConversations.directKey, directKey));
      await tx
        .insert(vibexMembers)
        .values([
          { conversationId: conv!.id, userId },
          { conversationId: conv!.id, userId: otherId },
        ])
        .onConflictDoNothing();
      return conv!.id;
    });
    return this.chat(userId, id);
  }

  async chat(userId: string, conversationId: string): Promise<VibexChatDto> {
    await this.membership(userId, conversationId);
    const [c] = await this.chatDtos(userId, [conversationId]);
    if (!c) throw notFound("Chat");
    return c;
  }

  /** My chats: pinned first (my order), then by last activity. Empty chats are listed only once pinned. */
  async chats(userId: string): Promise<VibexChatDto[]> {
    const mine = await this.ctx.db.select({ id: vibexMembers.conversationId }).from(vibexMembers).where(eq(vibexMembers.userId, userId));
    const list = await this.chatDtos(userId, mine.map((m) => m.id));
    return list
      .filter((c) => c.lastMessage || c.pinnedPosition !== null)
      .sort((a, b) => {
        if (a.pinnedPosition !== null || b.pinnedPosition !== null) {
          if (a.pinnedPosition === null) return 1;
          if (b.pinnedPosition === null) return -1;
          return a.pinnedPosition - b.pinnedPosition;
        }
        return b.lastMessageAt.localeCompare(a.lastMessageAt);
      });
  }

  private async chatDtos(userId: string, ids: string[]): Promise<VibexChatDto[]> {
    if (!ids.length) return [];
    const [convs, members, lastIds] = await Promise.all([
      this.ctx.db.select().from(vibexConversations).where(inArray(vibexConversations.id, ids)),
      this.ctx.db.select().from(vibexMembers).where(inArray(vibexMembers.conversationId, ids)),
      this.ctx.db.execute<{ id: string }>(
        sql`SELECT DISTINCT ON (conversation_id) id FROM vibex_messages WHERE conversation_id IN (${sql.join(
          ids.map((i) => sql`${i}::uuid`),
          sql`, `,
        )}) ORDER BY conversation_id, created_at DESC, id DESC`,
      ),
    ]);
    const lastRows = lastIds.rows.length ? await this.ctx.db.select().from(vibexMessages).where(inArray(vibexMessages.id, lastIds.rows.map((r) => r.id))) : [];
    const lastDtos = await this.messageDtos(userId, lastRows);
    const lastByConv = new Map(lastRows.map((m) => [m.conversationId, lastDtos.get(m.id)!]));
    const mineByConv = new Map(members.filter((m) => m.userId === userId).map((m) => [m.conversationId, m]));
    const peerByConv = new Map(members.filter((m) => m.userId !== userId).map((m) => [m.conversationId, m]));
    const people = await this.persons([...peerByConv.values()].map((m) => m.userId));
    // Unread: messages from others after my read marker.
    const unread = await this.ctx.db
      .select({ id: vibexMessages.conversationId, n: sql<number>`count(*)::int` })
      .from(vibexMessages)
      .innerJoin(vibexMembers, and(eq(vibexMembers.conversationId, vibexMessages.conversationId), eq(vibexMembers.userId, userId)))
      .where(
        and(
          inArray(vibexMessages.conversationId, ids),
          ne(vibexMessages.senderId, userId),
          or(isNull(vibexMembers.lastReadAt), gt(vibexMessages.createdAt, vibexMembers.lastReadAt)),
        ),
      )
      .groupBy(vibexMessages.conversationId);
    const unreadBy = new Map(unread.map((u) => [u.id, u.n]));
    const out: VibexChatDto[] = [];
    for (const c of convs) {
      const peer = peerByConv.get(c.id);
      const me = mineByConv.get(c.id);
      if (!peer || !me || !people.get(peer.userId)) continue;
      out.push({
        id: c.id,
        kind: "direct",
        peer: people.get(peer.userId)!,
        lastMessage: lastByConv.get(c.id) ?? null,
        lastMessageAt: c.lastMessageAt.toISOString(),
        unread: unreadBy.get(c.id) ?? 0,
        pinnedPosition: me.pinnedPosition,
        peerReadAt: peer.lastReadAt?.toISOString() ?? null,
      });
    }
    return out;
  }

  private async messageDtos(viewerId: string, rows: MessageRow[]): Promise<Map<string, VibexMessageDto>> {
    const out = new Map<string, VibexMessageDto>();
    if (!rows.length) return out;
    const files = await this.filesOf("messageId", rows.map((r) => r.id));
    const sharedIds = [...new Set(rows.filter((r) => r.sharedPost && r.sharedPostId).map((r) => r.sharedPostId!))];
    const shared = sharedIds.length ? await this.ctx.db.select().from(vibexPosts).where(and(inArray(vibexPosts.id, sharedIds), isNull(vibexPosts.deletedAt))) : [];
    const posts = await this.postDtos(viewerId, shared);
    for (const r of rows) {
      out.set(r.id, {
        id: r.id,
        conversationId: r.conversationId,
        senderId: r.senderId,
        mine: r.senderId === viewerId,
        text: r.text,
        files: files.get(r.id) ?? [],
        ...(r.sharedPost ? { sharedPost: (r.sharedPostId && posts.get(r.sharedPostId)) || null } : {}),
        createdAt: r.createdAt.toISOString(),
      });
    }
    return out;
  }

  /** History of a chat, newest first (the client shows it bottom-up). */
  async messages(userId: string, conversationId: string, cursor?: string, limit = 50): Promise<VibexPage<VibexMessageDto>> {
    await this.membership(userId, conversationId);
    const c = decodeCursor(cursor);
    const rows = await this.ctx.db
      .select()
      .from(vibexMessages)
      .where(and(eq(vibexMessages.conversationId, conversationId), olderThan(vibexMessages, c)))
      .orderBy(desc(vibexMessages.createdAt), desc(vibexMessages.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const dtos = await this.messageDtos(userId, items);
    return { items: items.map((r) => dtos.get(r.id)!), next: more ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id) : null };
  }

  async send(userId: string, conversationId: string, input: { text: string; fileIds: string[]; sharedPostId?: string }): Promise<VibexMessageDto> {
    const now = this.ctx.now();
    const row = await this.ctx.db.transaction(async (tx) => {
      await this.membership(userId, conversationId, tx);
      const [m] = await tx
        .insert(vibexMessages)
        .values({ conversationId, senderId: userId, text: input.text.trim(), sharedPostId: input.sharedPostId ?? null, sharedPost: !!input.sharedPostId, createdAt: now })
        .returning();
      await this.claimFiles(tx, userId, "message", input.fileIds, { messageId: m!.id });
      await tx.update(vibexConversations).set({ lastMessageAt: now }).where(eq(vibexConversations.id, conversationId));
      // Sending reads the chat up to here.
      await tx
        .update(vibexMembers)
        .set({ lastReadAt: now })
        .where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
      return m!;
    });
    const dto = (await this.messageDtos(userId, [row])).get(row.id)!;
    const sender = await this.person(userId);
    const snippet = row.text.slice(0, 140);
    const members = await this.ctx.db.select({ userId: vibexMembers.userId }).from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId));
    for (const m of members) {
      this.ctx.events.toUser(m.userId, { type: "vibex.message", conversationId, messageId: row.id, senderId: userId, senderName: sender.name, snippet });
    }
    return dto;
  }

  /** Marks the chat read up to now; the other person gets read receipts. */
  async read(userId: string, conversationId: string) {
    await this.membership(userId, conversationId);
    await this.ctx.db
      .update(vibexMembers)
      .set({ lastReadAt: this.ctx.now() })
      .where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
    const members = await this.ctx.db.select({ userId: vibexMembers.userId }).from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId));
    for (const m of members) this.ctx.events.toUser(m.userId, { type: "vibex.chats", conversationId });
    return { ok: true };
  }

  /** My pinned chats, in order (everything else becomes unpinned). */
  async setPins(userId: string, conversationIds: string[]) {
    const ids = [...new Set(conversationIds)];
    await this.ctx.db.transaction(async (tx) => {
      if (ids.length) {
        const mine = await tx
          .select({ id: vibexMembers.conversationId })
          .from(vibexMembers)
          .where(and(eq(vibexMembers.userId, userId), inArray(vibexMembers.conversationId, ids)));
        if (mine.length !== ids.length) throw notFound("Chat");
      }
      await tx.update(vibexMembers).set({ pinnedPosition: null }).where(and(eq(vibexMembers.userId, userId), isNotNull(vibexMembers.pinnedPosition)));
      for (const [i, id] of ids.entries()) {
        await tx
          .update(vibexMembers)
          .set({ pinnedPosition: i })
          .where(and(eq(vibexMembers.userId, userId), eq(vibexMembers.conversationId, id)));
      }
    });
    this.ctx.events.toUser(userId, { type: "vibex.chats" });
    return this.chats(userId);
  }

  /** "Share → send in a message" to one or more people (their direct chats). */
  async share(userId: string, postId: string, input: { userIds: string[]; text: string }) {
    const post = await this.target(postId);
    const conversations: string[] = [];
    for (const other of [...new Set(input.userIds)]) {
      const chat = await this.openDirect(userId, other);
      await this.send(userId, chat.id, { text: input.text, fileIds: [], sharedPostId: post.id });
      conversations.push(chat.id);
    }
    return { conversationIds: conversations };
  }
}
