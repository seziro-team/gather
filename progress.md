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

---

## 2026-07-28 — Phase 2: Request builder + real templates

- **Shipped:**
  - **A template model in `@gather/core`** — a zod schema covering all seven item types with
    per-type config (accepted extensions and file count; placeholder; date range; choice
    options and multi-select; number range and unit), validating the templates Gather ships,
    a firm's saved templates, and whatever the builder posts back, so anything that parses
    can be instantiated.
  - **Four built-in templates, 16 sections and 74 items, every item cited.** US individual
    tax year-end (25), new business onboarding (18), mortgage application (17), monthly
    bookkeeping close (14). Transcribed from IRS, CFPB, SBA and Fannie Mae Selling Guide
    pages read live on 2026-07-28.
  - **`templates/SOURCES.md`, generated** from the definitions by `pnpm docs:sources`, with
    `pnpm docs:sources:check` in CI. It carries every item, its type, whether it is required,
    and a numbered reference list with the verbatim quote behind it — plus a
    "deliberately not included" section covering the three things a reader would look for
    and not find.
  - **Client CRUD** — add, edit, archive and restore, firm-scoped in the query itself rather
    than checked afterwards, every mutation audited.
  - **The request builder** — sections and items, all seven types, required flags, help text,
    drag-to-reorder with the mouse, a finger or the arrow keys, edge auto-scroll, an unsaved-
    changes guard, and a client preview rendered from the same data with the real controls.
  - **Templates end to end** — build a request from any built-in or firm template, save a
    request back as a template, delete your own (never a built-in), with deep copies in both
    directions.
  - Built-ins install themselves on first boot; `pnpm seed:templates` does the same from a
    source checkout.

- **Real-world proof (what actually ran):** a wiped stack
  (`docker compose down -v` then `up -d --build`), healthy, then the whole suite.

  **Boot installs the checklists before anyone has opened a browser:**

  ```
  {"level":"info","name":"gather","msg":"migrations applied","applied":2}
  {"level":"info","name":"gather","msg":"built-in templates ready",
   "installed":4,"updated":0,"unchanged":0}
  ```

  **① A request built from each of the four, checked against the published document.**
  The end-to-end test parses `templates/SOURCES.md`, then creates a request from each
  template through the real UI and asserts the counts and **all 74 item labels** appear:

  ```
  ✓ a request from each built-in template matches every count and label in SOURCES.md (4.8s)
  ```

  ```
              key             | sections | items          template_key        | sections | items
  --------------------------- +----------+-------        ---------------------------+----------+------
   bookkeeping-monthly-close   |        4 |    14         bookkeeping-monthly-close  |        4 |   14
   mortgage-application        |        4 |    17         mortgage-application       |        4 |   17
   new-business-onboarding     |        4 |    18         new-business-onboarding    |        4 |   18
   us-individual-tax-year-end  |        4 |    25         us-individual-tax-year-end |        4 |   25
        (seeded at boot)                                       (instantiated by the app)
  ```

  **② One of every item type, dragged, and still there after a reload.** The drag is a real
  pointer drag — `mouse.down`, twenty `mouse.move` steps, `mouse.up` — not a synthetic
  reorder call. The keyboard path is asserted separately:

  ```
  ✓ adds one of every item type, reorders by drag, and the order survives a reload (4.2s)
  ```

  Order in the database afterwards, showing the drag (item 1 → position 3) and then the
  ArrowDown swap:

  ```
     type   |        label
  ----------+---------------------
   longtext | 3. Long text item
   text     | 2. Short text item
   file     | 1. File upload item
   yesno    | 4. Yes / no item
   date     | 5. Date item
   choice   | 6. Choice item
   number   | 7. Number item
  ```

  **③ Deep copy.** A request built from the "Monthly bookkeeping close" built-in was saved
  as the firm's own template, a second request was built from *that*, an item was deleted
  from the second, and both the template and the original request were then re-checked:

  ```
              what            | items
  ----------------------------+-------
   template our-monthly-close |    14
   request  February close    |    13
  ```

  ```
  ✓ a request saved as a template produces an independent copy (3.6s)
  ```

  **④ Every mutation, hash-chained.** One firm driven through all nine mutating actions:

  ```
   id |              action              |    prev    |    hash
  ----+----------------------------------+------------+------------
   46 | client.created                   | b09553e600 | 53fdee5595
   47 | client.updated                   | 53fdee5595 | 8a73d42e6b
   48 | request.created                  | 8a73d42e6b | ebf684ff44
   49 | request.structure_updated        | ebf684ff44 | cd8ce0df81
   50 | request.updated                  | cd8ce0df81 | c0a1d25fa1
   51 | template.created                 | c0a1d25fa1 | fa3cafe0ea
   52 | template.deleted                 | fa3cafe0ea | 51fb2e4e0f
   53 | request.deleted                  | 51fb2e4e0f | 3d5d545370
   54 | client.archived                  | 3d5d545370 | 149c5e0918

   id |           action           | actor_type | firm_id |          template          | items
  ----+----------------------------+------------+---------+----------------------------+-------
    1 | template.builtin_installed | system     |         | us-individual-tax-year-end |    25
    2 | template.builtin_installed | system     |         | new-business-onboarding    |    18
    3 | template.builtin_installed | system     |         | mortgage-application       |    17
    4 | template.builtin_installed | system     |         | bookkeeping-monthly-close  |    14

  $ pnpm verify:audit
  OK: 64 events, chain intact (head d1c023227e94…)          exit=0
  ```

  **Suites.** `Test Files 5 passed | Tests 56 passed` (25 from Phase 1, 19 template, 12
  structure and seeding) against a real PostgreSQL; `9 passed (35.4s)` end to end against the
  built image; lint, format, typecheck and `pnpm docs:sources:check` all clean.

  **CI green on the pull request** — <https://github.com/seziro-team/gather/pull/5>, run
  `30362999044`. Both jobs succeeded: *Typecheck, lint, test* in **1m45s** (including the new
  `Check template sources are documented` step) and *End-to-end against the built image* in
  **2m45s**. Merged as `23ccce3`.

