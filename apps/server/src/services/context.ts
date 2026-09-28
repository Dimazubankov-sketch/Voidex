import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { EventHub } from "./events.js";
import type { SmsProvider } from "./sms/index.js";

/** Dependencies shared by all services. Built once in app.ts. */
export interface Ctx {
  db: Db;
  config: Config;
  sms: SmsProvider;
  events: EventHub;
  now: () => Date;
}

/** Who is calling and from where — passed into services that audit or bind to devices. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | undefined;
  native: boolean;
  deviceName?: string;
  /** Device secret presented by the client (cookie or native header), if any. */
  deviceToken?: string;
}
