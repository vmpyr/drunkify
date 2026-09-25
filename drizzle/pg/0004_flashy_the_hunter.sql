CREATE TABLE "wrapped_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"user_id" text,
	"payload" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"source_revision" integer NOT NULL,
	"computed_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrapped_views" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"user_id" text NOT NULL,
	"watched_at" bigint,
	"last_viewed_at" bigint,
	"view_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wrapped_snapshots" ADD CONSTRAINT "wrapped_snapshots_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_snapshots" ADD CONSTRAINT "wrapped_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_views" ADD CONSTRAINT "wrapped_views_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_views" ADD CONSTRAINT "wrapped_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_wrapped_snapshots_personal" ON "wrapped_snapshots" USING btree ("trip_id","user_id","revision") WHERE "wrapped_snapshots"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_wrapped_snapshots_squad" ON "wrapped_snapshots" USING btree ("trip_id","revision") WHERE "wrapped_snapshots"."user_id" is null;--> statement-breakpoint
CREATE INDEX "ix_wrapped_snapshots_latest" ON "wrapped_snapshots" USING btree ("trip_id","user_id","revision" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_wrapped_views_trip_user" ON "wrapped_views" USING btree ("trip_id","user_id");