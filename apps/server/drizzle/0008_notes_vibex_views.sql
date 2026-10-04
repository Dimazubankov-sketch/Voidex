-- Step 2.5 — Voidex Notes storage (one document per account with a revision
-- for compare-and-swap saves, read-only share snapshots, images), Vibex:
-- deleting one's own chat message (a placeholder stays so replies keep
-- working) and unique post views.
-- Additive only: no column or row is removed or rewritten.
ALTER TABLE "vibex_messages" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_post_views" (
	"post_id" uuid NOT NULL REFERENCES "vibex_posts"("id") ON DELETE cascade,
	"viewer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vibex_post_views_pk" PRIMARY KEY("post_id","viewer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes_workspaces" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"data" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_media_owner_idx" ON "notes_media" USING btree ("owner_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes_shares" (
	"token" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_shares_owner_idx" ON "notes_shares" USING btree ("owner_id", "created_at");
