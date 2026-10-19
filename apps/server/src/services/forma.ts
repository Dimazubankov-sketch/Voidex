import { Script } from "node:vm";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { ErrorCode } from "@voidex/shared";
import {
  AGENT_CLIENTS,
  FORMA_ERRORS,
  FORMA_LIMITS,
  FORMA_SCHEMA_VERSION,
  FormaError,
  LIMITS,
  applyBackendCommands,
  applyCommands,
  checkProject,
  createProject,
  diffBackend,
  diffFrontend,
  normalizeScopes,
  parseBackend,
  parseBindings,
  parseFrontendDocument,
  runContractTests,
  sampleProject,
  startScreen,
  type AgentClient,
  type AgentScope,
  type BackendCommand,
  type Command,
  type FormaAgentCreated,
  type FormaAgentDto,
  type FormaAuditDto,
  type FormaProjectDto,
  type FormaProjectSummary,
  type FormaRevisionDto,
  type FormaSaveResult,
  type FrontendDocument,
  type Project,
  type SyntaxChecker,
} from "@voidex/forma";
import { formaAgents, formaAudit, formaProjects, formaRevisions } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { AppError, notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";

type ProjectRow = typeof formaProjects.$inferSelect;
type AgentRow = typeof formaAgents.$inferSelect;

/** A Forma error with its own code (the common ErrorCode list stays untouched). */
export function formaFail(code: (typeof FORMA_ERRORS)[keyof typeof FORMA_ERRORS], message: string, status: number, details?: Record<string, unknown>) {
  return new AppError(code as unknown as ErrorCode, message, { status, details });
}

/** Model validation errors become 400 with the path of the offending part. */
export function wrapForma<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof FormaError) {
      if (e.code === "not_found") throw new AppError(ErrorCode.NotFound, e.message, { details: { path: e.path } });
      throw formaFail(FORMA_ERRORS.invalid, e.message, 400, { path: e.path, reason: e.code });
    }
    throw e;
  }
}

/**
 * Syntax check of agent-written handler code: V8 compiles it (no execution:
 * a compiled Script never runs unless asked). The handler format is one
 * module with `export default async function handler(input, ctx)`; imports
 * are not available in the future isolated runtime, so they are refused.
 */
export const checkSyntax: SyntaxChecker = (source) => {
  if (/^\s*import\s[\s\S]*?from\s|^\s*import\s*\(/m.test(source)) return "import не поддерживается: операция получает всё через input и ctx.";
  if (!/export\s+default\b/.test(source)) return "Нет export default (функции-обработчика).";
  const body = source.replace(/^(\s*)export\s+default\s+/gm, "$1const __formaHandler = ").replace(/^(\s*)export\s+(?=(async\s+)?function|const|let|class)/gm, "$1");
  try {
    new Script(`(async () => {\n${body}\n})`, { filename: "handler.js" });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "ошибка разбора";
  }
};

const AGENT_TOKEN_RE = /^fma_[A-Za-z0-9_-]{40}$/;
const KEEP_REVISIONS = 50;
const KEEP_AUDIT = 1000;
/** A person's autosave adds a history entry at most this often (explicit saves always do). */
const FRONTEND_SNAPSHOT_MS = 10 * 60 * 1000;

export interface AgentContext {
  agent: AgentRow;
  scopes: Set<AgentScope>;
}

function toProject(row: ProjectRow): Project {
  const fe = row.frontend as unknown as Pick<FrontendDocument, "settings" | "frontend">;
  const be = row.backend as unknown as Pick<Project, "backend" | "bindings">;
  return {
    schemaVersion: FORMA_SCHEMA_VERSION,
    id: row.id,
    name: row.name,
    kind: "app",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    settings: fe.settings,
    frontend: fe.frontend,
    backend: be.backend,
    bindings: be.bindings,
    publishing: { appId: null, version: "0.1.0", status: "draft" },
  };
}

function dto(row: ProjectRow): FormaProjectDto {
  return { project: toProject(row), frontendRevision: row.frontendRevision, backendRevision: row.backendRevision };
}

function summary(row: ProjectRow): FormaProjectSummary {
  const p = toProject(row);
  const start = startScreen(p);
  const title = start.elements.find((e) => e.type === "heading")?.props.text;
  const button = start.elements.find((e) => e.type === "button");
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    screens: p.frontend.screens.length,
    operations: p.backend.operations.length,
    bindings: p.bindings.length,
    frontendRevision: row.frontendRevision,
    backendRevision: row.backendRevision,
    cover: { background: start.background, accent: button?.style.fill ?? p.settings.accent, title: typeof title === "string" && title ? title : p.name, button: button ? String(button.props.label ?? "") : null },
  };
}

