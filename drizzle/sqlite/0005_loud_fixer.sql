CREATE TABLE `ceremony_state` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`current_card_index` integer DEFAULT 0 NOT NULL,
	`sub_step` integer DEFAULT 0 NOT NULL,
	`held` integer DEFAULT false NOT NULL,
	`started_by` text,
	`started_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_ceremony_state_status" CHECK("ceremony_state"."status" in ('not_started','running','ended')),
	CONSTRAINT "ck_ceremony_state_card_index" CHECK("ceremony_state"."current_card_index" >= 0 and "ceremony_state"."current_card_index" <= 10),
	CONSTRAINT "ck_ceremony_state_sub_step" CHECK("ceremony_state"."sub_step" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_ceremony_state_trip` ON `ceremony_state` (`trip_id`);