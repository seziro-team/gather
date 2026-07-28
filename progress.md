# Gather — Progress Log

Append one entry per completed phase, newest at the bottom. Never edit a past entry; if something
was wrong, say so in the next entry. "Real-world proof" means output from an actual run — command
output, created-object IDs, message IDs, file paths — not a description of what should happen.

Entry template:

## [date] — Phase N: <name>

- Shipped:
- Real-world proof (what actually ran):
- Decisions & why:
- Deviations from plan:
- Known issues:
- Next step (exact resume instruction):

---

## 2026-07-28 — Phase 0: Research & plan

- **Shipped:** `plan.md` (11 sections: vision, competitor teardown, differentiation, architecture
  and data model, licence reasoning, security/compliance checklist, free-vs-paid scope, website
  spec, 8-phase breakdown with acceptance criteria and demo scripts, risks, resume instructions);
  `progress.md` (header + template only, per CLAUDE.md §2.3); repository initialised. Commit
  `08805d2`. No code, per §2.

- **Real-world proof (what actually ran):** every price, quota and endpoint was read from the live
  source on 2026-07-28 and linked in `plan.md`.
  - Vendor pricing pages read directly: Content Snare **$35/$71/$119/$215+** per month annual
    (monthly $42/$85/$143/$258+); FileInvite Standard **USD $9,900/year**, annual billing only;
    Canopy **$74/$109/$149** per user/month annual plus add-ons; Karbon Team **$59**, Business
    **$89** — with automatic client reminders gated to Business.
  - Practitioner evidence pulled from the pullpush.io Reddit archive (Reddit's own search blocks
    our crawler) and linked to the live threads: r/Bookkeeping `1ka0d1u`, r/taxpros `147xrl6`,
    `16znfop`, `1kp4vj1`, `y8n3xn`, `w3mvz4`, and Content Snare's Show HN `17422152`.
  - Third-party APIs verified from official docs: Resend (`POST /emails`, `Idempotency-Key` 24 h,
    **10 req/s**, free tier **3,000/mo but 100/day**), ClamAV (`clamav/clamav:1.4`, clamd TCP 3310,
    **3 GiB minimum RAM**), Stripe Billing Meters, Twilio A2P 10DLC fees, Google Drive resumable
    upload, MS Graph `createUploadSession` (chunks ≤60 MiB, multiples of 320 KiB), Dropbox
    `upload_session/*`, DocuSeal, Better Auth, pg-boss.
  - 16 CFR § 314.4 quoted from Cornell LII after ftc.gov returned 403 and ecfr.gov redirected.
  - `gh search repos` across three phrasings returned only 0-star hobby repos: there is no
    maintained open-source Content Snare.

- **Decisions & why:** AGPL-3.0 for the server (closes the closed-source-competing-SaaS door while
  leaving self-hosting firms unaffected), MIT for `site/` and future SDKs. TypeScript end to end,
  Next.js App Router, Drizzle, pg-boss — so **PostgreSQL is the only service Gather requires**.
  Positioning fixed on the pricing axis rather than the feature list: competitors meter *active
  requests*, which is exactly what spikes in a tax firm's January.

- **Deviations from plan:** two corrections to the operator's brief, both recorded in `plan.md`.
  (1) The brief specified "MinIO for self-host default"; `minio/minio` was **archived 2026-04-25**,
  ships source-only, and had its console and admin features moved to a commercial product — so the
  default is local disk, with an any-S3 driver and Garage as an optional profile. (2) Content
  Snare's entry price is **$35**, not the brief's $29. The brief's suggested 6 phases were split
  into **8**: its P4 bundled approve/reject, the dashboard and a full security pass.

- **Known issues:** `taxdome.com/pricing` returns HTTP 403 to automated fetches, so TaxDome's price
  is recorded as **unverified** and must not appear in site copy until someone loads it in a
  browser. Two circulating statistics were rejected as unsourced and marked do-not-use: the "340
  hours per firm per busy season" figure, and the brief's "100+ chase emails a day".

- **Next step (exact resume instruction):** `Start Phase 1: Foundation, schema, auth, CI — per plan.md §9.`

---

## 2026-07-28 — Phase 1: Foundation, schema, auth, CI

