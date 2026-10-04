/**
 * CLI for the Vibex demo data (development / test only):
 *
 *   pnpm seed:vibex-demo [your-address@voidops.ru]
 *   pnpm --filter @voidex/server db:seed:dev [your-address@voidops.ru]
 *
 * Refuses to run in production (NODE_ENV=production or a production config).
 * The data itself is described in demo-seed.ts.
 */
import { loadConfig } from "../config.js";
import { DEMO_PASSWORD, PRODUCTION_REFUSAL, seedVibexDemo } from "./demo-seed.js";

if (process.env.NODE_ENV === "production") {
  console.error(PRODUCTION_REFUSAL);
  process.exit(1);
}
const config = loadConfig();
if (config.production) {
  console.error(PRODUCTION_REFUSAL);
  process.exit(1);
}
const target = process.argv[2];
const r = await seedVibexDemo(config, { target });
const forTarget = !target ? "" : r.targetMissing ? `; no VOIDEX account ${target} — its demo chats were skipped` : `, demo chats for ${target} ${r.seededTarget ? "added" : "already there"}`;
console.log(`Demo Vibex data ready: ${r.createdAccounts} new account(s), UI-test content ${r.addedContent ? "added" : "already there"}${forTarget}. Sign in as demo.anna@${config.mailDomain} / ${DEMO_PASSWORD}`);
