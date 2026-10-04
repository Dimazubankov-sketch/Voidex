import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "../db/client.js";
import { blobs } from "../db/schema.js";

/**
 * Where file contents live. Everything that stores bytes (mail attachments,
 * wallpapers) goes through this interface and keeps only the returned key, so
 * the backing store can later move to an object store without touching the
 * features. The current implementation keeps blobs in PostgreSQL, which gives
 * transactions and the existing pg_dump backups for free.
 */
export interface BlobStorage {
  put(input: { ownerUserId: string; purpose: BlobPurpose; mimeType: string; data: Buffer }, tx?: Tx): Promise<string>;
  get(key: string, tx?: Tx): Promise<{ mimeType: string; data: Buffer; ownerUserId: string; purpose: BlobPurpose } | null>;
  /** Copies a blob for another owner (e.g. a forwarded attachment). */
  copy(key: string, ownerUserId: string, tx?: Tx): Promise<string | null>;
  delete(keys: string[], tx?: Tx): Promise<void>;
  /** Keys of an owner's blobs for one purpose (e.g. their wallpaper). */
  keysOf(ownerUserId: string, purpose: BlobPurpose, tx?: Tx): Promise<string[]>;
}

export type BlobPurpose = "mail" | "wallpaper" | "lock-wallpaper" | "vibex" | "notes";

export class PgBlobStorage implements BlobStorage {
  constructor(private readonly db: Db) {}

  private newKey() {
    return `pg:${randomBytes(18).toString("base64url")}`;
  }

  async put(input: { ownerUserId: string; purpose: BlobPurpose; mimeType: string; data: Buffer }, tx: Tx = this.db) {
    const key = this.newKey();
    await tx
      .insert(blobs)
      .values({ key, ownerUserId: input.ownerUserId, purpose: input.purpose, mimeType: input.mimeType, sizeBytes: input.data.length, data: input.data });
    return key;
  }

  async get(key: string, tx: Tx = this.db) {
    const [row] = await tx.select().from(blobs).where(eq(blobs.key, key));
    return row ? { mimeType: row.mimeType, data: row.data, ownerUserId: row.ownerUserId, purpose: row.purpose } : null;
  }

  async copy(key: string, ownerUserId: string, tx: Tx = this.db) {
    const src = await this.get(key, tx);
    return src ? this.put({ ownerUserId, purpose: src.purpose, mimeType: src.mimeType, data: src.data }, tx) : null;
  }

  async delete(keys: string[], tx: Tx = this.db) {
    if (keys.length) await tx.delete(blobs).where(inArray(blobs.key, keys));
  }

  async keysOf(ownerUserId: string, purpose: BlobPurpose, tx: Tx = this.db) {
    const rows = await tx
      .select({ key: blobs.key })
      .from(blobs)
      .where(and(eq(blobs.ownerUserId, ownerUserId), eq(blobs.purpose, purpose)));
    return rows.map((r) => r.key);
  }
}
