# Changelog

All notable changes to Gather are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Gather uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

`progress.md` is the long form: what shipped in each phase, what actually ran to prove it,
what was decided and why, and what is still broken. This file is the summary.

## [Unreleased]

### Added

- **Single sign-on over OIDC** against your own identity provider — Okta, Microsoft Entra
  ID, Google Workspace, Keycloak, Authentik. Discovery-driven, so no provider is named in
  the code. `GATHER_SSO_ENFORCED` turns off Gather passwords entirely; `SSO_ALLOWED_DOMAINS`
  limits which identities are admitted; `GATHER_SSO_AUTO_JOIN` provisions into the firm when
  the install has exactly one. **In the free product**, like team roles. Proven end to end
  against a real Keycloak — `pnpm test:sso`, and `docs/sso.md`.
- **Pagination and search** on clients, requests, the dashboard and the operator console.
  Every one of those previously loaded a firm's whole table to render a page.
- **`pnpm keys:rotate`** — moves every stored file onto a new encryption key. Only the
  per-file keys are re-wrapped, so no object is read and no ciphertext is rewritten: 167
  files in 1.7 seconds. Dry run by default, resumable, and safe to re-run.
- **`pnpm audit:anchor`** — writes the audit head somewhere the database cannot reach, and
  re-checks past anchors. Closes the caveat `SECURITY.md` has always carried: the chain is
  tamper evidence, and somebody who can write to the database can recompute it — but not a
  hash you wrote down elsewhere last week.
- **`/api/live`**, separate from `/api/health`, so a database blip makes instances unready
  rather than restarting them. `/api/metrics` in Prometheus format behind a bearer token,
  absent unless `GATHER_METRICS_TOKEN` is set.
- **CodeQL** on every pull request and weekly; a release workflow producing a CycloneDX SBOM
  and a container image with a signed provenance attestation.
- `CODE_OF_CONDUCT.md`.

### Changed

- The repository is **public**, with branch protection requiring all six CI jobs, Dependabot
  alerts, secret scanning with push protection, and private vulnerability reporting.
- `SECURITY.md` rewritten. It still described encryption at rest, virus scanning and
  retention as unshipped and advised against putting real client documents in Gather — all
  of which shipped in Phases 3 and 6.
- Dependencies brought current within their majors, including Better Auth 1.6 → 1.7, whose
  `genericOAuth` now requires discovery to supply the issuer and JWKS before a provider is
  registered.

## [0.1.0] — 2026-09-05

The first release. The whole self-hosted product works end to end.

### Added

**Collecting documents**

- Request builder: sections and items — file uploads, short and long text, yes/no, dates,
  choices and numbers — with required flags, help text, drag-to-reorder by mouse, touch or
  keyboard, and a live preview of exactly what the client will see.
- Four built-in templates, every item transcribed from published IRS, CFPB, SBA or Fannie
  Mae guidance and linked to its source: US individual tax year-end, new business
  onboarding, mortgage application, monthly bookkeeping close. `templates/SOURCES.md` is
  generated from the definitions and checked in CI.
- Save any request as a template. Copies are independent.
- Client portal with **no account**: one magic link, mobile-first, autosaving, camera-roll
  or drag-and-drop, with real progress on a slow connection.
- Per-item approve and reject. Rejecting reopens that one item with a note the client
  reads, keeps the superseded file as a version, and emails them. Approving the last
  required item completes the request and stops the reminders.
- Zip export foldered by section and item, with a manifest listing each file's SHA-256 as
  recorded when it arrived.

**Chasing**

- Reminder engine on pg-boss: three cadences (every N days, an escalating ladder, chosen
  weekdays), sent at a time on the client's clock, with quiet hours and a maximum count.
  They stop on their own when everything required is in.
- Resend or any SMTP server. `pnpm check:email` reads your SPF, DKIM and DMARC records and
  sends a real test message.
- Bounce webhooks (Resend/Svix) flip the reminder and show the firm what happened.
- A crashed worker never sends the same reminder twice: schedules are claimed with
  `FOR UPDATE SKIP LOCKED` and every send is guarded by a unique index.

**Accounts and team**

- Email and password with TOTP two-factor, required by default, plus one-time backup codes.
- Three roles — owner, admin, member — and ten named permissions, in the free product.
- Invitations by email or link: 32 bytes of CSPRNG stored only as SHA-256, expiring,
  revocable, single-use, audited. An invited colleague with no account can sign up through
  the invitation even where sign-ups are closed.

**Storage and security**

- AES-256-GCM envelope encryption before bytes reach the disk or the bucket, on every
  driver. Content type sniffed from the bytes, never the extension.
- Local disk or any S3-compatible store — AWS, R2, B2, Wasabi, MinIO, SeaweedFS, or the
  Garage container in `docker-compose.s3.yml`. The same test suite proves both.
- Optional ClamAV scanning; an infected upload is quarantined, deleted and never
  downloadable, and a file that was not scanned says so rather than looking clean.
- Per-request CSP with a nonce, strict headers on downloads, rate limiting on link
  redemption, uploads, autosaves, downloads, exports and every authentication route.
- Hash-chained, append-only audit trail. `UPDATE` and `DELETE` are blocked by a database
  trigger, and the CSV export **verifies away from the database**:
  `pnpm verify:audit --csv`.
- Retention purge (`GATHER_RETENTION_DAYS`), off by default, that disposes of files while
  keeping the record that they existed and were disposed of.

**Running it**

- One `docker compose up -d`: Postgres and Gather, nothing else. Migrations apply before
  the first request is served.
- `docker-compose.prod.yml` + Caddy: automatic Let's Encrypt TLS, HSTS, nothing but the
  proxy published, nightly `pg_dump`.
- Health endpoint, structured JSON logs, and an `.env.example` documenting every variable
  with its default and where to obtain it. Nothing phones home.
- Gather Cloud as an environment flag over the same code: plan limits, a Stripe-backed
  billing page, and an operator console at `/admin` that exists for nobody on a self-hosted
  install.
- One-page marketing site in `site/`, whose every screenshot is captured from a running
  install by `scripts/capture-demo.mjs`.

### Known gaps

Written down rather than implied. The full list is at the end of each `progress.md` entry.

- ⛔ **Stripe has never completed a call.** Hosted billing is written against the official
  SDK with the API version pinned and its webhook logic unit-tested, and the Subscribe
  button provably reaches Stripe — but no subscription has ever been created, because this
  build has never had a Stripe account. `docs/stripe-verification.md` is the procedure that
  closes it. Self-hosting is unaffected.
- SMS reminders, e-signature and Drive/Dropbox/OneDrive sync were planned for the hosted
  tier and are **not built**. Each needs a third-party account nobody has; they were cut
  rather than stubbed. See `plan.md` §7.2.
- One firm per person: somebody invited to a second firm keeps the first.
- No key rotation. If `GATHER_ENCRYPTION_KEY` leaks there is no supported re-encryption.
- The audit head hash is not anchored outside the database, so a full database compromise
  is not detectable by the chain alone.
- Uploads cannot resume; there is no pagination on requests or in the operator console;
  item drag cannot cross sections.
- Resend's API path is unproven — every email test to date ran against SMTP.

[unreleased]: https://github.com/seziro-team/gather/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/seziro-team/gather/releases/tag/v0.1.0
