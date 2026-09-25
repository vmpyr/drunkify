CREATE TABLE "applied_ops" (
	"client_op_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"drink_id" text NOT NULL,
	"type" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"applied_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "ck_applied_ops_type" CHECK ("applied_ops"."type" in ('create','update','delete','rate'))
);
--> statement-breakpoint
CREATE TABLE "custom_drink_names" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"abv" real,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"last_used_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drinks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"category" text NOT NULL,
	"drink_name" text NOT NULL,
	"size_ml" integer NOT NULL,
	"abv" real NOT NULL,
	"qty" real DEFAULT 1 NOT NULL,
	"drunk_at" bigint NOT NULL,
	"lat" real,
	"lng" real,
	"accuracy" real,
	"altitude" real,
	"speed" real,
	"venue_id" text,
	"venue_name" text,
	"city" text,
	"country_code" text,
	"rating" integer,
	"note" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"edit_count" integer DEFAULT 0 NOT NULL,
	"last_edited_at" bigint,
	CONSTRAINT "ck_drinks_category" CHECK ("drinks"."category" in ('beer','wine','cocktail','spirit','shot','cider','seltzer','soft','other')),
	CONSTRAINT "ck_drinks_size" CHECK ("drinks"."size_ml" > 0),
	CONSTRAINT "ck_drinks_abv" CHECK ("drinks"."abv" >= 0 and "drinks"."abv" <= 80),
	CONSTRAINT "ck_drinks_qty" CHECK ("drinks"."qty" > 0),
	CONSTRAINT "ck_drinks_rating" CHECK ("drinks"."rating" is null or "drinks"."rating" between 1 and 5),
	CONSTRAINT "ck_drinks_note" CHECK ("drinks"."note" is null or length("drinks"."note") <= 80)
);
--> statement-breakpoint
CREATE TABLE "favourites" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"drink_name" text NOT NULL,
	"size_ml" integer NOT NULL,
	"abv" real NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"name" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"source" text NOT NULL,
	"osm_id" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "ck_venues_source" CHECK ("venues"."source" in ('osm', 'user'))
);
--> statement-breakpoint
ALTER TABLE "applied_ops" ADD CONSTRAINT "applied_ops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applied_ops" ADD CONSTRAINT "applied_ops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_drink_names" ADD CONSTRAINT "custom_drink_names_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drinks" ADD CONSTRAINT "drinks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drinks" ADD CONSTRAINT "drinks_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drinks" ADD CONSTRAINT "drinks_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_applied_ops_trip_user_applied" ON "applied_ops" USING btree ("trip_id","user_id","applied_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_custom_drink_names_user_category_name" ON "custom_drink_names" USING btree ("user_id","category","name");--> statement-breakpoint
CREATE INDEX "ix_drinks_trip_drunk_at" ON "drinks" USING btree ("trip_id","drunk_at");--> statement-breakpoint
CREATE INDEX "ix_drinks_trip_user_drunk_at" ON "drinks" USING btree ("trip_id","user_id","drunk_at");--> statement-breakpoint
CREATE INDEX "ix_drinks_recent_key" ON "drinks" USING btree ("user_id","category","drink_name","size_ml");--> statement-breakpoint
CREATE INDEX "ix_drinks_trip_venue" ON "drinks" USING btree ("trip_id","venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_favourites_user_key" ON "favourites" USING btree ("user_id","category","drink_name","size_ml");--> statement-breakpoint
CREATE INDEX "ix_venues_trip_id" ON "venues" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "ix_venues_trip_lat_lng" ON "venues" USING btree ("trip_id","lat","lng");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_venues_trip_osm" ON "venues" USING btree ("trip_id","osm_id") WHERE "venues"."osm_id" is not null;