function agentDto(a: AgentRow, now: Date): FormaAgentDto {
  return {
    id: a.id,
    name: a.name,
    client: a.client as AgentClient,
    scopes: normalizeScopes(a.scopes),
    tokenPrefix: a.tokenPrefix,
    createdAt: a.createdAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    revokedAt: a.revokedAt?.toISOString() ?? null,
    lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
    active: !a.revokedAt && a.expiresAt > now,
  };
}

const frontendJson = (doc: Pick<FrontendDocument, "settings" | "frontend">) => ({ settings: doc.settings, frontend: doc.frontend }) as unknown as Record<string, unknown>;
const backendJson = (p: Pick<Project, "backend" | "bindings">) => ({ backend: p.backend, bindings: p.bindings }) as unknown as Record<string, unknown>;

/**
 * Forma: app projects of an account and the AI agent connections to them.
 *
 * The person (session) owns projects and edits the frontend. Agents
 * authenticate with a project-bound token and act through typed operations
 * on the backend layer and the bindings (and the frontend only with the
 * `frontend.write` scope). A person can never write the backend: there is no
 * such operation for a session, whatever the client sends.
 */
export class FormaService {
  constructor(private readonly ctx: Ctx) {}

  // ---- the person's projects ------------------------------------------------

  private async owned(userId: string, projectId: string): Promise<ProjectRow> {
    const [row] = await this.ctx.db
      .select()
      .from(formaProjects)
      .where(and(eq(formaProjects.id, projectId), eq(formaProjects.ownerId, userId)));
    if (!row) throw notFound("Project");
    return row;
  }

  async list(userId: string): Promise<FormaProjectSummary[]> {
    const rows = await this.ctx.db.select().from(formaProjects).where(eq(formaProjects.ownerId, userId)).orderBy(desc(formaProjects.updatedAt));
    return rows.map(summary);
  }

  async create(userId: string, name: string, template: "blank" | "sample"): Promise<FormaProjectDto> {
    const [{ n } = { n: 0 }] = await this.ctx.db.select({ n: sql<number>`count(*)::int` }).from(formaProjects).where(eq(formaProjects.ownerId, userId));
    if (n >= FORMA_LIMITS.projectsPerAccount) throw formaFail(FORMA_ERRORS.limit, "Too many projects.", 422);
    const p = wrapForma(() => (template === "sample" ? sampleProject(name.trim() || "Пример приложения") : createProject(name)));
    const now = this.ctx.now();
    const [row] = await this.ctx.db
      .insert(formaProjects)
      .values({ ownerId: userId, name: p.name, schemaVersion: FORMA_SCHEMA_VERSION, frontend: frontendJson(p), backend: backendJson(p), createdAt: now, updatedAt: now })
      .returning();
    await this.snapshot(row!, "frontend", "user", null, ["+ проект"]);
    await this.snapshot(row!, "backend", "user", null, []);
    return dto(row!);
  }

  async get(userId: string, projectId: string): Promise<FormaProjectDto> {
    return dto(await this.owned(userId, projectId));
  }

  /** Revisions of both layers, cheap: lets an open editor notice an agent's change. */
  async revisions(userId: string, projectId: string) {
    const row = await this.owned(userId, projectId);
    return { frontendRevision: row.frontendRevision, backendRevision: row.backendRevision };
  }

