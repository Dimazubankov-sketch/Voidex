-- Step 2.11 — story reactions and replies; Appex Store reviews.
--   * a reaction to a story (one per person, replaceable) lives on the view
--     row of that person (a reaction is also a view);
--   * a reply to a story is a direct message that refers to the story;
--   * Appex Store: one review per person and app (editable, deletable),
--     likes / dislikes on reviews (one vote per person) and reports.
-- Additive only: no DROP, no TRUNCATE, no rewrite. Existing rows are not
-- touched; every new column is nullable.
ALTER TABLE "vibex_story_views" ADD COLUMN IF NOT EXISTS "reaction" text;
--> statement-breakpoint
ALTER TABLE "vibex_story_views" ADD COLUMN IF NOT EXISTS "reacted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "vibex_messages" ADD COLUMN IF NOT EXISTS "story_id" uuid REFERENCES "vibex_stories"("id") ON DELETE set null;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"rating" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "store_reviews_rating_ck" CHECK ("rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_reviews_app_user_uq" ON "store_reviews" USING btree ("app_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_reviews_app_idx" ON "store_reviews" USING btree ("app_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_review_votes" (
	"review_id" uuid NOT NULL REFERENCES "store_reviews"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"vote" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_review_votes_pk" PRIMARY KEY ("review_id", "user_id"),
	CONSTRAINT "store_review_votes_vote_ck" CHECK ("vote" IN (-1, 1))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_review_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL REFERENCES "store_reviews"("id") ON DELETE cascade,
	"reporter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"reason" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_review_reports_uq" ON "store_review_reports" USING btree ("review_id", "reporter_id");
