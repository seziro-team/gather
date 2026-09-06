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

echo "▸ pass 1 — SSO offered alongside passwords"
docker compose "${COMPOSE[@]}" up -d --build
wait_for_provider
GATHER_TEST_SSO=1 npx playwright test --project=sso "$@"

echo
echo "▸ pass 2 — SSO enforced, one allowed domain, auto-join on"
GATHER_SSO_ENFORCED=true \
GATHER_SSO_AUTO_JOIN=true \
SSO_ALLOWED_DOMAINS=@delgado.example.com \
  docker compose "${COMPOSE[@]}" up -d --build
wait_for_provider
GATHER_TEST_SSO=1 GATHER_TEST_SSO_ENFORCED=1 \
  exec npx playwright test --project=sso "$@"
