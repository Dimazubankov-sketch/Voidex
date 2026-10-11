-- Step 2.9 — Vibex: stories (24 hours, then the author's archive) with their
-- views, per-person chat settings (notifications off, "deleted for me"), and
-- two new upload purposes ("story", "postfile": a Files attachment on a post;
-- purpose is plain text, no constraint to change).
-- Additive only: no DROP, no TRUNCATE, no rewrite. Existing chats, posts and
-- messages are not touched; the new member columns default to "as before".
ALTER TABLE "vibex_members" ADD COLUMN IF NOT EXISTS "muted" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "vibex_members" ADD COLUMN IF NOT EXISTS "cleared_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "vibex_members" ADD COLUMN IF NOT EXISTS "hidden" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"file_id" uuid NOT NULL REFERENCES "vibex_files"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_stories_owner_idx" ON "vibex_stories" USING btree ("owner_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_stories_expires_idx" ON "vibex_stories" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vibex_stories_file_uq" ON "vibex_stories" USING btree ("file_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_story_views" (
	"story_id" uuid NOT NULL REFERENCES "vibex_stories"("id") ON DELETE cascade,
	"viewer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vibex_story_views_pk" PRIMARY KEY ("story_id", "viewer_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_story_views_viewer_idx" ON "vibex_story_views" USING btree ("viewer_id");
