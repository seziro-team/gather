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
- **No telemetry.** A self-hosted Gather makes no request to any server you did not
  configure.

## What Gather does not do (yet, or at all)

Being straight about this is more useful than a longer list of features:

- **The hash chain is tamper _evidence_, not tamper prevention.** Someone with full write
  access to your database can disable the trigger and recompute the entire chain. Making
  that detectable requires anchoring the head hash somewhere outside the database —
  exporting audit trails periodically (Phase 5) is what gives you that copy.
- **Encryption at rest for uploaded files, virus scanning, retention/purge, security
  headers and the full authorization test suite are Phases 3 and 6.** Until then, do not
  put real client documents into a Gather install.
- **`x-forwarded-for` is recorded but never trusted** for access control. A trusted-proxy
  setting arrives in Phase 6.
- **Gather does not encrypt your database.** Use full-disk or Postgres-level encryption,
  and back it up.
- **Email verification and password reset need a mail transport** and arrive in Phase 4.

## About compliance claims

Firms preparing tax returns are "financial institutions" under the FTC Safeguards Rule
([16 CFR § 314.4](https://www.law.cornell.edu/cfr/text/16/314.4)) and are expected by IRS
Publication 4557 to maintain a written information security plan.

Gather ships controls that **help you meet specific elements** of that rule — multi-factor
authentication, logging and monitoring of authorized-user activity, encryption in transit
and (from Phase 3) at rest, access controls, secure disposal.

**Gather is not "compliant" and cannot make you compliant.** Compliance is a property of
your whole programme — your policies, your staff, your other systems, your incident
response plan. Anyone selling you a tool that claims otherwise is overselling. A mapping
document from each control to the specific element it supports arrives in Phase 6.

## Hardening a self-hosted install

- Put Gather behind TLS and set `GATHER_APP_URL` to the https address.
- Set `GATHER_AUTH_SECRET` explicitly and store it where you store your other secrets.
- Change `POSTGRES_PASSWORD` from the example value.
- Leave `GATHER_REQUIRE_2FA=true`.
- Keep `GATHER_ALLOW_SIGNUP=first-user-only` (the default) or `off`.
- Do not expose Postgres beyond localhost; the shipped compose file binds it to
  `127.0.0.1` for exactly this reason.
- Back up both the database and the `gather-data` volume.
