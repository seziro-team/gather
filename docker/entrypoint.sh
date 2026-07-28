#!/bin/sh
# Container entrypoint: make sure there is a real signing secret, apply any pending
# migrations, then start the server.
set -eu

SECRET_FILE=/app/data/auth-secret

# `cp .env.example .env && docker compose up` has to work on a clean machine *and*
# produce a secure install. Shipping a known secret in the example file would make every
# Gather install forgeable, so if none is configured we generate one and keep it in the
# data volume. Setting GATHER_AUTH_SECRET yourself always wins.
if [ -z "${GATHER_AUTH_SECRET:-}" ]; then
	if [ ! -f "$SECRET_FILE" ]; then
		mkdir -p /app/data
		node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64"))' >"$SECRET_FILE"
		chmod 600 "$SECRET_FILE"
		echo '{"level":"warn","msg":"GATHER_AUTH_SECRET was not set — generated one and stored it at /app/data/auth-secret inside the gather-data volume. Set it in .env if you want to control it (needed to keep sessions across a volume reset, and to run more than one replica)."}'
	fi
	GATHER_AUTH_SECRET="$(cat "$SECRET_FILE")"
	export GATHER_AUTH_SECRET
fi

echo '{"level":"info","msg":"starting gather web server","port":"'"${PORT:-3000}"'"}'
exec node /app/apps/web/server.js
