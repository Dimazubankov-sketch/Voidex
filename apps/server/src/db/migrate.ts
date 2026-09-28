import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";

/** Locates the drizzle/ folder both from sources (src/db) and from the bundle (dist). */
export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, "../../drizzle"), resolve(here, "../drizzle")]) {
    if (existsSync(resolve(candidate, "meta/_journal.json"))) return candidate;
  }
  throw new Error("Could not find the drizzle migrations folder.");
}

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
