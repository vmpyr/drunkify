CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text,
	"email" text,
	"trip_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"accepted_by" text,
	"accepted_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	CONSTRAINT "ck_invites_state" CHECK ("invites"."state" in ('pending', 'accepted', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint
);
--> statement-breakpoint
CREATE TABLE "trip_members" (
	"trip_id" text NOT NULL,
	"user_id" text NOT NULL,
	"color_index" bigint NOT NULL,
	"joined_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"last_opened_at" bigint,
	"first_drink_at" bigint,
	"missed_banner_dismissed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"timezone" text NOT NULL,
	"theme_id" text DEFAULT 'classic' NOT NULL,
	"unlock_at" bigint NOT NULL,
	"owner_id" text NOT NULL,
	"ceremony_started_at" bigint,
	"final24h_marked_at" bigint,
	"wrapped_unlocked_marked_at" bigint,
	"data_revision" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invites_token_hash" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_invites_trip_id" ON "invites" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "ix_invites_created_by" ON "invites" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ix_invites_state_expires_at" ON "invites" USING btree ("state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_password_resets_token_hash" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_password_resets_user_id" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_trip_members_trip_user" ON "trip_members" USING btree ("trip_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_trip_members_trip_color" ON "trip_members" USING btree ("trip_id","color_index");--> statement-breakpoint
CREATE INDEX "ix_trip_members_user_id" ON "trip_members" USING btree ("user_id");