- **Shipped:**
  - pnpm monorepo — `apps/web` (Next.js 16.2.12, App Router, Tailwind 4), `packages/core` (pure
    logic: canonical JSON, audit hashing, env schema, redacting logger), `packages/db` (Drizzle
    schema, migrations, audit writer, migrate and verify CLIs).
  - **All 20 tables of `plan.md` §4.4 in one migration**, plus `audit_head`. Better Auth's five
    tables were reconciled field by field against `npx auth@1.6.25 generate` before shipping.
  - **Append-only, hash-chained audit log.** SHA-256 over a canonical-JSON preimage with keys
    sorted at every depth, so a `jsonb` round trip still re-verifies; `timestamptz(3)` because
    millisecond ISO-8601 is what gets hashed. A database trigger rejects `UPDATE`, `DELETE` and
    `TRUNCATE`; `audit_head` makes truncation of the newest events detectable; `pnpm verify:audit`
    re-checks the chain and exits non-zero.
  - **Better Auth 1.6.25 with TOTP**, required by default (16 CFR 314.4(c)(5)), with backup codes,
    a wrong-code path, and enforcement that makes the dashboard unreachable until enrolment is
    finished. Sign-up is `first-user-only` by default and closes behind the owner. Firm creation
    is atomic with its audit events, and `/create-firm` is the recovery path if it ever is not.
  - `/api/health` reporting database and migration state; Docker healthcheck waits on it.
  - Multi-stage Dockerfile (Next standalone), `docker-compose.yml`, `docker-compose.test.yml`,
    `.env.example` documenting every variable and where to obtain it.
  - GitHub Actions CI (build, typecheck, lint, format, tests against a Postgres service,
    `pnpm audit`, and an end-to-end job that boots the real image), AGPL-3.0 `LICENSE`, `README`,
    `CONTRIBUTING.md`, `SECURITY.md`, issue templates, PR template, Dependabot.
  - Repository created: <https://github.com/seziro-team/gather> (private, at the operator's
    direction). Commits `73cbe27`, `614309d`, `a6bd6a2`, `4062625`, `d3d805b`.

- **Real-world proof (what actually ran):** full transcript in the scratchpad at
  `phase1-evidence.txt`; the load-bearing parts:

  **① Clean clone → healthy, timed.** `git clone` of the committed tree into `/tmp/gather-demo`
  with the Docker build cache pruned and the image removed first:

  ```
  $ cp .env.example .env && time docker compose up -d --build
  real    1m16.888s
  web healthy after 1s of polling
  gather-db-1   postgres:18-alpine   Up 13 seconds (healthy)
  gather-web-1  gather/web:local     Up 7 seconds (healthy)

  $ curl -fsS localhost:3000/api/health
  {"status":"ok","db":"ok","migrations":"applied","checkedAt":"2026-07-28T09:55:25.456Z"}

  $ docker compose logs web | head
  {"level":"warn","msg":"GATHER_AUTH_SECRET was not set — generated one and stored it at
   /app/data/auth-secret inside the gather-data volume. ..."}
  {"time":"...","level":"info","name":"gather","msg":"applying migrations",
   "pending":["0000_init","0001_audit_append_only"]}
  {"time":"...","level":"info","name":"gather","msg":"migrations applied","applied":2}
  ```

  ~78 seconds from clone to healthy, against a 5-minute budget. 20 tables and both audit triggers
  present afterwards.

  **② Real TOTP round trip**, against that default install (`GATHER_ALLOW_SIGNUP=first-user-only`),
  driven by Playwright with codes generated by **GNU oathtool** — the reference RFC 6238
  implementation, deliberately *not* the library that verifies them:

  ```
  ✓  1 health endpoint reports a migrated database (61ms)
  ✓  2 owner signs up, enrols TOTP, and signs back in with an authenticator code (27.9s)
  ✓  3 signed-out visitors are sent to sign in (335ms)
  3 passed (29.4s)
  ```

  The test signs up, enrols from the QR/secret, signs out, signs in with the password, is stopped
  at `/two-factor`, waits for a **fresh 30-second window** so the code cannot be a replay, and
  passes. Whole suite (5 tests) against a signup-open stack: `5 passed (8.7s)`.

  **③ Audit chain, produced by that flow and nothing else:**

  ```
   id |              action              | prev_hash  |    hash
    1 | auth.sign_up                     | 0000000000 | 23d6f1935b
    2 | firm.created                     | 23d6f1935b | 4ab7baeb89
    3 | firm.member_added                | 4ab7baeb89 | ab67e2ee21
    4 | auth.two_factor.enable_requested | ab67e2ee21 | c955a2ba18
    5 | auth.two_factor.verified         | c955a2ba18 | 1c80162763
    6 | auth.sign_out                    | 1c80162763 | c4d427aa9c
    7 | auth.sign_in                     | c4d427aa9c | a7c376d3ac
    8 | auth.two_factor.verified         | a7c376d3ac | c9a8f0df39

  $ pnpm verify:audit
  OK: 8 events, chain intact (head c9a8f0df3963…)          exit=0

  # Layer 1 — the database refuses:
  $ psql -c "update audit_event set action='nothing_happened' where id=2;"
  ERROR:  audit_event is append-only: UPDATE is not permitted

  # Layer 2 — disable the trigger, as someone with database rights would, and edit anyway:
  $ psql -c "alter table audit_event disable trigger audit_event_append_only;" \
         -c "update audit_event set action='nothing_happened' where id=2;"
  $ pnpm verify:audit
  FAIL at id=2: hash mismatch — event content was modified
                (stored 4ab7baeb89ff…, recomputed 5c6ab26de5a3…)
  Verified 8 event(s) before failing.                       exit=1
  ```

  25 unit and integration tests pass against a real PostgreSQL (`Test Files 3 passed | Tests 25
  passed`), including concurrent appends staying contiguous, rollback leaving no orphan event, and
  awkward unicode/nested metadata surviving the `jsonb` round trip.

  **④ CI green on a pull request** — <https://github.com/seziro-team/gather/pull/1>, run
  `30353345135`. Both jobs succeeded: *Typecheck, lint, test* in **1m37s** and *End-to-end against
  the built image* in **2m50s**, every step `success`, no step skipped except the two
  failure-only ones. Merged as `d3d805b`.