- **Decisions & why:**
  - **`templates/SOURCES.md` is generated, not written.** The document exists to make
    "no invented checklists" checkable. A hand-maintained copy would drift from the code on
    the first edit and quietly stop being true, so the citation lives on the item in
    `packages/core/src/templates/`, the document is derived from it, and CI fails if they
    disagree. A test separately fails any built-in item with no citation at all.
  - **Every cited URL was fetched before it was written down.** 52 distinct addresses; 49
    return HTTP 200 to a scripted request and the three `consumerfinance.gov` pages refuse
    those outright and were read through a browser-equivalent fetch. Two intended citations
    turned out not to exist at the obvious address — `about-schedule-k-1-form-1065` is a 404,
    and there is no `about-form-4506-c` — and two more (`uscis.gov/i-9`, Fannie Mae's Form
    1003 page) block every kind of automated read, so the I-9 item cites IRS Publication 15
    quoting the requirement instead and the 1003 was dropped. All of which is why they were
    checked rather than recalled.
  - **The mortgage template asks for the Social Security *card*, not the number.** The CFPB
    checklist it is otherwise transcribed from says "Social Security number". Uploaded files
    are encrypted at rest from Phase 3; a typed answer is a `jsonb` value in Postgres. Same
    information, better handling, and the departure is stated in the document rather than
    hidden.
  - **Citations stop at the template.** They are dropped when a request is built, because a
    quote from the IRS describes the item as Gather ships it and stops being true the moment
    a firm edits its copy. This also kept `item` free of a `sources` column, so §4.4 did not
    change.
  - **Row identity is preserved across a save.** The builder posts the whole structure with
    ids; `replaceRequestStructure` updates what it recognises, inserts what it does not, and
    deletes what is gone. Responses, files and review decisions will hang off `item.id` from
    Phase 3, so rewriting the rows on every save would silently discard a client's answers.
    An id that does not already belong to the request is treated as new rather than adopted —
    tested with a payload carrying another request's ids.
  - **Drag-reorder was written, not installed.** `@dnd-kit/core` 6.3.1 and
    `@dnd-kit/sortable` 10.0.0 have not been published since December 2024; the maintained
    successor `@dnd-kit/react` is at 0.5.0. Neither an 18-month-stale dependency nor a
    pre-1.0 API is worth taking for a single-axis list. Pointer events rather than HTML5
    drag-and-drop, because HTML5 drag does not fire on touch, and arrow keys on the focused
    handle do the same job with no pointer at all.
  - **The preview is inert on purpose.** It renders the real controls from the real
    structure, inside a disabled fieldset, under a banner saying so. A half-live form on the
    firm's side of the product would be a lie about what has been built.
  - **Explicit save, not autosave.** Autosave belongs to the client portal, where the person
    typing has no reason to know what a save button is for. On the firm's side an unsaved-
    changes indicator plus a `beforeunload` guard is the honest arrangement.

