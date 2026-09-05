# Launch checklist

What has to be true before Gather is announced, and where to announce it. Written as a
checklist because "we'll remember" is how a launch goes out with a broken quickstart.

## Before announcing anything

- [ ] **A clean clone works.** On a machine that has never seen this repo:
      `git clone … && cd gather && cp .env.example .env && docker compose up -d`, then
      `curl -fsS localhost:3000/api/health` returns `"status":"ok"`, and the first account
      can be created. Time it, and update the table in the README if the number has moved:
      it is a measurement, not a slogan, and it should stay one.
- [ ] `pnpm test` green, `pnpm build` green, `npx playwright test` green against the built
      image, CI green on `main`.
- [ ] `pnpm audit --prod --audit-level high` clean.
- [ ] The screenshots on the site were regenerated from the current build
      (`node scripts/capture-demo.mjs`) — not from a build three commits ago.
- [ ] `README.md`, `CHANGELOG.md` and `plan.md` agree with each other about what exists.
- [ ] Every ⛔ in `progress.md` is either closed or repeated on the site and in the README.
      **A gap that is only recorded in `progress.md` is a gap that has been hidden.**
- [ ] `v0.1.0` tagged, release notes = the `CHANGELOG` section, tarball attached by GitHub.
- [ ] `SECURITY.md` points at an address somebody actually reads.
- [ ] Issue templates and `CONTRIBUTING.md` make sense to somebody who has never seen the
      repo.

## Before Cloud takes a single signup

Do not open signups until all of these have really run — see
[`stripe-verification.md`](stripe-verification.md).

- [ ] A real test-mode subscription created, `sub_…` pasted into `progress.md`.
- [ ] The webhook wrote the plan (`actor_type = 'system'` in the audit trail), and a forged
      return from Checkout changed nothing.
- [ ] A cancelled subscription degrades to entry-plan limits with **no loss of access** to
      anything already collected.
- [ ] Live keys swapped in, and a real card charged once and refunded.
- [ ] `docker-compose.prod.yml` running on the real hostname with a real certificate.
- [ ] Backups copied off the machine, and a restore actually tested. An untested backup is
      a belief, not a backup.

## Where to post

Read each community's rules first — every one of these has banned somebody for launching
badly.

- [ ] **Show HN**, titled "Show HN: Gather – open-source client document collection for
      accountants". First comment: why it exists (the chase is unbilled labour), what is
      genuinely done, and what is not. Post on a weekday morning US-eastern, and answer
      every comment for the first six hours.
- [ ] **r/taxpros** — read the rules; it is strict about self-promotion. Lead with the
      audit-trail-as-defence-document angle from
      [this thread](https://redd.it/16znfop), not with a product pitch.
- [ ] **r/Bookkeeping** — the no-account portal is the hook
      ([thread](https://redd.it/1ka0d1u)).
- [ ] **r/selfhosted** — the Docker-and-Postgres-only story, and the AGPL.
- [ ] **awesome-selfhosted** PR — one line, alphabetical, licence and language tags. Read
      `CONTRIBUTING.md` there first; they reject entries with no demo or no releases.
- [ ] **Lobsters** if somebody has an invite. Do not beg for one.

## After

- [ ] Watch the issue tracker for the first hour of any post. The first bug report is
      almost always the quickstart.
- [ ] Anything that breaks for somebody else becomes a test before it becomes a fix.
- [ ] Add a `progress.md` entry for the launch itself: what actually happened, what people
      asked for, what was wrong.
