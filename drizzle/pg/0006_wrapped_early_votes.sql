CREATE TABLE "wrapped_early_votes" (
	"trip_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wrapped_early_votes" ADD CONSTRAINT "wrapped_early_votes_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_early_votes" ADD CONSTRAINT "wrapped_early_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_wrapped_early_votes_trip_user" ON "wrapped_early_votes" USING btree ("trip_id","user_id");