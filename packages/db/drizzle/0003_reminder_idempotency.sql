-- What makes a reminder send exactly once.
--
-- The row is inserted before the message is handed to a mail driver, with a key derived
-- from the schedule and how many reminders it has already sent. A worker that is killed
-- between "wrote the log row" and "the SMTP server replied" computes the same key when it
-- restarts, collides with this index, and declines to send a second copy.
--
-- Resend's Idempotency-Key header carries the same value and collapses duplicates at their
-- end too, but SMTP has no equivalent — and a guarantee that holds for only one of two
-- shipped drivers is not a guarantee. This index is the real one.
--
-- NOT NULL with no default is safe here: reminder_log is written only by the reminder
-- engine, which does not exist before this migration, so the table is empty on every
-- install that runs it.

ALTER TABLE "reminder_log" ADD COLUMN "idempotency_key" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_log_idempotency_key_index" ON "reminder_log" USING btree ("idempotency_key");
