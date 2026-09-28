import type { FastifyPluginAsync } from "fastify";
import {
  DraftCreateSchema,
  DraftInputSchema,
  MailListQuerySchema,
  MailMessageFlagSchema,
  MailThreadActionSchema,
  MailThreadQuerySchema,
} from "@voidex/shared";
import { z } from "zod";
import { parse } from "../http.js";

const idParam = z.object({ id: z.string().uuid() });

/** VOIDEX Mail API. Every call is scoped to the caller's own mailbox by MailService. */
export const mailRoutes: FastifyPluginAsync = async (app) => {
  const { mail } = app.services;
  app.addHook("preHandler", app.authenticate);

  app.get("/summary", async (req) => mail.summary(req.auth!.userId));

  app.get("/threads", async (req) => mail.list(req.auth!.userId, parse(MailListQuerySchema, req.query)));

  app.get("/threads/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { view } = parse(MailThreadQuerySchema, req.query);
    return mail.thread(req.auth!.userId, id, view);
  });

  app.post("/threads/actions", async (req) => {
    const body = parse(MailThreadActionSchema, req.body);
    return mail.threadAction(req.auth!.userId, body.threadIds, body.action);
  });

  app.patch("/messages/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return mail.flagMessage(req.auth!.userId, id, parse(MailMessageFlagSchema, req.body));
  });

  app.get("/messages/:id/compose", async (req) => {
    const { id } = parse(idParam, req.params);
    const { mode } = parse(z.object({ mode: z.enum(["reply", "reply_all", "forward"]) }), req.query);
    return mail.composeDefaults(req.auth!.userId, id, mode);
  });

  app.post("/drafts", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    reply.status(201);
    return mail.createDraft(req.auth!.userId, parse(DraftCreateSchema, req.body));
  });

  app.get("/drafts/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return mail.getDraft(req.auth!.userId, id);
  });

  app.put("/drafts/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return mail.updateDraft(req.auth!.userId, id, parse(DraftInputSchema, req.body));
  });

  app.delete("/drafts/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return mail.deleteDraft(req.auth!.userId, id);
  });

  app.post("/drafts/:id/send", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return mail.sendDraft(req.auth!.userId, id);
  });

  app.get("/resolve", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const { address } = parse(z.object({ address: z.string().min(1).max(254) }), req.query);
    return mail.resolveAddress(address);
  });

  app.get("/contacts", async (req) => {
    const { q } = parse(z.object({ q: z.string().max(100).default("") }), req.query);
    return mail.contacts(req.auth!.userId, q);
  });
};
