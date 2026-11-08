CREATE TABLE `aas_app_state` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`document` text NOT NULL,
	`updated_at` text NOT NULL
);