  /** The visual editor's save: the frontend layer only, refused when based on an older revision. */
  async saveFrontend(userId: string, projectId: string, input: { baseRevision: number; document: unknown; checkpoint: boolean }): Promise<FormaSaveResult> {
    const row = await this.owned(userId, projectId);
    const doc = wrapForma(() => parseFrontendDocument(input.document));
    if (Buffer.byteLength(JSON.stringify(doc)) > LIMITS.frontendBytes) throw formaFail(FORMA_ERRORS.limit, "The project is too large.", 413);
    const updated = await this.writeFrontend(row, doc, input.baseRevision, "user", null);
    const last = await this.lastRevisionAt(row.id, "frontend");
    if (input.checkpoint || !last || this.ctx.now().getTime() - last.getTime() > FRONTEND_SNAPSHOT_MS) {
      await this.snapshot(updated, "frontend", "user", null, diffFrontend({ name: row.name, frontend: toProject(row).frontend }, { name: doc.name, frontend: doc.frontend }));
    }
    return { frontendRevision: updated.frontendRevision, updatedAt: updated.updatedAt.toISOString() };
  }

  private async writeFrontend(row: ProjectRow, doc: FrontendDocument, baseRevision: number, actor: "user" | "agent", agent: AgentRow | null): Promise<ProjectRow> {
    const now = this.ctx.now();
    const [updated] = await this.ctx.db
      .update(formaProjects)
      .set({ name: doc.name, frontend: frontendJson(doc), frontendRevision: sql`${formaProjects.frontendRevision} + 1`, updatedAt: now })
      .where(and(eq(formaProjects.id, row.id), eq(formaProjects.frontendRevision, baseRevision)))
      .returning();
    if (!updated) {
      const [cur] = await this.ctx.db.select({ r: formaProjects.frontendRevision }).from(formaProjects).where(eq(formaProjects.id, row.id));
      throw formaFail(FORMA_ERRORS.conflict, "The interface was changed in the meantime.", 409, { layer: "frontend", revision: cur?.r ?? 0, actor, agent: agent?.name ?? null });
    }
    return updated;
  }

  async remove(userId: string, projectId: string) {
    await this.owned(userId, projectId);
    await this.ctx.db.delete(formaProjects).where(eq(formaProjects.id, projectId));
    return { ok: true };
  }

  async history(userId: string, projectId: string): Promise<FormaRevisionDto[]> {
    await this.owned(userId, projectId);
    return this.revisionList(projectId);
  }

