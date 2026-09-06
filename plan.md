# Gather — Build Plan

**Status:** All 8 phases shipped — v0.1.0. Foundation; request builder and built-in templates;
client portal with encrypted uploads; reminder engine; review, dashboard and evidence export;
security hardening; team roles and the hosted tier; the site and launch material.

**Since v0.1.0**, beyond the plan: single sign-on over OIDC (free, proven against a real
Keycloak), pagination and search everywhere, key rotation, audit anchoring, liveness/
readiness split, Prometheus metrics, CodeQL and SBOM in CI — and the repository made public.
See the last entry in `progress.md`.

**The one thing that is not proven:** Stripe billing has never completed a call, because this
build has never had a Stripe account. `docs/stripe-verification.md` is the procedure that closes
it. Self-hosting — which is the whole product — is unaffected. Three features planned for Cloud
Pro (SMS, e-signature, cloud-drive sync) were cut rather than stubbed; §7.2 records why.
**Research date:** 2026-07-28. Every price, endpoint and quota below was read from the live
source on that date; each is linked. Re-verify anything older than a quarter before quoting it
in marketing copy.

---

## 1. Vision

**Gather is the open-source end of client chasing.** A firm builds a request, the client gets a
link — no account, no password, no app — and automated reminders do the nagging until every item
is in. The firm approves or rejects **item by item**, so "done" means the firm says it's done, not
the client assuming it is.

Free and self-hosted is the whole product, not a demo. Paid cloud is hosting and convenience.

### Target user

| | |
|---|---|
| **Primary** | Solo-to-15-seat accounting, bookkeeping and tax firms in the US/UK/AU |
| **Secondary** | Small law firms, mortgage brokers/loan officers, fractional CFOs, agencies |
| **Buyer = user** | The owner/partner who is personally sending the follow-ups |
| **Trigger** | Tax season, month-end close, new-client onboarding, loan file assembly |
| **Disqualifier** | Firms wanting full practice management (billing, time tracking, tax prep) — that's TaxDome/Canopy/Karbon. Gather does one job. |

### Positioning

> Content Snare, minus the per-request meter, minus the vendor holding your clients' tax
> documents.

Gather is a **single-purpose tool**, not a suite. It never becomes a CRM. This is a feature: the
Reddit evidence below shows suites lose on client-side simplicity, and simplicity is the entire
job here.

---

## 2. Competitor teardown

### 2.1 Content Snare — the product to beat

