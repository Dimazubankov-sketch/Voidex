import { randomBytes } from "node:crypto";
import { and, arrayOverlaps, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  DEFAULT_NOTES_PREFS,
  ErrorCode,
  NOTES_DOCS_MAX,
  NOTES_DOC_MAX_BYTES,
  NOTES_MEDIA_PREFIX,
  NOTES_NAME_MAX,
  NOTES_PROJECTS_MAX,
  NOTES_SHARES_MAX,
  emptyNote,
  emptyPresentation,
  legacySnapshot,
  legacyWorkspace,
  notesExt,
  notesMediaId,
  notesMediaIds,
  notesPageCount,
  notesPreview,
  validCover,
  validNotesBody,
  type LegacyProject,
  type NotesBody,
  type NotesDocKind,
  type NotesDocMetaDto,
  type NotesDocumentDto,
  type NotesMemberDto,
  type NotesPersonDto,
  type NotesPrefsDto,
  type NotesProjectDetailDto,
  type NotesProjectDto,
  type NotesRole,
  type NotesShareDto,
  type NotesShareInfoDto,
  type NotesShareKind,
  type NotesShareMode,
  type ServerEvent,
} from "@voidex/shared";
import { mailAccounts, notesDocuments, notesMedia, notesMembers, notesPrefs, notesProjects, notesShares, notesWorkspaces, users } from "../db/schema.js";
import { fail, notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";

type ResourceType = "project" | "document";
type Grant = Exclude<NotesRole, "owner">;
type ProjectRow = typeof notesProjects.$inferSelect;
type DocRow = typeof notesDocuments.$inferSelect;
type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

const RANK: Record<NotesRole, number> = { viewer: 1, editor: 2, owner: 3 };
const best = (...roles: (NotesRole | null | undefined)[]): NotesRole | null =>
  roles.reduce<NotesRole | null>((a, r) => (r && (!a || RANK[r] > RANK[a]) ? r : a), null);
const canWrite = (r: NotesRole | null) => r === "owner" || r === "editor";

const forbidden = () => fail(ErrorCode.NotesForbidden, "You don't have access to this.", { status: 403 });
const cleanName = (s: string, fallback: string) => s.replace(/\s+/g, " ").trim().slice(0, NOTES_NAME_MAX) || fallback;
const RECEIVED = "received";

/**
 * Voidex Notes (Step 2.6). Projects hold notes and presentations; every read
 * and write is checked here against the signed-in account (never a user id
 * from the client):
 *
 * - owner: the project's creator — everything, including sharing and deleting;
 * - editor: reads and saves the original (project-wide or one document);
 * - viewer: reads only.
 *
 * Documents are saved one by one with a revision (compare-and-swap): a save
 * based on an older revision is refused (409), so co-editors never silently
 * overwrite each other. Removing someone's access takes effect on their very
 * next request and is pushed to their open devices (notes.access.revoked).
 *
 * Shares are links: "copy" hands out a snapshot the recipient can add to
 * their own Notes (independent from then on); "access" gives the recipient a
 * role on the original. The old per-account workspace JSON is converted into
 * projects and documents the first time its owner opens Notes; the JSON stays.
 */
export class NotesService {
  constructor(private readonly ctx: Ctx) {}

  // ------------------------------------------------------------------ people / events

  private async people(ids: string[]): Promise<Map<string, NotesPersonDto>> {
    const out = new Map<string, NotesPersonDto>();
    const unique = [...new Set(ids)];
    if (!unique.length) return out;
    const rows = await this.ctx.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, avatarVersion: users.avatarVersion, address: mailAccounts.address, localPart: mailAccounts.localPart })
      .from(users)
      .leftJoin(mailAccounts, and(eq(mailAccounts.userId, users.id), eq(mailAccounts.isPrimary, true)))
      .where(inArray(users.id, unique));
    for (const r of rows)
      out.set(r.id, { id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), username: r.localPart ?? "", mailAddress: r.address ?? "", avatarVersion: r.avatarVersion });
    return out;
  }

  /** Everyone who sees a document: the project owner and members of the project and of the document. */
  private async audience(projectId: string, documentId?: string): Promise<string[]> {
    const [p] = await this.ctx.db.select({ ownerId: notesProjects.ownerId }).from(notesProjects).where(eq(notesProjects.id, projectId));
    const conds = [and(eq(notesMembers.resourceType, "project"), eq(notesMembers.resourceId, projectId))];
    if (documentId) conds.push(and(eq(notesMembers.resourceType, "document"), eq(notesMembers.resourceId, documentId)));
    else {
      const docIds = (await this.ctx.db.select({ id: notesDocuments.id }).from(notesDocuments).where(eq(notesDocuments.projectId, projectId))).map((d) => d.id);
      if (docIds.length) conds.push(and(eq(notesMembers.resourceType, "document"), inArray(notesMembers.resourceId, docIds)));
    }
    const members = await this.ctx.db.select({ userId: notesMembers.userId }).from(notesMembers).where(or(...conds));
    return [...new Set([...(p ? [p.ownerId] : []), ...members.map((m) => m.userId)])];
  }

  private emit(userIds: string[], event: ServerEvent, exceptSessionId?: string) {
    for (const id of new Set(userIds)) this.ctx.events.toUser(id, event, exceptSessionId ? { exceptSessionId } : {});
  }

  // ------------------------------------------------------------------ access

  private async projectRow(projectId: string): Promise<ProjectRow> {
    const [p] = await this.ctx.db.select().from(notesProjects).where(eq(notesProjects.id, projectId));
    if (!p) throw notFound("Project");
    return p;
  }

  private async grant(userId: string, type: ResourceType, id: string): Promise<Grant | null> {
    const [m] = await this.ctx.db
      .select({ role: notesMembers.role })
      .from(notesMembers)
      .where(and(eq(notesMembers.resourceType, type), eq(notesMembers.resourceId, id), eq(notesMembers.userId, userId)));
    return m?.role ?? null;
  }

  /** My role on a project (null: none). Document-only access does not open the whole project. */
  private async projectRole(userId: string, p: ProjectRow): Promise<NotesRole | null> {
    if (p.ownerId === userId) return "owner";
    return this.grant(userId, "project", p.id);
  }

  private async docAccess(userId: string, documentId: string): Promise<{ doc: DocRow; project: ProjectRow; role: NotesRole }> {
    const [doc] = await this.ctx.db.select().from(notesDocuments).where(eq(notesDocuments.id, documentId));
    if (!doc) throw notFound("Document");
    const project = await this.projectRow(doc.projectId);
    const role = best(await this.projectRole(userId, project), await this.grant(userId, "document", doc.id));
    if (!role) throw notFound("Document");
    return { doc, project, role };
  }

  private async requireProject(userId: string, projectId: string, need: "read" | "write" | "owner") {
    const project = await this.projectRow(projectId);
    const role = await this.projectRole(userId, project);
    if (!role) throw notFound("Project");
    if (need === "owner" && role !== "owner") throw forbidden();
    if (need === "write" && !canWrite(role)) throw forbidden();
    return { project, role };
  }

  /** Images a save may refer to: mine, or already in the document (a co-editor's), or the project cover. */
  private async checkMedia(userId: string, ids: Set<string>, allowed: Iterable<string>) {
    const free = new Set(allowed);
    const rest = [...ids].filter((id) => !free.has(id));
    if (!rest.length) return;
    const own = await this.ctx.db.select({ id: notesMedia.id }).from(notesMedia).where(and(eq(notesMedia.ownerId, userId), inArray(notesMedia.id, rest)));
    if (own.length !== rest.length) throw fail(ErrorCode.ValidationFailed, "This image can't be used here.");
  }

  // ------------------------------------------------------------------ legacy conversion

  /** Converts the old workspace JSON once (idempotent, in one transaction; the JSON is kept). */
  async ensureMigrated(userId: string): Promise<void> {
    const [pending] = await this.ctx.db
      .select({ userId: notesWorkspaces.userId })
      .from(notesWorkspaces)
      .where(and(eq(notesWorkspaces.userId, userId), isNull(notesWorkspaces.migratedAt)));
    if (!pending) return;
    await this.ctx.db.transaction(async (tx) => {
      // Claim it (a second device converting at the same moment gets nothing back).
      const [row] = await tx
        .update(notesWorkspaces)
        .set({ migratedAt: this.ctx.now() })
        .where(and(eq(notesWorkspaces.userId, userId), isNull(notesWorkspaces.migratedAt)))
        .returning({ data: notesWorkspaces.data });
      if (!row) return;
      const projects = legacyWorkspace(row.data);
      const base = await this.nextProjectPosition(userId, tx);
      for (const [i, p] of projects.entries()) await this.insertProject(tx, userId, p, base + i, { keepMedia: true });
    });
  }

  private async nextProjectPosition(userId: string, tx: Tx | Ctx["db"] = this.ctx.db) {
    const [r] = await tx.select({ n: sql<number>`coalesce(max(${notesProjects.position}), -1)::int` }).from(notesProjects).where(eq(notesProjects.ownerId, userId));
    return (r?.n ?? -1) + 1;
  }

  /**
   * Inserts a converted / copied project. `keepMedia`: the images are already
   * the user's own (their own old workspace); otherwise each image is copied
   * into the user's account so the copy stays independent of the original.
   */
  private async insertProject(tx: Tx, userId: string, p: LegacyProject, position: number, opts: { keepMedia: boolean; projectId?: string }) {
    const remap = new Map<string, string>();
    const own = async (path: string | null | undefined): Promise<string | null> => {
      const id = notesMediaId(path);
      if (!id) return null;
      if (opts.keepMedia) return path!;
      if (!remap.has(id)) {
        const [m] = await tx.select().from(notesMedia).where(eq(notesMedia.id, id));
        if (!m) return null;
        const [copy] = await tx.insert(notesMedia).values({ ownerId: userId, mimeType: m.mimeType, sizeBytes: m.sizeBytes, storageKey: m.storageKey }).returning({ id: notesMedia.id });
        remap.set(id, copy!.id);
      }
      return `${NOTES_MEDIA_PREFIX}${remap.get(id)}`;
    };
    const rewrite = async (x: unknown): Promise<unknown> => {
      if (Array.isArray(x)) return Promise.all(x.map(rewrite));
      if (x && typeof x === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(x)) out[k] = (k === "src" || k === "cover") && typeof v === "string" ? ((await own(v)) ?? "") : await rewrite(v);
        return out;
      }
      return x;
    };
    let projectId = opts.projectId;
    if (!projectId) {
      const [row] = await tx
        .insert(notesProjects)
        .values({ ownerId: userId, name: cleanName(p.name, "Проект"), cover: await own(p.cover), position, legacyId: p.legacyId })
        .returning({ id: notesProjects.id });
      projectId = row!.id;
    }
    const [{ start }] = (await tx
      .select({ start: sql<number>`coalesce(max(${notesDocuments.position}), -1)::int + 1` })
      .from(notesDocuments)
      .where(eq(notesDocuments.projectId, projectId))) as [{ start: number }];
    const ids: string[] = [];
    for (const [i, d] of p.documents.entries()) {
      const data = (opts.keepMedia ? d.data : await rewrite(d.data)) as Record<string, unknown>;
      const cover = await own(d.cover);
      const [row] = await tx
        .insert(notesDocuments)
        .values({ projectId, kind: d.kind, name: cleanName(d.name, "Заметка"), cover, data, mediaIds: [...notesMediaIds({ data, cover })], position: start + i, legacyId: d.legacyId, updatedBy: userId })
        .returning({ id: notesDocuments.id });
      ids.push(row!.id);
    }
    return { projectId, documentIds: ids };
  }

  // ------------------------------------------------------------------ projects

  private projectDto(p: ProjectRow, role: NotesRole, owner: NotesPersonDto, documents: number, shared: boolean): NotesProjectDto {
    return { id: p.id, name: p.name, cover: p.cover, role, owner, documents, shared, position: p.position, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
  }

  private docMeta(d: DocRow, role: NotesRole, shared: boolean): NotesDocMetaDto {
    const data = d.data as { format?: string };
    return {
      id: d.id,
      projectId: d.projectId,
      kind: d.kind,
      name: d.name,
      cover: d.cover,
      format: (data.format ?? (d.kind === "note" ? "vertical" : "rect")) as NotesDocMetaDto["format"],
      role,
      revision: d.revision,
      pages: notesPageCount(d.data),
      preview: notesPreview(d.data),
      position: d.position,
      shared,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }

  /** My projects and the ones shared with me, plus documents shared with me one by one. */
  async listProjects(userId: string): Promise<{ projects: NotesProjectDto[]; sharedDocuments: NotesDocMetaDto[] }> {
    await this.ensureMigrated(userId);
    const grants = await this.ctx.db.select().from(notesMembers).where(eq(notesMembers.userId, userId));
    const projectGrants = new Map(grants.filter((g) => g.resourceType === "project").map((g) => [g.resourceId, g.role]));
    const docGrants = new Map(grants.filter((g) => g.resourceType === "document").map((g) => [g.resourceId, g.role]));
    const rows = await this.ctx.db
      .select()
      .from(notesProjects)
      .where(projectGrants.size ? or(eq(notesProjects.ownerId, userId), inArray(notesProjects.id, [...projectGrants.keys()])) : eq(notesProjects.ownerId, userId))
      .orderBy(asc(notesProjects.position), asc(notesProjects.createdAt));
    const ids = rows.map((r) => r.id);
    const counts = new Map<string, number>();
    const sharedProjects = new Set<string>();
    if (ids.length) {
      for (const c of await this.ctx.db
        .select({ projectId: notesDocuments.projectId, n: sql<number>`count(*)::int` })
        .from(notesDocuments)
        .where(inArray(notesDocuments.projectId, ids))
        .groupBy(notesDocuments.projectId))
        counts.set(c.projectId, c.n);
      for (const m of await this.ctx.db
        .select({ id: notesMembers.resourceId })
        .from(notesMembers)
        .where(and(eq(notesMembers.resourceType, "project"), inArray(notesMembers.resourceId, ids))))
        sharedProjects.add(m.id);
    }
    // Documents shared with me whose project I can't open as a whole.
    const docRows = docGrants.size ? await this.ctx.db.select().from(notesDocuments).where(inArray(notesDocuments.id, [...docGrants.keys()])) : [];
    const visibleDocs = docRows.filter((d) => !ids.includes(d.projectId));
    const owners = await this.people([...rows.map((r) => r.ownerId)]);
    return {
      projects: rows.map((p) => this.projectDto(p, p.ownerId === userId ? "owner" : projectGrants.get(p.id)!, owners.get(p.ownerId)!, counts.get(p.id) ?? 0, sharedProjects.has(p.id))),
      sharedDocuments: visibleDocs.map((d) => this.docMeta(d, docGrants.get(d.id)!, true)),
    };
  }

  async createProject(userId: string, name: string): Promise<NotesProjectDto> {
    await this.ensureMigrated(userId);
    const [{ n }] = (await this.ctx.db.select({ n: sql<number>`count(*)::int` }).from(notesProjects).where(eq(notesProjects.ownerId, userId))) as [{ n: number }];
    if (n >= NOTES_PROJECTS_MAX) throw fail(ErrorCode.ValidationFailed, "Too many projects.");
    // New projects come first in the custom order.
    const [{ min }] = (await this.ctx.db.select({ min: sql<number>`coalesce(min(${notesProjects.position}), 0)::int` }).from(notesProjects).where(eq(notesProjects.ownerId, userId))) as [{ min: number }];
    const [row] = await this.ctx.db.insert(notesProjects).values({ ownerId: userId, name: cleanName(name, "Новый проект"), position: min - 1 }).returning();
    const owner = (await this.people([userId])).get(userId)!;
    return this.projectDto(row!, "owner", owner, 0, false);
  }

  async project(userId: string, projectId: string): Promise<NotesProjectDetailDto> {
    const { project, role } = await this.requireProject(userId, projectId, "read");
    const docs = await this.ctx.db.select().from(notesDocuments).where(eq(notesDocuments.projectId, projectId)).orderBy(asc(notesDocuments.position), asc(notesDocuments.createdAt));
    const docIds = docs.map((d) => d.id);
    const docGrants = new Map<string, Grant>();
    const sharedDocs = new Set<string>();
    if (docIds.length) {
      for (const m of await this.ctx.db
        .select()
        .from(notesMembers)
        .where(and(eq(notesMembers.resourceType, "document"), inArray(notesMembers.resourceId, docIds)))) {
        sharedDocs.add(m.resourceId);
        if (m.userId === userId) docGrants.set(m.resourceId, m.role);
      }
    }
    const [projectMember] = await this.ctx.db
      .select({ id: notesMembers.userId })
      .from(notesMembers)
      .where(and(eq(notesMembers.resourceType, "project"), eq(notesMembers.resourceId, projectId)))
      .limit(1);
    const owner = (await this.people([project.ownerId])).get(project.ownerId)!;
    return {
      project: this.projectDto(project, role, owner, docs.length, !!projectMember),
      documents: docs.map((d) => this.docMeta(d, best(role, docGrants.get(d.id))!, sharedDocs.has(d.id) || !!projectMember)),
    };
  }

  async updateProject(userId: string, projectId: string, patch: { name?: string; cover?: string | null; position?: number }, sessionId?: string) {
    // Renaming and the cover: owner and editors. The custom order of my list: only mine.
    const { project, role } = await this.requireProject(userId, projectId, "write");
    const set: Partial<ProjectRow> = { updatedAt: this.ctx.now() };
    if (patch.name !== undefined) set.name = cleanName(patch.name, project.name);
    if (patch.cover !== undefined) {
      if (!validCover(patch.cover)) throw fail(ErrorCode.ValidationFailed, "Not a Notes image.");
      if (patch.cover) await this.checkMedia(userId, notesMediaIds({ cover: patch.cover }), notesMediaIds({ cover: project.cover }));
      set.cover = patch.cover ?? null;
    }
    if (patch.position !== undefined) {
      if (role !== "owner") throw forbidden();
      set.position = patch.position;
    }
    await this.ctx.db.update(notesProjects).set(set).where(eq(notesProjects.id, projectId));
    this.emit(await this.audience(projectId), { type: "notes.projects.changed", projectId }, sessionId);
    return { ok: true };
  }

  async deleteProject(userId: string, projectId: string) {
    const { project } = await this.requireProject(userId, projectId, "owner");
    const audience = await this.audience(projectId);
    const docIds = (await this.ctx.db.select({ id: notesDocuments.id }).from(notesDocuments).where(eq(notesDocuments.projectId, projectId))).map((d) => d.id);
    await this.ctx.db.transaction(async (tx) => {
      await tx.delete(notesMembers).where(or(and(eq(notesMembers.resourceType, "project"), eq(notesMembers.resourceId, projectId)), docIds.length ? and(eq(notesMembers.resourceType, "document"), inArray(notesMembers.resourceId, docIds)) : sql`false`));
      await tx.update(notesShares).set({ revokedAt: this.ctx.now() }).where(and(eq(notesShares.mode, "access"), or(eq(notesShares.resourceId, projectId), docIds.length ? inArray(notesShares.resourceId, docIds) : sql`false`)));
      await tx.delete(notesProjects).where(eq(notesProjects.id, projectId));
    });
    this.emit(audience, { type: "notes.resource.deleted", resourceType: "project", resourceId: projectId, name: project.name });
    return { ok: true };
  }

  // ------------------------------------------------------------------ documents

  async createDocument(userId: string, projectId: string, input: { kind: NotesDocKind; name: string; format?: string; data?: unknown }, sessionId?: string): Promise<NotesDocumentDto> {
    await this.requireProject(userId, projectId, "write");
    const [{ n, max }] = (await this.ctx.db
      .select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${notesDocuments.position}), -1)::int` })
      .from(notesDocuments)
      .where(eq(notesDocuments.projectId, projectId))) as [{ n: number; max: number }];
    if (n >= NOTES_DOCS_MAX) throw fail(ErrorCode.ValidationFailed, "Too many documents in this project.");
    let data: NotesBody;
    if (input.data !== undefined) {
      if (!validNotesBody(input.kind, input.data)) throw fail(ErrorCode.ValidationFailed, "This is not a Notes document.");
      data = input.data;
      await this.checkMedia(userId, notesMediaIds(data), []);
    } else data = input.kind === "note" ? emptyNote(input.format === "square" ? "square" : "vertical") : emptyPresentation(input.format === "square" ? "square" : "rect");
    if (Buffer.byteLength(JSON.stringify(data)) > NOTES_DOC_MAX_BYTES) throw fail(ErrorCode.NotesTooLarge, "The document is too large.");
    const [row] = await this.ctx.db
      .insert(notesDocuments)
      .values({
        projectId,
        kind: input.kind,
        name: cleanName(input.name, input.kind === "note" ? "Новая заметка" : "Новая презентация"),
        data: data as unknown as Record<string, unknown>,
        mediaIds: [...notesMediaIds(data)],
        position: max + 1,
        updatedBy: userId,
      })
      .returning();
    await this.ctx.db.update(notesProjects).set({ updatedAt: this.ctx.now() }).where(eq(notesProjects.id, projectId));
    this.emit(await this.audience(projectId), { type: "notes.projects.changed", projectId }, sessionId);
    return this.document(userId, row!.id);
  }

  async document(userId: string, documentId: string): Promise<NotesDocumentDto> {
    const { doc, project, role } = await this.docAccess(userId, documentId);
    const [member] = await this.ctx.db
      .select({ id: notesMembers.userId })
      .from(notesMembers)
      .where(or(and(eq(notesMembers.resourceType, "project"), eq(notesMembers.resourceId, project.id)), and(eq(notesMembers.resourceType, "document"), eq(notesMembers.resourceId, doc.id))))
      .limit(1);
    const owner = (await this.people([project.ownerId])).get(project.ownerId)!;
    return { ...this.docMeta(doc, role, !!member), data: doc.data as unknown as NotesBody, projectName: project.name, owner };
  }

  /** Saves the body (compare-and-swap on the revision). Editors and the owner only; checked on every save. */
  async saveDocument(userId: string, documentId: string, input: { data: unknown; revision: number }, sessionId?: string): Promise<{ revision: number; updatedAt: string }> {
    const { doc, project, role } = await this.docAccess(userId, documentId);
    if (!canWrite(role)) throw fail(ErrorCode.NotesAccessRevoked, "You can only read this document.", { status: 403 });
    if (!validNotesBody(doc.kind, input.data)) throw fail(ErrorCode.ValidationFailed, "This is not a Notes document.");
    if (Buffer.byteLength(JSON.stringify(input.data)) > NOTES_DOC_MAX_BYTES) throw fail(ErrorCode.NotesTooLarge, "The document is too large.");
    const media = notesMediaIds(input.data);
    await this.checkMedia(userId, media, [...doc.mediaIds, ...notesMediaIds({ cover: project.cover })]);
    if (doc.cover) media.add(notesMediaId(doc.cover)!);
    const now = this.ctx.now();
    const rows = await this.ctx.db
      .update(notesDocuments)
      .set({ data: input.data as unknown as Record<string, unknown>, mediaIds: [...media], revision: sql`${notesDocuments.revision} + 1`, updatedAt: now, updatedBy: userId })
      .where(and(eq(notesDocuments.id, documentId), eq(notesDocuments.revision, input.revision)))
      .returning({ revision: notesDocuments.revision });
    if (!rows.length) {
      const [current] = await this.ctx.db.select({ revision: notesDocuments.revision, by: notesDocuments.updatedBy }).from(notesDocuments).where(eq(notesDocuments.id, documentId));
      const by = current?.by ? (await this.people([current.by])).get(current.by) : undefined;
      throw fail(ErrorCode.NotesConflict, "The document was changed by someone else.", { details: { revision: current?.revision ?? 0, by: by?.name ?? "" } });
    }
    await this.ctx.db.update(notesProjects).set({ updatedAt: now }).where(eq(notesProjects.id, project.id));
    const me = (await this.people([userId])).get(userId)!;
    this.emit(
      await this.audience(project.id, documentId),
      { type: "notes.document.updated", documentId, projectId: project.id, revision: rows[0]!.revision, byUserId: userId, byName: me.name },
      sessionId,
    );
    return { revision: rows[0]!.revision, updatedAt: now.toISOString() };
  }

  async updateDocument(userId: string, documentId: string, patch: { name?: string; cover?: string | null; position?: number }, sessionId?: string) {
    const { doc, project, role } = await this.docAccess(userId, documentId);
    if (!canWrite(role)) throw forbidden();
    const set: Partial<DocRow> = { updatedAt: this.ctx.now() };
    if (patch.name !== undefined) set.name = cleanName(patch.name, doc.name);
    if (patch.cover !== undefined) {
      if (!validCover(patch.cover)) throw fail(ErrorCode.ValidationFailed, "Not a Notes image.");
      if (patch.cover) await this.checkMedia(userId, notesMediaIds({ cover: patch.cover }), doc.mediaIds);
      set.cover = patch.cover ?? null;
      const media = notesMediaIds(doc.data);
      if (patch.cover) media.add(notesMediaId(patch.cover)!);
      set.mediaIds = [...media];
    }
    if (patch.position !== undefined) set.position = patch.position;
    await this.ctx.db.update(notesDocuments).set(set).where(eq(notesDocuments.id, documentId));
    this.emit(await this.audience(project.id, documentId), { type: "notes.projects.changed", projectId: project.id }, sessionId);
    return { ok: true };
  }

  async deleteDocument(userId: string, documentId: string) {
    const { doc, project } = await this.docAccess(userId, documentId);
    if (project.ownerId !== userId) throw forbidden();
    const audience = await this.audience(project.id, documentId);
    await this.ctx.db.transaction(async (tx) => {
      await tx.delete(notesMembers).where(and(eq(notesMembers.resourceType, "document"), eq(notesMembers.resourceId, documentId)));
      await tx.update(notesShares).set({ revokedAt: this.ctx.now() }).where(and(eq(notesShares.mode, "access"), eq(notesShares.resourceId, documentId)));
      await tx.delete(notesDocuments).where(eq(notesDocuments.id, documentId));
    });
    this.emit(audience, { type: "notes.resource.deleted", resourceType: "document", resourceId: documentId, name: doc.name });
    return { ok: true };
  }

  // ------------------------------------------------------------------ media

  async upload(userId: string, mimeType: string, data: Buffer): Promise<{ url: string }> {
    const row = await this.ctx.db.transaction(async (tx) => {
      const storageKey = await this.ctx.blobs.put({ ownerUserId: userId, purpose: "notes", mimeType, data }, tx);
      const [m] = await tx.insert(notesMedia).values({ ownerId: userId, mimeType, sizeBytes: data.length, storageKey }).returning();
      return m!;
    });
    return { url: `${NOTES_MEDIA_PREFIX}${row.id}` };
  }

  /** An image: to its owner, or to anyone who may read a document / project showing it (or an old snapshot link). */
  async media(userId: string, id: string): Promise<{ mimeType: string; data: Buffer }> {
    const [m] = await this.ctx.db.select().from(notesMedia).where(eq(notesMedia.id, id));
    if (!m) throw notFound("Image");
    if (m.ownerId !== userId && !(await this.canSeeMedia(userId, id))) throw notFound("Image");
    const blob = await this.ctx.blobs.get(m.storageKey);
    if (!blob) throw notFound("Image");
    return { mimeType: m.mimeType, data: blob.data };
  }

  private async canSeeMedia(userId: string, id: string): Promise<boolean> {
    const path = `${NOTES_MEDIA_PREFIX}${id}`;
    const docs = await this.ctx.db
      .select({ id: notesDocuments.id })
      .from(notesDocuments)
      .where(arrayOverlaps(notesDocuments.mediaIds, [id]))
      .limit(50);
    for (const d of docs) {
      try {
        await this.docAccess(userId, d.id);
        return true;
      } catch {
        /* not this one */
      }
    }
    const covers = await this.ctx.db.select().from(notesProjects).where(eq(notesProjects.cover, path)).limit(20);
    for (const p of covers) if (await this.projectRole(userId, p)) return true;
    // Copy links show their snapshot's images to whoever has the link.
    const [shared] = await this.ctx.db
      .select({ token: notesShares.token })
      .from(notesShares)
      .where(and(arrayOverlaps(notesShares.mediaIds, [id]), isNull(notesShares.revokedAt)))
      .limit(1);
    return !!shared;
  }

  // ------------------------------------------------------------------ members

  private async resource(userId: string, type: ResourceType, id: string) {
    if (type === "project") {
      const project = await this.projectRow(id);
      const role = await this.projectRole(userId, project);
      if (!role) throw notFound("Project");
      return { project, name: project.name, role, kind: "project" as NotesShareKind, doc: null as DocRow | null };
    }
    const { doc, project, role } = await this.docAccess(userId, id);
    return { project, name: doc.name, role, kind: doc.kind as NotesShareKind, doc };
  }

  async members(userId: string, type: ResourceType, id: string): Promise<NotesMemberDto[]> {
    const { project } = await this.resource(userId, type, id);
    const rows = await this.ctx.db
      .select()
      .from(notesMembers)
      .where(and(eq(notesMembers.resourceType, type), eq(notesMembers.resourceId, id)))
      .orderBy(asc(notesMembers.createdAt));
    const people = await this.people([project.ownerId, ...rows.map((r) => r.userId)]);
    return [
      { ...people.get(project.ownerId)!, role: "owner", since: project.createdAt.toISOString() },
      ...rows.filter((r) => people.has(r.userId)).map((r) => ({ ...people.get(r.userId)!, role: r.role as NotesRole, since: r.createdAt.toISOString() })),
    ];
  }

  async setMemberRole(userId: string, type: ResourceType, id: string, memberId: string, role: Grant) {
    const { project } = await this.resource(userId, type, id);
    if (project.ownerId !== userId) throw forbidden();
    const rows = await this.ctx.db
      .update(notesMembers)
      .set({ role })
      .where(and(eq(notesMembers.resourceType, type), eq(notesMembers.resourceId, id), eq(notesMembers.userId, memberId)))
      .returning({ userId: notesMembers.userId });
    if (!rows.length) throw notFound("Member");
    this.emit([memberId, userId], { type: "notes.share.updated", resourceType: type, resourceId: id });
    return { ok: true };
  }

  /** The owner removes someone (or a member leaves). Effective on their next request; their devices close it now. */
  async removeMember(userId: string, type: ResourceType, id: string, memberId: string) {
    const { project, name } = await this.resource(userId, type, id);
    if (project.ownerId !== userId && memberId !== userId) throw forbidden();
    const rows = await this.ctx.db
      .delete(notesMembers)
      .where(and(eq(notesMembers.resourceType, type), eq(notesMembers.resourceId, id), eq(notesMembers.userId, memberId)))
      .returning({ userId: notesMembers.userId });
    if (!rows.length) throw notFound("Member");
    this.emit([memberId], { type: "notes.access.revoked", resourceType: type, resourceId: id, name });
    this.emit([project.ownerId], { type: "notes.share.updated", resourceType: type, resourceId: id });
    return { ok: true };
  }

  // ------------------------------------------------------------------ shares

  /**
   * A link to a project or a document. "copy": a snapshot (taken now) that the
   * recipient can add to their own Notes. "access": opening it gives the
   * recipient a role on the original. Only the owner shares.
   */
  async createShare(userId: string, input: { resourceType: ResourceType; resourceId: string; mode: NotesShareMode; role: Grant; recipientIds?: string[] }) {
    const r = await this.resource(userId, input.resourceType, input.resourceId);
    if (r.project.ownerId !== userId) throw forbidden();
    const [{ n }] = (await this.ctx.db.select({ n: sql<number>`count(*)::int` }).from(notesShares).where(and(eq(notesShares.ownerId, userId), isNull(notesShares.revokedAt)))) as [{ n: number }];
    if (n >= NOTES_SHARES_MAX) throw fail(ErrorCode.ValidationFailed, "Too many shared links. Remove some first.");
    let snapshot: Record<string, unknown> = {};
    let media: string[] = [];
    if (input.mode === "copy") {
      const docs = r.doc ? [r.doc] : await this.ctx.db.select().from(notesDocuments).where(eq(notesDocuments.projectId, r.project.id)).orderBy(asc(notesDocuments.position));
      snapshot = {
        v: 2,
        name: r.name,
        cover: r.doc ? r.doc.cover : r.project.cover,
        documents: docs.map((d) => ({ kind: d.kind, name: d.name, cover: d.cover, data: d.data })),
      };
      if (Buffer.byteLength(JSON.stringify(snapshot)) > NOTES_DOC_MAX_BYTES * 4) throw fail(ErrorCode.NotesTooLarge, "Too large to share as a copy.");
      media = [...notesMediaIds(snapshot)];
    }
    const token = randomBytes(24).toString("base64url");
    await this.ctx.db.insert(notesShares).values({
      token,
      ownerId: userId,
      name: r.name,
      data: snapshot,
      mediaIds: media,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      mode: input.mode,
      role: input.mode === "access" ? input.role : "viewer",
      docKind: r.doc ? r.doc.kind : null,
    });
    // Sent to particular people with access: they see it in their list right away.
    if (input.mode === "access" && input.recipientIds?.length) {
      for (const rid of new Set(input.recipientIds)) if (rid !== userId) await this.addMember(rid, input.resourceType, input.resourceId, input.role, userId);
    }
    return { token, card: { token, title: r.name, ext: notesExt(r.kind), kind: r.kind } };
  }

  private async addMember(memberId: string, type: ResourceType, id: string, role: Grant, grantedBy: string) {
    const existing = await this.grant(memberId, type, id);
    if (existing && RANK[existing] >= RANK[role]) return;
    await this.ctx.db
      .insert(notesMembers)
      .values({ resourceType: type, resourceId: id, userId: memberId, role, grantedBy })
      .onConflictDoUpdate({ target: [notesMembers.resourceType, notesMembers.resourceId, notesMembers.userId], set: { role } });
    this.emit([memberId], { type: "notes.projects.changed" });
    this.emit([grantedBy], { type: "notes.share.updated", resourceType: type, resourceId: id });
  }

  private async shareRow(token: string) {
    const [row] = await this.ctx.db.select().from(notesShares).where(eq(notesShares.token, token));
    if (!row) throw notFound("Share");
    return row;
  }

  /** What a link is. Content is never in it: opening needs access, copies are made by acceptShare. */
  async shareInfo(userId: string, token: string): Promise<NotesShareInfoDto> {
    const row = await this.shareRow(token);
    const owner = (await this.people([row.ownerId])).get(row.ownerId) ?? { id: row.ownerId, name: "" };
    const legacy = !row.resourceType;
    const kind: NotesShareKind = legacy ? (Array.isArray(row.data.spaces) ? "project" : row.data.mode === "presentation" ? "presentation" : "note") : row.resourceType === "project" ? "project" : (row.docKind ?? "note");
    let access: NotesRole | "none" = "none";
    let projectId: string | undefined;
    let documentId: string | undefined;
    let gone = !!row.revokedAt;
    if (!legacy && row.resourceId) {
      try {
        const r = await this.resource(userId, row.resourceType!, row.resourceId);
        access = r.role;
        projectId = r.project.id;
        documentId = r.doc?.id;
      } catch {
        // No access (yet) — or the original is gone.
        const exists =
          row.resourceType === "project"
            ? (await this.ctx.db.select({ id: notesProjects.id }).from(notesProjects).where(eq(notesProjects.id, row.resourceId))).length
            : (await this.ctx.db.select({ id: notesDocuments.id }).from(notesDocuments).where(eq(notesDocuments.id, row.resourceId))).length;
        if (!exists && row.mode === "access") gone = true;
      }
    }
    return { token, mode: row.mode, role: row.role, kind, name: row.name, ext: notesExt(kind), owner: { id: owner.id, name: owner.name }, access, projectId, documentId, gone };
  }

  /**
   * Opens a link for me: "access" → I get the role on the original (or keep my
   * better one); "copy" → an independent copy in my Notes (a project link: a
   * new project; a document link: into "Полученные").
   */
  async acceptShare(userId: string, token: string, opts: { copy?: boolean } = {}): Promise<{ projectId: string; documentId?: string }> {
    await this.ensureMigrated(userId);
    const row = await this.shareRow(token);
    if (row.revokedAt) throw fail(ErrorCode.NotesAccessRevoked, "This link no longer works.", { status: 410 });
    if (row.mode === "access" && !opts.copy) {
      if (row.resourceType === "project") await this.projectRow(row.resourceId!);
      else {
        const [d] = await this.ctx.db.select({ id: notesDocuments.id }).from(notesDocuments).where(eq(notesDocuments.id, row.resourceId!));
        if (!d) throw notFound("Document");
      }
      if (row.ownerId !== userId) await this.addMember(userId, row.resourceType!, row.resourceId!, row.role, row.ownerId);
      const r = await this.resource(userId, row.resourceType!, row.resourceId!);
      return { projectId: r.project.id, documentId: r.doc?.id };
    }
    // A copy: from the snapshot of a copy link, or (an access link I may read) from the original now.
    let snap: LegacyProject | null;
    if (row.mode === "copy") snap = row.resourceType ? this.snapshotProject(row.data) : legacySnapshot(row.data);
    else {
      const r = await this.resource(userId, row.resourceType!, row.resourceId!);
      const docs = r.doc ? [r.doc] : await this.ctx.db.select().from(notesDocuments).where(eq(notesDocuments.projectId, r.project.id)).orderBy(asc(notesDocuments.position));
      snap = this.snapshotProject({ name: r.name, cover: r.doc ? r.doc.cover : r.project.cover, documents: docs.map((d) => ({ kind: d.kind, name: d.name, cover: d.cover, data: d.data })) });
    }
    if (!snap) throw fail(ErrorCode.ValidationFailed, "This link is damaged.");
    const isProject = row.resourceType ? row.resourceType === "project" : Array.isArray(row.data.spaces);
    const result = await this.ctx.db.transaction(async (tx) => {
      if (isProject) return this.insertProject(tx, userId, snap, await this.nextProjectPosition(userId, tx), { keepMedia: false });
      // One document: into my "Received" project.
      let [received] = await tx.select({ id: notesProjects.id }).from(notesProjects).where(and(eq(notesProjects.ownerId, userId), eq(notesProjects.legacyId, RECEIVED)));
      if (!received) [received] = await tx.insert(notesProjects).values({ ownerId: userId, name: "Полученные", position: -1_000_000, legacyId: RECEIVED }).returning({ id: notesProjects.id });
      return this.insertProject(tx, userId, snap, 0, { keepMedia: false, projectId: received!.id });
    });
    this.emit([userId], { type: "notes.projects.changed" });
    return { projectId: result.projectId, documentId: isProject ? undefined : result.documentIds[0] };
  }

  private snapshotProject(data: Record<string, unknown>): LegacyProject | null {
    const docs = Array.isArray(data.documents) ? data.documents : [];
    const documents = docs
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .filter((d) => (d.kind === "note" || d.kind === "presentation") && validNotesBody(d.kind as NotesDocKind, d.data))
      .map((d) => ({ legacyId: "", kind: d.kind as NotesDocKind, name: String(d.name ?? ""), cover: notesMediaId(d.cover) ? (d.cover as string) : null, data: d.data as NotesBody }));
    return { legacyId: "", name: String(data.name ?? "Проект"), cover: notesMediaId(data.cover) ? (data.cover as string) : null, documents };
  }

  async listShares(userId: string, type: ResourceType, id: string): Promise<NotesShareDto[]> {
    const r = await this.resource(userId, type, id);
    if (r.project.ownerId !== userId) throw forbidden();
    const rows = await this.ctx.db
      .select()
      .from(notesShares)
      .where(and(eq(notesShares.resourceType, type), eq(notesShares.resourceId, id), isNull(notesShares.revokedAt)))
      .orderBy(asc(notesShares.createdAt));
    return rows.map((s) => ({ token: s.token, mode: s.mode, role: s.role, createdAt: s.createdAt.toISOString() }));
  }

  async revokeShare(userId: string, token: string) {
    const rows = await this.ctx.db
      .update(notesShares)
      .set({ revokedAt: this.ctx.now() })
      .where(and(eq(notesShares.token, token), eq(notesShares.ownerId, userId), isNull(notesShares.revokedAt)))
      .returning({ token: notesShares.token });
    if (!rows.length) throw notFound("Share");
    return { ok: true };
  }

  /** The card a Vibex message / VoidOps letter shows for a link (title and type only). */
  async card(token: string) {
    const row = await this.shareRow(token);
    const kind: NotesShareKind = row.resourceType === "project" ? "project" : (row.docKind ?? (row.data.mode === "presentation" ? "presentation" : Array.isArray(row.data.spaces) ? "project" : "note"));
    return { token, title: row.name, ext: notesExt(kind), kind };
  }

  // ------------------------------------------------------------------ preferences

  async prefs(userId: string): Promise<NotesPrefsDto> {
    const [row] = await this.ctx.db.select().from(notesPrefs).where(eq(notesPrefs.userId, userId));
    return { ...DEFAULT_NOTES_PREFS, ...(row?.data ?? {}) } as NotesPrefsDto;
  }

  async setPrefs(userId: string, patch: Partial<NotesPrefsDto>): Promise<NotesPrefsDto> {
    const next = { ...(await this.prefs(userId)), ...patch };
    await this.ctx.db
      .insert(notesPrefs)
      .values({ userId, data: next as unknown as Record<string, unknown>, updatedAt: this.ctx.now() })
      .onConflictDoUpdate({ target: notesPrefs.userId, set: { data: next as unknown as Record<string, unknown>, updatedAt: this.ctx.now() } });
    return next;
  }
}
