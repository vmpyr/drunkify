PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`q1_my_total_std` real,
	`q2_group_total_std` real,
	`q3_top_member_id` text,
	`q4_least_member_id` text,
	`q5_top_day` integer,
	`q6_critic_member_id` text,
	`locked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`q3_top_member_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`q4_least_member_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`q6_critic_member_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_predictions`("id", "trip_id", "user_id", "q1_my_total_std", "q2_group_total_std", "q3_top_member_id", "q4_least_member_id", "locked_at", "created_at", "updated_at") SELECT "id", "trip_id", "user_id", "q1_my_total_std", "q2_group_total_std", "q3_top_member_id", "q4_least_member_id", "locked_at", "created_at", "updated_at" FROM `predictions`;--> statement-breakpoint
DROP TABLE `predictions`;--> statement-breakpoint
ALTER TABLE `__new_predictions` RENAME TO `predictions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_predictions_trip_user` ON `predictions` (`trip_id`,`user_id`);
