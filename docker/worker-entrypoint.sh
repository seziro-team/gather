#!/bin/sh
# Container entrypoint for the reminder worker.
#
# The worker signs nothing and encrypts nothing — it reads schedules and sends email — but
# it shares `@gather/core`'s environment schema with the web app, and that schema requires
# a signing secret. So it takes the one the web container already generated into the shared
# data volume rather than inventing its own.
#
# Waits rather than generates, deliberately. Two containers each generating a secret would
# produce two different secrets, and the moment anything in the worker signs a link the web
# app has to verify, that becomes a bug nobody can reproduce. One writer, one value.
set -eu

SECRET_FILE=/app/data/auth-secret
ENCRYPTION_KEY_FILE=/app/data/encryption-key

if [ -z "${GATHER_AUTH_SECRET:-}" ]; then
	i=0
	while [ ! -f "$SECRET_FILE" ]; do
		i=$((i + 1))
		if [ "$i" -gt 60 ]; then
			echo '{"level":"error","msg":"No signing secret after 60s. The web container generates /app/data/auth-secret on first boot and the worker shares that volume — check that the web service started, or set GATHER_AUTH_SECRET explicitly in .env for both."}' >&2
			exit 1
		fi
		sleep 1
	done
	GATHER_AUTH_SECRET="$(cat "$SECRET_FILE")"
	export GATHER_AUTH_SECRET
fi

# Not needed to send a reminder, but the retention purge in Phase 6 runs here and touches
# stored files. Picked up when it exists; absent is fine and not worth blocking on.
if [ -z "${GATHER_ENCRYPTION_KEY:-}" ] && [ -f "$ENCRYPTION_KEY_FILE" ]; then
	GATHER_ENCRYPTION_KEY="$(cat "$ENCRYPTION_KEY_FILE")"
	export GATHER_ENCRYPTION_KEY
fi

exec node --enable-source-maps /app/dist/main.js
