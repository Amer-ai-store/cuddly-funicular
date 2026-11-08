CREATE TABLE `aas_repository_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`document` text,
	`checked_at` integer DEFAULT 0 NOT NULL,
	`attempted_at` integer DEFAULT 0 NOT NULL,
	`error` text
);
