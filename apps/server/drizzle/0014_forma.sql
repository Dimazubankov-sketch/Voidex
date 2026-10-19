-- Forma (app builder): its own tables only. Additive: no other table is
-- touched, nothing is dropped or rewritten.
--   forma_projects   one row per app project: the person-edited frontend and
--                    the agent-written backend + bindings, with a revision
--                    counter per layer (stale writes are refused);
--   forma_revisions  history of each layer (snapshots, who, what changed);
--   forma_agents     AI agent connections: one project, scopes, expiry, a
--                    SHA-256 of the token (the token itself is never stored);
--   forma_audit      every agent call and every connection change.
CREATE TABLE IF NOT EXISTS "forma_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "schema_version" integer NOT NULL,
  "frontend" jsonb NOT NULL,
  "backend" jsonb NOT NULL,
  "frontend_revision" integer DEFAULT 1 NOT NULL,
  "backend_revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forma_projects_owner_idx" ON "forma_projects" ("owner_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forma_agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "forma_projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "client" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forma_agents_token_uq" ON "forma_agents" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forma_agents_project_idx" ON "forma_agents" ("project_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forma_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "forma_projects"("id") ON DELETE CASCADE,
  "layer" text NOT NULL,
  "revision" integer NOT NULL,
  "actor" text NOT NULL,
  "agent_id" uuid REFERENCES "forma_agents"("id") ON DELETE SET NULL,
  "agent_name" text,
  "summary" jsonb NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forma_revisions_uq" ON "forma_revisions" ("project_id", "layer", "revision");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forma_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "forma_projects"("id") ON DELETE CASCADE,
  "agent_id" uuid REFERENCES "forma_agents"("id") ON DELETE SET NULL,
  "actor" text NOT NULL,
  "agent_name" text,
  "action" text NOT NULL,
  "ok" boolean NOT NULL,
  "detail" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forma_audit_project_idx" ON "forma_audit" ("project_id", "created_at");
