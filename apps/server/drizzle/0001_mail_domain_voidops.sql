-- Move every existing internal address from @voidex.app to @voidops.ru.
-- Content already stored in messages (sender / recipients) is updated too, so
-- replies, contacts and search keep working for existing conversations.
UPDATE "mail_accounts" SET "domain" = 'voidops.ru', "address" = "local_part" || '@voidops.ru' WHERE "domain" = 'voidex.app';
--> statement-breakpoint
UPDATE "mail_messages" SET "sender_address" = regexp_replace("sender_address", '@voidex\.app$', '@voidops.ru') WHERE "sender_address" LIKE '%@voidex.app';
--> statement-breakpoint
UPDATE "mail_recipients" SET "address" = regexp_replace("address", '@voidex\.app$', '@voidops.ru') WHERE "address" LIKE '%@voidex.app';
