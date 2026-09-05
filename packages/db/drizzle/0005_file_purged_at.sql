-- Secure disposal that leaves the evidence behind — 16 CFR 314.4(c)(6).
--
-- `pnpm retention:purge` deletes the stored bytes of files belonging to requests the firm
-- marked complete more than N days ago, and stamps this column. The row survives: its
-- name, size and SHA-256 are the record that a document existed, what it was, and when it
-- was disposed of. Deleting the row would erase the evidence along with the document.
--
-- NULL means the bytes are still there, which is the state of every file today.

ALTER TABLE "file" ADD COLUMN "purged_at" timestamp (3) with time zone;