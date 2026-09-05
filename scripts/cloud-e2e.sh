#!/usr/bin/env bash
# Brings up the hosted tier and runs e2e/cloud.spec.ts against it.
#
#   pnpm test:cloud
#
# The overlay makes every address on seziro.test an operator, so the suite can sign up a
# fresh one each run rather than reusing an account whose two-factor secret nobody kept.
#
# Leaves the cloud stack running. To get back to the self-hosted product:
#   docker compose -f docker-compose.yml -f docker-compose.mail.yml \
#     -f docker-compose.test.yml up -d
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ bringing up the hosted tier"
docker compose \
  -f docker-compose.yml \
  -f docker-compose.mail.yml \
  -f docker-compose.test.yml \
  -f docker-compose.cloud.yml \
  up -d --build

echo "▸ running the cloud suite"
GATHER_TEST_CLOUD=1 exec npx playwright test --project=cloud "$@"