- **Deviations from plan:** five, all written into `plan.md` §9 — generated `SOURCES.md`;
  built-ins installed at boot rather than by `pnpm seed:templates`; citations kept on the
  template only; hand-written drag-reorder; and the Social Security card/number departure.
  Also worth recording: the first end-to-end drag failed and the failure was real. The
  handle's bounding box was at `y = -76` — above the viewport — so the pointer never landed
  on it. Fixing the test exposed a genuine gap, that a long checklist could not be dragged
  past the edge of the window at all, and edge auto-scroll was added because of it.

- **Known issues:**
  1. **Items reorder within their section, and sections reorder among themselves — an item
     cannot be dragged into a different section.** Delete and re-add is the workaround. Worth
     doing properly, but it is not what Phase 2 promised.
  2. **"Save as template" always creates a new template.** There is no way to update one in
     place, so iterating on a firm template leaves a trail of copies.
  3. **Deleting an item deletes its responses**, by `on delete cascade`. Nothing can answer
     an item yet, so nothing is at risk today — but Phase 3 must refuse to delete an item
     that has been answered, or say plainly what will be lost.
  4. **A request cannot be sent.** There is no portal, no token and no email until Phases 3
     and 4; the request page says so rather than showing a button that does nothing.
  5. **No pagination anywhere** — clients, requests and templates all render in full. Fine
     for a firm's first year, not for its fifth.
  6. **`auth.sign_up` still carries a NULL `firm_id`** (carried over from Phase 1), so it is
     absent from the firm-scoped views. Phase 5's audit export should union on membership.
  7. **Dependabot #4 (TypeScript 5.9 → 6.0.3) still must not be merged** until
     `typescript-eslint` supports TypeScript ≥ 6.1.

- **Next step (exact resume instruction):** `Start Phase 3: Client portal + real uploads — per plan.md §9.`

---

## 2026-09-05 — Phase 3: Client portal + real uploads

- **Shipped:**
  - **`@gather/storage`** — a driver interface with two real implementations (`local`
    filesystem, `s3` for any S3-compatible endpoint), AES-256-GCM envelope encryption, and
    magic-byte content sniffing. Nothing buffers a whole file: each chunk is hashed,
    encrypted and handed to the driver before the next one is read, so a 200 MB upload
    costs the same memory as a 200 KB one.
  - **The client portal** — a magic link exchanged once for an HttpOnly session cookie
    scoped by path to `/portal/<request-id>`, so no other part of Gather ever receives it
    and a client can have two requests open at once. No account, no password, no app.
  - **Autosave**, debounced at 700 ms per item, flushed on `pagehide` and
    `visibilitychange` — the last two moments a phone reliably gives a page before a call
    or a memory reclaim takes the tab.
  - **Mobile-first checklist** with drag-drop, file picker and camera roll, a real upload
    progress bar (`XMLHttpRequest`, because `fetch` cannot report request-body progress),
    and per-item state.
  - **Signed five-minute downloads**, minted when the button is clicked rather than when
    the page is built, scoped to the portal session or the firm, and always served
    `Content-Disposition: attachment` with `nosniff` and `default-src 'none'`.
  - **`docker-compose.s3.yml`** — Garage v2.3.0 with a one-off init that assigns the
    cluster layout, imports the operator's key and creates the bucket; idempotent.
  - **`.env.example`** extended with every storage and portal variable, including the
    explicit warning that `GATHER_ENCRYPTION_KEY` must be set by hand under
    `STORAGE_DRIVER=s3` and that losing it loses the documents.
  - **`e2e/portal-mobile.spec.ts`** and a `mobile-safari` Playwright project — WebKit at
    390×844 with touch, driving the firm on a desktop context and the client on a phone.

