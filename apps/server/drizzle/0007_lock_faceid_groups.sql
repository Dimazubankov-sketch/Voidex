-- Step 2.4 — code-password (passcode), session lock and step-up, Face ID through
-- WebAuthn (the device's own biometrics), Vibex group chats.
-- Additive only: no column or row is removed or rewritten.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passcode_hash" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passcode_set_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passcode_failed_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passcode_locked_until" timestamp with time zone;
--> statement-breakpoint
-- Accounts registered from Step 2.4 on create a passcode during first setup;
-- existing accounts can add one in Settings (false for them).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passcode_setup_required" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Auto-lock after this many minutes without activity (0 = only on start / manually).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auto_lock_minutes" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "step_up_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "webauthn_challenge" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "webauthn_challenge_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"device_id" uuid NOT NULL REFERENCES "devices"("id") ON DELETE cascade,
	"credential_id" text NOT NULL,
	"public_key" bytea NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webauthn_credentials_credential_uq" ON "webauthn_credentials" USING btree ("credential_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webauthn_credentials_user_idx" ON "webauthn_credentials" USING btree ("user_id", "device_id");
--> statement-breakpoint
ALTER TABLE "vibex_conversations" ADD COLUMN IF NOT EXISTS "title" text;
--> statement-breakpoint
ALTER TABLE "vibex_conversations" ADD COLUMN IF NOT EXISTS "avatar_file_id" uuid REFERENCES "vibex_files"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "vibex_conversations" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "vibex_members" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'member' NOT NULL;
