# Contributing to Gather

Thanks for looking. Gather is built in the open and patches are welcome.

## What Gather is, and is not

**Gather does one job: collecting documents and information from clients, and chasing
until it's complete.** That focus is the product, not a limitation — the practitioners
whose complaints shaped it are already paying for suites that lost on client-side
simplicity.

So these are explicit non-goals, and pull requests adding them will be declined kindly:

- Practice management, CRM, time tracking, billing your clients, tax preparation
- Anything that requires the _client_ to create an account or install an app
- Identity quizzes (KBA) on the collection path — they lock real clients out
- Analytics, telemetry or any request to a server the operator did not configure

If something would make the checklist harder to finish on a phone, it is probably wrong
for Gather.

## Getting set up

You need Node ≥ 22.12, pnpm 10, and Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d db          # Postgres only; the app runs from source
pnpm build                       # workspace packages compile to dist/
pnpm db:migrate
pnpm dev                         # http://localhost:3000
```

`pnpm dev` reads the repository-root `.env`.

## Tests

```bash
# Unit + database integration tests. With the stack up, this needs no arguments: the
# runner reads .env, and derives a `<database>_test` scratch database it can truncate —
# it can never touch the one in DATABASE_URL.
pnpm test

# End-to-end, against a running install that allows sign-ups. The mail overlay adds
# Mailpit, a real SMTP server that catches instead of relaying, so the reminder and
# invitation tests assert on messages that were really sent.
sudo apt-get install -y oathtool unzip    # real TOTP codes; a real extractor for the zip
docker compose -f docker-compose.yml -f docker-compose.mail.yml \
               -f docker-compose.test.yml up -d --build
pnpm test:e2e

# Opt-in suites, each with its own stack because each needs something the default
# install deliberately does not have.
pnpm test:antivirus   # ClamAV — wants 3–4 GiB of RAM and a ~350 MB signature database
pnpm test:cloud       # the hosted tier: GATHER_CLOUD=true, plan limits, /admin
```

The database tests are deliberately not mocked: the audit chain's correctness depends on
Postgres behaviour — advisory locks, `jsonb` key normalisation, `timestamptz` precision —
that a fake would get wrong in exactly the ways that matter.

`oathtool` is GNU oath-toolkit's RFC 6238 implementation. Using it rather than the
library that verifies the code is the point: it proves a real authenticator app works.

## Before you open a pull request

```bash
pnpm typecheck
pnpm lint
pnpm format          # pnpm format:write to fix
pnpm test
```

CI runs exactly these, plus `pnpm audit --prod --audit-level high` and four end-to-end
jobs against the built Docker image: the default stack, the same portal suite against a
real S3 object store, ClamAV quarantine, and the hosted tier.

## House rules

- **No placeholders.** No stubbed functions, no mocked third-party responses in shipped
  code paths, no fake data rendered in any UI, no buttons that do nothing. If something
  isn't built yet, the UI says so plainly rather than pretending.
- **Every integration is the real API,** configured by environment variable and
  documented in `.env.example` with a comment saying where to obtain the value.
- **Secrets never appear in code or logs.** The logger redacts anything that looks like a
  token, key, password or session.
- **Migrations are plain SQL you can read** before running. Generate them with
  `pnpm db:generate`; never hand-edit one that has already shipped.
- **Audit anything that matters.** State changes that a firm might one day need to prove
  belong in the audit chain, and in the same transaction as the change itself.
- **Say what is not proven.** If something ships without having really run — an
  integration with no credentials, a path with no test — write it down where a user will
  see it, not only in a commit message. `docs/stripe-verification.md` is the shape that
  takes: what is proven, what is not, and the exact procedure that closes the gap.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).

## Project layout

```
apps/web            Next.js app — dashboard, portal, API routes
apps/worker         Reminder sender and the retention purge, on pg-boss
packages/core       Pure logic: audit hashing, canonical JSON, env, permissions, plans
packages/db         Drizzle schema, migrations, audit writer, queries, CLIs
packages/storage    Encryption, magic-byte sniffing, local and S3 drivers, ClamAV
packages/mail       Resend and SMTP drivers, templates, DNS preflight, bounce webhooks
packages/reminders   The send-once path, shared by the worker and the "send one now" button
packages/billing    Stripe: checkout, portal, webhook verification, event → plan state
site                The one-page marketing site (Astro, static)
e2e                 Playwright specs
docs                Threat model, Safeguards Rule mapping, incident response, launch
plan.md             The full build spec and phase plan
progress.md         What actually shipped in each phase, with evidence
```

The site's screenshots are not committed by hand — `node scripts/capture-demo.mjs` drives
a running install and writes them. If you change a screen that appears on the site, re-run
it against a fresh stack rather than editing an image.

`plan.md` is the source of truth for scope and sequencing. If a change alters
architecture or scope, update it in the same pull request.

## Reporting security issues

Please don't open a public issue — see [SECURITY.md](SECURITY.md).
