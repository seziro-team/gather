# Single sign-on

Gather signs people in through your own identity provider over OIDC: Okta, Microsoft Entra
ID, Google Workspace, Keycloak, Authentik, Auth0, or anything else that publishes a
discovery document.

It reads that document rather than hard-coding endpoints, so moving between providers is a
URL change and not a code change. Nothing in Gather names a provider.

**This is not a paid feature.** It is in the free, self-hosted product, like team roles.
Charging a firm extra to turn on the security control you want them to use is a practice
this project will not adopt.

## Set it up

### 1. Register Gather as a client in your provider

|                  |                                               |
| ---------------- | --------------------------------------------- |
| Application type | Web / confidential (it holds a client secret) |
| Grant            | Authorization code, with PKCE                 |
| Redirect URI     | `<GATHER_APP_URL>/api/auth/callback/sso`      |
| Scopes           | `openid profile email`                        |

The `email` claim is required — Gather identifies people by email everywhere: invitations,
audit rows, reminders. A provider that will not release it cannot be used, and Gather says
so rather than looping you back to a login page.

### 2. Point Gather at it

```bash
SSO_ISSUER_URL=https://login.example.com/realms/staff   # NOT the .well-known URL
SSO_CLIENT_ID=gather
SSO_CLIENT_SECRET=…
SSO_PROVIDER_NAME=Okta                                  # what the button says
```

`SSO_ISSUER_URL` is the **issuer**, not the discovery URL — Gather appends
`/.well-known/openid-configuration` itself, because asking somebody to paste the full URL is
asking for a typo in the one string that decides whether anyone can sign in.

Restart, and `/sign-in` grows a "Sign in with Okta" button next to the password form.

The app refuses to boot if the issuer is set without a client id and secret, or if the
issuer is not https. Both would otherwise fail at the first sign-in attempt, which is the
worst moment to find out.

### 3. Decide how strict to be

```bash
GATHER_SSO_ENFORCED=true                          # no Gather passwords at all
SSO_ALLOWED_DOMAINS=@yourfirm.com,@yourfirm.co.uk # only these domains may sign in
GATHER_SSO_AUTO_JOIN=true                         # new users join the firm automatically
GATHER_SSO_DEFAULT_ROLE=member
```

## What each setting actually does

### `GATHER_SSO_ENFORCED`

Turns off email-and-password sign-in **in Better Auth**, not just in the UI: the endpoint
stops existing. That is the point of enterprise SSO — joiners and leavers live in one
system, and an account disabled in your provider cannot get in here through a password
nobody remembered to change.

With it on:

- `/sign-in` has no password field and the endpoint refuses.
- `/sign-up` says where to go instead of showing a form nobody can complete.
- An invitation link sends the invitee to sign in with the provider first, then accepts the
  invitation for the account they end up with.

Gather refuses to start with `GATHER_SSO_ENFORCED=true` and no provider configured, because
that combination locks everybody out of their own install.

### `SSO_ALLOWED_DOMAINS`

An allow-list of email domains, comma-separated, each written `@example.com`.

Empty means "anyone the provider vouches for", which is right when the provider holds only
your staff and wrong when it is a shared tenant. Somebody outside the list authenticates
perfectly well at the provider and is then refused **here**, with a message saying so —
and no account is created.

Matched on the last `@` in the address, so `"@yourfirm.com"@evil.example` — a legal address
whose domain is `evil.example` — is a rejection rather than a way in.

### `GATHER_SSO_SATISFIES_2FA`

Default `true`, and only consulted when SSO is enforced.

Gather normally requires TOTP (`GATHER_REQUIRE_2FA`). When your provider is the only way in
and it is doing MFA, asking for a second code on top is not more security — it is a second
secret kept in the same password manager. So SSO users are not asked to enrol.

Set it to `false` if your provider does not enforce MFA and you want Gather to.

A password account on an install that merely _offers_ SSO is unaffected: it still has to
set up TOTP, because a password is still a way in.

### `GATHER_SSO_AUTO_JOIN`

Default `false`. With it on, a new SSO user is put straight into the firm **if this install
has exactly one**.

Exactly one is the whole safety property. On an install with two firms there is no right
answer to "which one", so Gather does nothing and the person lands on the ordinary "create
or join a firm" page — rather than inside a stranger's client list. It is `false` by default
because auto-provisioning is a policy decision, not a convenience.

Every auto-join writes an audit row with `via: sso-auto-join`, so "who let this person in?"
has an answer.

## Account linking

Somebody who already has a Gather password account and then signs in through the provider
lands in **the account they already have**, not a second empty one.

Linking is only trusted for the provider named in your environment. Gather does not link on
providers anyone can register at, because that is an account takeover: claim the victim's
address at the provider, sign in, inherit their firm.

## Try it before you trust it

The repository ships a real Keycloak so you can watch the whole flow before pointing it at
your own provider:

```bash
docker compose -f docker-compose.yml -f docker-compose.sso.yml up -d --build
# then open http://localhost:3000/sign-in and use dana / correct horse battery staple
pnpm test:sso     # two passes: SSO offered, then SSO enforced
```

That is a real provider doing a real authorization-code flow with PKCE, not a mock — see
[`../docker/keycloak-realm.README.md`](../docker/keycloak-realm.README.md), and the ⚠️ about
never exposing that realm.

## What is not built

- **SAML.** OIDC only. Every provider worth deploying speaks OIDC, and supporting both
  doubles the surface of the one component you cannot afford to get subtly wrong.
- **SCIM provisioning.** Users are created on first sign-in, not pushed from your directory.
  Deactivating somebody in the provider stops them signing in; it does not remove their
  membership row, so remove them in Gather too if you want them off the team list.
- **Group-to-role mapping.** Everybody arrives as `GATHER_SSO_DEFAULT_ROLE`; roles are
  managed in Gather. Mapping an IdP group to a Gather role needs a claim contract we would
  have to invent, and inventing one against a provider nobody has tested is how you get a
  role mapping that silently grants too much.
