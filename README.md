# Gather

**Stop being your clients' alarm clock.**

Gather is the open-source end of chasing clients for documents. You build a request, your
client gets a link — no account, no password, no app — and automated reminders do the
nagging until every item is in. You approve or reject **item by item**, so "done" means
you say it's done, not the client assuming it is.

Free and self-hosted is the whole product, not a demo. There is no cap on requests,
clients, seats or storage — only the disk you already pay for.

![Gather: building a request from a template, issuing a client link with no account, and reviewing what came back item by item](site/public/demo.gif)

_Recorded from a running install by `node scripts/capture-demo.mjs` — a real firm, a real
client, a real IRS W-9 through the real portal. Every screenshot in this repository and on
the site is produced the same way, so none of them can drift from the software._

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange)
![Node](https://img.shields.io/badge/node-%E2%89%A522.12-brightgreen)
![PostgreSQL](https://img.shields.io/badge/postgres-%E2%89%A513-blue)

> **Where this is up to.** Gather is built in the open, in phases, against a public plan
> ([`plan.md`](plan.md)). **The whole self-hosted product works end to end**: build a
> request, send a link, the client uploads from their phone, reminders chase until it is in,
> you approve item by item, your colleagues have roles, and everything lands in a
> tamper-evident audit trail you can export and verify away from the database.
>
> Everything under "What works today" genuinely works end to end and has a test that proves
> it against a running install. The one thing that does **not**: Gather Cloud's Stripe
> billing has never completed a call, because nobody has given this build a Stripe account —
> see [`docs/stripe-verification.md`](docs/stripe-verification.md). That affects the hosted
> tier only. Self-hosting is unaffected and always will be.

---

## Quickstart

You need Docker with the Compose plugin. Nothing else.

```bash
git clone https://github.com/seziro-team/gather.git
cd gather
cp .env.example .env
docker compose up -d
```

Then open <http://localhost:3000> and create the first account — it claims the install
and becomes the owner. Sign-ups close behind you.

Check it came up:

```bash
curl -fsS localhost:3000/api/health
# {"status":"ok","db":"ok","migrations":"applied","checkedAt":"..."}
```

`status: ok` means the database answered _and_ the schema is current — the container
applies migrations before it serves a single request.

You did not have to invent a secret: with `GATHER_AUTH_SECRET` left empty, Gather
generates a strong one on first boot and keeps it in the `gather-data` volume. Set it
yourself if you would rather hold it in your own secret store.

## What works today

- **PostgreSQL is the only service Gather needs.** No Redis, no broker, no object store.
- **Accounts with TOTP two-factor**, required by default. Any authenticator app works —
  1Password, Aegis, Google Authenticator, Bitwarden — plus one-time backup codes.
- **Clients and requests.** Add a client, build them a request out of sections and items —
  file uploads, short and long text, yes/no, dates, choices and numbers — with required
  flags, help text, drag-to-reorder (mouse, touch or arrow keys) and a live preview of
  exactly what the client will see.
- **Four real templates, included.** US individual tax year-end, new business onboarding,
  mortgage application, monthly bookkeeping close. Every item in all four is transcribed
  from published IRS, CFPB, SBA or Fannie Mae guidance and links to the page it came from —
  see [`templates/SOURCES.md`](templates/SOURCES.md). Save any request of your own as a
  template too; copies are independent, so editing one never changes the other.
- **A client portal with no account.** One link, no password, no app. Mobile-first, saves
  as they type, drag-drop or camera roll, and a real progress bar on a slow connection.
  Close the tab mid-sentence and nothing is lost.
- **Encrypted uploads.** AES-256-GCM envelope encryption before the bytes reach the disk or
  the bucket, on every storage driver. Content type is sniffed from the bytes, never the
  extension; downloads are always an attachment behind a five-minute signed URL.
- **Local disk or any S3-compatible store** — AWS, Cloudflare R2, Backblaze B2, Wasabi,
  SeaweedFS, MinIO, or the [Garage](https://garagehq.deuxfleurs.fr/) container in
  `docker-compose.s3.yml`. The same test suite proves both.
- **Reminders that stop.** Three cadences (every N days, an escalating ladder, chosen
  weekdays), sent at a time on **your client's** clock, with quiet hours. They stop on
  their own the moment everything required is in. Resend or any SMTP server.
  `pnpm check:email` reads your SPF, DKIM and DMARC records and sends a real test message,
  because reminders in a spam folder is the failure nobody notices.
- **Per-item approve and reject.** "Complete" is your judgement, item by item — never
  inferred from a file existing. Rejecting sends that one item back with a note the client
  reads, keeps the superseded file, and emails them. Approving the last required item
  completes the request and stops the reminders in the same breath.
- **A dashboard that opens on work** — what is waiting for you, what is overdue, how long
  each request has been outstanding.
- **Download everything as a zip**, foldered by section and item, with a manifest listing
  the SHA-256 of every file as recorded when it arrived.
- **Tamper-evident audit trail.** Every sign-in, edit, reminder, portal open, upload,
  decision and download is written to a hash-chained, append-only log. `UPDATE` and
  `DELETE` are blocked by a database trigger, and the CSV export **verifies away from the
  database** — `pnpm verify:audit --csv` recomputes every hash from the file alone.
- **Rate limiting, a real CSP, and optional virus scanning.** See
  [`docs/threat-model.md`](docs/threat-model.md) for what is defended and what is not.
- **Your colleagues, with roles.** Owner, admin and member — three roles and ten named
  permissions, in the free product rather than behind a plan. Invite by email or by handing
  someone the link; invitations expire, can be revoked, work once, and are audited. A
  colleague with no account signs up **through** the invitation, even on an install where
  sign-ups are closed.
- **Health endpoint, structured JSON logs, one-command Docker deployment**, and
  `docker-compose.prod.yml` for a real server: Caddy, automatic Let's Encrypt TLS, HSTS,
  nightly `pg_dump`, and nothing but the proxy listening.

Not built: SMS reminders, e-signature and Drive/Dropbox/OneDrive sync. They were planned for
the hosted tier and were **cut rather than stubbed** — each needs a third-party account
nobody has yet, and shipping integrations that have never run is exactly what this project
refuses to do. [`plan.md` §7.2](plan.md) records what each one needs.

## Verify the audit trail yourself

```bash
# Chain intact
DATABASE_URL=postgres://gather:gather@localhost:5432/gather pnpm verify:audit
# OK: 7 events, chain intact (head 3f9a1c4e7b02…)

# The database refuses to let you edit history
docker compose exec -T db psql -U gather -c \
  "update audit_event set action='nothing_happened' where id=2;"
# ERROR: audit_event is append-only: UPDATE is not permitted
```

Tampering is only possible by disabling the trigger, which is exactly what the hash chain
is there to catch — do that, edit a row, and `pnpm verify:audit` fails at the row you
touched.

The part that makes it evidence rather than a log: **the export verifies without the
database.** Hand the CSV to a client, an insurer or an auditor and they can check it
themselves, with no access to Gather and no need to take your word for anything:

```bash
# Download it from a request page, or /audit for the whole firm, then:
pnpm verify:audit --csv gather-audit-2026-09-05.csv
# OK: 11 events, every row's hash recomputes (head 6c8869fa2e6a…)

# Change one character of one field and it says exactly where:
# FAIL at id=781: hash mismatch on event 781 — its content was modified after it
# was written (stored 7244139f3a18…, recomputed 832d8f9075b9…)
```

## Architecture

```
                 ┌─────────────────────────────┐
  Client ──────▶ │  Magic-link portal          │
  (no account)   │  mobile-first checklist     │
                 ├─────────────────────────────┤
  Firm   ──────▶ │  Dashboard · builder ·      │   Next.js 16 (App Router)
  (session+TOTP) │  review                     │   one container
                 └──────────────┬──────────────┘
                                │
                   ┌────────────┴────────────┐
                   ▼                         ▼
            ┌─────────────┐          ┌──────────────────┐
            │ PostgreSQL  │          │ Storage driver   │
            │ data + jobs │          │ local disk | S3  │
            └─────────────┘          └──────────────────┘
                                             │
                              external, optional, env-driven:
                              Resend | SMTP · ClamAV
```

| Layer     | Choice                             | Why                                                     |
| --------- | ---------------------------------- | ------------------------------------------------------- |
| Language  | TypeScript                         | One language for portal, dashboard, API and worker      |
| Framework | Next.js 16 App Router              | Portal + dashboard + API in one deployable              |
| Database  | PostgreSQL 18                      | JSONB for item configs, and it doubles as the job queue |
| ORM       | Drizzle                            | Plain SQL migrations you can read before running        |
| Auth      | Better Auth + TOTP                 | Self-hostable; satisfies 16 CFR 314.4(c)(5)             |
| Storage   | Local disk (default) or any S3 API | Zero extra services by default                          |
| Styling   | Tailwind CSS v4                    | No web fonts, no external requests                      |

Full reasoning, competitor teardown and the security checklist are in [`plan.md`](plan.md).

## Self-hosted vs Cloud

Self-hosted is the real product. Gather Cloud is hosting and convenience for people who
would rather not run it — it does not unlock the core.

|                                                            | **Self-hosted**  | **Gather Cloud**     |
| ---------------------------------------------------------- | ---------------- | -------------------- |
| Request builder, portal, reminders, approvals, audit trail | ✅               | ✅ the same code     |
| Team roles and invitations                                 | ✅               | ✅                   |
| Requests and clients                                       | Unlimited        | Unlimited            |
| Seats                                                      | Unlimited        | 3 · 10 on Pro        |
| Storage                                                    | Your disk        | 25 GB · 100 GB       |
| Your clients' documents live on                            | Your server      | Seziro's servers     |
| Hosting, backups, updates, running the retention purge     | You              | Us                   |
| Price                                                      | **Free forever** | Planned $25 · $59/mo |

Every paid line is hosting or someone else doing the work. Nothing in the free product is
crippled to create the paid one, and the code enforces it: `self_hosted` has `null` for every
limit, not a large number — there is no meter to turn down later.

_Cloud is not open for signups yet: its billing has not been proven against a real Stripe
account. The code is here and runs — `pnpm test:cloud`._

## Turning things on

Everything below is opt-in, and Gather works without any of it.

```bash
# Email, so reminders actually go out. Set MAIL_DRIVER and the rest in .env, then:
pnpm check:email you@yourfirm.example

# A real SMTP server for development — catches mail instead of relaying it.
docker compose -f docker-compose.yml -f docker-compose.mail.yml up -d
open http://localhost:8025

# An S3-compatible object store instead of local disk.
docker compose -f docker-compose.yml -f docker-compose.s3.yml up -d

# Virus scanning. ⚠️ ClamAV wants 3–4 GiB of RAM — more than the rest of Gather
# combined, which is why it is not on by default.
docker compose -f docker-compose.yml -f docker-compose.antivirus.yml up -d
```

**Behind a reverse proxy**, set `GATHER_TRUST_PROXY=true` so Gather can tell one client
from another for rate-limiting. Leave it off otherwise: with it on and nothing in front,
anyone can set the header and choose their own bucket.

## Putting it on a real server

`docker-compose.prod.yml` is the whole deployment: Caddy in front, automatic Let's Encrypt
certificates, HSTS, nothing but 80 and 443 published, and a nightly `pg_dump`.

```bash
# On the server, with DNS already pointing at it:
cat >> .env <<'EOF'
GATHER_DOMAIN=gather.yourfirm.example
GATHER_APP_URL=https://gather.yourfirm.example
ACME_EMAIL=you@yourfirm.example
POSTGRES_PASSWORD=$(openssl rand -base64 32)
GATHER_AUTH_SECRET=$(openssl rand -base64 48)
GATHER_ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

No domain appears anywhere in the repo — every hostname is an environment variable.

**Two things to do yourself**, because software that pretends otherwise is lying:

1. **Copy the backups off this machine.** The nightly dump lands in the `gather-backups`
   volume, on the same disk as the database it is protecting. `docker compose cp` it to
   somewhere else, on a schedule you check.
2. **Keep `GATHER_ENCRYPTION_KEY` somewhere other than the server.** Without it the stored
   files cannot be read, and there is no recovery and no key rotation — see
   [`docs/incident-response.md`](docs/incident-response.md).

## Running it as a service for other firms

Gather Cloud is the same code with `GATHER_CLOUD=true`: plan limits, a billing page backed
by Stripe, and an operator console at `/admin` for whoever runs it. On a self-hosted install
`GATHER_ADMIN_EMAILS` is empty, `/admin` does not exist for anybody, and there is no back
door into your firm's data.

```bash
docker compose -f docker-compose.yml -f docker-compose.cloud.yml up -d --build
pnpm test:cloud   # brings the tier up and drives it
```

⚠️ **The Stripe calls have never succeeded.** They are written against the official SDK with
the API version pinned, the webhook logic is unit-tested, and the Subscribe button provably
reaches Stripe — but no subscription has ever been created, because nobody has given this
build an account. [`docs/stripe-verification.md`](docs/stripe-verification.md) is the
procedure that closes it. Until somebody runs it, treat hosted billing as untested code.

## Disposing of documents you no longer need

16 CFR 314.4(c)(6) asks a firm to dispose of customer information it no longer needs.
Gather will not decide that for you — retention is **off** by default — but when you do
decide:

```bash
# What would go, and nothing else.
docker compose exec worker node dist/cli/retention-purge.js --older-than 365d
# Do it.
docker compose exec worker node dist/cli/retention-purge.js --older-than 365d --confirm
```

Only files belonging to requests **you marked complete** are eligible. The record — name,
size, SHA-256 — and the audit trail survive, because "there was a document here and it was
disposed of on this date" is what disposal is supposed to leave behind.

## Roadmap

| Phase |                                                           | Status      |
| ----- | --------------------------------------------------------- | ----------- |
| 1     | Foundation: schema, accounts, two-factor, audit trail, CI | ✅ shipped  |
| 2     | Request builder and real templates                        | ✅ shipped  |
| 3     | Client portal and encrypted uploads                       | ✅ shipped  |
| 4     | Reminder engine                                           | ✅ shipped  |
| 5     | Approve/reject, dashboard, zip, audit export              | ✅ shipped  |
| 6     | Security hardening pass                                   | ✅ shipped  |
| 7     | Team roles, Gather Cloud, billing, production deployment  | ✅ shipped¹ |
| 8     | Website, docs, launch                                     | in progress |

¹ Everything but Stripe itself, which has never had an account to talk to. The gap and the
procedure that closes it are in [`docs/stripe-verification.md`](docs/stripe-verification.md).

## Configuration

Every setting is an environment variable, documented with its default and where to obtain
it in [`.env.example`](.env.example). Nothing phones home.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). In short:

```bash
pnpm install
docker compose up -d db
cp .env.example .env
pnpm build && pnpm db:migrate && pnpm seed:templates
pnpm dev
```

The Docker image runs the migrations and installs the built-in templates itself on boot;
`pnpm db:migrate` and `pnpm seed:templates` are for running from a source checkout.

To change what the built-in templates ask for, edit `packages/core/src/templates/` and run
`pnpm build && pnpm docs:sources`. CI fails if `templates/SOURCES.md` and the code
disagree, and a test fails any built-in item that cites no source at all.

## Security

Gather handles tax documents, so the security posture is written down rather than implied:

- **[`docs/threat-model.md`](docs/threat-model.md)** — what is defended, from whom, and
  where the defences end.
- **[`docs/safeguards-rule-mapping.md`](docs/safeguards-rule-mapping.md)** — which parts of
  the FTC Safeguards Rule Gather does something about, and the longer list of what it does
  **not** do for you. Gather ships controls that help; it does not make a firm compliant,
  and it says so.
- **[`docs/incident-response.md`](docs/incident-response.md)** — a template to fill in
  before you need it.
- **[SECURITY.md](SECURITY.md)** — reporting a vulnerability in Gather itself.

## Built on

Gather stands on other people's open source:

- [Better Auth](https://github.com/better-auth/better-auth) — authentication and TOTP (MIT)
- [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm) — schema and migrations (Apache-2.0)
- [Next.js](https://github.com/vercel/next.js) (MIT) and [React](https://github.com/facebook/react) (MIT)
- [node-postgres](https://github.com/brianc/node-postgres) (MIT)
- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) (MIT)
- [PostgreSQL](https://www.postgresql.org/) (PostgreSQL Licence)
- [node-qrcode](https://github.com/soldair/node-qrcode) (MIT)
- [Zod](https://github.com/colinhacks/zod) (MIT), [Vitest](https://github.com/vitest-dev/vitest) (MIT), [Playwright](https://github.com/microsoft/playwright) (Apache-2.0)

- [pg-boss](https://github.com/timgit/pg-boss) — the job queue, on Postgres alone (MIT)
- [nodemailer](https://github.com/nodemailer/nodemailer) — SMTP (MIT)
- [yazl](https://github.com/thejoshwolfe/yazl) — streamed zip archives (MIT)
- [file-type](https://github.com/sindresorhus/file-type) — magic-byte sniffing (MIT)
- [Garage](https://garagehq.deuxfleurs.fr/) — the optional object store (AGPL-3.0)
- [ClamAV](https://www.clamav.net/) — the optional virus scanner (GPL-2.0)
- [Mailpit](https://github.com/axllent/mailpit) — the development mail server (MIT)

- [Stripe](https://github.com/stripe/stripe-node) — billing on the hosted tier (MIT)
- [Caddy](https://github.com/caddyserver/caddy) — TLS in `docker-compose.prod.yml` (Apache-2.0)

## License

[AGPL-3.0-only](LICENSE). Running Gather for your own firm carries no obligations. If you
modify Gather and offer it to others over a network, you must publish your modifications.

Built in the open by [Seziro](https://github.com/seziro-team).
