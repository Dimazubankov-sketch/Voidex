-- Binary storage behind the BlobStorage interface: mail attachment content and
-- desktop wallpapers. Additive: older releases keep working.
CREATE TABLE IF NOT EXISTS "blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "blobs" ADD CONSTRAINT "blobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blobs_owner_idx" ON "blobs" USING btree ("owner_user_id","purpose");
