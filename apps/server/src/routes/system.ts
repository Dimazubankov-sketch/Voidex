import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { LEGAL_KEYS, isLanguageCode, DEFAULT_LANGUAGE, type ServerInfoDto } from "@voidex/shared";
import { z } from "zod";
import { parse } from "../http.js";

export const VERSION = "0.1.0";

export const systemRoutes: FastifyPluginAsync = async (app) => {
  const { config } = app.ctx;

  /**
   * Liveness + readiness: 200 only when the API runs AND PostgreSQL answers.
   * `revision` lets the deploy pipeline confirm the new build is the one serving.
   */
  app.get("/health", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    await app.ctx.db.execute(sql`select 1`);
    return { ok: true, revision: config.revision };
  });

  app.get("/system/info", async (): Promise<ServerInfoDto> => ({
    name: "VOIDEX",
    version: VERSION,
    environment: config.env,
    mailDomain: config.mailDomain,
    smsProvider: app.ctx.sms.name,
    smsDevMode: app.ctx.sms.isDevelopment,
    smsAvailable: app.ctx.sms.enabled,
    revision: config.revision,
  }));

  const langQuery = z.object({ lang: z.string().max(10).optional() });

  app.get("/legal", async (req) => {
    const { lang } = parse(langQuery, req.query);
    return app.services.legal.list(isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE);
  });

  app.get("/legal/:key", async (req) => {
    const { key } = parse(z.object({ key: z.enum(LEGAL_KEYS) }), req.params);
    const { lang } = parse(langQuery, req.query);
    return app.services.legal.get(key, isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE);
  });
};