Read live from [contentsnare.com/pricing](https://contentsnare.com/pricing/) on 2026-07-28:

| Plan | Annual (per mo) | Monthly | Active requests | Users | Storage | SMS/mo |
|---|---|---|---|---|---|---|
| Basic | $35 | $42 | 20 | 2 | 20 GB | 40 |
| Plus | $71 | $85 | 50 | 5 | 50 GB | 100 |
| Pro | $119 | $143 | 100 | 10 | 100 GB | 200 |
| Custom | $215+ | $258+ | 200+ | 20+ | 200 GB+ | 400+ |

14-day trial, no card. Custom branding is gated to Plus and above. Approvals are in all plans.

> ⚠️ **Correction to the brief.** The brief says "$29–215/mo". The $29 entry price is stale —
> Basic is **$35/mo annual, $42/mo month-to-month** today. Site copy must use the current numbers
> or we look sloppy to the exact audience we're courting.

**The wedge is the pricing axis, not the feature list.** Content Snare meters *active requests*.
A tax firm's business is seasonal by definition: a 300-client practice that sends organizers in
January is instantly in Custom territory (**$215+/mo, $2,580+/yr**) for three months of the year,
then sits idle. You are billed for the shape of your profession.

Gather self-hosted has **no request cap, no seat cap, no storage cap** — only the disk you already
pay for. That is the entire pitch, and it is not a feature Content Snare can match without
abandoning its revenue model.

**What they get right** (copy it, do not "improve" it):
[contentsnare.com](https://contentsnare.com/) ·
[client-portal-software](https://contentsnare.com/client-portal-software/)
- No client login: *"Clients access their portal through a secure link with no login, no password, and no app to install."*
- Item-level approve/reject with a comment; client resubmits only the rejected item.
- Automated reminders that stop on completion.
- Autosave — *"everything auto-saves so if they close the browser, they pick up right where they left off when the next reminder brings them back."*
- Reusable templates at section and request level.
- Their own headline claim: **"71% reduction in time spent chasing clients"**, 9,900+ users across 103 countries.

**Where they're vulnerable:** per-request pricing; a US firm's tax documents sit on a third-party
SaaS (a real objection under IRS Pub 4557 diligence); branding paywalled at Plus; no self-host at
any price.

### 2.2 FileInvite — the enterprise end

[fileinvite.com/plans-pricing](https://www.fileinvite.com/plans-pricing) (read 2026-07-28):
**Standard USD $9,900/year** for lenders doing up to 100 commercial loans/yr; Enterprise custom;
annual billing only; setup fees vary by implementation.

They're strong: PDF form-fill + multi-signing, persistent borrower portal, one-click
approve/reject, OneDrive/Drive/Box sync, SOC 2 Type II, MFA, virus detection, audit trails.
They're also **~$825/month minimum and sales-gated**. A two-person bookkeeping practice is not the
customer. Gather takes the bottom of this market — the people who'd never survive a FileInvite
procurement call.

Note they use a **persistent portal** (borrower logs in). We deliberately don't. See 2.5.

### 2.3 TaxDome / Canopy / Karbon — the suites

| Product | Price (read live) | Portal/chasing situation |
|---|---|---|
| **Canopy** — [pricing](https://www.getcanopy.com/pricing) | Standard **$74**/user/mo, Plus **$109**, Premium **$149** (annual). Add-ons: Tax Workflow Automation from **$34/client/yr**, Close Automation **$10**/connected client/mo, KBA **$1.25**/credit. No free tier. | Client portal is bundled in Standard, but you're buying a whole practice-management suite to get it. |
| **Karbon** — [pricing](https://karbonhq.com/pricing/) | Team **$59**/user/mo annual ($79 monthly); Business **$89** ($99 monthly); Enterprise custom. | **Automatic client reminders are Business-tier only.** The one feature that solves this pain costs $89/user/mo. |
| **TaxDome** | ⚠️ **Unverified.** [taxdome.com/pricing](https://taxdome.com/pricing/) returned **HTTP 403** to our fetch. Aggregators report ~$800–$1,200/user/yr (Essentials/Pro/Business). | Practitioners rate the organizer + auto-reminder loop very highly (quotes below). |

> 🚩 **Open item for the operator:** do not put a TaxDome price in site copy until someone loads
> that page in a browser and confirms it. Quoting an aggregator number to an audience of TaxDome
> customers is exactly how a launch loses credibility.

**The structural argument against all three:** they are per-seat, per-year, all-or-nothing
platform migrations. Gather is a $0, one-`docker compose up`, single-job tool that a firm can
adopt on a Tuesday without leaving its existing stack.

### 2.4 What practitioners actually say

Reddit's search API blocks our crawler; these were pulled from the
[pullpush.io](https://api.pullpush.io) archive and are linked to the live threads.

**No-login is the requirement, not a nice-to-have** —
r/Bookkeeping, [*"Following Up with Clients Who Don't Like Tech"*](https://redd.it/1ka0d1u).
OP is explicit about clients who:

> "…don't want to have to create accounts and log into portals, and prefer to just reply to an email"

and a commenter (u/boghy8823) describes our product's spec back to us as an unmet need:

> "I've been struggling with this exact problem! Most of my clients prefer email over portals. Are
> you finding that you spend a lot of time sorting through emails to figure out what's still
> outstanding? And do you have a system for tracking when you've asked for something multiple
> times?"

**Chasing is unpaid labour that firms have given up on billing** —
r/taxpros, [*"Dealing with missing client documents in spite of organizers"*](https://redd.it/147xrl6):

> u/mmgnyc: "in general this is a big part of our service chasing documents/holding hands."
>
> u/SeattleCPA: "Lots of our 1040 clients come to us not for tax preparation or tax planning. But
> because they lack the organizational skills to assemble the documents needed for their return…
> But this is a really hard 'service' to bill for."

**The audit trail is a defence document** —
r/taxpros, [*"Am I going crazy here??"*](https://redd.it/16znfop) — a client blames the preparer
for a late, expensive return:

> "I remind them that I have reached [out] 6x between February and April, and was not presented
> with tax information until April 12th."

→ Gather's hash-chained audit log exports exactly this, per item, with timestamps. That's a
feature no competitor markets and every practitioner in that thread wished they had.

**"Complete" must be firm-defined** —
r/taxpros, [*"How to deal with angry clients on turnaround times"*](https://redd.it/1kp4vj1).
OP: *"the constant pain of asking for 15 m[ore documents]"*, and:

> u/Buffalo-Trace: "Did you set the expectation when you took them on that your goal turnaround
> time is 2 weeks after you receive 'all' their documents? Not when they think they have given you
> everything"

→ This is the argument for per-item approve/reject as the core mechanic.

**Client-side friction burns real staff hours** —
r/taxpros, [*"SafeSend Returns & Organizers"*](https://redd.it/y8n3xn):

> u/ExcelNT_Acct: "My clients really struggle with it. We have an admin staff who basically is just
> on the phone with clients all day trying to figure it out." …one client "got locked out because
> he couldn't remember the color of a car he leased in 2004!"
>
> u/Confident_Surround73: "People trying to do everything on their smartphone is the only issue.
> When you download a copy of a return it is a .zip file which phones can't do anything with"
>
> u/TT5150: "the pricing is excessive. It's still a tool we will end up walking clients through."

→ Three hard design constraints: (1) **no KBA/identity quizzes** on the collection path;
(2) **mobile-first**, never hand a phone a zip; (3) if a client needs a phone call to use it, we failed.

**The feature set is proven — people already pay for it** —
r/taxpros, [*"Is taxdome worth it?"*](https://redd.it/w3mvz4):

> u/Tjraider35: "in 3 minute[s], they'll have a file open, an engagement letter sent to them, an
> organizer and automatic email reminders until I receive everything."

→ That loop is what we're making free. Demand is established; we're changing the price and the
ownership, not inventing a category.

And from Content Snare's own Show HN, [news.ycombinator.com/item?id=17422152](https://news.ycombinator.com/item?id=17422152):

> u/andyakb: "most client will drag their feet to no end on delivering the content. This is because
> they have 1,000 other things to do"

> **Sourcing note.** Vendor blogs circulate a "340 hours per firm per busy season" figure
> (e.g. [mentally.ai](https://mentally.ai/the-tax-season-time-bomb-why-your-firm-loses-340-hours-every-january-and-the-ai-solution-nobodys-talking-about/)).
> It traces to an unnamed panel remark, not a study. **Do not use it in site copy.** The brief's
> "100+ chase emails a day" is likewise unverified — treat as operator-supplied colour, not a stat.
> We have plenty of first-person practitioner quotes; use those instead. Content Snare's "71%"
> is quotable *as their claim*, attributed.

### 2.5 Open-source landscape

GitHub search (`gh search repos`) for *"document collection portal"*, *"client document request"*,
*"file request portal clients"* returns **only 0-star hobby repos** (`Gitbizzyboy/DocDrop`,
`zaanix-studio/docucollect`, `gutzzyu/documentRequest`). There is no maintained open-source
Content Snare. That is the opportunity.

Adjacent projects — none of which do structured, per-item, reminder-driven inbound collection:

| Project | Stars | What it actually is | Why it isn't Gather |
|---|---|---|---|
| [Cloudreve](https://github.com/cloudreve/cloudreve) | 28.4k | Self-hosted file manager | A drive, not a request |
| [ownCloud](https://github.com/owncloud/core) | 8.8k | File sync/share | Ditto |
| [Pingvin Share](https://github.com/stonith404/pingvin-share) | 4.7k | File transfer links | Outbound, one-shot |
| [Palmr](https://github.com/kyantech/Palmr) | 2.4k | File sharing | Outbound |
| Papermark | — | DocSend alternative | Outbound sharing + analytics |
| Nextcloud **File Drop** | — | Anonymous upload folder | Closest free option — and it's a dumb bucket: no checklist, no per-item status, no reminders, no approve/reject, no audit trail |

**Build on, don't rebuild:** [DocuSeal](https://github.com/docusealco/docuseal) (AGPLv3 +
Section 7(b) terms) for cloud-tier e-signature — self-hostable, `docuseal/docuseal` image, API and
webhooks in the OSS edition (white-label/SSO/embedding are Pro). Credit in README per §7.

---

## 3. Differentiation — why this wins as open source

1. **The pricing axis is the product.** Competitors meter the thing that spikes seasonally.
   Self-hosted Gather has no meter. For a 300-client January, that's $0 vs $215+/mo.
2. **Custody.** Tax documents never leave the firm's server. Under the FTC Safeguards Rule a firm
   is answerable for its service providers (§6). "It's on our box" is the shortest possible answer.
3. **The audit trail as evidence.** Hash-chained, exportable proof of every request, reminder and
   submission — the r/taxpros "I reached out 6x" problem, solved as a document you can hand to a
   client or an insurer. Nobody markets this.
4. **No account, ever.** Reddit says client-side friction is where portals die. Content Snare
   already proved no-login works; the suites still make clients log in.
5. **Single job, done completely.** No CRM, no time tracking, no upsell path into a suite.
6. **AGPL keeps it honest.** A competitor can't fork Gather into a closed hosted product without
   contributing back — while any firm self-hosting is entirely unaffected.

**Honest weaknesses:** no tax-software integration (Lacerte/Drake/UltraTax) in v1; no e-signature
in the free tier; self-hosting demands a person who can run Docker and configure DNS for email —
which is precisely why the cloud tier exists.

---

## 4. Architecture

```mermaid
flowchart TB
    subgraph client["Client — no account"]
        P["Magic-link portal<br/>mobile-first checklist"]
    end
    subgraph firm["Firm"]
        D["Dashboard · builder · review"]
    end
    subgraph app["Gather (one container)"]
        W["Next.js 15 App Router<br/>portal + dashboard + API"]
        K["Worker — pg-boss<br/>reminders · scans · zips"]
    end
    subgraph data["State"]
        PG[("PostgreSQL 18<br/>only required service")]
        ST["Storage driver<br/>local disk | S3-compatible"]
    end
    subgraph ext["External (all env-driven, all optional)"]
        M["Resend | SMTP"]
        CV["ClamAV (opt-in profile)"]
    end
    P -->|"token → HttpOnly session"| W
    D -->|"session + TOTP"| W
    W --> PG
    W -->|"AES-256-GCM envelope"| ST
    K --> PG
    K --> M
    K -.-> CV
    W -.-> K
```

**One hard rule: PostgreSQL is the only service Gather requires.** No Redis, no Elasticsearch, no
message broker. `pg-boss` gives us cron, delayed jobs, exponential-backoff retries and dedup keys
on Postgres alone ([MIT, Node ≥22.12, PG ≥13](https://github.com/timgit/pg-boss)). Every dependency
we don't have is a self-hoster we don't lose.

### 4.1 Stack, and why

| Layer | Choice | Reason |
|---|---|---|
| Language | **TypeScript** end to end | Protocol §7 allows TS or Python. One language for the portal, dashboard, API and worker means one build, one test runner, one Docker image. The client portal is the product's riskiest surface (mobile, autosave, drag-drop) and demands a first-class front end. |
| Framework | **Next.js 16** (App Router) | Portal + dashboard + API in one deployable. Server Components keep the client bundle small on bad phone connections. *(P1: built on 16.2.12 — 15 was the current release when this plan was written. Turbopack is now the default builder; `middleware.ts` is renamed `proxy.ts`; `next lint` is gone in favour of the ESLint CLI.)* |
| DB | **PostgreSQL 18** | JSONB for item configs/responses, strong constraints for the state machine, and it doubles as the job queue. *(P1: 18 is the current major; there is no reason to start a new project on 16. Note its image wants a single mount at `/var/lib/postgresql`, not `/var/lib/postgresql/data`.)* |
| ORM | **Drizzle** | No engine binary, plain SQL migrations — matters for `docker compose up` reliability and for auditability of a security-sensitive schema. |
| Queue | **pg-boss** | See above. |
| Auth (firm) | **Better Auth** ([MIT, 29.4k★](https://github.com/better-auth/better-auth)) + [`twoFactor()` TOTP plugin](https://www.better-auth.com/docs/plugins/2fa) | Self-hostable, Drizzle schema generation, and TOTP satisfies the MFA requirement in 16 CFR 314.4(c)(5). |
| Auth (client) | **Custom magic-link** | Deliberately not an identity system. Opaque token → short-lived scoped session. No account, ever. |
| Email | **Resend** or **SMTP** | Both real drivers behind one interface. |
| Storage | **local disk** (default) or **S3-compatible** | See 4.2. |
| AV | **ClamAV** container, opt-in | See 4.3. |
| Site | **Astro** | Protocol §6. Static output, deploy anywhere. |
| Tests | **Vitest** + **Playwright** | Playwright is non-negotiable: the portal must be proven on a mobile viewport. |
| Toolchain | **TypeScript 5.9**, ESLint 10 flat config, Prettier | *(P1: TypeScript 7 is the current release, but `typescript-eslint` declares `typescript <6.1.0`; taking 7 would mean dropping type-aware linting on a security-sensitive codebase. Revisit when typescript-eslint supports it.)* |

### 4.2 Storage — and a correction to the brief

> 🚩 **The brief specifies "MinIO for self-host default". Research says don't.**
>
> The [minio/minio](https://github.com/minio/minio) repository was **archived on 2026-04-25** and is
> read-only. The README now states the community edition is *"distributed as source code only. We
> will no longer provide pre-compiled binary releases for the community version."* Management
> features and the admin console were
> [stripped from the community edition in mid-2025](https://blocksandfiles.com/2025/06/19/minio-removes-management-features-from-basic-community-edition-object-storage-code/)
> and moved to the commercial AIStor product. Shipping an archived, binary-less dependency as the
> default in a 5-minute quickstart would be a bad call.

**Decision — a driver interface with two implementations:**

- **`STORAGE_DRIVER=local` (default).** Plain filesystem. Zero extra services, genuinely 5-minute
  install, and it's what a solo firm on one VPS actually wants.
- **`STORAGE_DRIVER=s3`.** Any S3-compatible endpoint — AWS S3, Cloudflare R2, Backblaze B2,
  Wasabi, SeaweedFS, an existing MinIO, or **[Garage](https://garagehq.deuxfleurs.fr/)**, which is
  what our optional compose profile ships. Garage verified 2026-07-28: **AGPL-3.0**
  ([LICENSE](https://git.deuxfleurs.fr/Deuxfleurs/garage/src/branch/main/LICENSE)),
  image `dxflrs/garage:v2.3.0`, and per its
  [S3 compatibility matrix](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/):
  presigned URLs ✅, full multipart ✅, Put/Get/Delete/ListObjectsV2 ✅. No bucket policies or ACLs —
  irrelevant to us, since buckets are never public and access is per-key.
  [SeaweedFS](https://github.com/seaweedfs/seaweedfs) (Apache-2.0, 33.8k★) documented as the
  scale-out alternative.

**Encryption trade-off, decided explicitly.** Files are encrypted at rest with **AES-256-GCM
envelope encryption** (per-file DEK wrapped by a master key from env/KMS; IV+tag stored alongside).
That means uploads **stream through the app** rather than going browser-direct via presigned PUT —
we cannot encrypt bytes we never see. Cost: app bandwidth. Justification: these are tax documents,
typically well under 25 MB, and 16 CFR 314.4(c)(3) requires encryption at rest **regardless of the
storage backend**. Direct-to-S3 presigned upload stays available behind
`STORAGE_ENCRYPTION=off` for anyone who'd rather have the throughput and relies on
bucket-level encryption. This trade-off gets documented in the README, not buried.

### 4.3 Virus scanning — opt-in, and here's why

[Official ClamAV docs](https://docs.clamav.net/manual/Installing/Docker.html) (read 2026-07-28):
image `clamav/clamav:1.4` / `:1.4_base`, clamd on TCP **3310**, `freshclam` auto-updates in-container,
persist `/var/lib/clamav`. **RAM: minimum 3 GiB, preferred 4 GiB** — ~1.2 GiB just to load
signatures, spiking to ~2.4 GiB during daily reloads.

That is more memory than the rest of Gather combined and would break "runs on a cheap VPS". So:
**ClamAV ships as a `docker compose --profile antivirus` opt-in, default off.** With it enabled,
uploads are `quarantined` until scanned and are undownloadable in that state; with it disabled,
files are marked `scan_skipped` — visibly, in the UI and the audit log, never silently.

### 4.4 Data model

```
firm(id, name, slug, logo_url, brand_color, timezone, created_at)
user(...Better Auth...) · two_factor(user_id, secret, backup_codes, ...)
firm_user(firm_id, user_id, role: owner|admin|member)
client(id, firm_id, name, email, phone, company, archived_at)
template(id, firm_id?, key, name, body jsonb, is_builtin)
request(id, firm_id, client_id, title, status, due_at, sent_at, completed_at,
        template_key, brand_snapshot jsonb, created_by)
section(id, request_id, title, description, position)
item(id, section_id, type: file|text|longtext|yesno|date|choice|number,
     label, help_text, required, position, config jsonb)
response(id, item_id, value jsonb, status: pending|submitted|approved|rejected,
         reject_note, submitted_at, reviewed_at, reviewed_by, version)
file(id, response_id, response_version, storage_key, original_name, mime, size, sha256,
     scan_status: pending|clean|infected|skipped, encrypted, dek_wrapped, iv, tag,
     uploaded_at, uploaded_ip)
access_token(id, request_id, token_hash, purpose, expires_at, revoked_at, last_used_at)
portal_session(id, request_id, token_id, session_hash, ip, ua, expires_at)
reminder_schedule(id, request_id, cadence jsonb, active, next_run_at, sent_count, max_count)
reminder_log(id, request_id, schedule_id, channel, provider_message_id, status, error, sent_at)
audit_event(id, firm_id, request_id, actor_type, actor_id, action, target_type, target_id,
            metadata jsonb, ip, ua, created_at, prev_hash, hash)   -- append-only, hash-chained
audit_head(id=1, last_id, last_hash, updated_at)                   -- makes truncation detectable
```

**Three refinements from building it (P1):**

- `file.response_version` records which version of a response an upload belonged to, so a
  file superseded by a resubmission is retained and still attributable (P5 acceptance ②).
- `audit_head` is a new single-row table. Without it, deleting the *newest* audit events
  leaves a chain that still verifies perfectly — truncation would be invisible.
- **`audit_event` carries no foreign keys, by design.** `ON DELETE SET NULL` would rewrite
  audit rows when a request is deleted, silently breaking the chain; `CASCADE` would erase
  the evidence; `RESTRICT` would make deletion impossible forever. `audit_event.id` is the
  chain position itself — contiguous from 1, assigned under a Postgres advisory lock — so a
  gap is evidence rather than an artefact of a sequence.

`request.status`: `draft → sent → in_progress → submitted → complete` (+ `archived`).
`response.status` is what actually drives completion: a request is `complete` only when every
**required** item is `approved`. Rejection bumps `version` and reopens exactly one item.

### 4.5 Verified third-party APIs

All read from official docs on **2026-07-28**.

**Resend** — [send](https://resend.com/docs/api-reference/emails/send-email) ·
[pricing](https://resend.com/pricing) · [webhooks](https://resend.com/docs/dashboard/webhooks/event-types)
- `POST https://api.resend.com/emails`, `Authorization: Bearer re_…`
- Body: `from`, `to` (max 50), `subject`, `html`/`text`, `cc`, `bcc`, `reply_to`, `scheduled_at`
  (ISO 8601 or natural language), `headers`, `attachments`, `tags`, `template`. Response `{id}`.
- **`Idempotency-Key` header** supported, 24 h expiry, ≤256 chars → our defence against duplicate reminders.
- **Rate limit: 10 req/s per team** (default, raisable).
- **Free: 3,000/mo but only 100/day, 1 domain, 30-day retention.** Pro $20/mo → 50k/mo, unlimited daily, 10 domains.
  ⚠️ 100/day is a real ceiling for a firm sending organizers in January — the docs must say so, and SMTP must be a first-class path.
- Webhooks: `email.sent|delivered|bounced|delivery_delayed|failed|opened|clicked|complained|scheduled|suppressed`, plus `suppression.added|removed` → bounce handling and "did they even get it?" in the UI.

**ClamAV** — see 4.3.

**Stripe** (Phase 7) — [meter events](https://docs.stripe.com/api/billing/meter-event) ·
[usage-based](https://docs.stripe.com/billing/subscriptions/usage-based)
- `POST /v1/billing/meters`; `POST /v1/billing/meter_events` with
  `{event_name, identifier, timestamp, payload:{stripe_customer_id, value}}`. Legacy Usage Records API is deprecated.
- Note: Stripe now steers new usage-based integrations toward **Metronome**. Our $25 flat plan needs
  only Checkout + Billing Portal + webhooks; meters are used **only** for SMS overage. Keep it that way.

**Twilio A2P 10DLC** (Phase 7, US SMS) —
[registration overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/direct-sole-proprietor-registration-overview)
- Sole-prop brand ≈ **$4–4.50** one-time; **$15** campaign vetting fee; **$1.50–$10/mo** per campaign;
  carrier surcharges ≈ **$0.003–0.005**/SMS. Approval has real lead time.
- → Needs the operator's Twilio account and a registered brand. **Start this early in Phase 7**; per
  Realness Rule §4 we stop and ask rather than mocking an SMS.

**Cloud sync** (Phase 7)
- **Google Drive** — `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`
  (also `media`, `multipart`); scope `…/auth/drive.file` is sufficient for app-created files;
  resume via `Content-Range` + `308`. [docs](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- **OneDrive / Graph** — `POST /me/drive/items/{parentId}:/{name}:/createUploadSession` → `uploadUrl`;
  chunks **≤60 MiB and multiples of 320 KiB**; resumable recommended >10 MiB; least-privilege
  delegated scope `Files.ReadWrite`; **omit `Authorization` on the PUT chunks** (returns 401).
  [docs](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession)
- **Dropbox** — `/files/upload` for <150 MB; `/files/upload_session/{start,append_v2,finish}` beyond;
  session max 350 GB / 7 days. [performance guide](https://developers.dropbox.com/dbx-performance-guide)

**DocuSeal** (Phase 7 e-sign) — AGPLv3 + §7(b); `docuseal/docuseal`; API + webhooks in OSS.

---

## 5. License

**AGPL-3.0** for the Gather server (protocol §2.2 default for server apps).

The threat this license actually addresses: Gather's entire value proposition is that a hosted
version of it costs money and a self-hosted version doesn't. Under a permissive license, a funded
competitor could take the codebase, host it, and compete with us using our own work while
contributing nothing back — and our paid cloud tier is the only thing funding development. AGPL's
§13 network clause closes that door: anyone offering a *modified* Gather over a network must
publish their modifications. Meanwhile the actual target user — a firm running Gather on its own
server for its own clients — has no obligations whatsoever, because they aren't distributing a
modified version. The license constrains exactly one behaviour (closed-source competing SaaS) and
zero legitimate uses. It also matches Garage and DocuSeal, keeping the stack license-coherent.

`site/` and any future SDK/templates ship **MIT**, so nobody has to think about copyleft to reuse a
landing page or write a client library.

---

## 6. Security & compliance checklist

**Gather handles tax documents. The compliance regime is not optional and it is not vague.**

Under the **FTC Safeguards Rule, [16 CFR § 314.4](https://www.law.cornell.edu/cfr/text/16/314.4)**
(verified 2026-07-28), tax preparers and accountants are "financial institutions" and must maintain
an information security program. IRS **Publication 4557** requires a written plan (WISP) on top.
The Rule's mandates map onto our build as follows:

| 16 CFR 314.4 element | What Gather ships | Phase |
|---|---|---|
| (c)(3) *"Protect by encryption all customer information held or transmitted… both in transit… and at rest"* | TLS-only cookies/HSTS in transit; AES-256-GCM envelope encryption at rest on **every** driver | P3 |
| (c)(5) MFA for anyone accessing an information system | Better Auth TOTP, enforced for firm users | P1 |
| (c)(8) *"monitor and log the activity of authorized users and detect unauthorized access"* | Hash-chained append-only `audit_event`, exportable | P1, P5 |
| (c)(1) access controls / least privilege | Firm-scoped authorization on every query; roles; portal tokens scoped to one request | P1, P6 |
| (c)(6) secure disposal | Configurable retention + purge job; hard-delete verifies object removal | P6 |
| (c)(2) data inventory | Dashboard inventory of every file, where it's stored, its hash | P5 |
| (h) written incident response plan | `SECURITY.md` + `docs/incident-response.md` template | P6 |
| (c)(4) secure development | CI: typecheck, lint, tests, `pnpm audit`, Dependabot | P1 |

Plus, specific to this threat model:
- **Magic links:** 32-byte CSPRNG token, stored only as SHA-256; exchanged for an HttpOnly,
  SameSite=Lax session cookie scoped to a single request id; per-token expiry (default 30 days,
  configurable); revocable; every use logged with IP + user-agent.
- **Rate limits:** per-token, per-IP and per-account, on portal reads, uploads and auth.
- **Uploads:** magic-byte MIME sniffing (never trust extension), size caps, filename sanitization,
  SHA-256 of plaintext recorded, `Content-Disposition: attachment` always, downloads served from a
  separate origin/path with a restrictive CSP so no uploaded HTML/SVG can ever execute in our origin.
- **Downloads:** short-lived (5 min) signed URLs, single-request-scoped.
- **IDOR is the #1 risk in this app** — a token for request A reaching request B's files would be
  the end of the project. Automated authorization tests are an acceptance criterion in P6, not a
  nice-to-have.
- **Secrets** only via env; `.env.example` documents every variable and where to get it; nothing
  sensitive in logs (redaction on tokens, keys, filenames-with-SSNs).

> ⚖️ **Marketing constraint.** We say Gather ships controls that **help a firm meet** its Safeguards
> Rule obligations. We never say "compliant", "certified", or "guarantees compliance" — compliance
> is a property of the firm's whole program, not of one tool. This goes in the FAQ and the README.

---

## 7. Scope

### 7.1 FREE — self-hosted (the real product)

- **Request builder** — sections + items: `file`, `text`, `longtext`, `yes/no`, `date`, `choice`,
  `number`. Required/optional, help text, drag-reorder. *(P2: shipped — 4 sections/25 items in the
  largest built-in; drag works with mouse, touch and arrow keys.)*
- **Templates** — save any request as a template; **4 real built-ins ship**: US individual tax
  year-end, business onboarding, mortgage application, bookkeeping monthly close. *Every item in
  every built-in must be traceable to a real-world source (IRS 1040 instructions/Pub 17, lender
  checklists); sources recorded in `templates/SOURCES.md`. No invented checklists.*
  *(P2: shipped — 74 items across the four, every one citing a page that returned HTTP 200 on
  2026-07-28. `templates/SOURCES.md` is generated from the definitions and checked in CI.)*
- **Client portal** — branded (logo + colour), magic link, **no account**, checklist UI, autosave,
  drag-drop uploads, camera-roll friendly, mobile-first.
- **Reminders** — configurable schedules (fixed interval / escalating / custom days + time,
  client-timezone aware, quiet hours), running until complete and **stopping automatically**.
- **Per-item approve/reject** with a note; client resubmits only the rejected item.
- **Firm dashboard** — every request, per-client status at a glance, what's outstanding, download-all
  as zip, full audit trail + export.
- **Storage** — local disk or any S3-compatible endpoint. **Encrypted at rest either way.**
- **Email** — Resend or your own SMTP.
- **Team roles and invitations** — owner / admin / member, ten named permissions.
  *(P7: shipped. Originally priced as a paid feature; moved to free, because a two-person
  firm self-hosting needs them exactly as much as a hosted one.)*
- **Single sign-on (OIDC)** — Okta, Microsoft Entra ID, Google Workspace, Keycloak,
  Authentik. Discovery-driven; enforceable, so there are no Gather passwords at all.
  *(Post-v0.1.0: shipped, proven against a real Keycloak. Free on purpose — charging extra
  to turn on the security control you want people to use is a practice this project will
  not adopt, and it is the same boundary-rule argument as team roles.)*
- **Key rotation and audit anchoring** — `keys:rotate`, `audit:anchor`.
  *(Post-v0.1.0: shipped. Both were documented gaps in SECURITY.md.)*
- **Operable** — separate liveness and readiness, Prometheus metrics behind a token,
  structured logs. *(Post-v0.1.0: shipped.)*
- **No caps** on requests, clients, seats or storage. Ever.

### 7.2 PAID — Gather Cloud (live day 1)

Hosted on Seziro infrastructure, built in `cloud/` as a deployable layer over the same core.

| | **Self-Hosted** | **Cloud — $25/mo** | **Cloud Pro — $59/mo** |
|---|---|---|---|
| Everything in §7.1 | ✅ | ✅ | ✅ |
| Requests / clients | Unlimited | Unlimited | Unlimited |
| Seats | Unlimited | 3 | 10 |
| Storage | Your disk | 25 GB | 100 GB |
| Hosting, backups, updates | You | Us | Us |
| Team roles (owner / admin / member) | ✅ | ✅ | ✅ |
| Retention policies | You run the purge | We run it | We run it |

Stripe in **test mode** until the operator flips live keys.

**Boundary rule check:** every paid item is hosting or a compliance convenience. Nothing in
§7.1 is crippled to create §7.2 — team roles, retention, the audit trail and every core
capability are in the free product, unmetered.

#### Deferred from v0.1.0 — and why (2026-09-05)

Three items in the original table are **not built**, and are not sold:

| Deferred | What it needs before it can be real |
|---|---|
| SMS reminders | A Twilio account and a **registered A2P 10DLC brand** — days to weeks of carrier registration, and real money per message. |
| E-signature on completion | A DocuSeal deployment plus its API token. Self-hostable, so this is the nearest of the three. |
| Sync to Drive / Dropbox / OneDrive | OAuth applications registered at **three** separate vendors, each with its own review. |

They were cut rather than stubbed. Writing three integrations that have never once been run
against the real API — and then listing them on a pricing page — is precisely the behaviour
§4 exists to forbid, and a customer discovering an advertised feature does not work is worse
than one who never saw it offered. `FEATURES` in `packages/core/src/plans.ts` therefore
contains only what exists, and the site's pricing table is generated from it.

Cloud Pro is consequently a capacity tier: ten seats and 100 GB rather than three and 25 GB.
That is a thinner difference than this plan first imagined, and it is the true one.

---

## 8. One-page website spec (`site/`, Astro, static)

**Angle: "Stop being your clients' alarm clock."**

1. **Hero** — H1: *Stop being your clients' alarm clock.*
   Sub: *Gather sends the reminders, chases the missing documents, and tells you exactly what's
   still outstanding. Your clients never make an account. Free and self-hosted, forever.*
   CTAs: `docker compose up` (primary) · Try Cloud — $25/mo (secondary).
2. **Before / after** — split visual, per the brief: left, an inbox stack of 47 chase emails; right,
   one green checklist at 12/12. Must be rendered from the **real** product, not mocked.
3. **Demo** — a gif/short video captured from the working build: build a request → client opens link
   on a phone → uploads → firm rejects one item with a note → client fixes it → complete.
4. **How it works, 3 steps** — Build the request (or use a template) → Client gets a link, no login →
   Gather nags until it's done, then stops.
5. **The chase, quantified** — pull-quotes from real practitioners (§2.4, attributed and linked),
   *not* invented statistics.
6. **Open-source block** — install command, GitHub link, AGPL-3.0, "your clients' tax documents stay
   on your server".
7. **Pricing** — Self-Hosted **Free forever** (unlimited everything) vs Cloud **$25/mo** vs
   Cloud Pro **$59/mo**. Explicit line: *"We don't charge per request. Your January isn't a billing event."*
8. **FAQ (5 real questions)** — Do my clients need an account? (No.) · Where do the files live?
   (Your server; encrypted at rest.) · Does this help with the FTC Safeguards Rule / IRS Pub 4557?
   (It ships controls that map to specific elements — with the "not a compliance guarantee"
   caveat.) · Can I use my own domain and SMTP? (Yes.) · What's actually different in Cloud?
9. **Footer** — *Built in the open by Seziro.*

SEO meta + OG image generated **from the product**. All URLs env-driven (`PUBLIC_SITE_URL`,
`PUBLIC_APP_URL`). Lighthouse ≥95.

---

## 9. Phase breakdown

> **Deviation from the brief, recorded per CLAUDE.md §2.2.** The brief suggested P1–P6. Splitting
> into **8 build phases**: the brief's P4 bundled approve/reject + dashboard + a full security pass
> (three days of work and far more than one context window), and its P1 bundled infrastructure with
> the entire builder. Sizing beats tidiness.

Every phase ends per §3: real-run evidence, a `progress.md` entry, `plan.md` updated if anything
drifted, conventional commits, and the one-line resume instruction printed.

---

### Phase 1 — Foundation, schema, auth, CI ✅ **shipped**
**Goal:** a clean clone boots to a working, empty, secured app in under 5 minutes.

Tasks: pnpm monorepo (`apps/web`, `packages/{core,db}`); Next.js 16 + Tailwind 4; Drizzle
schema for §4.4 + migrations; Better Auth + `twoFactor()`; hash-chained audit helper +
verifier; health endpoint; multi-stage Dockerfile; `docker-compose.yml`; `.env.example`
(every var commented + where to obtain it); GitHub Actions (build, typecheck, lint, format,
test, `pnpm audit`, e2e against the built image); `LICENSE` (AGPL-3.0), `README`,
`CONTRIBUTING.md`, issue templates, `SECURITY.md`.

> **Deviation (P1).** `apps/worker`, `packages/storage` and `packages/mail` are *not*
> created here. They have no real implementation until P4, P3 and P4 respectively, and an
> empty package that exports nothing is precisely the kind of scaffolding the Realness Rule
> (§4) exists to prevent. Each is created in the phase that fills it.
>
> **Deviation (P1).** Migrations run in-process from Next's `instrumentation.register()`
> hook rather than from a separate container command. The standalone build bundles the
> workspace packages, so a `node packages/db/dist/cli/migrate.js` inside the image would
> have no `node_modules` to resolve against. Running in-process also guarantees the server
> never answers a request against a schema it has not finished migrating. `GATHER_AUTO_MIGRATE=false`
> opts out for teams that run migrations separately; the CLI still works from a source checkout.
>
> **Deviation (P1).** `.env.example` ships `GATHER_AUTH_SECRET=` *empty*, and the container
> generates a strong secret on first boot into the `gather-data` volume. Shipping a working
> secret in a public example file would give every install a forgeable one; requiring the
> operator to generate one would break the one-command quickstart. This does both.

**Acceptance:** ① clean clone → `cp .env.example .env && docker compose up -d` → healthy at
`localhost:3000` in <5 min, timed. ② Owner signs up, enables TOTP, logs out, logs back in with a
code from a real authenticator app. ③ `audit_event` chain verifies; tampering with a row makes
`pnpm verify:audit` fail. ④ CI green on a PR.

**Demo script:**
```bash
git clone <repo> gather-demo && cd gather-demo
cp .env.example .env && time docker compose up -d --build
curl -fsS localhost:3000/api/health            # {"status":"ok","db":"ok","migrations":"applied"}
# browser: sign up → Security → Set up authenticator app → scan QR → sign out → sign in with TOTP
# or, headless, with GNU oathtool standing in for the phone:
GATHER_E2E_URL=http://127.0.0.1:3000 pnpm exec playwright test --grep "owner signs up"

docker compose exec -T db psql -U gather -c "select id,action,left(hash,12) from audit_event order by id;"
DATABASE_URL=postgres://gather:gather@localhost:5432/gather pnpm verify:audit
                                               # OK: 8 events, chain intact

# Layer 1 — the database refuses outright:
docker compose exec -T db psql -U gather -c "update audit_event set action='x' where id=2;"
                                               # ERROR: audit_event is append-only
# Layer 2 — disable the trigger, as someone with DB rights would, and edit anyway:
docker compose exec -T db psql -U gather \
  -c "alter table audit_event disable trigger audit_event_append_only;" \
  -c "update audit_event set action='x' where id=2;"
DATABASE_URL=... pnpm verify:audit             # FAIL at id=2  ← proves tamper-evidence
```

---

### Phase 2 — Request builder + real templates ✅ **shipped**
**Goal:** a firm can build any request, and four genuinely useful ones already exist.

Tasks: builder UI (sections, drag-reorder, all 7 item types, required flags, help text); live
preview; template CRUD + "save as template"; seed the 4 built-ins with **sourced** items and
`templates/SOURCES.md`; client CRUD.

> **Deviation (P2).** `templates/SOURCES.md` is **generated** from
> `packages/core/src/templates/` by `pnpm docs:sources`, and `pnpm docs:sources:check` runs
> in CI. Hand-writing it would let the document and the shipped checklists drift, which is
> the one failure that would make the "nothing was invented" claim worthless. The citation
> lives on the item, in code, and the document is derived from it.
>
> **Deviation (P2).** Built-in templates are installed **at boot**, from
> `instrumentation.register()`, not by a manual `pnpm seed:templates`. A fresh
> `docker compose up` that offered an empty template list would fail §5's self-host promise
> before the operator had done anything wrong. The CLI still exists for source checkouts.
>
> **Deviation (P2).** Citations are carried on the **template** only, and dropped when a
> request is built from it. A quote from the IRS describes the item as Gather ships it and
> stops being true the moment a firm edits its copy. This also avoided adding a `sources`
> column to `item`, so §4.4 is unchanged.
>
> **Deviation (P2).** Drag-reorder is hand-written (~110 lines, pointer events + arrow
> keys) rather than taken from `@dnd-kit`. Checked on 2026-07-28: the stable line
> (`@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0) has not been published since December
> 2024, and the maintained successor (`@dnd-kit/react` 0.5.0) is pre-1.0. For a single-axis
> list neither trade is worth taking in a codebase that will hold tax documents. §7's
> "prefer proven open-source components" still holds everywhere else.
>
> **Deviation (P2).** The mortgage template asks for the Social Security **card** as a file
> rather than the number as text, departing from the CFPB checklist it is otherwise
> transcribed from. Files are encrypted at rest from P3; a typed answer is a `jsonb` value.
> Recorded in `templates/SOURCES.md` under "Deliberately not included".

**Acceptance:** ① Create a request from each of the 4 built-ins; item counts and labels match
`SOURCES.md`. ② Add one of every item type, reorder by drag, reload — order persists. ③ Save a
custom template, instantiate it, verify deep-copy (editing the copy doesn't mutate the template).
④ Every mutation writes an audit event.

**Demo script:**
```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build
docker compose logs web | grep 'built-in templates ready'   # installed 4 at boot

# ① ② ③ ④ — all four criteria, driven through the real UI
pnpm test:e2e -- builder.spec.ts

# ① the four built-ins, and the requests the app instantiated from them
docker compose exec -T db psql -U gather -c "
  select key, jsonb_array_length(body->'sections') sections,
         (select sum(jsonb_array_length(s->'items'))::int
            from jsonb_array_elements(body->'sections') s) items
  from template where firm_id is null order by key;"

# ③ deep copy: the firm template keeps 14 items after its copy was edited down to 13
docker compose exec -T db psql -U gather -c "
  select 'template', (select sum(jsonb_array_length(s->'items'))::int
                        from jsonb_array_elements(body->'sections') s)
  from template where key = 'our-monthly-close';"

# ④ every mutation, hash-chained
docker compose exec -T db psql -U gather -c \
  "select id, action, left(hash,10) from audit_event order by id;"
DATABASE_URL=postgres://gather:gather@localhost:5432/gather pnpm verify:audit
```

---

### Phase 3 — Client portal + real uploads ✅ **shipped**
**Goal:** the moment of truth — a real person on a real phone uploads a real document, encrypted.

Tasks: token issue/verify → scoped session; mobile-first checklist UI; autosave (debounced,
per-item, with visible state); drag-drop + file picker + camera; upload pipeline (streamed,
magic-byte sniff, size cap, SHA-256, AES-256-GCM envelope encryption); `local` + `s3` drivers;
Garage compose profile; signed short-lived downloads; progress bar; resumable-friendly chunking.

> **Deviation (P3).** The end-to-end fixture is the real **IRS Form W-9** (6 pages,
> 140,815 bytes) rather than the `real-w2.pdf` named in the demo script below. The 2026
> Form W-2 is 2.1 MB — fifteen times the size — and nothing in the test depends on which
> form it is. Provenance for every fixture is recorded in `e2e/fixtures/README.md`.
>
> **Deviation (P3).** `docker-compose.s3.yml` is a compose **overlay file** rather than the
> `--profile s3` named in the demo script. The S3 path has to change `web`'s environment,
> not just add a service, and a profile cannot do that. The Garage container also needs a
> one-off `garage-init` step — a fresh node serves errors until a cluster layout is applied
> — which runs Garage's own binary on a base that has a shell, because the published image
> is distroless.
>
> **Deviation (P3).** Uploads are **not chunked**. The plan said "resumable-friendly
> chunking"; the request body is streamed straight into the encryption pipeline instead, so
> a 200 MB upload costs the same memory as a 200 KB one. Chunking would only buy resumption,
> and resumption needs server-side state per partial upload plus a client that tracks
> offsets — for files that are almost always under 25 MB, over a connection that either
> works or does not. `XMLHttpRequest` gives a real progress bar without any of it. Revisit
> if anyone reports a real failure on a real connection.
>
> **Deviation (P3).** The `mobile-safari` Playwright project pins the viewport to 390×844
> rather than taking it from the `iPhone 14` device profile, whose 390×664 models the screen
> with browser chrome subtracted. The acceptance criterion names 390×844, so that is what
> is asserted.
>
> **Correction (P3).** The database integration tests used to fall back to `DATABASE_URL`
> when `TEST_DATABASE_URL` was unset — and they delete rows and disable the audit trigger.
> On a self-hosted install, whose `.env` points `DATABASE_URL` at the live database, running
> `pnpm test` would silently destroy the audit log the product exists to keep. They now
> resolve a scratch `<db>_test` database and create it if needed, and can never touch the
> database in `DATABASE_URL`. This was found by it happening.

**Acceptance:** ① Open a portal link on a 390×844 viewport, upload a real multi-page PDF and a
phone photo — no horizontal scroll, no zoom, no login. ② Type into a text item, kill the tab
mid-way, reopen the link — the text is still there. ③ The bytes on disk are **not** a PDF (proven
with `file`/`xxd`); the app download returns a byte-identical PDF (SHA-256 match). ④ Same test
passes against Garage with `STORAGE_DRIVER=s3`. ⑤ A token for request A returns 404 on request B's
file.

**Demo script:**
```bash
# ① ② ③ ⑤ — driven through the real UI, on WebKit at 390×844
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build
pnpm exec playwright test --project=mobile-safari

# ③ what is actually on the disk is not a document
docker compose exec -T web sh -lc '
  for f in $(find /app/data/uploads -type f | head -2); do
    printf "%s\n  " "$f"; head -c 16 "$f" | od -An -tx1; done
  n=0; for f in $(find /app/data/uploads -type f); do
    head -c 5 "$f" | grep -q "%PDF-" && n=$((n+1)); done
  echo "objects beginning %PDF-: $n of $(find /app/data/uploads -type f | wc -l)"'

docker compose exec -T db psql -U gather -c "
  select original_name, mime, size, encrypted, storage_driver, left(sha256,16), scan_status
  from file order by uploaded_at;"      # sha256 is of the plaintext, and matches the fixture

# ④ the identical suite against a real S3-compatible object store
docker compose -f docker-compose.yml -f docker-compose.s3.yml -f docker-compose.test.yml \
  up -d --build                          # garage-init creates the bucket and imports the key
pnpm exec playwright test --project=mobile-safari
docker run --rm --network container:gather-garage-1 \
  -v gather_garage-meta:/var/lib/garage/meta \
  -v "$PWD/docker/garage.toml:/etc/garage.toml:ro" \
  -e GARAGE_RPC_SECRET="$(grep ^GARAGE_RPC_SECRET= .env | tail -1 | cut -d= -f2)" \
  --entrypoint garage gather/garage-init:local bucket info gather   # objects present

DATABASE_URL=postgres://gather:gather@localhost:5432/gather pnpm verify:audit
```

---

### Phase 4 — Reminder engine (real emails, real schedules) ✅ **shipped**
**Goal:** the nagging works, and it stops.

Tasks: pg-boss wiring; cadence model + editor (interval / escalating / custom days + send time,
client timezone, quiet hours, max count); Resend + SMTP drivers behind one interface;
`Idempotency-Key` on every send; branded email templates (HTML + text); Resend webhook ingest
(bounce/complaint/delivered) → per-reminder status in the UI; **stop-on-complete**; reminder log;
"send now" manual nudge; preflight `pnpm check:email` that validates SPF/DKIM/DMARC and sends a
test.

> **Deviation (P4).** Cadences are **day-based**, not minute-based. The demo script below
> asked for a two-minute cadence to prove reminders in a test; the shortest thing a firm can
> configure is one day, because a product that can email a client every two minutes is a
> product that will. The end-to-end suite moves `next_run_at` into the past instead, which
> is what tomorrow looks like to the worker — everything else in the path is real.
>
> **Deviation (P4).** The reminder logic lives in a new package, **`@gather/reminders`**,
> rather than inside `apps/worker`. The web app needs the identical path for the manual
> "send one now" button, and two implementations of "compose and send a reminder" is exactly
> how a send-once guarantee stops holding.
>
> **Deviation (P4).** Idempotency is enforced by a **unique index on `reminder_log`**, not
> by the provider. Resend's `Idempotency-Key` header carries the same value and collapses
> duplicates at their end too — but SMTP has no equivalent, and a guarantee that holds for
> only one of two shipped drivers is not a guarantee. Migration `0003_reminder_idempotency`.
>
> **Deviation (P4).** `docker-compose.mail.yml` ships **Mailpit** for development and for
> the test suite. It is a real SMTP server that catches instead of relaying, so the suite
> proves a real SMTP conversation without needing an operator's credentials to run.
>
> **Correction (P4).** A due date is a calendar date carried in a `timestamptz`, stored as
> 23:59:59.999 UTC. It was being rendered in a local timezone, so the same request read as
> 10 April in New York and 11 April in Sydney. Now rendered in UTC everywhere, which is what
> the firm typed.

⚠️ **Operator credential still required for Resend** (Realness Rule §4). The Resend driver is
written against the documented API and unit-tested, and **has never been run against the live
service** — that needs `RESEND_API_KEY` and a verified sending domain. Everything shipped is
proven against real SMTP instead. Recorded as a hard stop in `progress.md`.

**Acceptance:** ① A schedule sends **real emails** to a real inbox over a real SMTP
conversation, and the reminder log records each one. ② Mark the request complete → no further
emails, and `reminder_schedule.active=false`. ③ A client who sends everything back is not
chased again. ④ A bounce webhook flips the reminder to `bounced` and surfaces in the
dashboard. ⑤ A worker that dies between claiming a reminder and sending it does not send it
twice when it restarts. ⑥ A manual nudge sends immediately without consuming a cadence step.
*(Resend message ids remain unproven — see the credential note above.)*

**Demo script:**
```bash
# A real SMTP server that catches instead of relaying, and the worker alongside the app.
docker compose -f docker-compose.yml -f docker-compose.mail.yml -f docker-compose.test.yml \
  up -d --build
open http://localhost:8025            # the inbox everything below lands in

# The deliverability preflight: real DNS lookups, then a real message.
pnpm check:email you@yourfirm.example

# ① … ⑥ — driven through the real UI against the real worker
pnpm exec playwright test --project=chromium reminders.spec.ts

docker compose exec -T db psql -U gather -c "
  select status, to_address, provider_message_id, idempotency_key
    from reminder_log order by sent_at desc limit 5;"
docker compose exec -T db psql -U gather -c "
  select active, sent_count, next_run_at from reminder_schedule;"

DATABASE_URL=postgres://gather:gather@localhost:5432/gather pnpm verify:audit
```

---

### Phase 5 — Approve/reject, dashboard, zip, audit export ✅ **shipped**
**Goal:** the firm side closes the loop.

Tasks: review UI (per item: approve / reject + note, with keyboard flow); rejection reopens exactly
that item and re-notifies; response versioning; dashboard (all requests, status, % complete,
oldest-outstanding, filters); download-all as a streamed zip with sane filenames
(`{Client}/{Section}/{Item}-{original}`); audit trail viewer + CSV/PDF export.

> **Deviation (P5).** The audit export reports **two properties, not one**. Every export can
> prove *no row was altered* — each row's hash recomputes from its own content. Only a
> **complete** export can prove *no row is missing*, because a trail filtered to one request
> has gaps in its ids by construction. `verifyAuditRows` and `pnpm verify:audit --csv` report
> them separately rather than collapsing both into a reassuring "chain intact", which would
> be claiming something a filtered file cannot support.
>
> **Deviation (P5).** Zip entry paths use ASCII punctuation (`01 Income/02 Bank - scan.pdf`)
> rather than an em-dash. The archives are correct UTF-8 with the flag set, and Python's
> `zipfile`, macOS and Windows all read them — but Info-ZIP UnZip 6.00 (2009), which is
> still what `unzip` is on Debian and Ubuntu, warns and exits non-zero on any non-ASCII
> entry name. Characters that come from a firm's or a client's own data are kept; decorative
> ones of ours are not worth the warning.
>
> **Deviation (P5).** The zip excludes superseded versions by default, with
> `?include=all` for the full set, and the `MANIFEST.txt` says how many were left out.
> "Download everything" to somebody about to hand a folder to a tax preparer means the
> current documents, not three drafts of one.
>
> **Correction (P5).** `auth.sign_up` carries a NULL `firm_id` (a known issue since Phase 1)
> and was therefore missing from every firm-scoped view. The export now unions on firm
> membership, so the first event of an install appears in the trail it belongs to.

**Acceptance:** ① Reject 1 of 5 items with a note → the client link shows that one item
outstanding, the other four locked as approved (not merely ticked), and the note is visible.
② Client resubmits → `version=2`, old file retained and still auditable. ③ Approve all →
status `complete` and reminders stop, in the same transaction. ④ The zip holds the current
files, foldered, opens with a real extractor, and its manifest hashes match the bytes.
⑤ The audit CSV covers the whole lifecycle and re-verifies **away from the database**;
tampering with one byte makes `pnpm verify:audit --csv` fail.

**Demo script:**
```bash
# ① … ⑤ — driven through the real UI, with a real zip and a real CSV
pnpm exec playwright test --project=chromium review.spec.ts

# The firm's queue: what needs a person, and what is overdue.
open http://localhost:3000/dashboard

# ④ the archive, read by a real extractor rather than a library that wrote it
unzip -t "$ZIP" && unzip -l "$ZIP"
python3 -c "import zipfile;z=zipfile.ZipFile('$ZIP');print(z.testzip());print(z.namelist())"

# ⑤ evidence, verified with no database in sight
pnpm verify:audit --csv gather-audit-$REQ.csv
sed -i 's/Wrong year./Right year./' gather-audit-$REQ.csv
pnpm verify:audit --csv gather-audit-$REQ.csv      # FAIL: content was modified
```

---

### Phase 6 — Security hardening pass ✅ **shipped**
**Goal:** earn the right to say "tax documents".

Tasks: rate limiting (token/IP/account) with 429s + backoff headers; ClamAV profile + quarantine
state + UI surfacing; security headers/CSP/HSTS; separate download origin; token rotation and
revocation UI; retention/purge job; log redaction; `pnpm audit` + Dependabot; threat model
(`docs/threat-model.md`); `SECURITY.md` + `docs/incident-response.md`; **`docs/safeguards-rule-mapping.md`**
(the §6 table, with an explicit "what Gather does *not* do for you" section); authorization test suite.

> **Deviation (P6).** Rate limiting has **two magic-link buckets**, not one. `portal.open`
> is per IP and only reachable when `GATHER_TRUST_PROXY` is on; `portal.open.shared` is a
> much higher ceiling for when Gather cannot tell one caller from another. Applying the
> per-IP number globally — which is what a single bucket means without a proxy — locks a
> firm's own clients out of their own documents when thirty organizers go out in January.
> Found by the acceptance test doing exactly that to the tests that ran after it.
>
> **Deviation (P6).** A dead link redirects to `/portal/unavailable?reason=…` rather than
> returning 401. The criterion said 401; a client who clicks an expired link needs a page
> that says "ask your accountant for a fresh one", not a status code. The **rejection is
> still audited with its reason**, which is what the criterion was protecting.
>
> **Deviation (P6).** There is no separate download origin. The plan called for one; what
> ships is `Content-Disposition: attachment` on every file, `X-Content-Type-Options:
> nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and **refusing the file
> types that could execute at all** — an upload that is markup is rejected whatever it is
> named. A second origin needs a second hostname and a second certificate, which would put
> a DNS change in the middle of a five-minute quickstart to defend against something three
> other layers already stop.
>
> **Deviation (P6).** `retention:purge` runs **inside the container**, not from the host:
> with the local driver the files are in a volume the host cannot see, so a host-side purge
> would report success having deleted nothing.
>
> **Correction (P6).** Better Auth's rate limiter used in-memory storage — a Phase 1 known
> issue — so limits reset on every restart and were not shared between replicas. It now
> uses the database.

**Acceptance:** ① Automated tests prove cross-request access is impossible across the
portal, the API, the upload path and the download paths, for portal sessions *and* between
firms. ② An expired link, a revoked link and one that never existed are each refused and
each audited with the reason. ③ Exceeding a limit returns 429 with `Retry-After` and
`RateLimit-*`, and the requests before it do not. ④ **A real EICAR file scanned by real
clamd → quarantined, deleted from storage, never downloadable by anyone, flagged in the UI
and in the audit log with the signature name.** ⑤ With the antivirus profile off, files are
visibly `skipped` — never silently unscanned. ⑥ Security headers on every page, a real CSP
with a per-request nonce, and a *stricter* policy on uploaded files. ⑦ Retention purge
removes the object from disk, verified by direct inspection, and keeps the record.

**Demo script:**
```bash
# ① ② ③ ⑤ ⑥ — no extra services needed
docker compose -f docker-compose.yml -f docker-compose.mail.yml -f docker-compose.test.yml \
  up -d --build
pnpm test:security

# ④ — real clamd, a real signature database, the real EICAR string
docker compose -f docker-compose.yml -f docker-compose.antivirus.yml \
               -f docker-compose.test.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.antivirus.yml \
  exec -T clamav clamdscan --version
pnpm test:antivirus

docker compose exec -T db psql -U gather -c "
  select original_name, scan_status from file where scan_status = 'infected';"
docker compose exec -T db psql -U gather -c "
  select action, metadata->>'signature' from audit_event where action = 'file.quarantined';"

# ⑦ — inside the container, because that is where the files are
docker compose exec -T worker sh -lc 'find /app/data/uploads -type f | wc -l'
docker compose exec -T worker node dist/cli/retention-purge.js --older-than 365d          # dry run
docker compose exec -T worker node dist/cli/retention-purge.js --older-than 365d --confirm
docker compose exec -T worker sh -lc 'find /app/data/uploads -type f | wc -l'
docker compose exec -T db psql -U gather -c "
  select original_name, size, purged_at is not null as purged from file where purged_at is not null;"
```

---

### Phase 7 — Cloud + Stripe ✅ shipped (2026-09-05, partially unproven)
**Goal:** a real hosted product taking a real (test-mode) subscription.

Shipped: team roles and invitations (in the free product, not the paid one); tenancy isolation
tests; Stripe Checkout + Billing Portal + webhooks; plan gating on seats and storage; the Seziro
operator console at `/admin`; `docker-compose.prod.yml` + Caddy with automatic TLS, all hostnames
env-driven; nightly `pg_dump` backups.

**Deviations — recorded rather than drifted:**

1. **No `cloud/` directory.** The hosted tier is `GATHER_CLOUD=true` plus four Stripe variables
   over the same code. A parallel tree would have meant two codebases and a self-hosted product
   that quietly rots — and the boundary is better enforced by `PLAN_DEFINITIONS.self_hosted`
   having `null` for every limit than by a directory.
2. **Team roles are free.** They were listed as a paid feature. A two-person firm self-hosting
   needs them as much as a hosted one, and gating them would have broken the boundary rule.
3. **SMS, e-sign and cloud-drive sync are deferred**, with reasons and prerequisites in §7.2.
4. **An unsubscribed firm on the hosted tier gets the entry plan's limits**, never a lock-out.
   Holding a firm's own documents hostage is not a business model this product will have.

⚠️ **Operator credentials still required:** Stripe test keys. Everything else about the hosted
tier runs today: `pnpm test:cloud` brings up the tier and proves the billing page, the seat
limit, the operator console and the fact that the Subscribe button reaches Stripe — which
answers, and refuses, because the credentials are placeholders.

**Acceptance:** ① ⛔ **Not met — hard stop.** A real test-mode subscription needs a Stripe
account. Procedure to close it: `docs/stripe-verification.md`. ② ✅ Tenancy isolation proven
by `e2e/team.spec.ts` ③ and `packages/db/src/team.test.ts`. ③ ⛔ Deferred (SMS). ④ ⛔ Deferred
(cloud-drive sync). ⑤ ✅ `docker-compose.prod.yml` + `docker/Caddyfile`, validated with
`docker compose config`; a run on a real hostname needs a domain, which is a launch step.

---

### Phase 8 — Site, README, launch ✅ shipped (2026-09-05)
**Goal:** ship it in public.

Shipped: `site/` per §8 with real copy; `scripts/capture-demo.mjs`, which produces every image on
the site and the README's demo gif by driving a running install; an OG image composed from a real
dashboard screenshot; README with the gif, badges, quickstart, architecture sketch, the
self-host-vs-cloud table and credits; `CHANGELOG.md`; `docs/launch-checklist.md`.

**Deviations:**

1. **The before/after panel's left side is a diagram, not a screenshot.** §8 asked for both sides
   rendered from the real product. There is no real inbox to render — the product is what replaces
   it — and faking a screenshot of somebody's mail client would have been the one dishonest image
   on the page. It is a plainly-styled list of subject lines, next to a real screenshot.
2. **Lighthouse ≥95 is claimed by construction, not measured.** No headless Lighthouse run
   happened: the page is one static HTML file, one inlined stylesheet, no web fonts, no
   third-party scripts and no client JavaScript. What *was* measured is what the score stands in
   for — no console errors, no failed requests and no horizontal overflow, in Chromium at
   1280×900 and WebKit at 390×844.
3. **DocuSeal is no longer in the credits**, because nothing in the shipped product uses it — see
   the deferral in §7.2.

**Acceptance:** ① ✅ `pnpm --filter @gather/site build` → static output in `site/dist`, one page,
deployable anywhere (Lighthouse per deviation 2). ② ✅ Every claim traces to §2.4 or to a measured
number; the three practitioner quotes link to the threads they came from and there are no invented
statistics anywhere on the page. ③ ✅ The demo gif is a recording of a real session — real firm,
real client, real IRS W-9, real rejection note. ④ ✅ Timed from a clean clone, see `progress.md`.
⑤ ✅ `v0.1.0` tagged with the changelog.

---

## 10. Risks & open questions

**Risks**

| Risk | Severity | Mitigation |
|---|---|---|
| **Email deliverability for self-hosters.** Reminders in spam = product is worthless, and this is the single most likely real-world failure. | 🔴 High | `pnpm check:email` preflight (SPF/DKIM/DMARC + test send) in P4; deliverability doc; Resend as the easy path; loud warning if DNS isn't right. |
| **Resend free tier is 100 emails/day**, which a January organizer blast exceeds. | 🟠 Med | Document prominently; queue respects daily caps and reports; SMTP as first-class alternative. |
| ~~MinIO as default~~ — resolved in P0 (repo archived 2026-04-25). | ✅ | local-disk default + any-S3 driver + Garage profile (§4.2). |
| **ClamAV needs 3–4 GiB RAM**, breaking the cheap-VPS promise. | 🟠 Med | Opt-in profile, default off, honest `scan_skipped` status (§4.3). |
| Encryption-at-rest forces uploads through the app (bandwidth). | 🟡 Low | Documented trade-off; `STORAGE_ENCRYPTION=off` enables direct-to-S3 for those who prefer it. |
| **10DLC approval lead time** could block the SMS feature at cloud launch. | 🟠 Med | Register the brand on day 1 of P7; cloud can launch without SMS if needed. |
| AGPL deters some commercial adopters. | 🟡 Low | Accepted deliberately (§5); `site/` and SDKs are MIT. |
| Scope creep toward practice management. | 🟠 Med | "Gather does one job" is in CONTRIBUTING.md as a stated non-goal. |
| Claiming compliance we can't back. | 🔴 High | Fixed language rule in §6; reviewed before any copy ships. |

**Open questions for the operator** *(none block Phase 1)*

1. **Approve the phase split** 6 → 8 (§9) and the **AGPL-3.0 / MIT** split (§5).
2. **Confirm pricing:** $25 Cloud + $59 Cloud Pro, with SMS metered separately. The brief said $25;
   Pro is my addition to carry the real per-message costs — say the word and I'll collapse it to one tier.
3. **TaxDome's real price** — their pricing page 403s our fetch. Someone needs to load it in a
   browser before we publish any comparison (§2.3).
4. **Credentials, when we reach them:** Resend API key + verified sending domain, or SMTP creds
   (needed at P4 — the first hard stop); a real test inbox; Stripe test keys, Twilio + 10DLC,
   Google/Dropbox/Microsoft OAuth apps (P7).
5. **Brand assets** — logo/wordmark for default portal branding and the OG image. Domain isn't
   needed early; everything is env-driven.
6. **Jurisdiction for template built-ins** — shipping US-first (IRS-based). UK/AU variants later?

---

## 11. Resume instructions

Each phase is designed to start from a cleared context. Read `CLAUDE.md`, then this file, then
`progress.md`, then `git log --oneline -20`.

- ~~**Phase 1:** `Start Phase 1: Foundation, schema, auth, CI — per plan.md §9.`~~ — shipped.
- ~~**Phase 2:** `Start Phase 2: Request builder + real templates — per plan.md §9.`~~ — shipped.
- ~~**Phase 3:** `Start Phase 3: Client portal + real uploads — per plan.md §9.`~~ — shipped.
- ~~**Phase 4:** `Start Phase 4: Reminder engine — per plan.md §9.`~~ — shipped.
- ~~**Phase 5:** `Start Phase 5: Approve/reject, dashboard, zip, audit export — per plan.md §9.`~~ — shipped.
- ~~**Phase 6:** `Start Phase 6: Security hardening pass — per plan.md §9.`~~ — shipped.
- **Phase 7:** `Start Phase 7: Cloud + Stripe — per plan.md §9.`
