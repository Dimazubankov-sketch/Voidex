-- Step 2.10 — Vibex: message actions and the activity tab.
--   * edited messages (when), forwarded messages (from whom), a pinned message
--     per chat, messages deleted "for me" (one row per person and message);
--   * the Vibex activity (new followers, likes, reposts, comments, added to a
--     group, a followed person published / posted a story), read per person.
-- Additive only: no DROP, no TRUNCATE, no rewrite. Existing messages, chats
-- and posts are not touched; every new column is nullable.
ALTER TABLE "vibex_messages" ADD COLUMN IF NOT EXISTS "edited_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "vibex_messages" ADD COLUMN IF NOT EXISTS "forwarded_from_id" uuid REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "vibex_conversations" ADD COLUMN IF NOT EXISTS "pinned_message_id" uuid REFERENCES "vibex_messages"("id") ON DELETE set null;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_message_hides" (
	"message_id" uuid NOT NULL REFERENCES "vibex_messages"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vibex_message_hides_pk" PRIMARY KEY ("message_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_message_hides_user_idx" ON "vibex_message_hides" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"type" text NOT NULL,
	"post_id" uuid REFERENCES "vibex_posts"("id") ON DELETE cascade,
	"conversation_id" uuid REFERENCES "vibex_conversations"("id") ON DELETE cascade,
	"story_id" uuid REFERENCES "vibex_stories"("id") ON DELETE cascade,
	"comment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_activity_user_idx" ON "vibex_activity" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_activity_unread_idx" ON "vibex_activity" USING btree ("user_id") WHERE "read_at" IS NULL;
