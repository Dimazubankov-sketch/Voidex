-- Step 2.3 — Notification Center, Vibex follows, profile details (bio, site,
-- city, cover, settings), comment threads, voice / video-circle messages.
-- Additive only: no column or row is removed or rewritten.
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"app" text NOT NULL,
	"type" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"actor_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"target" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON "notifications" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_follows" (
	"follower_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"followee_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vibex_follows_pk" PRIMARY KEY ("follower_id", "followee_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_follows_followee_idx" ON "vibex_follows" USING btree ("followee_id", "created_at");
--> statement-breakpoint
ALTER TABLE "vibex_profiles" ADD COLUMN IF NOT EXISTS "bio" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "vibex_profiles" ADD COLUMN IF NOT EXISTS "website" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "vibex_profiles" ADD COLUMN IF NOT EXISTS "city" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "vibex_profiles" ADD COLUMN IF NOT EXISTS "cover_key" text;
--> statement-breakpoint
ALTER TABLE "vibex_profiles" ADD COLUMN IF NOT EXISTS "cover_mime" text;
--> statement-breakpoint
ALTER TABLE "vibex_profiles" ADD COLUMN IF NOT EXISTS "cover_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "vibex_profiles" ADD COLUMN IF NOT EXISTS "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "vibex_comments" ADD COLUMN IF NOT EXISTS "root_id" uuid REFERENCES "vibex_comments"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "vibex_comments" ADD COLUMN IF NOT EXISTS "reply_to_id" uuid REFERENCES "vibex_comments"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "vibex_comments" ADD COLUMN IF NOT EXISTS "reply_to_user_id" uuid REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_comments_root_idx" ON "vibex_comments" USING btree ("root_id", "created_at");
--> statement-breakpoint
ALTER TABLE "vibex_messages" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'text' NOT NULL;
--> statement-breakpoint
ALTER TABLE "vibex_messages" ADD COLUMN IF NOT EXISTS "duration_ms" integer;
--> statement-breakpoint
ALTER TABLE "vibex_messages" ADD COLUMN IF NOT EXISTS "reply_to_id" uuid REFERENCES "vibex_messages"("id") ON DELETE set null;
