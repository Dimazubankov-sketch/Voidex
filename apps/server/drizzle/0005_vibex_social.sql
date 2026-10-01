-- Step 2.2 — Vibex: profiles (activation of Vibex for a VOIDEX account),
-- comments, post editing, "not interested" and reports. Additive only.
CREATE TABLE IF NOT EXISTS "vibex_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Everyone who already used Vibex (Step 2.1) keeps using it without a new sign-in.
INSERT INTO "vibex_profiles" ("user_id")
SELECT DISTINCT u FROM (
	SELECT "author_id" AS u FROM "vibex_posts"
	UNION SELECT "user_id" FROM "vibex_members"
	UNION SELECT "user_id" FROM "vibex_likes"
	UNION SELECT "user_id" FROM "vibex_bookmarks"
) s
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "vibex_posts" ADD COLUMN IF NOT EXISTS "edited_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL REFERENCES "vibex_posts"("id") ON DELETE cascade,
	"author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibex_comments_post_idx" ON "vibex_comments" USING btree ("post_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_hidden_posts" (
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"post_id" uuid NOT NULL REFERENCES "vibex_posts"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vibex_hidden_posts_pk" PRIMARY KEY ("user_id", "post_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibex_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"post_id" uuid NOT NULL REFERENCES "vibex_posts"("id") ON DELETE cascade,
	"reason" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vibex_reports_once_uq" ON "vibex_reports" USING btree ("reporter_id", "post_id");
