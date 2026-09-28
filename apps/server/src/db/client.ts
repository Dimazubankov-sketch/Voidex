import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction — services accept either. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 20 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
