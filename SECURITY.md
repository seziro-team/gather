# Security

Gather is built to hold tax documents, loan files and identity documents. We take reports
seriously and we would rather hear about a problem than not.

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. It is enabled, it reaches the maintainers
directly, and the report stays private until a fix is released.

Please include what you did, what happened, and what you expected. If you have a proof of
concept, include it — we will not take action against anyone reporting in good faith
against their own install.

- We aim to acknowledge within **3 working days**.
- We aim to ship a fix or a mitigation for a confirmed high-severity issue within
  **30 days**, and to credit you in the release notes unless you ask us not to.

## Supported versions

Gather is pre-1.0 and moving quickly. Only the latest tagged release is supported.

## What Gather does

As of v0.1.0:

- **Passwords** are hashed by Better Auth; a minimum length of 12 is enforced and no
  arbitrary complexity rules are imposed.
- **Two-factor authentication** (TOTP, RFC 6238) is required for firm users by default
  (`GATHER_REQUIRE_2FA`), with single-use backup codes. The dashboard is unreachable
  until it is set up.
- **Sign-up is closed by default** after the first account claims the install.
- **Rate limits** apply to sign-in, sign-up and two-factor verification.
- **Session cookies** are `HttpOnly` and `SameSite=Lax`, and `Secure` whenever
  `GATHER_APP_URL` is https.
- **The audit log is append-only and hash-chained.** A database trigger rejects `UPDATE`,
  `DELETE` and `TRUNCATE` on `audit_event`; each event stores the hash of the one before
  it, and a separate head row makes truncation of the newest events detectable.
  `pnpm verify:audit` re-verifies the chain and exits non-zero if it has been altered.
- **Logs are structured and redacted** — anything whose key looks like a token, secret,
  password, cookie, API key or session is replaced before it is written.
- **Uploaded files are encrypted at rest** with AES-256-GCM envelope encryption, before the
  bytes reach the disk or the bucket, on every storage driver. The key is yours; with
  `STORAGE_DRIVER=s3` Gather refuses to start rather than generate one it cannot store
  beside the objects.
- **Content type is sniffed from the bytes**, never from the extension. Markup is refused
  whatever it is called, and an extension that implies a signature must have one.
- **Optional virus scanning** (ClamAV). An infected upload is quarantined, deleted and never
  downloadable; a file nobody scanned reports `skipped` rather than looking clean.
- **A per-request Content-Security-Policy with a nonce**, and a much stricter policy on any
  response that serves a client's file (`default-src 'none'; sandbox`).
- **Rate limits in Postgres** — surviving restarts and shared across replicas — on link
  redemption, uploads, autosaves, downloads, exports and every authentication route.
- **Client portal links** are 32 bytes of CSPRNG stored only as SHA-256, per-link expiry,
  individually revocable, and every open is recorded. The same shape is used for firm
  invitations.
- **Secure disposal.** `retention:purge` removes files from completed requests while keeping
  the record that they existed and were disposed of.
- **No telemetry.** A self-hosted Gather makes no request to any server you did not
  configure.

## What Gather does not do (yet, or at all)

Being straight about this is more useful than a longer list of features:

- **The hash chain is tamper _evidence_, not tamper prevention.** Someone with full write
  access to your database can disable the trigger and recompute the entire chain. Detecting
  that needs the head hash anchored somewhere the database cannot reach —
  `pnpm audit:anchor` writes and re-checks that anchor, and it is only as good as where you
  keep it.
- **Gather does not encrypt your database.** Use full-disk or Postgres-level encryption, and
  back it up. Uploaded files are encrypted; the rows describing them are not.
- **`x-forwarded-for` is only trusted when `GATHER_TRUST_PROXY=true`.** Turn it on when — and
  only when — there really is a proxy in front, or any caller can choose their own
  rate-limit bucket.
- **Scanning is inline with the upload request.** A large file on a slow clamd holds the
  request open for the whole scan.
- **No CAPTCHA or proof-of-work.** Rate limits bound a brute force; they do not stop a
  distributed one. Put a reverse proxy in front of anything on the public internet.
- **Password reset needs a mail transport.** With `MAIL_DRIVER=none` there is no way to
  recover an account whose password and backup codes are both lost.

## About compliance claims

Firms preparing tax returns are "financial institutions" under the FTC Safeguards Rule
([16 CFR § 314.4](https://www.law.cornell.edu/cfr/text/16/314.4)) and are expected by IRS
Publication 4557 to maintain a written information security plan.

Gather ships controls that **help you meet specific elements** of that rule — multi-factor
authentication, logging and monitoring of authorized-user activity, encryption in transit
and at rest, access controls, and secure disposal.

**Gather is not "compliant" and cannot make you compliant.** Compliance is a property of
your whole programme — your policies, your staff, your other systems, your incident
response plan. Anyone selling you a tool that claims otherwise is overselling.

[`docs/safeguards-rule-mapping.md`](docs/safeguards-rule-mapping.md) maps each control to the
element it supports, and — more usefully — lists the longer set of things Gather does not do
for you. [`docs/threat-model.md`](docs/threat-model.md) says who the defences are against and
where they end.

## Hardening a self-hosted install

- Put Gather behind TLS and set `GATHER_APP_URL` to the https address.
- Set `GATHER_AUTH_SECRET` explicitly and store it where you store your other secrets.
- Change `POSTGRES_PASSWORD` from the example value.
- Leave `GATHER_REQUIRE_2FA=true`.
- Keep `GATHER_ALLOW_SIGNUP=first-user-only` (the default) or `off`.
- Do not expose Postgres beyond localhost; the shipped compose file binds it to
  `127.0.0.1` for exactly this reason.
- Back up both the database and the `gather-data` volume, and **keep
  `GATHER_ENCRYPTION_KEY` somewhere other than the server** — without it the stored files
  cannot be read.
- Rotate that key on a schedule you set: `pnpm keys:rotate` re-encrypts every stored file
  under a new key, one file at a time, resumable.
- Anchor the audit head somewhere outside the database — `pnpm audit:anchor --write` — and
  check it on a schedule with `pnpm audit:anchor --verify`.
- On the hosted tier or any multi-user install, prefer SSO: `GATHER_SSO_ENFORCED=true`
  turns off password sign-in entirely, so account lifecycle lives in your identity
  provider. See [`docs/sso.md`](docs/sso.md).
