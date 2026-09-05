# Gather and the FTC Safeguards Rule

**Gather ships controls that help a firm meet specific obligations. It does not make a firm
compliant, and nothing in this document says it does.**

Compliance is a property of your whole information security program — your staff, your
laptops, your other vendors, your written plan — not of any one tool. What follows is an
honest map of which parts of 16 CFR § 314.4 Gather does something about, what it actually
does, and the much longer list of things it does not touch.

If you are looking for a vendor who will tell you that installing their software makes you
compliant, we are not that vendor and you should be suspicious of the ones who are.

---

## Why this applies to you

Under the **FTC Safeguards Rule**
([16 CFR § 314](https://www.law.cornell.edu/cfr/text/16/314.4), verified 2026-07-28), tax
preparers, accountants and bookkeepers are "financial institutions" and must maintain a
written information security program. **IRS Publication 4557** requires a written plan (a
WISP) on top of that.

If you collect a client's W-2, their bank statements or their Social Security card, you are
in scope. Gather exists because that collection usually happens over email attachments,
which is the worst available option.

---

## What Gather does, element by element

| § 314.4 element                                          | What Gather actually does                                                                                                                                                                                                               | Where                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **(c)(1)** Access controls, least privilege              | Every query is firm-scoped **in the query**, not checked afterwards. A client's portal session is scoped to one request by a path-scoped cookie and cannot reach another. Roles: owner / admin / member.                                | `lib/portal.ts`, `packages/db/src/responses.ts` |
| **(c)(2)** Inventory of customer information             | Every file is a row: name, size, SHA-256, which storage driver holds it, when it arrived and from which IP. The zip export carries a manifest of all of it.                                                                             | `file` table, `MANIFEST.txt`                    |
| **(c)(3)** Encryption in transit and at rest             | In transit: TLS is yours to terminate; cookies are `Secure` on HTTPS and HSTS is sent. At rest: **AES-256-GCM envelope encryption on every storage driver**, per-file key wrapped by a master key from the environment.                 | `packages/storage/src/crypto.ts`                |
| **(c)(4)** Secure development practices                  | CI runs typecheck, lint, format, unit and integration tests against a real Postgres, end-to-end tests against the built image, and `pnpm audit --prod --audit-level high`. Dependabot is on.                                            | `.github/workflows/ci.yml`                      |
| **(c)(5)** Multi-factor authentication                   | TOTP, **required by default** for every firm user. The dashboard is unreachable until enrolment is finished. Backup codes are issued.                                                                                                   | `lib/auth.ts`                                   |
| **(c)(6)** Secure disposal                               | `pnpm retention:purge` deletes stored bytes for requests completed more than N days ago. The file record survives with its hash, so disposal leaves evidence rather than a gap. Dry run by default; retention is off unless you set it. | `apps/worker/src/cli/retention-purge.ts`        |
| **(c)(8)** Monitoring and logging of authorised activity | A hash-chained, append-only audit log of every request, reminder, portal open, upload, decision and download. Exportable as CSV that **verifies away from the database**.                                                               | `audit_event`, `pnpm verify:audit`              |
| **(h)** Written incident response plan                   | A template you fill in — see [incident-response.md](./incident-response.md).                                                                                                                                                            | `docs/`                                         |

Plus, specific to this threat model rather than to the Rule:

- **Magic links**: 32 bytes of CSPRNG, stored only as SHA-256, exchanged once for a session
  and never seen again. Per-token expiry, revocable, every use logged with IP and
  user-agent.
- **Uploads**: content sniffed from magic bytes, never from the extension; size caps;
  filenames sanitized; SHA-256 of the plaintext recorded; always served
  `Content-Disposition: attachment` with `nosniff` and a `default-src 'none'` policy.
- **Rate limiting** on magic-link redemption, uploads, autosaves, downloads and exports, in
  Postgres so it survives a restart and is shared between replicas.
- **Virus scanning**, opt-in (see below).

---

## What Gather does **not** do for you

This is the section that matters. None of the following is covered by installing Gather.

**§ 314.4(a) — a qualified individual.** Somebody has to be responsible for your program.
Software cannot be that person.

**§ 314.4(b) — a written risk assessment.** Gather does not know what other systems you
run, who has access to them, or what your risks are.

**§ 314.4(d) — continuous monitoring or annual penetration testing.** Gather logs its own
activity. It does not monitor your network, your endpoints, or anything outside itself, and
nobody has pen-tested your install.

**§ 314.4(e) — security awareness training.** The most common breach in a small firm is
somebody clicking something. Gather does not train anyone.

**§ 314.4(f) — service provider oversight.** Self-hosting means _you_ are the service
provider, which removes one third party from your assessment and adds you to it. If you use
Gather Cloud, we become a service provider you have to assess — ask us for what you need.

**§ 314.4(g) — reassessing the program as things change.** A document, not a feature.

**§ 314.4(i) — annual reporting to your board or equivalent.** Ditto.

**The machine Gather runs on.** Disk encryption, OS patching, firewall rules, SSH keys,
backups and their restoration are entirely yours. Gather encrypts files before they reach
the disk, which helps if the disk is stolen and does nothing if the server is compromised
while running.

**Your email.** Reminders are only private in transit as far as your mail provider makes
them. Gather never puts a document in an email — only a link — but the link is a bearer
token, and an inbox somebody else can read is a request somebody else can open.

**Key management.** `GATHER_ENCRYPTION_KEY` protects every document. Gather generates one
on first boot for local storage and refuses to generate one for S3. Backing it up, rotating
it, and keeping it somewhere other than the server it protects are yours.

**Deciding what to keep.** Retention defaults to _never purge_. Gather will not delete a
firm's client documents on a timer the firm did not set.

---

## Virus scanning is off by default, and says so

ClamAV needs 3–4 GiB of RAM — more than the rest of Gather combined. Turning it on by
default would break the promise that Gather runs on a cheap VPS.

So it is opt-in:

```bash
docker compose -f docker-compose.yml -f docker-compose.antivirus.yml up -d
```

With it **on**, an upload cannot be downloaded by anyone — including the firm — until it
has been scanned. An infected file is quarantined: the record and the audit event stay as
evidence, the bytes are deleted, and the client is told.

With it **off**, every file is marked `skipped` and the interface says "Not scanned" next
to it. It is never silently treated as clean, because the difference between "we checked
and it was fine" and "nobody looked" is the whole point.

---

## What to do if something goes wrong

See [incident-response.md](./incident-response.md), and
[SECURITY.md](../SECURITY.md) for reporting a vulnerability in Gather itself.

---

_Last reviewed 2026-09-05 against 16 CFR § 314.4 as published on Cornell LII. If you are
reading this much later than that, re-check the regulation before relying on this table._
