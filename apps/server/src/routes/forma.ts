import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AGENT_CLIENTS, AGENT_SCOPES, TOKEN_TTLS, LIMITS } from "@voidex/forma";
import { parse } from "../http.js";
import { formaFail } from "../services/forma.js";
import { formaAgentRoutes } from "./forma-agent.js";

const id = z.string().uuid();
const idParam = z.object({ id });
const agentParam = z.object({ id, agentId: id });
const createBody = z.object({ name: z.string().max(LIMITS.nameMax * 2).default(""), template: z.enum(["blank", "sample"]).default("blank") });
const saveBody = z.object({ baseRevision: z.number().int().min(0), document: z.unknown(), checkpoint: z.boolean().default(false) });
const restoreBody = z.object({ revision: z.number().int().min(0), baseRevision: z.number().int().min(0) });
const agentBody = z.object({
  name: z.string().max(60).default(""),
  client: z.enum(AGENT_CLIENTS),
  scopes: z.array(z.enum(AGENT_SCOPES)).max(AGENT_SCOPES.length),
  ttlHours: z.union(TOKEN_TTLS.map((h) => z.literal(h)) as unknown as [z.ZodLiteral<number>, z.ZodLiteral<number>]),
});

/**
 * Forma API for the person (session auth): projects, the frontend layer,
 * history, agent connections and their audit log. The backend layer is
 * read-only here: only an authorised agent writes it (see forma-agent.ts).
 */
export const formaRoutes: FastifyPluginAsync = async (app) => {
  const forma = app.services.forma;
  const scale = app.ctx.config.rateLimitScale;
  const limit = (max: number) => ({ config: { rateLimit: { max: max * scale, timeWindow: "1 minute" } } });

  // Agents: their own auth (project tokens), registered before the session hook below.
  await app.register(formaAgentRoutes, { service: () => forma });

  await app.register(async (user) => {
    user.addHook("preHandler", app.authenticate);
    user.addHook("onSend", async (_req, reply) => {
      if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
    });
    const me = (req: { auth?: { userId: string } | null }) => req.auth!.userId;

    user.get("/projects", async (req) => forma.list(me(req)));
    user.post("/projects", limit(30), async (req, reply) => {
      const body = parse(createBody, req.body);
      reply.status(201);
      return forma.create(me(req), body.name, body.template);
    });
    user.get("/projects/:id", async (req) => forma.get(me(req), parse(idParam, req.params).id));
    user.get("/projects/:id/revision", limit(240), async (req) => forma.revisions(me(req), parse(idParam, req.params).id));
    user.put("/projects/:id/frontend", { bodyLimit: 1024 * 1024, ...limit(240) }, async (req) => forma.saveFrontend(me(req), parse(idParam, req.params).id, parse(saveBody, req.body)));
    // The rule "a person reads and copies the backend, never edits it" is the server's, not the UI's.
    for (const method of ["PUT", "PATCH", "POST", "DELETE"] as const) {
      user.route({
        method,
        url: "/projects/:id/backend",
        handler: async () => {
          throw formaFail("forma_backend_read_only", "The backend is written by an authorised AI agent; in Forma it can be read and copied.", 403);
        },
      });
    }
    user.delete("/projects/:id", limit(30), async (req) => forma.remove(me(req), parse(idParam, req.params).id));
    user.get("/projects/:id/history", async (req) => forma.history(me(req), parse(idParam, req.params).id));
    user.post("/projects/:id/restore", limit(30), async (req) => {
      const body = parse(restoreBody, req.body);
      return forma.restoreFrontend(me(req), parse(idParam, req.params).id, body.revision, body.baseRevision);
    });

    user.get("/projects/:id/agents", async (req) => forma.listAgents(me(req), parse(idParam, req.params).id));
    user.post("/projects/:id/agents", limit(20), async (req, reply) => {
      reply.status(201);
      return forma.createAgent(me(req), parse(idParam, req.params).id, parse(agentBody, req.body), `${req.protocol}://${req.host}`);
    });
    user.delete("/projects/:id/agents/:agentId", limit(60), async (req) => {
      const p = parse(agentParam, req.params);
      return forma.revokeAgent(me(req), p.id, p.agentId);
    });
    user.get("/projects/:id/audit", async (req) => forma.auditLog(me(req), parse(idParam, req.params).id));
  });
};
