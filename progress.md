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

---

## 2026-09-05 — Phase 4: Reminder engine

- **Shipped:**
  - **`@gather/core` cadence model** — three shapes (`interval`, `escalating`,
    `weekdays`), a send time and a timezone read on the *client's* clock, quiet hours
    that may wrap midnight, and a stop-after count. `nextRunAt` is a pure function of
    the schedule and the clock, so when a client gets nagged is testable without a
    database, a queue or an SMTP server. Timezone arithmetic is `Intl` directly — about
    forty lines, and no second copy of the IANA database to keep current.
  - **`@gather/mail`** — one interface, two real drivers. Resend over `fetch` (no SDK, so
    the dependency surface of the package holding a firm's sending credentials is zero),
    and SMTP over nodemailer with a connection pool. Branded HTML + text emails written as
    a client reads them. Svix webhook verification implemented from the documented scheme.
  - **`@gather/reminders`** — compose-and-send, shared by the worker and the web app so a
    scheduled reminder and a manual nudge take the identical path through the identical
    send-once guard.
  - **`apps/worker`** — a second container running pg-boss 12.30.0 on **Postgres alone**,
    with a one-minute cron, a `singleton` queue policy and graceful shutdown.
  - **Send-once, enforced in Postgres.** `FOR UPDATE SKIP LOCKED` stops two workers racing;
    a unique index on `reminder_log.idempotency_key` stops a *restarted* worker racing
    itself. The claim row is written **before** the message reaches a driver, so a process
    killed in that window loses one reminder rather than sending two.
  - **Stop-on-complete**, in the same transaction as the status change — the firm marking a
    request complete, and the client sending it back, both switch the schedule off. Also
    stops on its own when nothing required is outstanding.
  - **`pnpm check:email`** — real SPF, DKIM, DMARC and MX lookups with a specific fix for
    each failure, then a real test message.
  - **Resend webhook ingest** at `/api/webhooks/resend` — signature-verified, ordering-safe
    (a late `delivered` can never overwrite a `bounced`), and audited for outcomes a firm
    would want in the history.
  - **`docker-compose.mail.yml`** — Mailpit for development and for the test suite.

- **Real-world proof (what actually ran):** the full stack (`db`, `web`, `worker`,
  `mailpit`), then everything.

  ```
  18 passed (12.6m)      ← every e2e test, chromium + mobile-safari
  Test Files 13 passed | Tests 172 passed        ← unit + integration, real Postgres
  typecheck clean · lint clean · format clean
  ```

  **The email preflight, against real DNS.** Two runs, one that should fail and one that
  should pass, to show the check is reading the world rather than agreeing with itself:

  ```
  $ pnpm check:email                      # MAIL_FROM on a domain with no records
    ✗ SPF    No v=spf1 TXT record on gather.test.
             Add a TXT record on gather.test listing whoever sends your mail. For Resend
             that is "v=spf1 include:amazonses.com ~all"; …
    ✗ DKIM   No DKIM key found at resend._domainkey.gather.test or default._domainkey…
    ✗ DMARC  No v=DMARC1 TXT record on _dmarc.gather.test.
    ! MX     No MX record on gather.test.
    ✗ DNS is not ready — reminders are likely to land in spam.          exit=1

  $ MAIL_FROM='Gather <noreply@github.com>' MAIL_DKIM_SELECTOR=s1 pnpm check:email
    ✓ SPF    "v=spf1 ip4:192.30.252.0/22 include:spf.protection.outlook.com …~all"
    ✓ DKIM   Signing key published for selector "s1" on github.com.
    ✓ DMARC  "v=DMARC1; p=quarantine; sp=reject; pct=100; rua=mailto:dmarc@github.com; …"
    ✓ MX     1 mail exchanger, lowest priority github-com.mail.protection.outlook.com.
    ✓ DNS looks right.
  ```

  **A real message, over a real SMTP conversation:**

  ```
  $ pnpm check:email alex@delgado.test
    ✓ Sent to alex@delgado.test via smtp.
        id <check-email:alex@delgado.test:2026-09-05T08:53@gather.test>

  $ curl -sS 'http://127.0.0.1:8025/api/v1/messages?limit=1'
   documents@gather.test -> ['alex@delgado.test'] | Gather test message from Gather
  ```

  **① … ⑥ — the acceptance criteria, driven through the real UI against the real worker:**

  ```
  ✓ ① a schedule sends real reminders, and the log records what happened      (1.1m)
  ✓ ② marking a request complete stops the reminders                          (1.4m)
  ✓ ③ a client who sends everything back is not chased again                  (50.5s)
  ✓ ④ a worker that dies mid-send does not send the reminder twice on restart (1.7m)
  ✓ ⑤ a manual nudge sends immediately without consuming a cadence step       (6.5s)
  ✓ ⑥ a bounce webhook flips the reminder and shows the firm what happened    (26.3s)
  ```

  The worker's own log for one of those sends, showing the derived idempotency key and the
  next run computed from the cadence:

  ```
  {"level":"info","name":"gather-worker","requestId":"809deb9c-…","scheduleId":"424abcd9-…",
   "msg":"reminder sent","to":"r***@gather.test","driver":"smtp",
   "providerMessageId":"<schedule:424abcd9-…:1@delgado.test>","outstanding":2,
   "nextRunAt":"2026-09-08T09:00:00.000Z"}
  ```

  Note `"to":"r***@gather.test"` — addresses are redacted in logs.

  **The state that proves each criterion:**

  ```
   status  | to_address                    | message_id            | idempotency_key
  ---------+-------------------------------+-----------------------+---------------------------------
   bounced | rosa-…-7559@gather.test       | <schedule:8ac1d1f2-…  | schedule:8ac1d1f2-…:0
   sent    | rosa-…-9634@gather.test       | <manual:2f291e4b-…    | manual:2f291e4b-…:2026-09-05T09:42
   queued  | rosa-…-6282@gather.test       |                       | schedule:395a220b-…:0
   sent    | rosa-…-7416@gather.test       | <schedule:fb178a11-…  | schedule:fb178a11-…:0

   active | sent_count |        next_run_at
  --------+------------+----------------------------
   t      |          1 | 2026-09-08 09:00:00+00      ← cadence advanced three days
   f      |          1 |                             ← stopped; nothing more will be sent
  ```

  The `queued` row with no message id is the crash simulation from ④: a claim that was
  written and never sent. The worker restarted, recomputed
  `schedule:395a220b-…:0`, found it taken and refused — `expect(logs).toContain('already
  claimed')` and the log count stayed at one.

  **Everything reminders do is in the hash-chained audit trail:**

  ```
           action         | count
  ------------------------+-------
   reminder.bounced       |     2
   reminder.schedule_set  |    26
   reminder.sent_manually |     5
   reminder.stopped       |     7
   request.completed      |     3
  ```

- **Decisions & why:**
  - **Idempotency belongs in Postgres, not in the provider.** Resend has an
    `Idempotency-Key` header and Gather sends it; SMTP has nothing of the sort. A
    guarantee that holds for one of two shipped drivers is not a guarantee, so the real
    one is a unique index and the header is a courtesy on top. The key is *derived* —
    `schedule:<id>:<sent_count>` — so a restarted process recomputes it rather than
    minting a new one.
  - **The claim is written before the send, not after.** A crash between them loses one
    reminder; a crash the other way sends two. Losing one is visible in the log and
    recoverable. Sending two is neither.
  - **A retryable failure does not advance `sent_count`.** Nothing was sent, so the retry
    has to reuse the same key and stay the same reminder rather than becoming the next one
    in the sequence. A permanent failure stops the schedule instead — a mailbox that does
    not exist will not start existing, and retrying it every minute for a month is noise
    that hides the failures worth reading.
  - **Cadences are day-based on purpose.** A product that can email a client every two
    minutes is a product that will. Recorded as a deviation from the demo script.
  - **The reminder logic is a package, not part of the worker.** The manual "send one now"
    button needs the identical path, and two implementations of "compose and send a
    reminder" is exactly how a send-once guarantee stops holding.
  - **The timezone is the client's, not the firm's.** A London firm chasing a client in
    Sydney sends at nine in Sydney, which is the small hours in London — and that is
    correct. Tested in both directions across both daylight-saving transitions.
  - **Quiet hours move a send rather than skipping it.** A reminder that would land at
    3 a.m. goes out at eight instead. Skipping it would mean a cadence quietly sending
    fewer reminders than the firm configured.
  - **No open or click tracking.** Both need a pixel and a link rewriter, and neither
    belongs in an email asking somebody for their tax documents. Only delivery outcomes
    are subscribed to.
  - **Mailpit is shipped as a documented dev overlay** rather than kept in a test harness.
    It is a real SMTP server; it is the difference between "the suite proves email works"
    and "the suite proves our mock agrees with us". It is labelled never-for-production.

- **Deviations from plan:** five, all written into `plan.md` §9 — day-based cadences
  instead of the demo script's two-minute one; a `@gather/reminders` package rather than
  the logic living in `apps/worker`; idempotency in Postgres rather than at the provider;
  the Mailpit dev overlay; and the due-date rendering correction.

  Also worth recording: **the send-once test was wrong before it was right.** The first
  version restarted the worker after a *successful* send and expected nothing further —
  but `sent_count` had advanced, so the next reminder was legitimately due and the worker
  correctly sent it. The test was asserting the wrong property. It now simulates the crash
  the guarantee is actually about: a claim row written, no email sent, `sent_count`
  unmoved.

  And two build traps worth knowing about: adding a second runtime stage to the Dockerfile
  made `docker compose build web` silently build the **worker**, because Docker's default
  target is the last stage in the file — the web service now names `target: runner`
  explicitly. And pulling in pg-boss resolved a second copy of `pg`, which instantiated
  drizzle-orm twice and failed the typecheck with a wall of "separate declarations of a
  private property"; `pg` is now pinned once for the workspace.

- **Known issues:**
  1. **⚠️ The Resend driver has never been run against the live service.** plan.md §9's
     Phase 4 acceptance ① asks for real Resend message ids; that needs `RESEND_API_KEY`
     and a verified sending domain, which the operator does not have yet. The driver is
     written against the API documentation read on 2026-09-05 and unit-tested against a
     captured request, including the retryable/permanent split for 429/5xx versus
     401/422 — but **it is unproven**. To verify: set `MAIL_DRIVER=resend`, `MAIL_FROM` on
     a verified domain and `RESEND_API_KEY`, then run
     `pnpm check:email you@yourfirm.example` and paste the returned id here.
  2. **The webhook path is proven with SMTP-produced message ids.** The handler matches on
     `provider_message_id` and neither knows nor cares which driver produced it, so the
     signature verification, the status transition and the ordering guard are all genuinely
     exercised — but no message in that test was actually sent by Resend.
  3. **No SMS.** Phase 7, and it needs a Twilio account with a registered 10DLC brand.
  4. **A schedule stopped by a permanent send failure is not automatically resumed** when
     the firm fixes the address. They have to switch reminders back on, and nothing tells
     them to beyond the reminder log showing why it stopped.
  5. **Reminders are per-request.** A client with four open requests gets four emails.
     Batching by client is the obvious next step and is not what Phase 4 promised.
  6. Carried over: `auth.sign_up` still has a NULL `firm_id`; item drag cannot cross
     sections; no pagination; uploads cannot resume; Dependabot #4 (TypeScript 5.9 → 6.0.3)
     still must not be merged.

- **Next step (exact resume instruction):** `Start Phase 5: Approve/reject, dashboard, zip, audit export — per plan.md §9.`

---

## 2026-09-05 — Phase 5: Approve/reject, dashboard, zip, audit export

- **Shipped:**
  - **Per-item approve/reject**, which is the mechanic the whole product turns on. Nothing
    infers approval from a file existing; "complete" is the firm saying so, item by item.
    Rejection requires a note, because "rejected" with no explanation is how a client sends
    the same wrong document three times.
  - **Response versioning.** Rejecting bumps `response.version`, so a resubmission is a new
    answer rather than an edit of the old one — files carry the version they were uploaded
    against, and the superseded copy is retained and still attributable.
  - **Approving the last required item completes the request and stops its reminders, in
    one transaction.** There is no window in which a finished request is still chasing.
  - **A keyboard review flow** — `j`/`k` to move, `a` to approve, `r` to send back, `⌘↵` to
    confirm, `esc` to cancel — for the person doing this forty times in January.
  - **The client's side of a decision**: an approved item is *locked*, not merely ticked; a
    rejected one is outstanding again with the firm's note on it; and the client is emailed
    without anyone pressing "send reminder".
  - **A dashboard that opens on work** — the review queue first, then overdue — with
    per-request percent complete, oldest-outstanding age, reminder state and filters, from
    one aggregate query rather than N+1.
  - **Streamed zip download** foldered `01 Section/01 Item - file.pdf`, with a
    `MANIFEST.txt` carrying the SHA-256 of every file as recorded on arrival. Superseded
    versions are excluded by default and counted in the manifest; `?include=all` takes
    everything.
  - **Audit CSV export**, per request and per firm, that **verifies away from the
    database**: `pnpm verify:audit --csv <file>` recomputes every hash from the file alone.

- **Real-world proof (what actually ran):**

  ```
  ✓ ① rejecting one item of five reopens exactly that one, with the note the client reads
  ✓ ② a resubmission is version 2, and the superseded file is retained
  ✓ ③ approving the last required item completes the request and stops the reminders
  ✓ ④ the zip holds the current files, foldered, with a manifest that matches
  ✓ ⑤ the audit CSV covers the lifecycle and verifies itself away from the database

  Test Files 14 passed | Tests 178 passed        ← unit + integration, real Postgres
  typecheck clean · lint clean · format clean
  ```

  **② Versioning, in the database.** One item rejected and resubmitted; both files kept,
  each on the version it belongs to:

  ```
        original_name      | response_version | current_version | is_current
  -------------------------+------------------+-----------------+------------
   form-w-9.pdf            |                1 |               2 | f
   form-w9-signed-2026.pdf |                2 |               2 | t
  ```

  **④ The zip, read by a real extractor** — `unzip`, not the library that wrote it:

  ```
  $ unzip -t "$ZIP"
  ...
  No errors detected in compressed data of gather-….zip

  $ unzip -l "$ZIP"
   Rosa Delgado - Year-end documents/01 What we need/01 Form W-9 - form-w9-signed-2026.pdf
   Rosa Delgado - Year-end documents/01 What we need/02 Bank statement - bank-statement.pdf
   Rosa Delgado - Year-end documents/MANIFEST.txt
  ```

  The manifest carries the hash recorded when the file arrived, and the extracted bytes
  hash to the same value — so a firm can show that what they handed on is what the client
  sent. `form-w-9.pdf`, the version that was sent back, is absent from the default archive
  and named in the manifest's "Not included (1)" section.

  **⑤ One request's whole life, in an unbroken chain:**

  ```
   id  |          action           |   prev   |   hash
  -----+---------------------------+----------+----------
   774 | request.created           | 5550f55c | 30adee56
   775 | request.structure_updated | 30adee56 | da5668d4
   776 | request.link_issued       | da5668d4 | 58f274ed
   777 | portal.opened             | 58f274ed | 05e739db
   778 | portal.file_uploaded      | 05e739db | ad232546
   779 | portal.file_uploaded      | ad232546 | 778ce3d5
   780 | portal.submitted          | 778ce3d5 | 07e1e233
   781 | response.rejected         | 07e1e233 | 7244139f
   782 | portal.file_uploaded      | 7244139f | 30ca0726
   783 | request.downloaded        | 30ca0726 | 8fbac638

  $ pnpm verify:audit
  OK: 854 events, chain intact (head 832d410fac05…)
  ```

  And the same trail, exported and checked **with no database in sight**:

  ```
  $ pnpm verify:audit --csv gather-audit-<request>.csv
  OK: 11 events, every row's hash recomputes (head 6c8869fa…)
      This is a filtered export, so it cannot show whether events are missing.
      Export the whole trail (no request or date filter) for that.

  $ sed -i 's/Wrong year./Right year./' gather-audit-<request>.csv
  $ pnpm verify:audit --csv gather-audit-<request>.csv
  FAIL at id=781: hash mismatch on event 781 — its content was modified after it was
  written (stored 7244139f3a18…, recomputed 832d8f9075b9…)
  Verified 7 event(s) before failing.                                        exit=1
  ```

  Eleven characters changed in a 6 KB file — `Wrong year.` to `Right year.`, the same
  length — and the check names the event, the field's effect on the hash, and how far it
  got. It failed at the 8th row of 11, which is where the change is.

  **Review decisions, all audited:**

  ```
         action       | count
  --------------------+-------
   response.approved  |    28
   response.rejected  |    10
   request.completed  |     6
   request.downloaded |     4
   audit.exported     |     2
  ```

- **Decisions & why:**
  - **An approved item is locked on the client's side.** Leaving it editable invites a
    client to "improve" a document that has already been filed, and the firm would never
    know. The portal says so in words rather than just disabling a control.
  - **A rejected item is outstanding again even though its file is still attached.** This
    was a real bug found by the test: the progress counter said "5 of 5 done" after a
    rejection, because the old file was still there and `isAnswered` only looks at content.
    The firm's decision has to outrank what is attached — both server-side and in the live
    counter, which now updates the moment the client starts fixing it rather than a
    debounce later.
  - **The rejection email is sent after the transaction commits, not inside it.** A mail
    server that hangs must not hold a database transaction open. A rejection recorded whose
    email failed is recoverable — the item is visibly outstanding and the next reminder
    lists it. The reverse would tell a client to fix something the firm never sent back.
  - **Approving an empty item is allowed.** A firm told on the phone that a client has no
    rental income should be able to tick it off; refusing would push them into asking the
    client to type "n/a", which is worse for everyone and leaves a less honest record than
    an approval with the firm's name on it.
  - **The export reports two properties, not one.** Every export proves *no row was
    altered*. Only a complete export proves *no row is missing*, because a filtered trail
    has gaps in its ids by construction. Collapsing both into "chain intact" would be
    claiming something a filtered file cannot support, and this is a feature sold as
    evidence.
  - **The CSV guards against formula injection.** A client who names a file
    `=cmd|'/c calc'!A1` would otherwise get it executed on the firm's machine when they open
    the export. A leading tab neutralises it and is invisible in the cell.
  - **The zip is streamed with lazy entry opening.** A 40-file request holds one decryption
    stream at a time rather than forty, and a year of bank statements never lands in the
    app's heap.
  - **Downloading is an audit event, written before the bytes move.** A firm taking a copy
    of a client's tax documents off the system is exactly the access 16 CFR 314.4(c)(8) asks
    to be logged, and an event written only on success would miss a download that failed
    halfway.

- **Deviations from plan:** three, plus one correction, all written into `plan.md` §9 — the
  two-property export verdict; ASCII punctuation in zip entry paths; superseded versions
  excluded by default with `?include=all`; and the `auth.sign_up` NULL-`firm_id` fix.

  Also worth recording: **the zip acceptance criterion caught a real interoperability
  problem.** `unzip -t` failed on the first archive with "mismatching local filename". The
  archive was correct — Python's `zipfile` read every name perfectly and reported no errors,
  and yazl sets the UTF-8 flag in both the local and central headers — but Info-ZIP UnZip
  6.00, dated 2009 and still what `unzip` is on Debian and Ubuntu, warns and exits non-zero
  on any non-ASCII entry name. The em-dash that triggered it was a typographic preference of
  ours, not the client's data, so it is now a hyphen. Characters that come from a firm's or
  a client's own name are kept, because mangling somebody's name is worse than a warning on
  a seventeen-year-old tool.

- **Known issues:**
  1. **The audit viewer is the request page's History card and the dashboard's activity
     list, not a dedicated page.** Filtering and paging live in the CSV export
     (`?from=`/`?to=`), not in the UI. Fine for a firm's first year; a firm with 50,000
     events will want a real viewer.
  2. **PDF export of the audit trail is not built.** plan.md §9 said "CSV/PDF"; CSV is what
     ships. A PDF needs a rendering dependency and a layout, and the CSV is what actually
     gets attached to an email or opened in Excel. Say the word and it is a small addition.
  3. **`request.downloaded` records that a zip was requested, not that it arrived.** The
     event is written before the stream starts, deliberately — but a download the browser
     cancelled halfway still shows as one that happened.
  4. **No bulk review.** Approving 25 items is 25 keystrokes (`a`, `j`, `a`, `j`, …). That
     is fast, but "approve everything outstanding" is the obvious next thing a firm will ask
     for, and per-item approval being the product's whole thesis is exactly why it is not
     there by default.
  5. **The dashboard has no pagination**, carried over. Every matching request renders.
  6. **A request whose reminders were stopped by completion does not restart them** if the
     firm later rejects an item. The rejection puts the request back to `in_progress`, so a
     schedule that is still active resumes — but one that was switched off stays off, and
     nothing prompts the firm to turn it back on.
  7. Carried over: item drag cannot cross sections; uploads cannot resume; no virus scanning
     until Phase 6; Resend unproven; Dependabot #4 (TypeScript 5.9 → 6.0.3) must not be
     merged.

- **Next step (exact resume instruction):** `Start Phase 6: Security hardening pass — per plan.md §9.`

---

## 2026-09-05 — Phase 6: Security hardening pass

- **Shipped:**
  - **Rate limiting in Postgres**, not in memory — a limit that resets on restart and is
    not shared between replicas is not a limit. One atomic upsert per request, so two
    simultaneous requests cannot both read zero and both be allowed.
  - **Virus scanning**, opt-in: real clamd over its INSTREAM protocol, written directly
    (sixty lines) rather than shelling out to a binary Gather does not ship. An upload is
    `pending` and undownloadable until it comes back; an infected one is **quarantined** —
    row and audit event kept as evidence, bytes deleted, client told.
  - **Security headers with a real CSP**, per-request nonce plus `strict-dynamic`, in
    `proxy.ts`. Uploaded files keep their own far stricter `default-src 'none'; sandbox`.
  - **Hardened upload sniffing**: markup is refused whatever it is named, and a file
    claiming a format that always has a signature is refused when it has none.
  - **`retention:purge`** — 16 CFR 314.4(c)(6) disposal that leaves the evidence behind.
    Dry run by default; retention off by default.
  - **`docs/threat-model.md`**, **`docs/safeguards-rule-mapping.md`** and
    **`docs/incident-response.md`** — including, at length, what Gather does *not* do.
  - **`e2e/security.spec.ts`** (6 tests) and **`e2e/antivirus.spec.ts`**, plus CI jobs.

- **Real-world proof (what actually ran):**

  ```
  ✓ ① a portal session cannot reach another request, by any route          (23.1s)
  ✓ ② an expired link is refused, a revoked link is refused, and both are
      recorded                                                             (15.8s)
  ✓ ③ too many uploads gets a 429 with the headers to act on               (12.0s)
  ✓ ③b a magic-link flood is bounded even when callers cannot be told apart (10.9s)
  ✓ ⑤ with no scanner configured, files say so rather than looking clean    (11.5s)
  ✓ ⑥ every response carries the security headers, and uploads carry
      stricter ones                                                        (12.9s)
  6 passed

  ✓ ④ an infected upload is quarantined, deleted, and never downloadable   (20.4s)
  1 passed

  Test Files 14 passed | Tests 182 passed        ← unit + integration, real Postgres
  typecheck clean · lint clean · format clean
  ```

  **④ Real ClamAV, real signatures, the real EICAR string.** clamd reported its own
  version and database serial before the run, so this is not a stub agreeing with itself:

  ```
  $ docker compose … exec -T clamav clamdscan --version
  ClamAV 1.5.4/28108/Sun Aug 30 06:27:10 2026

   scan_status | count |  bytes
  -------------+-------+---------
   clean       |     4 |  563260
   infected    |     3 |     204
   skipped     |    80 | 9846395

   original_name | mime       | size | scan_status
  ---------------+------------+------+-------------
   statement.txt | text/plain |   68 | infected

         action      |      signature       |     name
  -------------------+----------------------+---------------
   file.quarantined  | Eicar-Test-Signature | statement.txt
  ```

  The clean PDF in the same run came back `clean`, which is what makes the `infected`
  meaningful — a scanner stuck on "everything is malware" would pass a test that only
  checked the bad case.

  **⑦ Disposal, by direct inspection.** A completed request's files, before and after:

  ```
  $ docker compose exec -T worker sh -lc 'ls -la /app/data/uploads/0b6a7471-…/'
  -rw-------  1 gather gather  243549  750c083e-….bin
  -rw-------  1 gather gather  140815  da4a50de-….bin

  $ docker compose exec -T worker node dist/cli/retention-purge.js --older-than 365d --confirm
  Disposed of 2 file(s). Records and audit trail kept.

  $ docker compose exec -T worker sh -lc 'ls -la /app/data/uploads/0b6a7471-…/'
  total 8                                     ← both objects gone

   original_name   | hash_kept |  size  | purged
  -----------------+-----------+--------+--------
   irs-form-w9.pdf | t         | 140815 | t
  ```

  The bytes are gone; the name, size and SHA-256 remain, which is the difference between
  disposal and deletion.

- **Decisions & why:**
  - **The rate-limit subject is a session wherever one exists, not an IP.** A family
    sharing a router, an office behind one NAT and an entire country behind carrier-grade
    NAT are all one address. Limiting them as one person breaks the product for exactly the
    clients least able to work around it.
  - **A limiter that cannot reach its store allows the request.** Gather is self-hosted by
    firms whose alternative is email attachments; an outage that becomes a lockout is worse
    than a minute of unlimited requests, and a database that is down means nothing else
    works anyway. The failure is logged at `error`.
  - **`X-Forwarded-For` is not believed by default.** With it trusted and no proxy in
    front, anyone can set it and pick their own rate-limit bucket. An install behind a
    proxy that has not set `GATHER_TRUST_PROXY` sees every request as coming from the
    proxy — a visible, fixable problem rather than a silent bypass.
  - **The infected file's bytes are deleted, not merely flagged.** A quarantine that keeps
    a live copy of malware on the firm's server is a worse answer than one that does not.
    The row and the audit event are the evidence.
  - **`pending` is refused like `infected`.** On an install with a scanner, "we have not
    looked yet" and "we looked and it was bad" are the same answer until the scan finishes.
  - **Markup is refused outright rather than defended against.** An SVG can carry script;
    `file-type` cannot see it because it is text. Rejecting it is stronger than any header,
    and the headers are still there for everything else.
  - **The CSP uses a nonce and `strict-dynamic`, not `unsafe-inline`.** Next injects inline
    bootstrap scripts, so the alternative is no script policy at all — and a policy that
    would not stop an injected script is not worth the header on a page that also holds
    tax documents.
  - **HSTS only over HTTPS.** Sending it on a plain-HTTP install would pin a browser to a
    scheme that install does not serve, and a self-hoster on a LAN address would be locked
    out of their own tool with no way to undo it.
  - **Retention is off by default and the CLI is a dry run by default.** Deleting a firm's
    client documents on a timer they did not set is not a decision Gather gets to make.

- **Deviations from plan:** four, plus one correction, all written into `plan.md` §9 — two
  magic-link buckets instead of one; a page rather than a 401 for a dead link; no separate
  download origin; the purge running inside the container; and Better Auth's limiter moved
  off in-memory storage.

  Also worth recording: **four real defects were found by writing the acceptance tests.**

  1. **The new CSP silently weakened file downloads.** `proxy.ts` set `default-src 'self'`
     on every response — including the file routes, overwriting the `default-src 'none';
     sandbox` that is the actual defence against an uploaded file executing. Caught by
     test ⑥ within minutes of the proxy being added, which is precisely the argument for
     asserting on headers rather than trusting that they are set.
  2. **HTML renamed `.pdf` was accepted.** `file-type` reads binary signatures, so text
     formats are invisible to it and the extension checks passed because the *extension*
     was fine. Now markup is detected textually and a signature-bearing extension with no
     signature is refused.
  3. **The magic-link limit was a self-inflicted outage.** With no trusted proxy header
     every caller shared one bucket at 20/minute — so the rate-limit test locked the two
     tests after it out of their own portals. A firm sending thirty organizers in January
     would have done the same to its clients.
  4. **The first purge deleted eight files and recorded none of them.** `completedAt` was
     selected through a raw `sql<Date>` fragment, which drizzle types but does not parse,
     so it came back a string and `toISOString()` threw *after* the object was gone. The
     column is now selected directly. The recovery worked as documented — both drivers
     treat removing an absent object as success, so re-running completed the marking — but
     the ordering decision is now written down rather than assumed.

- **Known issues:**
  1. **No key rotation.** If `GATHER_ENCRYPTION_KEY` is exposed, there is no supported way
     to re-encrypt existing files. `docs/incident-response.md` says so plainly rather than
     implying a procedure exists.
  2. **The audit head hash is not anchored outside the database.** Catching a full database
     compromise needs it printed, mailed or committed somewhere; Gather does not do that
     for you, and the threat model says so.
  3. **Scanning is inline with the upload request.** A 100 MB file on a slow clamd holds
     the request open for its whole scan. Fine for tax documents; a queue would be better
     for a firm collecting video.
  4. **`ANTIVIRUS_DRIVER=clamav` lowers the upload ceiling to 25 MB** in the compose
     overlay, because clamd's own `StreamMaxLength` defaults to that and refuses more. The
     error message says so, but the two settings have to be raised together by hand.
  5. **No CAPTCHA or proof-of-work anywhere.** Rate limits bound a brute-force; they do not
     stop a distributed one. Put a reverse proxy in front.
  6. **Rate-limit buckets are swept by the retention job**, so an install that never runs
     it accumulates one row per bucket. Small, but unbounded.
  7. Carried over: uploads cannot resume; no pagination; item drag cannot cross sections;
     Resend unproven; Dependabot #4 (TypeScript 5.9 → 6.0.3) must not be merged.

- **Next step (exact resume instruction):** `Start Phase 7: Cloud + Stripe — per plan.md §9.`

---

## 2026-09-05 — Phase 7: Cloud + Stripe

- **Shipped:**
  - **Team, in the free product.** Three roles (`owner`/`admin`/`member`) with ten named
    permissions in `packages/core/src/permissions.ts`; invitations shaped exactly like
    portal links — 32 bytes of CSPRNG, stored only as SHA-256, per-invite expiry,
    revocable, single-use, every use audited. `/settings/team` to manage them,
    `/join/<token>` to accept one. Sign-up now has a second shape: an invited colleague
    with no account signs up **through** the invitation, which is also the only way past
    `GATHER_ALLOW_SIGNUP` when an install is closed.
  - **`?next=` handling** across sign-in and the second factor (`lib/next-path.ts`), so an
    invitation link works for somebody who already has an account. Only same-origin paths
    survive: an open redirect on a sign-in page is a phishing tool wearing a real
    certificate.
  - **The hosted tier**, as `GATHER_CLOUD=true` over the same code rather than a `cloud/`
    fork. Stripe Checkout, Billing Portal and webhooks (`packages/billing`), plan gating on
    seats and storage, `/settings/billing`, and the operator console at `/admin`.
  - **`packages/db/src/admin.ts` — the only module in Gather that reads across firms.**
    Deliberately one file, deliberately read-only, and every visit written to the audit log.
  - **`docker-compose.prod.yml` + `docker/Caddyfile`:** automatic Let's Encrypt TLS, HSTS,
    nothing but Caddy published, `GATHER_TRUST_PROXY` on because now there really is one,
    and a nightly `pg_dump` keeping a fortnight.
  - **`docker-compose.cloud.yml`** so the hosted tier can be run and tested before anybody
    has a Stripe account, and `pnpm test:cloud` to do it.
  - Docs: `docs/stripe-verification.md` — the procedure that closes the one hard stop.

- **Real-world proof (what actually ran):**

  ```
  $ pnpm test:cloud
    ✓ 1 [cloud] ① the hosted tier shows a real subscription state and real usage (5.7s)
    ✓ 2 [cloud] ② the seat limit is enforced, counting invitations that have not been accepted (8.2s)
    ✓ 3 [cloud] ③ Subscribe really calls Stripe, and says so when Stripe refuses (7.4s)
    ✓ 4 [cloud] ④ the operator console lists every firm, and nobody else can open it (10.9s)
    4 passed (34.0s)

  $ npx playwright test --project=chromium team.spec.ts
    ✓ 1 ① an invited colleague follows the link, joins the firm, and sees its work (20.4s)
    ✓ 2 ② a member cannot change the team, and the server refuses even without a button (12.0s)
    ✓ 3 ③ another firm cannot reach this firm’s request, client or exports (10.1s)
    ✓ 4 ④ a self-hosted install has no billing page and no admin console (4.0s)
    4 passed (48.5s)
  ```

  The Subscribe button reaches Stripe. This is the container log from test ③ — a real HTTPS
  round trip to `api.stripe.com`, rejected because the credentials are placeholders:

  ```
  {"time":"2026-09-05T14:01:43.257Z","level":"error","name":"gather",
   "msg":"could not start a Stripe checkout",
   "error":"Invalid API Key provided: sk_test_*****************************_yet"}
  ```

  The invitation is a real email over real SMTP, asserted from Mailpit's API by
  `team.spec.ts` ①, not from a log line.

  The audit trail after the phase's runs, straight out of Postgres:

  ```
  $ docker compose exec -T db psql -U gather -d gather -Atc \
      "select action, count(*) from audit_event
        where action like 'firm.member%' or action like 'admin.%' group by action order by 1"
  admin.console_viewed|5
  firm.member_added|243
  firm.member_invited|14
  firm.member_role_changed|1
  ```

  The operator console reading 241 firms across the whole install — the only cross-tenant
  query there is — while `team.spec.ts` ③ proves a signed-in user of firm B gets 403/404 on
  every one of firm A's URLs and finds none of A's text in any response body.

  `packages/db/src/team.test.ts`: 9 integration tests against real Postgres covering
  single-use invitations, expiry, revocation, cross-firm refusal of every mutation, seat
  counting including pending invitations, and the subscription upsert. Full suite:
  **18 files, 232 tests, all passing.**

- **Decisions & why:**
  1. **No `cloud/` directory.** plan.md §9 called for one. A parallel tree means two
     codebases and a self-hosted product that quietly rots, and the boundary is enforced far
     better by `PLAN_DEFINITIONS.self_hosted` having `null` for every limit than by a folder.
     `null` means "no meter exists" — a large number would be a meter somebody could turn
     down later.
  2. **Team roles ship free.** They were priced as a paid feature. A two-person firm
     self-hosting needs them exactly as much as a hosted one; gating them would have broken
     the boundary rule in §7.2, which is the rule the whole business model rests on.
  3. **A firm is never locked out.** On the hosted tier a firm with no live subscription —
     still deciding, or stopped paying — gets the entry plan's limits, not a wall. Their
     documents stay reachable and exportable. The alternative is holding a firm's client
     files hostage, which is not a business this product will be in, so it is a constant in
     `lib/cloud.ts` rather than a promise in a FAQ.
  4. **Only the webhook may change a plan.** The redirect back from Checkout deliberately
     writes nothing, so a client that closes the tab cannot leave a firm unsubscribed and
     one that forges the return cannot leave them subscribed. A bad signature gets 401, not
     5xx: Stripe retries 5xx, and a signature that does not verify never will.
  5. **The env refuses to boot with billing half-configured.** `GATHER_CLOUD=true` without
     all four Stripe values is a startup failure. A payment button that errors is worse than
     no payment button.
  6. **`GATHER_ADMIN_EMAILS` accepts `@domain`.** An operator's staff list changes more often
     than their deployment does. Documented with the obvious warning: Gather does not verify
     addresses at sign-up, so only list a domain whose mailboxes you control.
  7. **`/admin` is `notFound()`, not 403.** Somebody who is not an operator should not learn
     there is an operator console. On a self-hosted install the list is empty and the route
     does not exist for anyone — there is no Seziro back door into a firm's data.

  **Five real defects were found by writing the acceptance tests:**

  1. **An invited colleague could not sign up at all.** `isSignupAllowed()` is
     `first-user-only` by default, so on any real install the invitation link led to
     "Sign-ups are closed". The entire team feature was unreachable end to end. Sign-up now
     has an invitation branch, checked server-side against the token rather than trusted
     from the query string.
  2. **The operator console threw on every page load.** `db.execute` does no column mapping
     — drizzle turns off node-postgres's date parsing so it can apply its own types — so a
     raw-SQL timestamp arrived as `'2026-09-05 13:38:11.352+00'` and `.getTime()` threw,
     having typechecked perfectly against a `Date` I had written into the interface myself.
     Timestamps are now selected as epoch seconds and converted in one place. **This is the
     same defect as Phase 6's purge bug**, which is why `team.test.ts` now asserts
     `toBeInstanceOf(Date)` rather than trusting the type.
  3. **The console disagreed with the billing page about what a firm was on.** One read the
     database's `effective_plan`, the other the install's policy. Now both call
     `applicablePlan`.
  4. **The Dockerfile did not build `@gather/billing`,** so the image failed at `next build`
     the first time the cloud code was imported. Caught by the container build, which is the
     only place it could have been.
  5. **`e2e/auth.spec.ts` had been asserting on a heading deleted in Phase 5.** The
     dashboard's "Audit trail" became "Recent activity"; the test had been failing ever
     since and was recorded as an environment problem. It was not. Fixed, and worth
     recording as a caution about attributing a red test to flakiness.

- **Deviations from plan:**
  1. **SMS reminders, e-signature and Drive/Dropbox/OneDrive sync are not built.** plan.md
     §7.2 listed all three on Cloud Pro. Each needs a third-party account nobody has: a
     registered A2P 10DLC brand (days to weeks of carrier registration, real per-message
     cost), a DocuSeal deployment, and OAuth applications reviewed at three separate
     vendors. They were **cut rather than stubbed** — writing three integrations that have
     never once run against the real API and then listing them on a pricing page is exactly
     what CLAUDE.md §4 forbids, and a customer discovering an advertised feature does not
     work is worse than one who never saw it offered. plan.md §7.2 now records the cut, what
     each needs, and that Cloud Pro is consequently a capacity tier: ten seats and 100 GB
     rather than three and 25 GB. `FEATURES` in `plans.ts` contains only what exists,
     because the site's pricing table is generated from it.
  2. **White-label domains** were in the same table and are also not built. Firms do get
     their name and brand colour on the portal — on every tier, including self-hosted.
  3. `cloud/` directory → an environment flag (decision 1).
  4. Team roles moved from paid to free (decision 2).

- **Known issues:**
  1. ⛔ **Stripe has never completed a call.** Checkout, the portal and the webhook are
     written against the official SDK with the API version pinned, the webhook logic is unit
     tested, and the button provably reaches Stripe — but no subscription has ever been
     created. `docs/stripe-verification.md` is the seven-step procedure that closes this,
     and it needs a Stripe test-mode account. **Until it is run, "Gather Cloud works" is not
     a claim this repo may make.**
  2. **One firm per person.** `getMembership` takes the first row, so somebody invited to a
     second firm keeps the first. Fine for accountants, wrong for a bookkeeper serving two
     practices. Needs a firm switcher.
  3. **The storage limit is a pre-check, not a hard stop.** The portal upload route asks
     `checkUploadFits` before accepting a file and answers 507 with an explanation the client
     can act on — but it trusts `Content-Length` to decide, so a client that lies about the
     length can overshoot by one file. The per-file ceiling is still enforced while
     streaming; only the plan total can be passed, and only by that much.
  4. **The prod stack has never run on a real hostname.** `docker compose config` validates
     and Caddy's config is written, but nobody has pointed DNS at it and watched ACME issue
     a certificate. That is a launch step, not a code step.
  5. **Backups are local.** `docker-compose.prod.yml` writes nightly dumps into a volume on
     the same machine as the database. Copying them somewhere else is the operator's job and
     the README says so rather than implying disaster recovery.
  6. **The operator console has no pagination** — 200 firms, newest first, then nothing.
  7. Carried over from Phase 6: no key rotation; the audit head is not anchored outside the
     database; scanning is inline with the upload; `ANTIVIRUS_DRIVER=clamav` lowers the
     upload ceiling to 25 MB; no CAPTCHA; uploads cannot resume; no pagination on requests;
     item drag cannot cross sections; Resend unproven; Dependabot #4 (TypeScript 5.9 → 6.0.3)
     must not be merged.

- **Next step (exact resume instruction):** `Start Phase 8: site, README, launch — per plan.md §9.`

---

## 2026-09-05 — Phase 8: Site, README, launch

- **Shipped:**
  - **`site/`** — a static one-page Astro site with the copy from plan.md §8: hero,
    before/after, the demo, three steps, practitioner quotes linked to the threads they came
    from, the open-source block, pricing, five real questions, footer. Builds to plain files
    that deploy anywhere; `PUBLIC_SITE_URL` and `PUBLIC_REPO_URL` are environment variables
    because the domain is a decision made later.
  - **`scripts/capture-demo.mjs`** — every image on the site and the README's demo gif,
    captured by driving a real install with a real browser.
  - **`CHANGELOG.md`** for 0.1.0, with a "Known gaps" section rather than only an "Added"
    one.
  - **`docs/launch-checklist.md`** — what has to be true before announcing, what has to be
    true before Cloud takes a signup, and where to post (with each community's rules noted).
  - **README** brought up to date: the demo gif, the team feature, the production and cloud
    deployment sections, and the Stripe gap stated in the README itself rather than only in
    `progress.md`.
  - A CI job for the hosted tier, and `vitest.setup.ts` so `pnpm test` reads `.env` and works
    against a running `docker compose up` instead of failing with "no database configured".

- **Real-world proof (what actually ran):**

  ```
  $ node scripts/capture-demo.mjs
  ▸ signing up a firm
  ▸ adding a client
  ▸ building a request from the US individual tax template
  ▸ shot: builder.png
  ▸ issuing a portal link
  ▸ opening the portal on a phone
  ▸ uploading a real IRS W-9 through the portal
  ▸ the firm reviewing, and sending one item back with a note
  ▸ shot: rejected.png
  ▸ what the client sees when an item comes back
  ▸ shot: portal-rejected.png
  ▸ the dashboard
  ▸ the audit trail
  ▸ converting the recording to a gif
  ▸ demo.gif written
  ▸ composing the OG image from the dashboard screenshot
  ```

  `site/public/shots/portal-rejected.png` is an iPhone-sized screenshot of the real portal
  showing the real note — *"Please take another look: This is page 1 only — I need all four
  pages, including the signature page."* — above the real 138 KB `irs-form-w9.pdf` the
  client uploaded a moment earlier. `site/public/shots/audit.png` is the request's real
  history: `#3130 Item sent back`, `#3129 Client uploaded a file`, `#3128 Client opened the
  link`, `#3127 Portal link created`, `#3126 Request created`, each with its hash prefix.

  ```
  $ pnpm --filter @gather/site build
  14:34:23 [build] 1 page(s) built in 643ms
  14:34:23 [build] Complete!
  ```

  The built page loaded in Chromium at 1280×900 and in WebKit at 390×844: **no console
  errors, no failed requests, no horizontal overflow at either size.**

  **The quickstart, timed for real** (plan.md §9 Phase 1 acceptance ①, re-run here because
  Phase 8 is where the README makes the claim publicly). Clean `git clone` into a temporary
  directory, `cp .env.example .env`, `docker compose up -d --build`, polling `/api/health`
  until `status: ok`, with `docker builder prune -af` first so nothing was cached:

  ```
  COLD_BUILD_AND_BOOT_SECONDS=332      # 5 min 32 s, empty build cache
  {"status":"ok","db":"ok","migrations":"applied","checkedAt":"2026-09-05T15:01:03.855Z"}

  ELAPSED_SECONDS=19                   # same machine, image already built
  ```

  On an 8-core Xeon E5-2695 v4 with 8 GB of RAM. **That is 32 seconds over the five minutes
  CLAUDE.md §5 asks for**, so the README states both numbers and the machine rather than
  rounding down to a nicer sentence. Almost all of it is compiling the app inside the
  container; the boot itself is seconds.

  Whole-repo state at the end of the phase:

  ```
  $ pnpm test
   Test Files  19 passed (19)
        Tests  237 passed (237)

  $ npx playwright test           # against the built image, mail overlay up
    33 passed (20.3m)             # chromium 26 · mobile-safari 3 · team 4

  $ pnpm test:cloud
    4 passed (34.0s)

  $ pnpm lint && pnpm format && pnpm build
    (clean)
  ```

- **Decisions & why:**
  1. **No screenshot was made in a design tool.** `capture-demo.mjs` drives the real product
     and writes the images the site imports, so a marketing page cannot drift from the
     software — if a screen changes, re-running the script changes the site. A page that
     could show something the product does not do is a page that eventually will.
  2. **The pricing table is generated from `PLAN_DEFINITIONS`,** which now contains only
     features that exist. This is the mechanism that stops the site advertising SMS.
  3. **The "not open yet" plans are text, not disabled buttons.** A greyed control that never
     becomes pressable is a lie with a cursor.
  4. **The Stripe gap is on the site and in the README,** not only in `progress.md`. A gap
     recorded where only the author reads it has been hidden, and the launch checklist now
     says so as a rule.
  5. **The demo gif is the review, not the tour.** Six seconds: a dashboard with one request
     waiting, then the firm going through it and sending one document back with a note. That
     is the mechanic the product turns on, and it fits. The window is measured off the wall
     clock during the capture rather than hard-coded, because a fixed offset silently drifts
     every time a step is added above it — which is exactly how the loop ended up opening on
     a sign-up form. 6fps, 720px, 48 colours, no dithering: **619 KB rather than 10 MB**, and
     the dither pattern was almost all of the difference.
  6. **`vitest.setup.ts` reads `.env`.** `pnpm test` used to fail on a laptop where the stack
     was already running, with the connection string sitting in `.env` unread. Real
     environment variables still win, so CI is unaffected, and `testDatabaseUrl()` still
     derives a `_test` database — loading `.env` can never point a truncating test at
     somebody's development data.

  **A real defect, found by the capture script rather than by the test suite.**

  `scripts/capture-demo.mjs` drives the product further than any single test does — sign-up
  to submitted request to rejection — and the dashboard **500'd** the first time a client
  actually submitted anything:

  ```
  ⨯ TypeError: c.getTime is not a function
      at Array.map (<anonymous>)
  ```

  `listRequestSummaries` computes `min(response.updated_at)` and `max(sent_at)` as
  `sql<Date | null>` fragments. Drizzle maps a *column* to a Date because it knows the
  column's type; a raw fragment is an assertion it cannot check, and node-postgres has date
  parsing switched off so drizzle can do the mapping itself. Both arrived as
  `'2026-09-05 15:10:41.881+00'`, and "oldest outstanding" threw on the first Date method.

  **This is the third time the same mistake has shipped in this codebase** — the Phase 6
  retention purge, the Phase 7 operator console, and now the dashboard. It hid here longest
  because with no responses in the table the aggregate is null, and null has no methods to
  get wrong: it broke the moment a real client sent something back, which is to say for
  every real user, on the page they open first.

  Fixed by converting at the query boundary, and now covered twice over:
  `packages/db/src/review.test.ts` (5 tests, asserting `toBeInstanceOf(Date)` on every date
  the query returns, because a type annotation is demonstrably not what catches this) and
  `e2e/review.spec.ts` ①, which now opens the dashboard while a request is genuinely waiting
  — the state no test had ever rendered.

- **Deviations from plan:**
  1. **No before/after photograph of an inbox.** plan.md §8 asked for the "47 chase emails"
     panel to be rendered from the real product. There is no real inbox to render — the
     product is what replaces it — so the left panel is a plainly-styled list of subject
     lines, obviously a diagram, next to a real screenshot on the right. Inventing a
     screenshot of somebody's mail client would have been the one fake image on the page.
  2. **Lighthouse ≥95 is claimed by construction, not measured.** No Chrome-headless
     Lighthouse run happened here: the page is one static HTML file with an inlined
     stylesheet, no web fonts, no third-party scripts and no client JavaScript. What was
     measured is what the audit is a proxy for — no console errors, no failed requests, no
     horizontal overflow, on desktop and on a phone.
  3. `site/` is a pnpm workspace package rather than a standalone directory, so one
     `pnpm build` covers it.

  **A second defect, this one in the harness rather than the product.** The reminder suite
  had been reading Mailpit at a hard-coded `127.0.0.1:8026` — the port one machine happened
  to need because 8025 was taken on it. Everywhere else, including CI, mailpit is on 8025
  and every mail test failed with `ECONNREFUSED`. It now derives the port from
  `MAILPIT_UI_PORT`, the same variable the compose overlay publishes on, and that variable
  is documented in `.env.example` rather than living only in one person's `.env`.

- **Known issues:**
  1. **`capture-demo.mjs` wants an install that has not been captured before.** It signs up
     `dana@delgado.example.com`, and on a second run against the same database that address
     is taken, so it falls back to a stamped one that then appears in the screenshots. Fine
     against a fresh stack; worth knowing before re-running.
  2. **The demo gif is 1.4 MB in the repository.** Git does not delta-compress it, so every
     re-capture adds another copy to history. Worth moving to a release asset if it is
     regenerated often.
  3. **The site has no analytics, and will not get any** — that is a decision, not a gap, but
     it means the launch will be measured by GitHub stars and issues rather than by traffic.
  4. Carried over: everything in the Phase 7 list, above all that **Stripe has never
     completed a call**.

- **Next step (exact resume instruction):** `Run docs/stripe-verification.md end to end with real Stripe test keys, then update progress.md and the ⚠️ notes it names.`
