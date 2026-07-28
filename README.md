# Gather

**Stop being your clients' alarm clock.**

Gather is the open-source end of chasing clients for documents. You build a request, your
client gets a link — no account, no password, no app — and automated reminders do the
nagging until every item is in. You approve or reject **item by item**, so "done" means
you say it's done, not the client assuming it is.

Free and self-hosted is the whole product, not a demo. There is no cap on requests,
clients, seats or storage — only the disk you already pay for.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange)
![Node](https://img.shields.io/badge/node-%E2%89%A522.12-brightgreen)
![PostgreSQL](https://img.shields.io/badge/postgres-%E2%89%A513-blue)

> **Where this is up to.** Gather is being built in the open, in phases, against a public
> plan ([`plan.md`](plan.md)). **Phase 2 of 8 is done: the request builder and the built-in
> templates.** What is listed under "What works today" genuinely works end to end —
> everything else is not there yet rather than half there. See the [roadmap](#roadmap).

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
- **Tamper-evident audit trail.** Every sign-in, client change, request edit and template
  save is written to a hash-chained, append-only log. `UPDATE` and `DELETE` are blocked by
  a database trigger; `pnpm verify:audit` re-checks the whole chain and exits non-zero if
  anything was altered or removed.
- **Health endpoint, structured JSON logs, one-command Docker deployment.**

Not yet: sending a request to a client, the portal, uploads, reminders, approvals. Those
are Phases 3–5.

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

|                                                            | **Self-hosted**  | **Gather Cloud** |
| ---------------------------------------------------------- | ---------------- | ---------------- |
| Requests, clients, seats, storage                          | Unlimited        | Unlimited        |
| Request builder, portal, reminders, approvals, audit trail | ✅               | ✅               |
| Your clients' documents live on                            | Your server      | Seziro's servers |
| Hosting, backups, updates                                  | You              | Us               |
| SMS reminders, e-signature, Drive/Dropbox/OneDrive sync    | —                | ✅               |
| Price                                                      | **Free forever** | Planned $25/mo   |

_Cloud is not available yet — it is Phase 7._

## Roadmap

| Phase |                                                           | Status     |
| ----- | --------------------------------------------------------- | ---------- |
| 1     | Foundation: schema, accounts, two-factor, audit trail, CI | ✅ shipped |
| 2     | Request builder and real templates                        | ✅ shipped |
| 3     | Client portal and encrypted uploads                       | next       |
| 4     | Reminder engine                                           | planned    |
| 5     | Approve/reject, dashboard, zip, audit export              | planned    |
| 6     | Security hardening pass                                   | planned    |
| 7     | Gather Cloud and billing                                  | planned    |
| 8     | Website, docs, launch                                     | planned    |

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

Gather handles tax documents. If you find a vulnerability, please read
[SECURITY.md](SECURITY.md) — it also states plainly what Gather's controls do and do not
do for your obligations under the FTC Safeguards Rule and IRS Publication 4557.

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

Later phases add [pg-boss](https://github.com/timgit/pg-boss),
[Garage](https://garagehq.deuxfleurs.fr/), [ClamAV](https://www.clamav.net/) and
[DocuSeal](https://github.com/docusealco/docuseal).

## License

[AGPL-3.0-only](LICENSE). Running Gather for your own firm carries no obligations. If you
modify Gather and offer it to others over a network, you must publish your modifications.

Built in the open by [Seziro](https://github.com/seziro-team).