  private async revisionList(projectId: string, layer?: "frontend" | "backend"): Promise<FormaRevisionDto[]> {
    const rows = await this.ctx.db
      .select({ layer: formaRevisions.layer, revision: formaRevisions.revision, actor: formaRevisions.actor, agentName: formaRevisions.agentName, summary: formaRevisions.summary, createdAt: formaRevisions.createdAt })
      .from(formaRevisions)
      .where(layer ? and(eq(formaRevisions.projectId, projectId), eq(formaRevisions.layer, layer)) : eq(formaRevisions.projectId, projectId))
      .orderBy(desc(formaRevisions.createdAt))
      .limit(100);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /** The person restores an earlier version of the interface (becomes a new revision). */
  async restoreFrontend(userId: string, projectId: string, revision: number, baseRevision: number): Promise<FormaProjectDto> {
    const row = await this.owned(userId, projectId);
    const snap = await this.revisionSnapshot(projectId, "frontend", revision);
    const doc = wrapForma(() => parseFrontendDocument(snap));
    const updated = await this.writeFrontend(row, doc, baseRevision, "user", null);
    await this.snapshot(updated, "frontend", "user", null, [`↺ версия ${revision}`]);
    return dto(updated);
  }

  private async lastRevisionAt(projectId: string, layer: "frontend" | "backend"): Promise<Date | null> {
    const [r] = await this.ctx.db
      .select({ at: formaRevisions.createdAt })
      .from(formaRevisions)
      .where(and(eq(formaRevisions.projectId, projectId), eq(formaRevisions.layer, layer)))
      .orderBy(desc(formaRevisions.createdAt))
      .limit(1);
    return r?.at ?? null;
  }

  private async revisionSnapshot(projectId: string, layer: "frontend" | "backend", revision: number): Promise<Record<string, unknown>> {
    const [r] = await this.ctx.db
      .select({ snapshot: formaRevisions.snapshot })
      .from(formaRevisions)
      .where(and(eq(formaRevisions.projectId, projectId), eq(formaRevisions.layer, layer), eq(formaRevisions.revision, revision)));
    if (!r) throw notFound("Revision");
    return r.snapshot;
  }

  private async snapshot(row: ProjectRow, layer: "frontend" | "backend", actor: "user" | "agent", agent: AgentRow | null, summaryLines: string[]) {
    const revision = layer === "frontend" ? row.frontendRevision : row.backendRevision;
    const snapshot = layer === "frontend" ? { name: row.name, ...(row.frontend as Record<string, unknown>) } : row.backend;
    await this.ctx.db
      .insert(formaRevisions)
      .values({ projectId: row.id, layer, revision, actor, agentId: agent?.id ?? null, agentName: agent?.name ?? null, summary: summaryLines.slice(0, 50), snapshot })
      .onConflictDoNothing();
    // Keep the newest revisions of the layer.
    await this.ctx.db.execute(sql`
      delete from forma_revisions where project_id = ${row.id} and layer = ${layer}
      and revision < (select coalesce(min(revision), 0) from (select revision from forma_revisions where project_id = ${row.id} and layer = ${layer} order by revision desc limit ${KEEP_REVISIONS}) k)`);
  }

  // ---- agent connections (made by the person) --------------------------------

  async createAgent(userId: string, projectId: string, input: { name: string; client: AgentClient; scopes: AgentScope[]; ttlHours: number }, origin: string): Promise<FormaAgentCreated> {
    const row = await this.owned(userId, projectId);
    const now = this.ctx.now();
    const [{ n } = { n: 0 }] = await this.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(formaAgents)
      .where(and(eq(formaAgents.projectId, row.id), isNull(formaAgents.revokedAt), gt(formaAgents.expiresAt, now)));
    if (n >= FORMA_LIMITS.activeAgentsPerProject) throw formaFail(FORMA_ERRORS.limit, "Too many active connections.", 422);
    if (!(AGENT_CLIENTS as readonly string[]).includes(input.client)) throw formaFail(FORMA_ERRORS.invalid, "Unknown client.", 400);
    const token = `fma_${randomToken(30)}`;
    const [agent] = await this.ctx.db
      .insert(formaAgents)
      .values({
        ownerId: userId,
        projectId: row.id,
        name: input.name.trim().slice(0, 60) || "AI",
        client: input.client,
        scopes: normalizeScopes(input.scopes),
        tokenHash: sha256(token),
        tokenPrefix: token.slice(0, 10),
        expiresAt: new Date(now.getTime() + input.ttlHours * 3600_000),
        createdAt: now,
      })
      .returning();
    await this.audit(row.id, null, "user", "agent.create", true, { agent: agent!.name, client: agent!.client, scopes: agent!.scopes, expiresAt: agent!.expiresAt.toISOString() });
    return {
      agent: agentDto(agent!, now),
      token,
      endpoints: { rest: `${origin}/api/forma/agent/v1`, mcp: `${origin}/api/forma/mcp`, openapi: `${origin}/api/forma/agent/v1/openapi.json` },
    };
  }

  async listAgents(userId: string, projectId: string): Promise<FormaAgentDto[]> {
    await this.owned(userId, projectId);
    const rows = await this.ctx.db.select().from(formaAgents).where(eq(formaAgents.projectId, projectId)).orderBy(desc(formaAgents.createdAt));
    const now = this.ctx.now();
    return rows.map((a) => agentDto(a, now));
  }

  async revokeAgent(userId: string, projectId: string, agentId: string) {
    await this.owned(userId, projectId);
    const [a] = await this.ctx.db
      .update(formaAgents)
      .set({ revokedAt: this.ctx.now() })
      .where(and(eq(formaAgents.id, agentId), eq(formaAgents.projectId, projectId), isNull(formaAgents.revokedAt)))
      .returning();
    if (!a) throw notFound("Connection");
    await this.audit(projectId, null, "user", "agent.revoke", true, { agent: a.name });
    return { ok: true };
  }

  async auditLog(userId: string, projectId: string): Promise<FormaAuditDto[]> {
    await this.owned(userId, projectId);
    const rows = await this.ctx.db.select().from(formaAudit).where(eq(formaAudit.projectId, projectId)).orderBy(desc(formaAudit.createdAt)).limit(200);
    return rows.map((r) => ({ id: r.id, actor: r.actor, agentName: r.agentName, action: r.action, ok: r.ok, detail: r.detail, createdAt: r.createdAt.toISOString() }));
  }

  async audit(projectId: string, agent: AgentRow | null, actor: "user" | "agent", action: string, ok: boolean, detail: Record<string, unknown>) {
    await this.ctx.db.insert(formaAudit).values({ projectId, agentId: agent?.id ?? null, agentName: agent?.name ?? null, actor, action, ok, detail, createdAt: this.ctx.now() });
    if (Math.random() < 0.05) {
      await this.ctx.db.execute(sql`
        delete from forma_audit where project_id = ${projectId} and created_at < (
          select coalesce(min(created_at), 'epoch') from (select created_at from forma_audit where project_id = ${projectId} order by created_at desc limit ${KEEP_AUDIT}) k)`);
    }
  }

  // ---- the agent side -----------------------------------------------------------

  /** A token is valid when it is known, not revoked, not expired and its project still exists. */
  async authenticateAgent(header: string | undefined): Promise<AgentContext> {
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const unauthorized = () => formaFail(FORMA_ERRORS.agentUnauthorized, "A valid Forma agent token is required (Authorization: Bearer fma_...).", 401);
    if (!AGENT_TOKEN_RE.test(token)) throw unauthorized();
    const [agent] = await this.ctx.db.select().from(formaAgents).where(eq(formaAgents.tokenHash, sha256(token)));
    const now = this.ctx.now();
    if (!agent || agent.revokedAt || agent.expiresAt <= now) throw unauthorized();
    if (!agent.lastUsedAt || now.getTime() - agent.lastUsedAt.getTime() > 60_000) {
      await this.ctx.db.update(formaAgents).set({ lastUsedAt: now }).where(eq(formaAgents.id, agent.id));
    }
    return { agent, scopes: new Set(normalizeScopes(agent.scopes)) };
  }

  require(ctx: AgentContext, scope: AgentScope) {
    if (!ctx.scopes.has(scope)) throw formaFail(FORMA_ERRORS.scope, `This connection has no "${scope}" permission.`, 403, { scope });
  }

  async agentProject(ctx: AgentContext): Promise<ProjectRow> {
    const [row] = await this.ctx.db.select().from(formaProjects).where(eq(formaProjects.id, ctx.agent.projectId));
    if (!row) throw notFound("Project");
    return row;
  }

  async agentRead(ctx: AgentContext): Promise<FormaProjectDto> {
    return dto(await this.agentProject(ctx));
  }

  /** Agent writes to the backend layer (operations need backend.write, bindings need bindings.write). */
  async agentBackend(ctx: AgentContext, baseRevision: number, commands: BackendCommand[]): Promise<{ backendRevision: number; changes: string[] }> {
    for (const c of commands ?? []) {
      const scope: AgentScope = c?.type === "upsertBinding" || c?.type === "deleteBinding" ? "bindings.write" : "backend.write";
      this.require(ctx, scope);
    }
    const row = await this.agentProject(ctx);
    const before = toProject(row);
    const after = wrapForma(() => applyBackendCommands(before, commands, `${ctx.agent.name}`));
    // Round-trip validation of what is stored.
    wrapForma(() => ({ b: parseBackend(after.backend), x: parseBindings(after.bindings) }));
    return this.writeBackend(ctx, row, after, baseRevision, diffBackend(before, after));
  }

  async agentRollback(ctx: AgentContext, revision: number, baseRevision: number) {
    this.require(ctx, "backend.write");
    this.require(ctx, "bindings.write");
    const row = await this.agentProject(ctx);
    const snap = await this.revisionSnapshot(row.id, "backend", revision);
    const before = toProject(row);
    const restored = wrapForma(() => ({ ...before, backend: parseBackend(snap.backend), bindings: parseBindings(snap.bindings) }));
    return this.writeBackend(ctx, row, restored, baseRevision, [`↺ версия ${revision}`, ...diffBackend(before, restored)]);
  }

  private async writeBackend(ctx: AgentContext, row: ProjectRow, p: Project, baseRevision: number, changes: string[]) {
    const [updated] = await this.ctx.db
      .update(formaProjects)
      .set({ backend: backendJson(p), backendRevision: sql`${formaProjects.backendRevision} + 1`, updatedAt: this.ctx.now() })
      .where(and(eq(formaProjects.id, row.id), eq(formaProjects.backendRevision, baseRevision)))
      .returning();
    if (!updated) throw formaFail(FORMA_ERRORS.conflict, "The backend was changed in the meantime: read it again and retry.", 409, { layer: "backend", revision: row.backendRevision });
    await this.snapshot(updated, "backend", "agent", ctx.agent, changes);
    return { backendRevision: updated.backendRevision, changes };
  }

  /** Agent writes to the interface: only with the frontend.write scope, through the editor's own commands. */
  async agentFrontend(ctx: AgentContext, baseRevision: number, commands: Command[]) {
    this.require(ctx, "frontend.write");
    const row = await this.agentProject(ctx);
    const before = toProject(row);
    const after = wrapForma(() => applyCommands(before, commands).project);
    const doc = wrapForma(() => parseFrontendDocument({ name: after.name, settings: after.settings, frontend: after.frontend }));
    const updated = await this.writeFrontend(row, doc, baseRevision, "agent", ctx.agent);
    const changes = diffFrontend(before, after);
    await this.snapshot(updated, "frontend", "agent", ctx.agent, changes);
    return { frontendRevision: updated.frontendRevision, changes };
  }

  async agentCheck(ctx: AgentContext) {
    const p = toProject(await this.agentProject(ctx));
    const diagnostics = checkProject(p, checkSyntax);
    return { ok: !diagnostics.some((d) => d.level === "error"), diagnostics };
  }

  async agentTests(ctx: AgentContext, operation?: string) {
    this.require(ctx, "tests.run");
    const p = toProject(await this.agentProject(ctx));
    const reports = runContractTests(p, operation);
    return {
      executed: false,
      note: "Contract tests only: handler code is never executed until Forma has an isolated runtime.",
      passed: reports.filter((r) => r.contract === "passed").length,
      failed: reports.filter((r) => r.contract === "failed").length,
      reports,
    };
  }

  async agentRevisions(ctx: AgentContext, layer?: "frontend" | "backend") {
    return this.revisionList(ctx.agent.projectId, layer);
  }

  async agentRevision(ctx: AgentContext, layer: "frontend" | "backend", revision: number) {
    return { layer, revision, snapshot: await this.revisionSnapshot(ctx.agent.projectId, layer, revision) };
  }

  async agentDiff(ctx: AgentContext, layer: "frontend" | "backend", from: number, to: number) {
    const a = await this.revisionSnapshot(ctx.agent.projectId, layer, from);
    const b = await this.revisionSnapshot(ctx.agent.projectId, layer, to);
    const changes = wrapForma(() =>
      layer === "backend"
        ? diffBackend({ backend: parseBackend(a.backend), bindings: parseBindings(a.bindings) }, { backend: parseBackend(b.backend), bindings: parseBindings(b.bindings) })
        : diffFrontend(parseFrontendDocument(a), parseFrontendDocument(b)),
    );
    return { layer, from, to, changes };
  }
}
