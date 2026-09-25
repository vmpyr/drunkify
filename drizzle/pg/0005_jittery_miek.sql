CREATE TABLE "ceremony_state" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"current_card_index" integer DEFAULT 0 NOT NULL,
	"sub_step" integer DEFAULT 0 NOT NULL,
	"held" boolean DEFAULT false NOT NULL,
	"started_by" text,
	"started_at" bigint,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "ck_ceremony_state_status" CHECK ("ceremony_state"."status" in ('not_started','running','ended')),
	CONSTRAINT "ck_ceremony_state_card_index" CHECK ("ceremony_state"."current_card_index" >= 0 and "ceremony_state"."current_card_index" <= 10),
	CONSTRAINT "ck_ceremony_state_sub_step" CHECK ("ceremony_state"."sub_step" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ceremony_state" ADD CONSTRAINT "ceremony_state_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceremony_state" ADD CONSTRAINT "ceremony_state_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_ceremony_state_trip" ON "ceremony_state" USING btree ("trip_id");