- **Real-world proof (what actually ran):** a wiped stack (`down -v`, then `up -d`), then
  the whole suite. 12 end-to-end tests across two browser engines, 118 unit and integration
  tests, lint, format and typecheck clean.

  ```
  Running 12 tests using 1 worker
    ✓ [chromium]      auth.spec.ts — 5 tests
    ✓ [chromium]      builder.spec.ts — 4 tests
    ✓ [mobile-safari] ① a client uploads a real PDF and a phone photo, on a phone,
                        with no account                                          (1.4m)
    ✓ [mobile-safari] ② an answer typed and abandoned mid-way survives the tab
                        being closed                                             (1.1m)
    ✓ [mobile-safari] ⑤ nothing scoped to one request can reach another request's
                        file                                                     (1.6m)
    12 passed (5.2m)
  ```

  **① Real documents, on a real phone viewport.** The fixtures are the actual IRS Form W-9
  (6 pages, 140,815 bytes, downloaded from irs.gov) and a 3024×4032 JPEG carrying iPhone
  EXIF. The test asserts no password field exists anywhere on the page, no horizontal
  overflow at 390 px, and that every control a finger lands on clears 44 px.

  **③ The bytes at rest are not documents.** Read from inside the container, not through
  the app:

  ```
  /app/data/uploads/2164b3a4-…/29746433-….bin
    be 78 f8 b9 1f 48 33 a0 30 6e 16 c9 3e df dd 92
  /app/data/uploads/0b6a7471-…/750c083e-….bin
    20 d5 6a 3a 0e 29 70 37 a4 a7 df a4 3a d5 05 2f
  objects whose first bytes are %PDF-: 0 of 3

     original_name   |      mime       |  size  | encrypted | driver |      sha256      | scan
  -------------------+-----------------+--------+-----------+--------+------------------+------
   irs-form-w9.pdf   | application/pdf | 140815 | t         | local  | 2d420cbb4123dcf1 | skipped
   receipt-photo.jpg | image/jpeg      | 243549 | t         | local  | 17d04952095f6845 | skipped
   irs-form-w9.pdf   | application/pdf | 140815 | t         | local  | 2d420cbb4123dcf1 | skipped
  ```

  `2d420cbb4123dcf1…` is the SHA-256 of the fixture on disk before it was ever uploaded.
  The test downloads the file back through the real signed-URL path and asserts the hash
  matches and the first five bytes are `%PDF-`. The MIME column is sniffed from the bytes,
  never the browser's claim. `scan_status = skipped` is honest rather than silent: no
  antivirus is configured, and the UI says so (plan.md §4.3).

  **④ The identical suite against a real object store.** Garage v2.3.0, brought up by the
  overlay file, provisioned by `garage-init`, with Gather on `STORAGE_DRIVER=s3`:

  ```
  garage-init: ready — bucket 'gather' is writable by GK988e30bd319ffed297af0be0
  3 passed (4.3m)          ← the same three mobile tests, unchanged

  ==== BUCKET INFORMATION ====
  Size:            525.2 kB (512.9 KiB)
  Objects:         3
  Permissions  Access key                  Local aliases
  RW           GK988e30bd319ffed297af0be0  gather-app

   storage_driver | count |   sum
  ----------------+-------+---------
   local          |    15 | 2625895
   s3             |     3 |  525179
  ```

  525,179 bytes is exactly 140815 + 243549 + 140815 — GCM is a stream mode, so ciphertext
  is the same length as plaintext, and the object store holds precisely what was sent.

  **⑤ Cross-request access, attacked four ways.** The interesting one is the last: the firm
  mints a *genuinely valid* download signature for request B's file from B's own page, then
  the test points it at request A. The signature verifies — it is scoped to the firm, not to
  the request — and the route still refuses, because the `file → response → item → section →
  request` join finds nothing. It returns **404**, not 403, so nothing confirms the id even
  exists.

  ```
  A's session on B's portal page          → 302 to /portal/unavailable
  A's session uploading into B's request  → 401
  unsigned request for B's file           → 403  (refused before any lookup)
  valid firm signature, aimed at A        → 404  ← the database join, doing the work
  same signature, aimed at B              → 200, sha256 matches
  ```

  **The audit trail, from the whole run:**

  ```
          action        | count
  ----------------------+-------
   portal.file_uploaded |     3
   portal.opened        |     4
   request.link_issued  |     4

  $ pnpm verify:audit
  OK: 101 events, chain intact (head c411843d905e…)          exit=0
  ```

