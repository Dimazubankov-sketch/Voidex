import type { FastifyPluginAsync } from "fastify";
import { ErrorCode, NotificationListQuerySchema, SystemNotificationSchema } from "@voidex/shared";
import { z } from "zod";
import { parse } from "../http.js";
import { fail } from "../lib/errors.js";

const idParam = z.object({ id: z.string().uuid() });

/** Notification Center of the signed-in account: list, read, clear. */
export const notificationRoutes: FastifyPluginAsync = async (app) => {
  const { notifications } = app.services;
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (req) => {
    const q = parse(NotificationListQuerySchema, req.query);
    return notifications.list(req.auth!.userId, q.before, q.limit);
  });

  app.post("/read-all", async (req) => notifications.markAllRead(req.auth!.userId));

  app.post("/:id/read", async (req) => notifications.markRead(req.auth!.userId, parse(idParam, req.params).id));

  app.delete("/:id", async (req) => notifications.remove(req.auth!.userId, parse(idParam, req.params).id));

  app.delete("/", async (req) => notifications.clear(req.auth!.userId));

  /**
   * Development / test only: a "VOIDEX update" notice for the caller. In
   * production update notices are sent by operators (db:notify-update CLI).
   */
  app.post("/dev/system-update", async (req) => {
    if (app.ctx.config.env === "production") throw fail(ErrorCode.NotFound, "Not found.", { status: 404 });
    const body = parse(SystemNotificationSchema, req.body);
    return notifications.systemUpdate(body, req.auth!.userId);
  });
};
