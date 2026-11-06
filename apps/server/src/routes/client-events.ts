import type { FastifyPluginAsync } from "fastify";
import { parse } from "../http.js";
import { clientEventSchema, scrubDetail, uaFamily } from "../lib/client-events.js";

/** POST /api/client-events — anonymous, tiny, rate-limited; only writes a sanitized line to the log. */
export const clientEventRoutes: FastifyPluginAsync = async (app) => {
  const scale = app.ctx.config.rateLimitScale;
  app.post(
    "/client-events",
    { bodyLimit: 2048, config: { rateLimit: { max: 20 * scale, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const ev = parse(clientEventSchema, req.body);
      req.log.warn(
        { clientEvent: { ...ev, detail: scrubDetail(ev.detail) }, ua: uaFamily(req.headers["user-agent"]) },
        `client event: ${ev.kind}`,
      );
      return reply.status(204).send();
    },
  );
};