- **Decisions & why:**
  - **`audit_event` carries no foreign keys.** `ON DELETE SET NULL` would rewrite audit rows when a
    request is deleted — silently breaking the chain, and in fact failing against the append-only
    trigger; `CASCADE` would erase the evidence; `RESTRICT` would make deletion impossible.
    `audit_event.id` *is* the chain position, contiguous from 1 under a Postgres advisory lock, so
    a gap is evidence rather than a sequence artefact.
  - **Two layers on the audit log, on purpose.** The trigger prevents the accidental cases (a stray
    `UPDATE` from application code, an ORM cascade, a hand-typed statement). The hash chain catches
    the deliberate one, which necessarily begins by disabling the trigger. `SECURITY.md` states
    plainly that this is tamper *evidence*, not prevention, and that catching a full database
    compromise needs the head hash anchored outside the database.
  - **Migrations run in-process** from Next's `instrumentation.register()`. The standalone bundle
    inlines the workspace packages, so a separate `node .../migrate.js` inside the image has no
    `node_modules` to resolve; running in-process also means the server never answers a request
    against a half-migrated schema.
  - **`.env.example` ships an empty `GATHER_AUTH_SECRET`** and the container generates one on first
    boot into the data volume. Shipping a working secret in a public example file would hand every
    install a forgeable one; demanding the operator generate one would break the one-command
    quickstart. The production guard that refuses a known placeholder is still in place.
  - **TypeScript 5.9, not 7.** TypeScript 7 is current, but `typescript-eslint` declares
    `typescript <6.1.0`; taking 7 would mean dropping type-aware linting on a codebase that will
    handle tax documents. Dependabot has already opened a PR for it (see known issues).
  - **PostgreSQL 18, not the planned 16** — no reason to start a new project two majors behind.
  - **oathtool rather than a JavaScript TOTP library** in the end-to-end test: using an independent
    implementation is what proves a real authenticator app works, rather than proving Better Auth
    agrees with itself.
  - **Dependency overrides pinned** for `postcss`, `sharp` and `esbuild`, each above a live
    advisory its parent had not yet picked up; `pnpm audit --prod --audit-level high` in CI is what
    will say when one can be dropped.

- **Deviations from plan:** all four written into `plan.md` §9 rather than left here.
  1. **`apps/worker`, `packages/storage` and `packages/mail` were not created.** They have no real
     implementation until P4, P3 and P4; empty packages are exactly the scaffolding the Realness
     Rule forbids. Each is created in the phase that fills it.
  2. **Migrations at boot** instead of a separate container command (reason above);
     `GATHER_AUTO_MIGRATE=false` opts out, and the CLI still works from a source checkout.
  3. **Generated auth secret** instead of a shipped example one.
  4. **Stack versions moved** — Next 15→16.2.12, PostgreSQL 16→18, TypeScript pinned at 5.9.
  - Also worth recording: Postgres 18's image needs a single mount at `/var/lib/postgresql`, not
    `/var/lib/postgresql/data`; mounting the latter makes the container refuse to start. The first
    clean-clone build also failed on `COPY apps/web/public` — git does not track empty directories —
    which is precisely the class of bug a clean-clone acceptance test exists to catch.

- **Known issues:**
  1. **`auth.sign_up` is recorded with `firm_id` NULL**, because the firm does not exist yet at
     that moment. It is therefore absent from the firm-scoped dashboard list, which starts at
     `firm.created`. Correct, but incomplete for an export — P5's audit viewer should union on the
     firm's members as well as on `firm_id`.
  2. **Dependabot has opened three PRs** (#2 node 22→26-alpine, #3 dev tooling, #4 TypeScript
     5.9→6.0.3). **#4 must not be merged** until `typescript-eslint` supports TypeScript ≥ 6.1;
     #2 needs checking against Next 16's supported Node range before merging.
  3. **No password reset and no email verification.** Both need a mail transport, which is P4. A
     user who forgets their password today has no self-service route back in.
  4. **Better Auth's rate limiter uses in-memory storage**, so limits reset on restart and are not
     shared between replicas. P6 moves it to the database as part of the rate-limiting pass.
  5. **The README quickstart clones a private repository**, so it will fail for anyone else until
     the repo is made public.
  6. **No demo gif in the README yet** (CLAUDE.md §7). There is nothing worth filming until the
     portal exists; it is scheduled with the rest of the launch material in P8. No broken image
     link was committed in the meantime.

- **Next step (exact resume instruction):** `Start Phase 2: Request builder + real templates — per plan.md §9.`
