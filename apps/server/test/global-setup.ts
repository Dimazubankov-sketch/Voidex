import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runMigrations } from "../src/db/migrate.js";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://voidex:voidex@localhost:5432/voidex_test";

/** Fresh schema for every test run. */
export default async function setup() {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await runMigrations(drizzle(pool));
  await pool.end();
}
