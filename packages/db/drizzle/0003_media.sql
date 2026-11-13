-- #37: the media table is replaced rather than altered. SQLite cannot ADD a NOT
-- NULL column without a default, and nothing before #37 ever wrote a media row
-- (no route, no import), so there is no data to carry across. Hand-written: the
-- drizzle-kit output used ADD ... NOT NULL and would fail on any database.
DROP TABLE `media`;--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_item_id_idx` ON `media` (`item_id`,`deleted_at`,`position`);
