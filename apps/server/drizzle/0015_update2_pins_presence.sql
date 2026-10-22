-- Update 2 — Vibex: several pinned messages per chat; presence (last seen).
--   * vibex_pins: the messages pinned in a chat (for everyone in it). The
--     conversation's pinned_message_id stays and keeps the newest pin, so an
--     older app (a rollback) still shows one pin. Existing pins are copied in.
--   * users.last_seen_at: when the account's last device went offline. Shown
--     to others only as their privacy setting allows (enforced by the server).
-- Additive only: no DROP, no TRUNCATE, no rewrite. Existing rows are not
-- touched; the new column is nullable.
CREATE TABLE IF NOT EXISTS "vibex_pins" (
	"conversation_id" uuid NOT NULL REFERENCES "vibex_conversations"("id") ON DELETE cascade,
	"message_id" uuid NOT NULL REFERENCES "vibex_messages"("id") ON DELETE cascade,
	"pinned_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vibex_pins_conversation_id_message_id_pk" PRIMARY KEY("conversation_id","message_id")
);
--> statement-breakpoint
INSERT INTO "vibex_pins" ("conversation_id", "message_id", "pinned_at")
SELECT c."id", c."pinned_message_id", now()
FROM "vibex_conversations" c
JOIN "vibex_messages" m ON m."id" = c."pinned_message_id" AND m."conversation_id" = c."id"
WHERE c."pinned_message_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;
