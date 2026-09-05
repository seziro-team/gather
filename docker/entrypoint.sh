#!/bin/sh
# Container entrypoint: make sure there is a real signing secret, apply any pending
# migrations, then start the server.
set -eu

SECRET_FILE=/app/data/auth-secret
ENCRYPTION_KEY_FILE=/app/data/encryption-key

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

# The key that encrypts uploaded files. Same reasoning as above with one difference that
# matters enormously: losing this key does not mean logging in again, it means every
# document ever uploaded is unreadable. So it is generated only when the files live in the
# very same volume the key does. Once objects are in a bucket somewhere else, a key that
# only exists in a container volume is a way to lose everything to `docker compose down -v`,
# and Gather refuses rather than setting that trap.
if [ -z "${GATHER_ENCRYPTION_KEY:-}" ] && [ "${STORAGE_ENCRYPTION:-on}" != "off" ]; then
	if [ "${STORAGE_DRIVER:-local}" = "s3" ]; then
		echo '{"level":"error","msg":"STORAGE_DRIVER=s3 needs GATHER_ENCRYPTION_KEY set explicitly. Generate one with `openssl rand -base64 32`, put it in .env, and keep a backup — without it the objects in your bucket cannot be read. Set STORAGE_ENCRYPTION=off if you deliberately want files stored in the clear."}' >&2
		exit 1
	fi
	if [ ! -f "$ENCRYPTION_KEY_FILE" ]; then
		mkdir -p /app/data
		node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))' >"$ENCRYPTION_KEY_FILE"
		chmod 600 "$ENCRYPTION_KEY_FILE"
		echo '{"level":"warn","msg":"GATHER_ENCRYPTION_KEY was not set — generated one and stored it at /app/data/encryption-key inside the gather-data volume, next to the files it protects. BACK UP THAT VOLUME: without this key, uploaded documents cannot be decrypted by anyone, including you."}'
	fi
	GATHER_ENCRYPTION_KEY="$(cat "$ENCRYPTION_KEY_FILE")"
	export GATHER_ENCRYPTION_KEY
fi

echo '{"level":"info","msg":"starting gather web server","port":"'"${PORT:-3000}"'"}'
exec node /app/apps/web/server.js
