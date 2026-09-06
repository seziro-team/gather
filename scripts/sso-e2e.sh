#!/usr/bin/env bash
# Brings up Gather with a real Keycloak and runs both SSO suites against it.
#
#   pnpm test:sso
#
# Two passes, because "SSO available" and "SSO enforced" are different products and the
# second is the one an IT department deploys:
#
#   1. e2e/sso.spec.ts          — SSO offered alongside passwords
#   2. e2e/sso-enforced.spec.ts — no passwords at all, one allowed domain, auto-join on
#
# Leaves the stack in the enforced configuration. To get back to the ordinary one:
#   docker compose -f docker-compose.yml -f docker-compose.mail.yml \
#     -f docker-compose.test.yml up -d
set -euo pipefail
cd "$(dirname "$0")/.."

KEYCLOAK_PORT="${KEYCLOAK_PORT:-8081}"
export KEYCLOAK_PORT

# Named here, not left to the overlay's default.
#
# Compose substitutes `${SSO_PROVIDER_NAME:-Keycloak}` from `.env` when that file sets it —
# and `.env.example`, which CI copies, sets it to "your organisation". A shell variable beats
# `.env`, so this is what makes the fixture's identity the fixture's to decide. The tests
# assert on the button's text, and it took a CI failure to notice.
export SSO_PROVIDER_NAME="${SSO_PROVIDER_NAME:-Keycloak}"


COMPOSE=(-f docker-compose.yml -f docker-compose.mail.yml -f docker-compose.test.yml -f docker-compose.sso.yml)

wait_for_provider() {
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$KEYCLOAK_PORT/realms/gather/.well-known/openid-configuration" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "the provider never served its discovery document" >&2
  exit 1
}

# The realm is imported on a *fresh* Keycloak and never again — `start-dev` keeps its H2
# database inside the container, and compose does not recreate a service just because a
# mounted file's contents changed. So an edit to keycloak-realm.json is invisible until the
# container is replaced, and the symptom is Keycloak serving "Invalid parameter:
# redirect_uri" against a realm that looks correct on disk.
#
# Recreating it every run costs about twenty seconds and removes a whole category of "but I
# changed that" from a fixture nobody should have to debug.
echo "▸ replacing Keycloak, so the realm file on disk is the realm in use"
docker compose "${COMPOSE[@]}" rm -sf keycloak >/dev/null 2>&1 || true

echo "▸ pass 1 — SSO offered alongside passwords"
# `--remove-orphans`: switching between overlays leaves containers behind that the next
# `up` then collides with by name. Without it, running the ordinary stack and then this one
# fails with "container name is already in use" and looks like a Docker problem.
docker compose "${COMPOSE[@]}" up -d --build --remove-orphans
wait_for_provider
GATHER_TEST_SSO=1 npx playwright test --project=sso "$@"

echo
echo "▸ pass 2 — SSO enforced, one allowed domain, auto-join on"
GATHER_SSO_ENFORCED=true \
GATHER_SSO_AUTO_JOIN=true \
SSO_ALLOWED_DOMAINS=@delgado.example.com \
  docker compose "${COMPOSE[@]}" up -d --build --remove-orphans
wait_for_provider
GATHER_TEST_SSO=1 GATHER_TEST_SSO_ENFORCED=1 \
  exec npx playwright test --project=sso "$@"
