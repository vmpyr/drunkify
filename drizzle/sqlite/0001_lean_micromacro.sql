CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`name` text,
	`email` text,
	`trip_id` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`accepted_by` text,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_invites_state" CHECK("invites"."state" in ('pending', 'accepted', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_invites_token_hash` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `ix_invites_trip_id` ON `invites` (`trip_id`);--> statement-breakpoint
CREATE INDEX `ix_invites_created_by` ON `invites` (`created_by`);--> statement-breakpoint
CREATE INDEX `ix_invites_state_expires_at` ON `invites` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_password_resets_token_hash` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `ix_password_resets_user_id` ON `password_resets` (`user_id`);--> statement-breakpoint
CREATE TABLE `trip_members` (
	`trip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`color_index` integer NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_opened_at` integer,
	`first_drink_at` integer,
	`missed_banner_dismissed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_trip_members_trip_user` ON `trip_members` (`trip_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_trip_members_trip_color` ON `trip_members` (`trip_id`,`color_index`);--> statement-breakpoint
CREATE INDEX `ix_trip_members_user_id` ON `trip_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`timezone` text NOT NULL,
	`theme_id` text DEFAULT 'classic' NOT NULL,
	`unlock_at` integer NOT NULL,
	`owner_id` text NOT NULL,
	`ceremony_started_at` integer,
	`final24h_marked_at` integer,
	`wrapped_unlocked_marked_at` integer,
	`data_revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
