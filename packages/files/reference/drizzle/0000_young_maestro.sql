CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`folder` text,
	`favorite` integer DEFAULT 0 NOT NULL,
	`trashed` integer DEFAULT 0 NOT NULL,
	`downloaded` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL,
	`revision` integer NOT NULL,
	`size` integer NOT NULL,
	`blob` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`token` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`file` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`editable` integer DEFAULT 0 NOT NULL,
	`blob` text,
	`created` integer NOT NULL
);
