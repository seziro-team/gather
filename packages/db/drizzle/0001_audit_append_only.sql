-- Enforce append-only semantics on the audit log at the database level.
--
-- The hash chain makes tampering *detectable*; this trigger makes the ordinary
-- forms of it *impossible*. A stray UPDATE from application code, a hand-typed
-- psql statement, or an ORM cascade can no longer touch a recorded event.
--
-- It is not a defence against someone with superuser rights, who can disable the
-- trigger — which is precisely the case the hash chain and `pnpm verify:audit`
-- exist to catch. The two layers are deliberate: prevention for accidents and
-- application bugs, detection for deliberate tampering.

CREATE OR REPLACE FUNCTION gather_audit_append_only() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_event is append-only: % is not permitted', TG_OP
		USING ERRCODE = 'restrict_violation',
		      HINT = 'Audit events are tamper-evident by design. Record a correction by appending a new event.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_event_append_only
	BEFORE UPDATE OR DELETE ON "audit_event"
	FOR EACH ROW EXECUTE FUNCTION gather_audit_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate
	BEFORE TRUNCATE ON "audit_event"
	FOR EACH STATEMENT EXECUTE FUNCTION gather_audit_append_only();
