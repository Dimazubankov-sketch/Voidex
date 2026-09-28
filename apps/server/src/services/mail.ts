import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import {
  ErrorCode,
  makeSnippet,
  parseAddress,
  subjectWithPrefix,
  type DraftCreateInput,
  type DraftDto,
  type DraftInput,
  type MailAddressDto,
  type MailFolder,
  type MailMessageDto,
  type MailSummaryDto,
  type MailView,
  type Paginated,
  type RecipientKind,
  type ThreadDetailDto,
  type ThreadSummaryDto,
} from "@voidex/shared";
import type { Tx } from "../db/client.js";
import { mailAccounts, mailEntries, mailMessages, mailRecipients, mailThreads, users } from "../db/schema.js";
import { fail, notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";

type Account = typeof mailAccounts.$inferSelect & { displayName: string };
type Message = typeof mailMessages.$inferSelect;
type Entry = typeof mailEntries.$inferSelect;
type Recipient = typeof mailRecipients.$inferSelect;

export type ThreadAction = "archive" | "trash" | "restore" | "delete_forever" | "read" | "unread" | "star" | "unstar" | "inbox";

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function encodeCursor(at: Date, id: string) {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const d = at ? new Date(at) : null;
  if (!d || Number.isNaN(d.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return { at: d, id };
}

/**
 * Internal VOIDEX Mail.
 *
 * Security model: a message's content is stored once, but a user can reach it
 * only through a `mail_entries` row owned by their mail account. Every read and
 * every mutation below is scoped by the caller's account id, which comes from
 * the authenticated session — so guessing a thread or message id reveals
 * nothing and changes nothing.
 */
export class MailService {
  constructor(private readonly ctx: Ctx) {}

  // ---------------------------------------------------------------- accounts

  async accountFor(userId: string, tx: Tx = this.ctx.db): Promise<Account> {
    const [row] = await tx
      .select({ acc: mailAccounts, first: users.firstName, last: users.lastName })
      .from(mailAccounts)
      .innerJoin(users, eq(users.id, mailAccounts.userId))
      .where(and(eq(mailAccounts.userId, userId), eq(mailAccounts.isPrimary, true)));
    if (!row) throw notFound("Mail account");
    return { ...row.acc, displayName: `${row.first} ${row.last}`.trim() };
  }

  /** Looks up internal recipients; external domains are rejected (no external transport yet). */
  private async resolve(tx: Tx, addresses: { kind: RecipientKind; address: string }[]) {
    const domain = this.ctx.config.mailDomain;
    const parsed = addresses.map((a) => ({ ...a, parts: parseAddress(a.address, domain) }));
    const invalid = parsed.filter((p) => !p.parts).map((p) => p.address);
    if (invalid.length) {
      throw fail(ErrorCode.RecipientNotFound, `Invalid address: ${invalid.join(", ")}`, { details: { addresses: invalid } });
    }
    const external = parsed.filter((p) => p.parts!.domain !== domain).map((p) => p.address);
    if (external.length) {
      throw fail(ErrorCode.RecipientExternal, `VOIDEX Mail can only deliver to @${domain} addresses for now.`, {
        details: { addresses: external },
      });
    }
    const locals = [...new Set(parsed.map((p) => p.parts!.local))];
    const found = locals.length
      ? await tx
          .select({ acc: mailAccounts, first: users.firstName, last: users.lastName })
          .from(mailAccounts)
          .innerJoin(users, eq(users.id, mailAccounts.userId))
          .where(and(eq(mailAccounts.domain, domain), inArray(mailAccounts.localPart, locals), eq(users.status, "active")))
      : [];
    const byLocal = new Map(found.map((f) => [f.acc.localPart, { ...f.acc, displayName: `${f.first} ${f.last}` }]));
    const missing = parsed.filter((p) => !byLocal.has(p.parts!.local)).map((p) => p.address);
    if (missing.length) {
      throw fail(ErrorCode.RecipientNotFound, `No VOIDEX user with address ${missing.join(", ")}.`, {
        details: { addresses: missing },
      });
    }
    // Deduplicate: an address listed twice keeps its most visible kind (to > cc > bcc).
    const rank: Record<RecipientKind, number> = { to: 0, cc: 1, bcc: 2 };
    const out = new Map<string, { kind: RecipientKind; account: Account }>();
    for (const p of parsed) {
      const account = byLocal.get(p.parts!.local)!;
      const prev = out.get(account.id);
      if (!prev || rank[p.kind] < rank[prev.kind]) out.set(account.id, { kind: p.kind, account });
    }
    return [...out.values()];
  }

  async resolveAddress(address: string) {
    const domain = this.ctx.config.mailDomain;
    const parts = parseAddress(address, domain);
    if (!parts) return { address, exists: false, internal: false, name: null };
    if (parts.domain !== domain) return { address: `${parts.local}@${parts.domain}`, exists: false, internal: false, name: null };
    const [row] = await this.ctx.db
      .select({ first: users.firstName, last: users.lastName, address: mailAccounts.address })
      .from(mailAccounts)
      .innerJoin(users, eq(users.id, mailAccounts.userId))
      .where(and(eq(mailAccounts.domain, domain), eq(mailAccounts.localPart, parts.local), eq(users.status, "active")));
    return {
      address: `${parts.local}@${domain}`,
      exists: !!row,
      internal: true,
      name: row ? `${row.first} ${row.last}` : null,
    };
  }

  /** People this account has exchanged mail with — for recipient autocomplete. */
  async contacts(userId: string, q: string): Promise<MailAddressDto[]> {
    const acc = await this.accountFor(userId);
    const like = `${escapeLike(q.trim().toLowerCase())}%`;
    const rows = await this.ctx.db.execute<{ address: string; name: string | null; last: Date }>(sql`
      select address, max(name) as name, max(at) as last from (
        select m.sender_address as address, m.sender_name as name, e.sort_at as at
          from ${mailEntries} e join ${mailMessages} m on m.id = e.message_id
          where e.account_id = ${acc.id} and e.deleted_at is null and m.status = 'sent'
        union all
        select r.address, r.name, e.sort_at
          from ${mailEntries} e join ${mailRecipients} r on r.message_id = e.message_id
          join ${mailMessages} m on m.id = e.message_id
          where e.account_id = ${acc.id} and e.role = 'sender' and m.status = 'sent'
      ) x
      where address <> ${acc.address} and (lower(address) like ${like} or lower(coalesce(name, '')) like ${like}
        or lower(coalesce(name, '')) like ${"% " + like})
      group by address order by last desc limit 8`);
    return rows.rows.map((r) => ({ address: r.address, name: r.name }));
  }

  // ---------------------------------------------------------------- summary

  async summary(userId: string): Promise<MailSummaryDto> {
    const acc = await this.accountFor(userId);
    const rows = await this.ctx.db.execute<{ folder: string; unread_threads: number; total: number; starred_unread: number }>(sql`
      select folder,
        count(distinct thread_id) filter (where not is_read)::int as unread_threads,
        count(*)::int as total,
        count(distinct thread_id) filter (where not is_read and is_starred)::int as starred_unread
      from ${mailEntries}
      where account_id = ${acc.id} and deleted_at is null
      group by folder`);
    const by = new Map(rows.rows.map((r) => [r.folder, r]));
    const starredUnread = rows.rows.filter((r) => r.folder !== "trash").reduce((n, r) => n + r.starred_unread, 0);
    return {
      address: acc.address,
      displayName: acc.displayName,
      unread: {
        inbox: by.get("inbox")?.unread_threads ?? 0,
        archive: by.get("archive")?.unread_threads ?? 0,
        starred: starredUnread,
      },
      totals: { drafts: by.get("drafts")?.total ?? 0, trash: by.get("trash")?.total ?? 0 },
    };
  }

  // ---------------------------------------------------------------- listing

  private viewFilter(view: MailView): SQL {
    if (view === "starred") return and(eq(mailEntries.isStarred, true), ne(mailEntries.folder, "trash"), ne(mailEntries.folder, "drafts"))!;
    return eq(mailEntries.folder, view);
  }

  private searchFilter(q: string | undefined): SQL | undefined {
    const term = q?.trim();
    if (!term) return undefined;
    const like = `%${escapeLike(term)}%`;
    return sql`${mailEntries.messageId} in (
      select m.id from ${mailMessages} m where m.subject ilike ${like} or m.body ilike ${like}
        or m.sender_address ilike ${like} or m.sender_name ilike ${like}
        or exists (select 1 from ${mailRecipients} r where r.message_id = m.id and (r.address ilike ${like} or r.name ilike ${like})))`;
  }

  async list(userId: string, query: { view: MailView; q?: string; cursor?: string; limit: number }): Promise<Paginated<ThreadSummaryDto>> {
    const acc = await this.accountFor(userId);
    if (query.view === "drafts") return this.listDrafts(acc, query);

    const cursor = decodeCursor(query.cursor);
    const where = and(eq(mailEntries.accountId, acc.id), isNull(mailEntries.deletedAt), this.viewFilter(query.view), this.searchFilter(query.q));
    const lastAt = sql<Date>`max(${mailEntries.sortAt})`;
    const groups = await this.ctx.db
      .select({
        threadId: mailEntries.threadId,
        lastAt,
        unread: sql<boolean>`bool_or(not ${mailEntries.isRead})`,
        starred: sql<boolean>`bool_or(${mailEntries.isStarred})`,
      })
      .from(mailEntries)
      .where(where)
      .groupBy(mailEntries.threadId)
      .having(cursor ? sql`(max(${mailEntries.sortAt}), ${mailEntries.threadId}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)` : undefined)
      .orderBy(desc(lastAt), desc(mailEntries.threadId))
      .limit(query.limit + 1);

    const page = groups.slice(0, query.limit).filter((g) => g.threadId);
    const threadIds = page.map((g) => g.threadId!);
    if (!threadIds.length) return { items: [], nextCursor: null };

    // All of this account's visible messages in these threads.
    const visible = await this.ctx.db
      .select({ e: mailEntries, m: mailMessages, t: mailThreads })
      .from(mailEntries)
      .innerJoin(mailMessages, eq(mailMessages.id, mailEntries.messageId))
      .innerJoin(mailThreads, eq(mailThreads.id, mailEntries.threadId))
      .where(
        and(
          eq(mailEntries.accountId, acc.id),
          isNull(mailEntries.deletedAt),
          inArray(mailEntries.threadId, threadIds),
          query.view === "trash" ? eq(mailEntries.folder, "trash") : ne(mailEntries.folder, "trash"),
        ),
      )
      .orderBy(asc(mailEntries.sortAt));

    const recipients = await this.recipientsOf(visible.map((v) => v.m.id));

    const items: ThreadSummaryDto[] = page.map((g) => {
      const rows = visible.filter((v) => v.e.threadId === g.threadId);
      const sentRows = rows.filter((r) => r.m.status === "sent");
      const inView = sentRows.filter((r) => (query.view === "starred" ? r.e.isStarred : r.e.folder === query.view));
      const latest = (inView.length ? inView : sentRows).at(-1) ?? rows.at(-1)!;
      const participants = new Map<string, MailAddressDto>();
      if (query.view === "sent") {
        for (const r of sentRows.filter((x) => x.e.role === "sender")) {
          for (const rc of recipients.get(r.m.id) ?? []) participants.set(rc.address, { address: rc.address, name: rc.name });
        }
      } else {
        for (const r of sentRows) {
          participants.set(r.m.senderAddress, {
            address: r.m.senderAddress,
            name: r.m.senderAccountId === acc.id ? null : r.m.senderName,
          });
        }
      }
      return {
        id: g.threadId!,
        subject: latest?.t.subject ?? "",
        snippet: latest?.m.snippet ?? "",
        participants: [...participants.values()],
        messageCount: sentRows.length,
        unread: !!g.unread,
        starred: !!g.starred,
        lastMessageAt: new Date(g.lastAt).toISOString(),
        hasDraft: rows.some((r) => r.m.status === "draft"),
      };
    });

    const last = groups[query.limit - 1];
    const nextCursor = groups.length > query.limit && last?.threadId ? encodeCursor(new Date(last.lastAt), last.threadId) : null;
    return { items, nextCursor };
  }

  private async listDrafts(acc: Account, query: { q?: string; cursor?: string; limit: number }): Promise<Paginated<ThreadSummaryDto>> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.ctx.db
      .select({ e: mailEntries, m: mailMessages })
      .from(mailEntries)
      .innerJoin(mailMessages, eq(mailMessages.id, mailEntries.messageId))
      .where(
        and(
          eq(mailEntries.accountId, acc.id),
          eq(mailEntries.folder, "drafts"),
          isNull(mailEntries.deletedAt),
          this.searchFilter(query.q),
          cursor ? sql`(${mailEntries.sortAt}, ${mailEntries.messageId}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(mailEntries.sortAt), desc(mailEntries.messageId))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const recipients = await this.recipientsOf(page.map((r) => r.m.id));
    const items = page.map(({ e, m }) => ({
      id: m.threadId ?? m.id,
      draftId: m.id,
      subject: m.subject,
      snippet: m.snippet,
      participants: (recipients.get(m.id) ?? []).map((r) => ({ address: r.address, name: r.name })),
      messageCount: 1,
      unread: false,
      starred: e.isStarred,
      lastMessageAt: e.sortAt.toISOString(),
      hasDraft: true,
    }));
    const last = page.at(-1);
    return { items, nextCursor: rows.length > query.limit && last ? encodeCursor(last.e.sortAt, last.m.id) : null };
  }

  private async recipientsOf(messageIds: string[]) {
    const map = new Map<string, Recipient[]>();
    if (!messageIds.length) return map;
    const rows = await this.ctx.db
      .select()
      .from(mailRecipients)
      .where(inArray(mailRecipients.messageId, [...new Set(messageIds)]))
      .orderBy(asc(mailRecipients.position));
    for (const r of rows) {
      const list = map.get(r.messageId) ?? [];
      list.push(r);
      map.set(r.messageId, list);
    }
    return map;
  }

  // ---------------------------------------------------------------- reading

  private toMessageDto(acc: Account, e: Entry, m: Message, recipients: Recipient[]): MailMessageDto {
    const own = m.senderAccountId === acc.id;
    // Bcc is visible only to the sender; a bcc'd recipient sees only To/Cc.
    const visibleRecipients = own ? recipients : recipients.filter((r) => r.kind !== "bcc");
    return {
      id: m.id,
      threadId: m.threadId ?? m.id,
      from: { address: m.senderAddress, name: m.senderName },
      recipients: visibleRecipients.map((r) => ({ kind: r.kind, address: r.address, name: r.name })),
      subject: m.subject,
      body: m.body,
      status: m.status,
      folder: e.folder,
      read: e.isRead,
      starred: e.isStarred,
      sentAt: m.sentAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      inReplyToId: m.inReplyToId,
      forwardOfId: m.forwardOfId,
      isOwn: own,
    };
  }

  async thread(userId: string, threadId: string, view: MailView): Promise<ThreadDetailDto> {
    const acc = await this.accountFor(userId);
    const rows = await this.ctx.db
      .select({ e: mailEntries, m: mailMessages, t: mailThreads })
      .from(mailEntries)
      .innerJoin(mailMessages, eq(mailMessages.id, mailEntries.messageId))
      .innerJoin(mailThreads, eq(mailThreads.id, mailEntries.threadId))
      .where(
        and(
          eq(mailEntries.accountId, acc.id),
          eq(mailEntries.threadId, threadId),
          isNull(mailEntries.deletedAt),
          view === "trash" ? eq(mailEntries.folder, "trash") : ne(mailEntries.folder, "trash"),
        ),
      )
      .orderBy(asc(mailEntries.sortAt));
    if (!rows.length) throw notFound("Conversation");
    const recipients = await this.recipientsOf(rows.map((r) => r.m.id));
    return {
      id: threadId,
      subject: rows[0]!.t.subject,
      messages: rows.map((r) => this.toMessageDto(acc, r.e, r.m, recipients.get(r.m.id) ?? [])),
    };
  }

  // ---------------------------------------------------------------- mutations

  async threadAction(userId: string, threadIds: string[], action: ThreadAction) {
    const acc = await this.accountFor(userId);
    const now = this.ctx.now();
    const scope = and(
      eq(mailEntries.accountId, acc.id),
      inArray(mailEntries.threadId, threadIds),
      isNull(mailEntries.deletedAt),
      ne(mailEntries.folder, "drafts"),
    );
    const restoreFolder = sql`case when ${mailEntries.role} = 'sender' then 'sent' else 'inbox' end`;
    const db = this.ctx.db;
    let changed = 0;
    switch (action) {
      case "archive":
        changed = (await db.update(mailEntries).set({ folder: "archive" }).where(and(scope, eq(mailEntries.folder, "inbox"))).returning({ id: mailEntries.id })).length;
        break;
      case "inbox":
        changed = (await db.update(mailEntries).set({ folder: restoreFolder as unknown as MailFolder }).where(and(scope, eq(mailEntries.folder, "archive"))).returning({ id: mailEntries.id })).length;
        break;
      case "trash":
        changed = (await db.update(mailEntries).set({ folder: "trash" }).where(and(scope, ne(mailEntries.folder, "trash"))).returning({ id: mailEntries.id })).length;
        break;
      case "restore":
        changed = (await db.update(mailEntries).set({ folder: restoreFolder as unknown as MailFolder }).where(and(scope, eq(mailEntries.folder, "trash"))).returning({ id: mailEntries.id })).length;
        break;
      case "delete_forever":
        changed = (await db.update(mailEntries).set({ deletedAt: now }).where(and(scope, eq(mailEntries.folder, "trash"))).returning({ id: mailEntries.id })).length;
        break;
      case "read":
      case "unread":
        changed = (await db.update(mailEntries).set({ isRead: action === "read" }).where(scope).returning({ id: mailEntries.id })).length;
        break;
      case "unstar":
        changed = (await db.update(mailEntries).set({ isStarred: false }).where(scope).returning({ id: mailEntries.id })).length;
        break;
      case "star": {
        // Starring a conversation stars its latest message.
        const latest = await db
          .selectDistinctOn([mailEntries.threadId], { id: mailEntries.id })
          .from(mailEntries)
          .where(and(scope, ne(mailEntries.folder, "trash")))
          .orderBy(mailEntries.threadId, desc(mailEntries.sortAt));
        if (latest.length) {
          changed = (await db.update(mailEntries).set({ isStarred: true }).where(inArray(mailEntries.id, latest.map((l) => l.id))).returning({ id: mailEntries.id })).length;
        }
        break;
      }
    }
    if (changed) this.ctx.events.toUser(userId, { type: "mail.changed", threadIds });
    return { changed };
  }

  async flagMessage(userId: string, messageId: string, flags: { read?: boolean; starred?: boolean }) {
    const acc = await this.accountFor(userId);
    const patch: Partial<Entry> = {};
    if (flags.read !== undefined) patch.isRead = flags.read;
    if (flags.starred !== undefined) patch.isStarred = flags.starred;
    if (!Object.keys(patch).length) return { ok: true };
    const [row] = await this.ctx.db
      .update(mailEntries)
      .set(patch)
      .where(and(eq(mailEntries.accountId, acc.id), eq(mailEntries.messageId, messageId), isNull(mailEntries.deletedAt)))
      .returning({ threadId: mailEntries.threadId });
    if (!row) throw notFound("Message");
    this.ctx.events.toUser(userId, { type: "mail.changed", threadIds: row.threadId ? [row.threadId] : [] });
    return { ok: true };
  }

  // ---------------------------------------------------------------- drafts

  private async ownDraft(tx: Tx, acc: Account, draftId: string, lock = false) {
    const q = tx
      .select()
      .from(mailMessages)
      .where(and(eq(mailMessages.id, draftId), eq(mailMessages.senderAccountId, acc.id)));
    const [m] = lock ? await q.for("update") : await q;
    if (!m) throw notFound("Draft");
    if (m.status !== "draft") throw fail(ErrorCode.DraftAlreadySent, "This message has already been sent.");
    return m;
  }

  private async writeRecipients(tx: Tx, messageId: string, input: Pick<DraftInput, "to" | "cc" | "bcc">) {
    await tx.delete(mailRecipients).where(eq(mailRecipients.messageId, messageId));
    const domain = this.ctx.config.mailDomain;
    const rows: (typeof mailRecipients.$inferInsert)[] = [];
    let position = 0;
    for (const kind of ["to", "cc", "bcc"] as const) {
      for (const raw of input[kind]) {
        const parts = parseAddress(raw, domain);
        const address = parts ? `${parts.local}@${parts.domain}` : raw.trim().toLowerCase();
        rows.push({ messageId, kind, address, position: position++ });
      }
    }
    if (rows.length) await tx.insert(mailRecipients).values(rows);
  }

  private async draftDto(tx: Tx, m: Message): Promise<DraftDto> {
    const recips = await tx.select().from(mailRecipients).where(eq(mailRecipients.messageId, m.id)).orderBy(asc(mailRecipients.position));
    const of = (k: RecipientKind) => recips.filter((r) => r.kind === k).map((r) => r.address);
    return {
      id: m.id,
      threadId: m.threadId,
      to: of("to"),
      cc: of("cc"),
      bcc: of("bcc"),
      subject: m.subject,
      body: m.body,
      replyToMessageId: m.inReplyToId,
      forwardOfMessageId: m.forwardOfId,
      updatedAt: m.updatedAt.toISOString(),
    };
  }

  /** Entry of this account for a message it can see (ownership check for reply/forward). */
  private async visibleMessage(tx: Tx, acc: Account, messageId: string) {
    const [row] = await tx
      .select({ m: mailMessages })
      .from(mailEntries)
      .innerJoin(mailMessages, eq(mailMessages.id, mailEntries.messageId))
      .where(and(eq(mailEntries.accountId, acc.id), eq(mailEntries.messageId, messageId), isNull(mailEntries.deletedAt), eq(mailMessages.status, "sent")));
    if (!row) throw notFound("Message");
    return row.m;
  }

  async createDraft(userId: string, input: DraftCreateInput): Promise<DraftDto> {
    const acc = await this.accountFor(userId);
    const now = this.ctx.now();
    return this.ctx.db.transaction(async (tx) => {
      let threadId: string | null = null;
      let inReplyToId: string | null = null;
      let forwardOfId: string | null = null;
      if (input.replyToMessageId) {
        const parent = await this.visibleMessage(tx, acc, input.replyToMessageId);
        threadId = parent.threadId;
        inReplyToId = parent.id;
      } else if (input.forwardOfMessageId) {
        forwardOfId = (await this.visibleMessage(tx, acc, input.forwardOfMessageId)).id;
      }
      const [m] = await tx
        .insert(mailMessages)
        .values({
          threadId,
          senderAccountId: acc.id,
          senderAddress: acc.address,
          senderName: acc.displayName,
          subject: input.subject,
          body: input.body,
          snippet: makeSnippet(input.body),
          status: "draft",
          inReplyToId,
          forwardOfId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.writeRecipients(tx, m!.id, input);
      await tx.insert(mailEntries).values({
        accountId: acc.id,
        messageId: m!.id,
        threadId,
        role: "sender",
        folder: "drafts",
        isRead: true,
        sortAt: now,
      });
      this.ctx.events.toUser(userId, { type: "mail.changed" });
      return this.draftDto(tx, m!);
    });
  }

  async getDraft(userId: string, draftId: string) {
    const acc = await this.accountFor(userId);
    return this.draftDto(this.ctx.db, await this.ownDraft(this.ctx.db, acc, draftId));
  }

  /** Autosave target: replaces the draft's content and recipients. */
  async updateDraft(userId: string, draftId: string, input: DraftInput): Promise<DraftDto> {
    const acc = await this.accountFor(userId);
    const now = this.ctx.now();
    return this.ctx.db.transaction(async (tx) => {
      await this.ownDraft(tx, acc, draftId, true);
      const [m] = await tx
        .update(mailMessages)
        .set({ subject: input.subject, body: input.body, snippet: makeSnippet(input.body), updatedAt: now })
        .where(eq(mailMessages.id, draftId))
        .returning();
      await this.writeRecipients(tx, draftId, input);
      await tx.update(mailEntries).set({ sortAt: now }).where(and(eq(mailEntries.messageId, draftId), eq(mailEntries.accountId, acc.id)));
      this.ctx.events.toUser(userId, { type: "mail.changed" });
      return this.draftDto(tx, m!);
    });
  }

  async deleteDraft(userId: string, draftId: string) {
    const acc = await this.accountFor(userId);
    await this.ctx.db.transaction(async (tx) => {
      await this.ownDraft(tx, acc, draftId, true);
      await tx.delete(mailMessages).where(eq(mailMessages.id, draftId));
    });
    this.ctx.events.toUser(userId, { type: "mail.changed" });
    return { ok: true };
  }

  /** Delivers a draft to every internal recipient atomically. */
  async sendDraft(userId: string, draftId: string) {
    const acc = await this.accountFor(userId);
    const now = this.ctx.now();
    const result = await this.ctx.db.transaction(async (tx) => {
      const draft = await this.ownDraft(tx, acc, draftId, true);
      const recips = await tx.select().from(mailRecipients).where(eq(mailRecipients.messageId, draft.id)).orderBy(asc(mailRecipients.position));
      if (!recips.length) throw fail(ErrorCode.NoRecipients, "Add at least one recipient.");
      const resolved = await this.resolve(tx, recips.map((r) => ({ kind: r.kind, address: r.address })));

      // Store canonical recipients with resolved accounts and display names.
      await tx.delete(mailRecipients).where(eq(mailRecipients.messageId, draft.id));
      await tx.insert(mailRecipients).values(
        resolved.map((r, i) => ({
          messageId: draft.id,
          kind: r.kind,
          address: r.account.address,
          name: r.account.displayName,
          accountId: r.account.id,
          position: i,
        })),
      );

      let threadId = draft.threadId;
      const subject = draft.subject.trim();
      if (threadId) {
        await tx.update(mailThreads).set({ lastMessageAt: now }).where(eq(mailThreads.id, threadId));
      } else {
        const [t] = await tx.insert(mailThreads).values({ subject, createdAt: now, lastMessageAt: now }).returning();
        threadId = t!.id;
      }
      await tx
        .update(mailMessages)
        .set({ status: "sent", sentAt: now, updatedAt: now, threadId, subject, senderName: acc.displayName })
        .where(eq(mailMessages.id, draft.id));

      const selfSend = resolved.some((r) => r.account.id === acc.id);
      await tx
        .update(mailEntries)
        .set({ folder: selfSend ? "inbox" : "sent", isRead: !selfSend, sortAt: now, threadId })
        .where(and(eq(mailEntries.messageId, draft.id), eq(mailEntries.accountId, acc.id)));

      const others = resolved.filter((r) => r.account.id !== acc.id);
      if (others.length) {
        await tx.insert(mailEntries).values(
          others.map((r) => ({
            accountId: r.account.id,
            messageId: draft.id,
            threadId,
            role: "recipient" as const,
            folder: "inbox" as const,
            isRead: false,
            sortAt: now,
          })),
        );
      }
      return { threadId: threadId!, recipientUserIds: others.map((r) => r.account.userId), snippet: draft.snippet, subject };
    });

    this.ctx.events.toUser(userId, { type: "mail.changed", threadIds: [result.threadId] });
    for (const uid of new Set(result.recipientUserIds)) {
      this.ctx.events.toUser(uid, {
        type: "mail.received",
        threadId: result.threadId,
        messageId: draftId,
        from: { address: acc.address, name: acc.displayName },
        subject: result.subject,
        snippet: result.snippet,
      });
    }
    return { messageId: draftId, threadId: result.threadId };
  }

  /** Convenience: create + send in one call (used by API clients without autosave). */
  async send(userId: string, input: DraftCreateInput) {
    const draft = await this.createDraft(userId, input);
    try {
      return await this.sendDraft(userId, draft.id);
    } catch (err) {
      // Keep the draft so nothing the user wrote is lost.
      throw Object.assign(err as object, { draftId: draft.id });
    }
  }

  /**
   * Reply/forward defaults, computed server-side so every client behaves the
   * same. The quote header is localised to the caller's language and time zone.
   */
  async composeDefaults(
    userId: string,
    messageId: string,
    mode: "reply" | "reply_all" | "forward",
    locale: { lang: "en" | "ru"; tz?: string } = { lang: "en" },
  ) {
    const acc = await this.accountFor(userId);
    const m = await this.visibleMessage(this.ctx.db, acc, messageId);
    const recips = (await this.recipientsOf([m.id])).get(m.id) ?? [];
    const own = m.senderAccountId === acc.id;
    const visible = own ? recips : recips.filter((r) => r.kind !== "bcc");
    let when: string;
    try {
      when = new Intl.DateTimeFormat(locale.lang, { dateStyle: "long", timeStyle: "short", timeZone: locale.tz }).format(m.sentAt ?? m.createdAt);
    } catch {
      when = new Intl.DateTimeFormat(locale.lang, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(m.sentAt ?? m.createdAt);
    }
    const L =
      locale.lang === "ru"
        ? { wrote: (w: string, who: string) => `${w}, ${who} пишет:`, fwd: "---------- Пересланное сообщение ----------", from: "От", date: "Дата", subject: "Тема", to: "Кому" }
        : { wrote: (w: string, who: string) => `On ${w}, ${who} wrote:`, fwd: "---------- Forwarded message ----------", from: "From", date: "Date", subject: "Subject", to: "To" };
    const who = `${m.senderName} <${m.senderAddress}>`;
    if (mode === "forward") {
      const header = [
        L.fwd,
        `${L.from}: ${who}`,
        `${L.date}: ${when}`,
        `${L.subject}: ${m.subject}`,
        `${L.to}: ${visible.filter((r) => r.kind === "to").map((r) => r.address).join(", ")}`,
      ].join("\n");
      return { to: [], cc: [], subject: subjectWithPrefix(m.subject, "Fwd"), body: `\n\n${header}\n\n${m.body}`, forwardOfMessageId: m.id };
    }
    const quoted = m.body
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    const to = own ? visible.filter((r) => r.kind === "to").map((r) => r.address) : [m.senderAddress];
    const cc =
      mode === "reply_all"
        ? [...new Set(visible.filter((r) => (own ? r.kind === "cc" : true)).map((r) => r.address))].filter((a) => a !== acc.address && !to.includes(a))
        : [];
    return { to, cc, subject: subjectWithPrefix(m.subject, "Re"), body: `\n\n${L.wrote(when, who)}\n${quoted}`, replyToMessageId: m.id };
  }

  async exportAll(userId: string) {
    const acc = await this.accountFor(userId);
    const rows = await this.ctx.db
      .select({ e: mailEntries, m: mailMessages })
      .from(mailEntries)
      .innerJoin(mailMessages, eq(mailMessages.id, mailEntries.messageId))
      .where(and(eq(mailEntries.accountId, acc.id), isNull(mailEntries.deletedAt)))
      .orderBy(asc(mailEntries.sortAt));
    const recips = await this.recipientsOf(rows.map((r) => r.m.id));
    return {
      address: acc.address,
      messages: rows.map((r) => this.toMessageDto(acc, r.e, r.m, recips.get(r.m.id) ?? [])),
    };
  }
}
