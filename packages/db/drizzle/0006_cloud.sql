-- The cloud layer: subscriptions, team invitations, and a per-firm retention policy.
--
-- None of this changes how a self-hosted install behaves. A firm with no `subscription`
-- row is on `self_hosted`, which has no limits — the plan gate reads "no row" as
-- "unlimited", not as "unpaid". Gather Cloud is hosting and convenience; it does not
-- unlock the core, and the code has to make that structurally true rather than promised.
--
-- `subscription` is a **cache of Stripe**, written only by webhooks. Never by the redirect
-- back from Checkout: a client that never returns must not leave a firm unsubscribed, and
-- one that fakes the return must not leave them subscribed.
--
-- `firm_invite` is shaped like `access_token` and for the same reasons — 32 bytes of
-- CSPRNG stored only as SHA-256, per-invite expiry, revocable, every use recorded.

CREATE TYPE "public"."firm_plan" AS ENUM('self_hosted', 'cloud', 'cloud_pro');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled');--> statement-breakpoint
CREATE TABLE "firm_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "firm_role" DEFAULT 'member' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"invited_by" text,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"accepted_at" timestamp (3) with time zone,
	"accepted_by" text,
	"revoked_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firm_invite_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"plan" "firm_plan" DEFAULT 'self_hosted' NOT NULL,
	"status" "subscription_status" DEFAULT 'none' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_end" timestamp (3) with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"seat_limit" integer,
	"storage_limit_bytes" bigint,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firm" ADD COLUMN "retention_days" integer;--> statement-breakpoint
ALTER TABLE "firm_invite" ADD CONSTRAINT "firm_invite_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_invite" ADD CONSTRAINT "firm_invite_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_invite" ADD CONSTRAINT "firm_invite_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "firm_invite_firm_id_index" ON "firm_invite" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "firm_invite_pending" ON "firm_invite" USING btree ("firm_id","email") WHERE "firm_invite"."accepted_at" is null and "firm_invite"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "subscription_stripe_customer_id_index" ON "subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "subscription_stripe_subscription_id_index" ON "subscription" USING btree ("stripe_subscription_id");