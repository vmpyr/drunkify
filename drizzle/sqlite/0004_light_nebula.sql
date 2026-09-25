CREATE TABLE `wrapped_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`user_id` text,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`source_revision` integer NOT NULL,
	`computed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_wrapped_snapshots_personal` ON `wrapped_snapshots` (`trip_id`,`user_id`,`revision`) WHERE "wrapped_snapshots"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_wrapped_snapshots_squad` ON `wrapped_snapshots` (`trip_id`,`revision`) WHERE "wrapped_snapshots"."user_id" is null;--> statement-breakpoint
CREATE INDEX `ix_wrapped_snapshots_latest` ON `wrapped_snapshots` (`trip_id`,`user_id`,"revision" desc);--> statement-breakpoint
CREATE TABLE `wrapped_views` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`watched_at` integer,
	`last_viewed_at` integer,
	`view_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_wrapped_views_trip_user` ON `wrapped_views` (`trip_id`,`user_id`);