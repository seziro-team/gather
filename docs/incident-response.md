# Incident response plan

**This is a template. It is not a plan until you have filled in the names and phone numbers
and someone has read it.**

16 CFR § 314.4(h) requires a written incident response plan. This one is scoped to a Gather
install: it covers what to do when something happens to the system holding your clients'
tax documents. It is not a whole-firm plan, and it does not replace your WISP.

Print it. An incident response plan that only exists on the system that is on fire is not a
plan.

---

## Fill this in first

|                                                                               |     |
| ----------------------------------------------------------------------------- | --- |
| **Who decides** (the qualified individual under §314.4(a))                    |     |
| **Their phone number**                                                        |     |
| **Backup decision-maker**                                                     |     |
| **Who runs the server**                                                       |     |
| **Where Gather runs** (host, provider, region)                                |     |
| **Where backups are** (database, `gather-data` volume, encryption key)        |     |
| **Cyber insurance policy number and claims line**                             |     |
| **Lawyer**                                                                    |     |
| **State AG notification requirements** (varies; look yours up now, not later) |     |

---

## What counts as an incident

Any of these, and you do not need to be sure:

- A firm user's account or a device with an active session is compromised.
- A portal link reached somebody it was not meant for.
- The server is accessed by anyone who should not have accessed it.
- `pnpm verify:audit` fails.
- A file is found infected after it was downloaded.
- Documents appear somewhere they should not be.
- A backup, or the encryption key, is lost or exposed.

---

## First hour

**1. Write down the time.** Everything after this is easier with a timeline.

**2. Stop the bleeding, without destroying evidence.**

```bash
# Take Gather off the network but leave the containers and their state alone.
docker compose stop web worker
```

Do **not** `docker compose down -v`. That deletes the volumes — the database, the uploads
and the encryption key — and with them your ability to find out what happened.

**3. Snapshot the evidence before you change anything.**

```bash
# The audit trail, first, because it is what everything else is checked against.
DATABASE_URL=… pnpm verify:audit | tee incident-audit-verify.txt
docker compose exec -T db pg_dump -U gather gather > incident-db.sql
docker compose logs --no-color --timestamps > incident-logs.txt
```

**4. Answer these three questions, from the audit log.**

```sql
-- Who signed in, and from where?
select created_at, action, actor_id, ip, ua
  from audit_event
 where action like 'auth.%' and created_at > now() - interval '30 days'
 order by id desc;

-- Which portal links were opened, and by which address?
select created_at, request_id, ip, ua, metadata
  from audit_event
 where action in ('portal.opened', 'portal.link_rejected')
   and created_at > now() - interval '30 days'
 order by id desc;

-- What left the system?
select created_at, actor_id, request_id, metadata, ip
  from audit_event
 where action in ('request.downloaded', 'audit.exported')
 order by id desc;
```

`request.downloaded` carries the file count and byte total. That is your answer to "what
did they take", and it is the reason downloading is audited before the bytes move.

**5. Revoke everything that can be revoked.**

- Every portal link on any affected request — the request page, "Revoke".
- Every firm user's sessions: rotate `GATHER_AUTH_SECRET` in `.env` and restart. This signs
  everyone out at once.
- If the encryption key may be exposed, see "Key exposure" below.

---

## First day

**Work out the scope.** For each affected request, the audit trail gives you the client, the
documents, when they arrived and every time they were opened or downloaded. Export it:

```
/requests/<id>/audit.csv          one request
/audit?from=2026-01-01            the whole firm, bounded
```

Verify the export away from the database before you rely on it:

```bash
pnpm verify:audit --csv gather-audit-<id>.csv
```

**Decide whether you must notify.** You are a financial institution under the Safeguards
Rule. The FTC has required notification of certain events since May 2024, and every US
state has its own breach-notification law with its own trigger and deadline. **This is a
legal question, not a technical one.** Call your lawyer and your insurer today, not next
week.

**Tell the affected clients** when you have something true to tell them. The audit trail
lets you say precisely which documents were involved and when, which is a much better
conversation than "we are investigating".

---

## Specific situations

### `pnpm verify:audit` fails

Someone with database access edited or deleted an audit event. The trigger blocks that, so
they disabled it first — this was deliberate.

```bash
# Where the chain breaks, and therefore roughly when.
pnpm verify:audit
docker compose exec -T db psql -U gather -c \
  "select id, created_at, action from audit_event where id between <n>-3 and <n>+3;"
```

Treat everything after the break as unverified. Events _before_ it still verify
independently, so they remain usable.

### A portal link went to the wrong person

1. Revoke it on the request page. The link stops working immediately.
2. `select * from audit_event where request_id = '…' and action = 'portal.opened'` — the IP
   and user-agent of every open tells you whether it was used.
3. Issue a new link to the right address.

### Key exposure

If `GATHER_ENCRYPTION_KEY` is exposed, every document ever uploaded is readable by whoever
has it _and_ a copy of the storage.

There is no key rotation in Gather today (see Known issues in `progress.md`). Rotating means
decrypting with the old key and re-encrypting with a new one, which is a migration nobody
has written. If you are in this position, keep the old key — without it the documents are
unreadable — and talk to us before doing anything irreversible.

### A file was found infected after somebody downloaded it

The audit log records `file.quarantined` with the signature and the hash, and
`request.downloaded` tells you whether it left before the scan. Tell whoever opened it,
with the signature name so their own antivirus vendor can advise.

---

## Afterwards

- Write down what happened and when, while it is fresh.
- Fix the thing that let it happen, not just the symptom.
- If it was Gather's fault, tell us: see [SECURITY.md](../SECURITY.md). We would rather
  find out from you than from a blog post.
- Update this document with what you learned.

---

_Template last updated 2026-09-05. Review it annually — §314.4(g) — and after every
incident._
