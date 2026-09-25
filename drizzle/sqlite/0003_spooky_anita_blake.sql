CREATE TABLE `achievement_unlocks` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`user_id` text,
	`triggered_by_user_id` text NOT NULL,
	`achievement_key` text NOT NULL,
	`drink_id` text,
	`vars` text DEFAULT '{}' NOT NULL,
	`unlocked_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`drink_id`) REFERENCES `drinks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_achievement_unlocks_personal` ON `achievement_unlocks` (`trip_id`,`user_id`,`achievement_key`) WHERE "achievement_unlocks"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_achievement_unlocks_group` ON `achievement_unlocks` (`trip_id`,`achievement_key`) WHERE "achievement_unlocks"."user_id" is null;--> statement-breakpoint
CREATE INDEX `ix_achievement_unlocks_trip_unlocked` ON `achievement_unlocks` (`trip_id`,`unlocked_at`);--> statement-breakpoint
CREATE TABLE `predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`q1_my_total_std` real,
	`q2_group_total_std` real,
	`q3_top_member_id` text,
	`q4_least_member_id` text,
	`q5_top_drink` text,
	`q5_top_drink_category` text,
	`locked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`q3_top_member_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`q4_least_member_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_predictions_q5_top_drink_category" CHECK("predictions"."q5_top_drink_category" in ('beer','wine','cocktail','spirit','shot','cider','seltzer','soft','other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_predictions_trip_user` ON `predictions` (`trip_id`,`user_id`);