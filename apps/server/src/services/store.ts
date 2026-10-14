import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  APP_REGISTRY,
  ErrorCode,
  isAppId,
  toPublicAddress,
  type AppId,
  type StoreReportReason,
  type StoreReviewDto,
  type StoreReviewSort,
  type StoreReviewStatsDto,
  type StoreReviewsDto,
} from "@voidex/shared";
import { mailAccounts, storeReviewReports, storeReviewVotes, storeReviews, users } from "../db/schema.js";
import { fail, notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";

type ReviewRow = typeof storeReviews.$inferSelect;

/** Apps the Store lists: every registered, available app except the Store itself and Settings. */
export function catalogApp(id: string): AppId {
  if (!isAppId(id) || id === "store" || id === "settings" || APP_REGISTRY[id].status !== "available") throw notFound("App");
  return id;
}

/**
 * Step 2.11: Appex Store reviews. One review per person and app (editing
 * replaces it, deleting removes it with its votes and reports); likes and
 * dislikes are one vote per person; a report is kept once per person for
 * moderation and changes nothing else. The author is always the signed-in
 * account (name + public @voidops address), never what a form says.
 */
export class StoreService {
  constructor(private readonly ctx: Ctx) {}

  private async dtos(viewerId: string, rows: ReviewRow[]): Promise<StoreReviewDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [authors, votes, mine, reported] = await Promise.all([
      this.ctx.db
        .select({ id: users.id, first: users.firstName, last: users.lastName, address: mailAccounts.address })
        .from(users)
        .leftJoin(mailAccounts, and(eq(mailAccounts.userId, users.id), eq(mailAccounts.isPrimary, true)))
        .where(inArray(users.id, [...new Set(rows.map((r) => r.userId))])),
      this.ctx.db
        .select({
          id: storeReviewVotes.reviewId,
          likes: sql<number>`count(*) filter (where ${storeReviewVotes.vote} = 1)::int`,
          dislikes: sql<number>`count(*) filter (where ${storeReviewVotes.vote} = -1)::int`,
        })
        .from(storeReviewVotes)
        .where(inArray(storeReviewVotes.reviewId, ids))
        .groupBy(storeReviewVotes.reviewId),
      this.ctx.db.select().from(storeReviewVotes).where(and(inArray(storeReviewVotes.reviewId, ids), eq(storeReviewVotes.userId, viewerId))),
      this.ctx.db.select({ id: storeReviewReports.reviewId }).from(storeReviewReports).where(and(inArray(storeReviewReports.reviewId, ids), eq(storeReviewReports.reporterId, viewerId))),
    ]);
    const authorBy = new Map(authors.map((a) => [a.id, a]));
    const voteBy = new Map(votes.map((v) => [v.id, v]));
    const myVote = new Map(mine.map((v) => [v.reviewId, v.vote]));
    const reportedSet = new Set(reported.map((r) => r.id));
    return rows
      .filter((r) => authorBy.has(r.userId))
      .map((r) => {
        const a = authorBy.get(r.userId)!;
        return {
          id: r.id,
          appId: r.appId as AppId,
          // "Фамилия Имя", as the Store shows authors.
          author: { id: a.id, name: `${a.last} ${a.first}`.trim(), address: a.address ? toPublicAddress(a.address, this.ctx.config.mailDomain) : "" },
          rating: r.rating,
          title: r.title,
          text: r.text,
          createdAt: r.createdAt.toISOString(),
          editedAt: r.editedAt?.toISOString() ?? null,
          likes: voteBy.get(r.id)?.likes ?? 0,
          dislikes: voteBy.get(r.id)?.dislikes ?? 0,
          myVote: myVote.get(r.id) ?? 0,
          mine: r.userId === viewerId,
          reported: reportedSet.has(r.id),
        };
      });
  }

  async stats(appId: string): Promise<StoreReviewStatsDto> {
    const id = catalogApp(appId);
    const rows = await this.ctx.db
      .select({ rating: storeReviews.rating, n: sql<number>`count(*)::int` })
      .from(storeReviews)
      .where(eq(storeReviews.appId, id))
      .groupBy(storeReviews.rating);
    const counts: StoreReviewStatsDto["counts"] = [0, 0, 0, 0, 0];
    for (const r of rows) if (r.rating >= 1 && r.rating <= 5) counts[r.rating - 1] = r.n;
    const total = counts.reduce((a, b) => a + b, 0);
    const average = total ? Math.round((counts.reduce((a, n, i) => a + n * (i + 1), 0) / total) * 10) / 10 : 0;
    return { counts, total, average };
  }

  /** Ratings of every catalog app at once (the catalog rows). */
  async allStats(): Promise<Record<string, StoreReviewStatsDto>> {
    const rows = await this.ctx.db
      .select({ app: storeReviews.appId, rating: storeReviews.rating, n: sql<number>`count(*)::int` })
      .from(storeReviews)
      .groupBy(storeReviews.appId, storeReviews.rating);
    const out: Record<string, StoreReviewStatsDto> = {};
    for (const r of rows) {
      if (!isAppId(r.app)) continue;
      const s = (out[r.app] ??= { counts: [0, 0, 0, 0, 0], total: 0, average: 0 });
      if (r.rating >= 1 && r.rating <= 5) s.counts[r.rating - 1] = r.n;
    }
    for (const s of Object.values(out)) {
      s.total = s.counts.reduce((a, b) => a + b, 0);
      s.average = s.total ? Math.round((s.counts.reduce((a, n, i) => a + n * (i + 1), 0) / s.total) * 10) / 10 : 0;
    }
    return out;
  }

  async list(viewerId: string, appId: string, sort: StoreReviewSort = "date", limit = 100): Promise<StoreReviewsDto> {
    const id = catalogApp(appId);
    const helpful = sql`(SELECT count(*) FROM store_review_votes v WHERE v.review_id = ${storeReviews.id} AND v.vote = 1)`;
    const order =
      sort === "helpful"
        ? [desc(helpful), desc(storeReviews.createdAt)]
        : sort === "high"
          ? [desc(storeReviews.rating), desc(storeReviews.createdAt)]
          : sort === "low"
            ? [storeReviews.rating, desc(storeReviews.createdAt)]
            : [desc(storeReviews.createdAt)];
    const rows = await this.ctx.db
      .select()
      .from(storeReviews)
      .where(eq(storeReviews.appId, id))
      .orderBy(...order)
      .limit(limit);
    const [own] = await this.ctx.db.select().from(storeReviews).where(and(eq(storeReviews.appId, id), eq(storeReviews.userId, viewerId)));
    const items = await this.dtos(viewerId, rows);
    const mine = own ? ((await this.dtos(viewerId, [own]))[0] ?? null) : null;
    return { items, stats: await this.stats(id), mine };
  }

  /** Step 2.12: every review I wrote (my account page in the Store), newest first. */
  async mine(userId: string): Promise<StoreReviewDto[]> {
    const rows = await this.ctx.db.select().from(storeReviews).where(eq(storeReviews.userId, userId)).orderBy(desc(sql`coalesce(${storeReviews.editedAt}, ${storeReviews.createdAt})`));
    return this.dtos(
      userId,
      rows.filter((r) => isAppId(r.appId) && r.appId !== "store" && r.appId !== "settings" && APP_REGISTRY[r.appId].status === "available"),
    );
  }

  /** My review of an app: written the first time, replaced (edited) after that. */
  async upsert(userId: string, appId: string, input: { rating: number; title: string; text: string }): Promise<StoreReviewDto> {
    const id = catalogApp(appId);
    const now = this.ctx.now();
    const [row] = await this.ctx.db
      .insert(storeReviews)
      .values({ appId: id, userId, rating: input.rating, title: input.title, text: input.text, createdAt: now })
      .onConflictDoUpdate({ target: [storeReviews.appId, storeReviews.userId], set: { rating: input.rating, title: input.title, text: input.text, editedAt: now } })
      .returning();
    this.ctx.events.toUser(userId, { type: "store.reviews", appId: id });
    return (await this.dtos(userId, [row!]))[0]!;
  }

  async remove(userId: string, appId: string) {
    const id = catalogApp(appId);
    const gone = await this.ctx.db.delete(storeReviews).where(and(eq(storeReviews.appId, id), eq(storeReviews.userId, userId))).returning({ id: storeReviews.id });
    if (!gone.length) throw notFound("Review");
    return { ok: true };
  }

  private async review(reviewId: string, appId: string): Promise<ReviewRow> {
    const id = catalogApp(appId);
    const [r] = await this.ctx.db.select().from(storeReviews).where(and(eq(storeReviews.id, reviewId), eq(storeReviews.appId, id)));
    if (!r) throw notFound("Review");
    return r;
  }

  /** Like (1), dislike (-1) or take the vote back (0). Returns the canonical counters. */
  async vote(userId: string, appId: string, reviewId: string, vote: 1 | -1 | 0) {
    const r = await this.review(reviewId, appId);
    if (r.userId === userId) throw fail(ErrorCode.ValidationFailed, "You can't vote for your own review.");
    if (vote === 0) await this.ctx.db.delete(storeReviewVotes).where(and(eq(storeReviewVotes.reviewId, r.id), eq(storeReviewVotes.userId, userId)));
    else
      await this.ctx.db
        .insert(storeReviewVotes)
        .values({ reviewId: r.id, userId, vote })
        .onConflictDoUpdate({ target: [storeReviewVotes.reviewId, storeReviewVotes.userId], set: { vote } });
    const dto = (await this.dtos(userId, [r]))[0]!;
    return { vote: dto.myVote, likes: dto.likes, dislikes: dto.dislikes };
  }

  /** A report for moderation (once per person; a second one is accepted without a duplicate). */
  async report(userId: string, appId: string, reviewId: string, reason: StoreReportReason, description: string) {
    const r = await this.review(reviewId, appId);
    if (r.userId === userId) throw fail(ErrorCode.ValidationFailed, "You can't report your own review.");
    await this.ctx.db.insert(storeReviewReports).values({ reviewId: r.id, reporterId: userId, reason, description }).onConflictDoNothing();
    return { ok: true };
  }
}
