import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

const config = loadConfig();

// Apply pending migrations on boot so every deploy has the right schema.
{
  const { db, pool } = createDb(config.databaseUrl);
  await runMigrations(db);
  await pool.end();
}

const app = await buildApp({ config });
await app.listen({ host: config.host, port: config.port });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  });
}
