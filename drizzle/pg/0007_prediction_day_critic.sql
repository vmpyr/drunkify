ALTER TABLE "predictions" DROP CONSTRAINT "ck_predictions_q5_top_drink_category";--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "q5_top_day" integer;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "q6_critic_member_id" text;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_q6_critic_member_id_users_id_fk" FOREIGN KEY ("q6_critic_member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "q5_top_drink";--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "q5_top_drink_category";
