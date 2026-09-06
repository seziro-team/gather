# `keycloak-realm.json`

A Keycloak realm for developing and testing Gather's single sign-on, imported by
[`../docker-compose.sso.yml`](../docker-compose.sso.yml). One confidential client, two
users.

> [!CAUTION]
> **The client secret and both passwords are in that file on purpose**, so a clean checkout
> can run `pnpm test:sso` with no setup. That is only safe because nothing in the SSO
> overlay is reachable from outside the machine running it. Never import this realm into a
> Keycloak anyone else can reach, and never reuse the secret anywhere.

Keycloak is a **fixture, not a dependency**. Gather reads the provider's discovery document
and knows nothing else about it — which is exactly what it does against Okta, Microsoft
Entra ID, Google Workspace, Authentik or Auth0. Nothing in `apps/web` mentions Keycloak.

## What is in it

|        |                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------ |
| Realm  | `gather`                                                                                         |
| Client | `gather`, confidential, authorization-code + PKCE (`S256`), redirect to `/api/auth/callback/sso` |
| User   | `dana` / `dana@delgado.example.com` — inside the allowed domain                                  |
| User   | `sam` / `sam@outside.example.org` — outside it, for testing `SSO_ALLOWED_DOMAINS`                |

Both passwords are `correct horse battery staple`, the same throwaway the rest of the test
suite uses.

## Setting up your own provider instead

See [`../docs/sso.md`](../docs/sso.md). The short version: register Gather as a confidential
OIDC client, allow `<GATHER_APP_URL>/api/auth/callback/sso` as a redirect URI, and
set `SSO_ISSUER_URL`, `SSO_CLIENT_ID` and `SSO_CLIENT_SECRET`.
