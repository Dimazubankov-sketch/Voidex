-- Vibex: messenger (direct chats, messages, files) and social feed (posts,
-- reposts, likes, bookmarks). Additive: no existing table changes.
CREATE TABLE IF NOT EXISTS "vibex_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'direct' NOT NULL,
	"direct_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vibex_conversations_direct_uq" ON "vibex_conversations" USING btree ("direct_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_members" (
	"conversation_id" uuid NOT NULL REFERENCES "vibex_conversations"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"last_read_at" timestamp with time zone,
	"pinned_position" integer,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vibex_members_conversation_id_user_id_pk" PRIMARY KEY ("conversation_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_members_user_idx" ON "vibex_members" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"kind" text DEFAULT 'post' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"repost_of_id" uuid REFERENCES "vibex_posts"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_posts_created_idx" ON "vibex_posts" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_posts_author_idx" ON "vibex_posts" USING btree ("author_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_posts_repost_of_idx" ON "vibex_posts" USING btree ("repost_of_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vibex_posts_one_repost_uq" ON "vibex_posts" USING btree ("author_id", "repost_of_id") WHERE kind = 'repost' AND deleted_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL REFERENCES "vibex_conversations"("id") ON DELETE cascade,
	"sender_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"text" text DEFAULT '' NOT NULL,
	"shared_post_id" uuid REFERENCES "vibex_posts"("id") ON DELETE set null,
	"shared_post" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_messages_conversation_idx" ON "vibex_messages" USING btree ("conversation_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"purpose" text NOT NULL,
	"message_id" uuid REFERENCES "vibex_messages"("id") ON DELETE cascade,
	"post_id" uuid REFERENCES "vibex_posts"("id") ON DELETE cascade,
	"position" integer DEFAULT 0 NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_files_message_idx" ON "vibex_files" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_files_post_idx" ON "vibex_files" USING btree ("post_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_files_owner_idx" ON "vibex_files" USING btree ("owner_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_likes" (
	"post_id" uuid NOT NULL REFERENCES "vibex_posts"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vibex_likes_post_id_user_id_pk" PRIMARY KEY ("post_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_likes_user_idx" ON "vibex_likes" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_bookmarks" (
	"post_id" uuid NOT NULL REFERENCES "vibex_posts"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vibex_bookmarks_post_id_user_id_pk" PRIMARY KEY ("post_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_bookmarks_user_idx" ON "vibex_bookmarks" USING btree ("user_id", "created_at");
