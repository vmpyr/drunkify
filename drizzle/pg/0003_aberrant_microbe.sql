CREATE TABLE "achievement_unlocks" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"user_id" text,
	"triggered_by_user_id" text NOT NULL,
	"achievement_key" text NOT NULL,
	"drink_id" text,
	"vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unlocked_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"user_id" text NOT NULL,
	"q1_my_total_std" real,
	"q2_group_total_std" real,
	"q3_top_member_id" text,
	"q4_least_member_id" text,
	"q5_top_drink" text,
	"q5_top_drink_category" text,
	"locked_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "ck_predictions_q5_top_drink_category" CHECK ("predictions"."q5_top_drink_category" in ('beer','wine','cocktail','spirit','shot','cider','seltzer','soft','other'))
);
--> statement-breakpoint
ALTER TABLE "achievement_unlocks" ADD CONSTRAINT "achievement_unlocks_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_unlocks" ADD CONSTRAINT "achievement_unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_unlocks" ADD CONSTRAINT "achievement_unlocks_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_unlocks" ADD CONSTRAINT "achievement_unlocks_drink_id_drinks_id_fk" FOREIGN KEY ("drink_id") REFERENCES "public"."drinks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_q3_top_member_id_users_id_fk" FOREIGN KEY ("q3_top_member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_q4_least_member_id_users_id_fk" FOREIGN KEY ("q4_least_member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_achievement_unlocks_personal" ON "achievement_unlocks" USING btree ("trip_id","user_id","achievement_key") WHERE "achievement_unlocks"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_achievement_unlocks_group" ON "achievement_unlocks" USING btree ("trip_id","achievement_key") WHERE "achievement_unlocks"."user_id" is null;--> statement-breakpoint
CREATE INDEX "ix_achievement_unlocks_trip_unlocked" ON "achievement_unlocks" USING btree ("trip_id","unlocked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_predictions_trip_user" ON "predictions" USING btree ("trip_id","user_id");