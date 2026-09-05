-- Record which storage driver holds each file's bytes.
--
-- Without this, `STORAGE_DRIVER` at download time decides where Gather looks — so a firm
-- that starts on local disk and later moves to S3 would find every document it had already
-- collected reported missing. The driver that wrote an object is a property of the object,
-- not of the current configuration.
--
-- 'local' is the right default for existing rows: the S3 driver did not exist when they
-- were written.

ALTER TABLE "file" ADD COLUMN "storage_driver" text DEFAULT 'local' NOT NULL;
