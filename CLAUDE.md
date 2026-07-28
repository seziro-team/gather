# SEZIRO BUILD PROTOCOL

You are Claude Code, acting as the sole senior engineer building an open-source
product for Seziro (an independent studio: brand, software, AI). The human
operator runs you in PHASES and CLEARS CONTEXT between phases. These rules
govern every session in this repo and override convenience.

## 1. SESSION START — EVERY TIME
Your chat memory is gone between phases. At the start of EVERY session:
1. Read this file, then `plan.md`, then `progress.md`, then `git log --oneline -20`.
2. State which phase you are in and what its acceptance criteria are.
3. Never assume anything from "previous conversations" — the files and the git
   history are the only truth.

## 2. PHASE 0 — RESEARCH & PLAN (mandatory first phase, no code)
Before writing any code:
1. RESEARCH PROPERLY, ONLINE, NOW. Use web search and fetching to verify:
   - Competitors: real current pricing pages, real user complaints (Reddit,
     HN, G2/Capterra reviews, GitHub issues). Quote and link the pain.
   - Every third-party API this product needs: confirm the endpoints, auth
     model, scopes, quotas, and pricing EXIST TODAY by reading the official
     docs. Never plan against remembered API knowledge.
   - Existing open-source projects to build on or differentiate from.
2. Write `plan.md` — the complete build spec:
   - Vision, target user, positioning, and the competitor teardown (with links).
   - Differentiation: exactly why this wins as open source.
   - Architecture (text/mermaid), data model, stack choices with reasons.
   - License choice (default AGPL-3.0 for server apps, MIT for SDKs/templates)
     with one paragraph of reasoning.
   - The FREE self-hosted scope and the PAID cloud scope (from the brief),
     refined by your research.
   - The one-page website spec (copy outline included).
   - PHASE BREAKDOWN: numbered phases, each with goal, task list, explicit
     acceptance criteria, and a "demo script" (the exact commands/actions that
     prove it works for real). Size each phase to fit ONE context window; if a
     phase grows, split it and record the change.
   - Risks and open questions.
3. Create `progress.md` containing ONLY a header and this entry template
   (no fake entries):
   ## [date] — Phase N: <name>
   - Shipped:
   - Real-world proof (what actually ran):
   - Decisions & why:
   - Deviations from plan:
   - Known issues:
   - Next step (exact resume instruction):
4. Commit both files. STOP and wait for the operator to approve the plan.

## 3. PHASE END — EVERY TIME
A phase is NOT done until:
1. Its acceptance criteria pass with REAL runs (see rule 4) and you show the
   evidence (command output, IDs of created objects, screenshots/paths).
2. `progress.md` gets a full new entry (template above).
3. `plan.md` is updated if scope/architecture changed (never silently drift).
4. Everything is committed with conventional-commit messages.
5. You print the exact one-line instruction the operator should paste to start
   the next phase after clearing context.

## 4. THE REALNESS RULE — ZERO PLACEHOLDERS
Everything built must be completely real, end to end:
- NO lorem ipsum, no "TODO: integrate later", no stubbed functions, no mocked
  API responses in shipped code paths, no fake data rendered in any UI, no
  dead buttons, no hardcoded sample outputs pretending to be live results.
- Every integration is the REAL third-party API, wired via environment
  variables. Maintain `.env.example` documenting every variable with a comment
  and where to obtain it.
- If a real credential, account, or paid signup is required, STOP and ask the
  operator for it. Never fake around a missing credential.
- Test fixtures are allowed ONLY inside the test suite, clearly labeled.
- "Done" means provably done: the call was actually placed, the email actually
  sent, the Stripe test-mode charge actually created, the file actually
  rendered — and the proof is pasted into `progress.md`.
- Prefer proven open-source components over reinventing; credit them in README.

## 5. OPEN-CORE BUSINESS MODEL (applies to every product)
- FREE = the self-hosted product. It runs on the user's own PC/server/
  resources: `docker compose up` from a clean machine in under 5 minutes,
  bring-your-own API keys, no phone-home, no artificial limits on core value.
- PAID CLOUD = hosted on Seziro's own server infrastructure, LIVE FROM DAY 1
  of launch. Build it in this repo (or `cloud/` dir) as a deployable layer:
  multi-tenant orgs + auth, Stripe billing (subscriptions and/or usage
  metering via Stripe's current Meters API), an admin panel for Seziro, and
  the paid-only features named in the brief. Include
  `docker-compose.prod.yml` + reverse-proxy config; ALL hostnames/URLs are
  env-driven because domains are decided later. Stripe runs in test mode
  until the operator flips the live keys.
- The boundary rule: self-host must be genuinely great (that's the marketing);
  paid features are hosting, convenience, team/multi-location scale, and
  managed compliance — never crippling the core.

## 6. ONE-PAGE WEBSITE (every product ships one)
Build `site/` — a single-page static marketing site (Astro preferred), with
REAL copy written for this product (no filler): hero with one-line promise,
demo (gif or short video you actually capture from the working product),
"how it works" in 3 steps, open-source block with the install command and
GitHub link, pricing table (Self-Hosted — Free forever vs Cloud — $X/mo),
FAQ (5 real questions), footer "Built in the open by Seziro." SEO meta + OG
image (generate it from the product, not a placeholder). Must build to
static files deployable anywhere; domain env-driven.

## 7. REPO HYGIENE (every product)
README with a real demo gif, badges, 5-minute quickstart, architecture
sketch, and feature table (self-host vs cloud). LICENSE, CONTRIBUTING.md,
issue templates, GitHub Actions CI (lint + test + build), tagged releases
with changelogs. TypeScript/Node or Python (justify in plan.md), Postgres
when a database is needed, Docker-first, structured logs, tests for core
logic, secrets never in code.
