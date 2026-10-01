import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { BlobStorage } from "./blobs.js";
import type { EventHub } from "./events.js";
import type { SmsProvider } from "./sms/index.js";
import type { Translator } from "./translate.js";

/** Dependencies shared by all services. Built once in app.ts. */
export interface Ctx {
  db: Db;
  config: Config;
  sms: SmsProvider;
  events: EventHub;
  blobs: BlobStorage;
  translator: Translator;
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
