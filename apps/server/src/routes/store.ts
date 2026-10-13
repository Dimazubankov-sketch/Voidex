import type { FastifyPluginAsync } from "fastify";
import { STORE_REVIEW_SORTS, StoreReportSchema, StoreReviewSchema, StoreVoteSchema } from "@voidex/shared";
import { z } from "zod";
import { parse } from "../http.js";
import { catalogApp } from "../services/store.js";

const appParam = z.object({ id: z.string().min(1).max(40) });
const reviewParam = appParam.extend({ reviewId: z.string().uuid() });
const listQuery = z.object({ sort: z.enum(STORE_REVIEW_SORTS).default("date") });

/**
 * Step 2.11: Appex Store API. The catalog itself is the App Registry (the
 * client has it); here are the real reviews, their votes and reports, and
 * install / update of an app to the registry's version. Every route acts as
 * the signed-in VOIDEX account (no separate Store login).
 */
export const storeRoutes: FastifyPluginAsync = async (app) => {
  const { store, apps } = app.services;
  const scale = app.ctx.config.rateLimitScale;
  const limit = (max: number) => ({ config: { rateLimit: { max: max * scale, timeWindow: "1 minute" } } });
  app.addHook("preHandler", app.authenticate);
  app.addHook("onSend", async (_req, reply) => {
    if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
  });
  const me = (req: { auth?: { userId: string } | null }) => req.auth!.userId;

  app.get("/stats", async () => store.allStats());
  app.get("/apps/:id/reviews", async (req) => {
    const { id } = parse(appParam, req.params);
    return store.list(me(req), id, parse(listQuery, req.query).sort);
  });
  app.put("/apps/:id/review", limit(30), async (req) => {
    const { id } = parse(appParam, req.params);
    return store.upsert(me(req), id, parse(StoreReviewSchema, req.body));
  });
  app.delete("/apps/:id/review", limit(30), async (req) => store.remove(me(req), parse(appParam, req.params).id));
  app.post("/apps/:id/reviews/:reviewId/vote", limit(120), async (req) => {
    const { id, reviewId } = parse(reviewParam, req.params);
    return store.vote(me(req), id, reviewId, parse(StoreVoteSchema, req.body).vote);
  });
  app.post("/apps/:id/reviews/:reviewId/report", limit(20), async (req) => {
    const { id, reviewId } = parse(reviewParam, req.params);
    const body = parse(StoreReportSchema, req.body);
    return store.report(me(req), id, reviewId, body.reason, body.description);
  });
  app.post("/apps/:id/install", limit(60), async (req) => apps.install(me(req), catalogApp(parse(appParam, req.params).id)));
};
