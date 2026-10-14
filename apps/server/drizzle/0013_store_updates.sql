-- Step 2.12 — Appex Store updates.
--   * updated_at: when the installed version last changed by an update (the
--     Store's "recently updated");
--   * auto_update: this app's own auto-update choice (NULL: the Store's
--     global choice in the preferences applies);
--   * notified_version: the version an "update available" notification was
--     already sent for (one notification per new version).
-- Additive only: no DROP, no TRUNCATE, no rewrite. Existing rows are not
-- touched; every new column is nullable.
ALTER TABLE "installed_apps" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "installed_apps" ADD COLUMN IF NOT EXISTS "auto_update" boolean;
--> statement-breakpoint
ALTER TABLE "installed_apps" ADD COLUMN IF NOT EXISTS "notified_version" text;
