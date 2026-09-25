CREATE TABLE `applied_ops` (
	`client_op_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`trip_id` text NOT NULL,
	`drink_id` text NOT NULL,
	`type` text NOT NULL,
	`status_code` integer NOT NULL,
	`response` text NOT NULL,
	`applied_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_applied_ops_type" CHECK("applied_ops"."type" in ('create','update','delete','rate'))
);
--> statement-breakpoint
CREATE INDEX `ix_applied_ops_trip_user_applied` ON `applied_ops` (`trip_id`,`user_id`,`applied_at`);--> statement-breakpoint
CREATE TABLE `custom_drink_names` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`abv` real,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_custom_drink_names_user_category_name` ON `custom_drink_names` (`user_id`,`category`,`name`);--> statement-breakpoint
CREATE TABLE `drinks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`trip_id` text NOT NULL,
	`category` text NOT NULL,
	`drink_name` text NOT NULL,
	`size_ml` integer NOT NULL,
	`abv` real NOT NULL,
	`qty` real DEFAULT 1 NOT NULL,
	`drunk_at` integer NOT NULL,
	`lat` real,
	`lng` real,
	`accuracy` real,
	`altitude` real,
	`speed` real,
	`venue_id` text,
	`venue_name` text,
	`city` text,
	`country_code` text,
	`rating` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`edit_count` integer DEFAULT 0 NOT NULL,
	`last_edited_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_drinks_category" CHECK("drinks"."category" in ('beer','wine','cocktail','spirit','shot','cider','seltzer','soft','other')),
	CONSTRAINT "ck_drinks_size" CHECK("drinks"."size_ml" > 0),
	CONSTRAINT "ck_drinks_abv" CHECK("drinks"."abv" >= 0 and "drinks"."abv" <= 80),
	CONSTRAINT "ck_drinks_qty" CHECK("drinks"."qty" > 0),
	CONSTRAINT "ck_drinks_rating" CHECK("drinks"."rating" is null or "drinks"."rating" between 1 and 5),
	CONSTRAINT "ck_drinks_note" CHECK("drinks"."note" is null or length("drinks"."note") <= 80)
);
--> statement-breakpoint
CREATE INDEX `ix_drinks_trip_drunk_at` ON `drinks` (`trip_id`,`drunk_at`);--> statement-breakpoint
CREATE INDEX `ix_drinks_trip_user_drunk_at` ON `drinks` (`trip_id`,`user_id`,`drunk_at`);--> statement-breakpoint
CREATE INDEX `ix_drinks_recent_key` ON `drinks` (`user_id`,`category`,`drink_name`,`size_ml`);--> statement-breakpoint
CREATE INDEX `ix_drinks_trip_venue` ON `drinks` (`trip_id`,`venue_id`);--> statement-breakpoint
CREATE TABLE `favourites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`drink_name` text NOT NULL,
	`size_ml` integer NOT NULL,
	`abv` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_favourites_user_key` ON `favourites` (`user_id`,`category`,`drink_name`,`size_ml`);--> statement-breakpoint
CREATE TABLE `venues` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`name` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`source` text NOT NULL,
	`osm_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_venues_source" CHECK("venues"."source" in ('osm', 'user'))
);
--> statement-breakpoint
CREATE INDEX `ix_venues_trip_id` ON `venues` (`trip_id`);--> statement-breakpoint
CREATE INDEX `ix_venues_trip_lat_lng` ON `venues` (`trip_id`,`lat`,`lng`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_venues_trip_osm` ON `venues` (`trip_id`,`osm_id`) WHERE "venues"."osm_id" is not null;