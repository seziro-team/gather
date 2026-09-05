# Gather's threat model

What Gather is defending, from whom, and — as importantly — what it is not defending
against. Written so that somebody deciding whether to trust it with a client's tax return
can check our reasoning rather than take our word.

## What is worth stealing

A Gather install holds, for every client of a firm:

- **Tax documents** — W-2s, 1099s, bank statements, mortgage statements, and in the
  mortgage template a photograph of a Social Security card.
- **Names, addresses, email addresses and phone numbers.**
- **A record of who owes what**, which is commercially useful to a competitor and
  embarrassing to a firm.

The documents are the prize. Everything below is about them.

## Who might want it

|        | Who                                                                       | What they can do                                                 | What stops them                                                                 |
| ------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **T1** | Someone on the internet with no access                                    | Reach any public URL: the sign-in page, `/p/<token>`, the portal | Rate limiting, 32-byte tokens, no enumerable ids                                |
| **T2** | A client with a valid portal link                                         | Everything their own link permits                                | Sessions scoped to one request by path and by query                             |
| **T3** | Someone who obtained a client's link — a forwarded email, a shared laptop | The same as T2, for one request                                  | Link expiry, session expiry, revocation, every use logged with IP               |
| **T4** | A firm user with a valid account                                          | Everything in their own firm                                     | Firm scoping in every query; TOTP; audit log                                    |
| **T5** | Someone who has compromised the server                                    | Everything, including the encryption key                         | Nothing. See "Where the defences end"                                           |
| **T6** | The hosting provider or a disk thief                                      | The disk, at rest                                                | AES-256-GCM envelope encryption                                                 |
| **T7** | A malicious upload                                                        | Whatever a file can do to whoever opens it                       | Magic-byte sniffing, `attachment` always, `default-src 'none'`, optional ClamAV |

## The attacks that actually matter

### Cross-request access (IDOR) — the one that would end the project

A portal token for request A reaching request B's files would be the worst thing Gather
could do. plan.md §6 names it the #1 risk, and it is defended in three independent layers:

1. **The session lookup takes the request id.** `currentPortal(requestId)` resolves a
   session only if it was issued for _that_ request; a valid session for another one
   resolves to nothing rather than to somebody else's checklist.
2. **The cookie is path-scoped** to `/portal/<request-id>`, so a browser never sends it to
   another request's pages at all — and no other part of Gather ever receives it.
3. **The database join is the ownership path.** Files are reached through
   `file → response → item → section → request`, in the query. There is no code path that
   takes a file id and trusts it.

Layer 3 is the one that has to hold if the others are bypassed, and it is the one the
end-to-end suite attacks directly: a _genuinely valid_ signature, minted by the firm for a
real file, aimed at a different request. It returns 404 — not 403, which would confirm the
id exists.

### Guessing a magic link

Tokens are 32 bytes from `randomBytes`, stored only as SHA-256. Guessing one is not a real
attack; the defence exists so that _trying_ is bounded and visible. Redemption is rate
limited per IP, and every rejected link is audited with the reason, the address and the
user-agent — so "somebody tried a revoked link from this address at this time" is a
question a firm can answer.

### A malicious file

Anything a client uploads is treated as hostile:

- The type is **sniffed from the bytes**, never taken from the extension or the browser's
  `Content-Type`.
- Filenames are sanitized before they reach a filesystem, a zip entry or a header.
- Downloads are **always** `Content-Disposition: attachment`, with `X-Content-Type-Options:
nosniff` and `Content-Security-Policy: default-src 'none'; sandbox` — so an uploaded HTML
  or SVG file cannot execute in Gather's origin even if somebody manages to open it inline.
- With the antivirus profile on, nothing is downloadable until it has been scanned.

### A hostile firm user

The audit log is append-only at two levels: a database trigger refuses `UPDATE`, `DELETE`
and `TRUNCATE`, and a hash chain catches anyone who disables the trigger first. `audit_head`
makes truncation of the newest events detectable, because deleting the tail otherwise leaves
a chain that still verifies.

This is tamper **evidence**, not tamper prevention. It is deliberately the weaker claim.

### Spreadsheet injection

A client controls their own filenames, and those filenames end up in a CSV a firm opens in
Excel. A cell beginning `=`, `+`, `-` or `@` is a formula. Every exported cell is prefixed
with a tab if it starts with one of those.

## Where the defences end

**A compromised server is game over.** The encryption key is in the environment of the
process that serves the files; anyone who can run code as that process can read everything.
Encryption at rest protects a stolen disk and a decommissioned VPS, not a live compromise.

**The audit log proves tampering happened, not that it did not.** Catching a full database
compromise needs the head hash anchored somewhere outside the database — print it, mail it
to yourself, commit it to a repository. Gather does not do this for you.

**A forwarded link is a working link** until it expires or is revoked. This is the direct
cost of the no-account design, which plan.md §2.4 argues is what makes clients actually use
the thing. The mitigation is short-lived sessions, revocation, and a log of every open — not
prevention.

**`X-Forwarded-For` is a lie unless you configure it.** With `GATHER_TRUST_PROXY` off,
Gather does not believe the header, so an install behind a proxy sees every request as
coming from the proxy. That is a visible problem you can fix; believing it by default would
be a silent rate-limit bypass for anyone who sets a header.

**Denial of service is not addressed.** Rate limits stop a crawler and a brute-force. They
do not stop somebody who wants your server to fall over. Put a reverse proxy in front of it.

**Email is only as private as email.** Gather never attaches a document — only a link — but
a mailbox somebody else can read is a request somebody else can open.

## Reporting something

[SECURITY.md](../SECURITY.md). Please do not open a public issue for a vulnerability.

---

_Last reviewed 2026-09-05._
