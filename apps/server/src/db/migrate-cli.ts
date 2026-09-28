import { loadConfig } from "../config.js";
import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
await runMigrations(db);
await pool.end();
console.log("Migrations applied.");
