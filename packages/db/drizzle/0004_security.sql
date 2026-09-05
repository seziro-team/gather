-- Rate limiting, in the database rather than in memory.
--
-- `rate_limit` is Better Auth's own store, added so `rateLimit.storage: 'database'` has
-- somewhere to write. Until now the limiter used in-memory storage, which meant limits
-- reset on every restart and were not shared between replicas — so "five sign-in attempts
-- a minute" was really five per container per deploy, which is not a limit.
--
-- `throttle` is Gather's, for everything that is not an auth endpoint: magic-link
-- redemption, portal reads, uploads, autosaves, downloads and exports. A fixed window per
-- bucket, updated in one atomic upsert so two simultaneous requests cannot both read zero
-- and both be allowed.
--
-- Neither table holds anything sensitive: a bucket key is a scope plus a session id or an
-- IP address, and both are already in the audit log with more context.

CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "throttle" (
	"bucket" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp (3) with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key_idx" ON "rate_limit" USING btree ("key");--> statement-breakpoint
CREATE INDEX "throttle_window_started_at_index" ON "throttle" USING btree ("window_started_at");