- **Decisions & why:**
  - **Encryption forces uploads through the app, and that is the right trade.** plan.md
    §4.2 committed to this; building it confirmed it. We cannot encrypt bytes we never see,
    so browser-direct presigned PUT is unavailable while `STORAGE_ENCRYPTION=on`. These are
    tax documents and 16 CFR 314.4(c)(3) requires encryption at rest whatever the backend.
    `STORAGE_ENCRYPTION=off` remains for anyone who prefers throughput.
  - **The portal cookie is path-scoped, not site-scoped.** Two consequences, both wanted: a
    client with two open requests can work on both in one browser, and the firm's dashboard,
    the auth endpoints and every API route are outside its path, so a portal session cannot
    be replayed anywhere it was not issued for.
  - **The magic link is exchanged for a session and then redirected away.** The token
    appears in exactly one request and never again — not in the address bar of the page the
    client sits on for ten minutes, not in a screenshot they send their accountant, and not
    in the `Referer` of anything the page loads.
  - **Downloads are signed at click time.** Rendering a link into the page would mean the
    five-minute expiry had already been running for however long the tab was open.
  - **`garage-init` runs Garage's own binary on Alpine.** The published image is distroless
    — `/garage` and nothing else, not even `/bin/sh` — so neither a shell script nor a
    `CMD-SHELL` healthcheck can run in it. The binary is copied byte-for-byte rather than
    rebuilt, and the healthcheck is `['CMD', '/garage', 'status']`.
  - **Uploads are streamed, not chunked.** Recorded as a deviation in plan.md §9.

- **Deviations from plan:** five, all written into `plan.md` §9 — the IRS Form W-9 fixture
  instead of a 2.1 MB W-2; a compose **overlay** rather than a `--profile` for S3 (a profile
  can add a service but cannot change `web`'s environment); no chunked uploads; the
  `mobile-safari` viewport pinned to 390×844 rather than the device profile's 390×664; and
  the test-database correction below.

  Also worth recording: **three real bugs were found by writing these tests, not by
  reading the code.**
  1. The firm's request page **500'd on any request with a file on it**. It is a Server
     Component and imported `formatBytes` from a `'use client'` module; Next refuses to call
     a function exported from a client module on the server, and the failure only appears at
     render time on a page that happens to have data in it. `formatBytes` now lives in
     `apps/web/src/lib/format.ts`, which has no directive.
  2. The Playwright `baseURL` was `127.0.0.1` while the app calls itself `localhost`. Those
     are different cookie hosts, so the portal cookie was set on one and never sent to the
     other. That is not a test artefact — it is exactly what a self-hoster gets wrong when
     `GATHER_APP_URL` does not match the address people actually use, and the config now
     says so.
  3. The 44 px tap-target assertion caught the `sr-only` file input, which is 1 px by
     design and which nobody taps. The assertion now excludes `.sr-only` and requires a
     minimum control count, so it cannot pass by matching nothing.

- **Known issues:**
  1. **`pnpm test` used to be able to destroy a live install.** The database integration
     tests fall back through `TEST_DATABASE_URL` → `DATABASE_URL`, and they delete rows and
     disable the audit trigger. On a self-hosted clone whose `.env` points at the real
     database, running the suite wiped the audit log. Found by doing it. They now resolve a
     scratch `<db>_test` database, create it if absent, and can never touch the database in
     `DATABASE_URL` — but anyone who ran `pnpm test` on a Phase 1 or 2 checkout should
     assume their local data is gone.
  2. **Uploads cannot resume.** A dropped connection means starting that file again. See
     the deviation note; revisit on a real report.
  3. **No virus scanning yet** — every file is `scan_status = skipped`, surfaced in the UI
     as "Not scanned" with an explanation. ClamAV is Phase 6.
  4. **A revoked or expired link cannot be re-sent from the portal side**, and there is
     still no email: the firm copies the link and sends it however it already talks to the
     client. Phase 4 puts a real email around it.
  5. **`removeFileAction` deletes the row and audits it, then removes the object
     best-effort.** A bucket that refuses the delete leaves an orphan object with no row.
     The audit event survives either way; a sweeper for orphans belongs with the retention
     job in Phase 6.
  6. **The mobile suite takes ~5 minutes** because each test drives two devices through a
     full sign-up and TOTP enrolment before it starts. Fine now; worth a shared
     authenticated state if it grows.
  7. Carried over: `auth.sign_up` still has a NULL `firm_id`; item drag cannot cross
     sections; "save as template" always creates a new one; no pagination; Dependabot #4
     (TypeScript 5.9 → 6.0.3) still must not be merged.

- **Next step (exact resume instruction):** `Start Phase 4: Reminder engine — per plan.md §9.`
