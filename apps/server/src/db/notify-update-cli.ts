/**
 * Operators only: sends a "VOIDEX update" notice to the Notification Center of
 * every active account (or one account by id).
 *
 *   pnpm --filter @voidex/server notify:update "VOIDEX 2.3" "What's new: …" [version] [user-id]
 *
 * Nothing is sent automatically; there is no update backend yet.
 */
import { SystemNotificationSchema } from "@voidex/shared";
import { loadConfig } from "../config.js";
import { PgBlobStorage } from "../services/blobs.js";
import { EventHub } from "../services/events.js";
import { NotificationService } from "../services/notifications.js";
import { ConsoleSmsProvider } from "../services/sms/index.js";
import { DisabledTranslator } from "../services/translate.js";
import { createDb } from "./client.js";

const [title, body = "", version, userId] = process.argv.slice(2);
const input = SystemNotificationSchema.safeParse({ title, body, version });
if (!input.success) {
  console.error('Usage: notify:update "<title>" "<text>" [version] [user-id]');
  process.exit(1);
}
const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const service = new NotificationService({
  db,
  config,
  sms: new ConsoleSmsProvider(() => {}),
  events: new EventHub(),
  blobs: new PgBlobStorage(db),
  translator: new DisabledTranslator(),
  now: () => new Date(),
});
const r = await service.systemUpdate(input.data, userId);
await pool.end();
console.log(`Update notice sent to ${r.sent} account(s).`);
