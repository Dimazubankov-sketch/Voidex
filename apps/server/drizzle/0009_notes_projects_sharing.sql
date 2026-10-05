-- Step 2.6 — Voidex Notes: projects hold documents directly (notes and
-- presentations, no "spaces"), each document saved on its own with a revision,
-- access for other people (editor / viewer), shares that either hand out a copy
-- or give access to the original, per-person list preferences, and Notes share
-- cards in Vibex messages and VoidOps mail.
-- Additive only: the old per-account workspace (notes_workspaces) and the old
-- share snapshots stay as they are; each workspace is converted into projects
-- and documents the first time its owner opens Notes (notes_workspaces.migrated_at).
CREATE TABLE IF NOT EXISTS "notes_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"cover" text,
	"position" integer DEFAULT 0 NOT NULL,
	"legacy_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_projects_owner_idx" ON "notes_projects" USING btree ("owner_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "notes_projects"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"cover" text,
	"data" jsonb NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"legacy_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_documents_project_idx" ON "notes_documents" USING btree ("project_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes_members" (
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"role" text NOT NULL,
	"granted_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_members_pk" PRIMARY KEY("resource_type","resource_id","user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_members_user_idx" ON "notes_members" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "notes_shares" ADD COLUMN IF NOT EXISTS "resource_type" text;
--> statement-breakpoint
ALTER TABLE "notes_shares" ADD COLUMN IF NOT EXISTS "resource_id" uuid;
--> statement-breakpoint
ALTER TABLE "notes_shares" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'copy' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notes_shares" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'viewer' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notes_shares" ADD COLUMN IF NOT EXISTS "doc_kind" text;
--> statement-breakpoint
ALTER TABLE "notes_shares" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_shares_resource_idx" ON "notes_shares" USING btree ("resource_type", "resource_id");
--> statement-breakpoint
ALTER TABLE "notes_workspaces" ADD COLUMN IF NOT EXISTS "migrated_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vibex_messages" ADD COLUMN IF NOT EXISTS "notes_card" jsonb;
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "notes_cards" jsonb DEFAULT '[]'::jsonb NOT NULL;
