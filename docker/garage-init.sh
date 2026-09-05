#!/bin/sh
# Bring a fresh Garage node to the point where Gather can use it as a bucket.
#
# Garage does nothing useful until a cluster layout is applied, so a plain `up -d` would
# leave the operator staring at an S3 endpoint that returns errors. This runs once,
# is idempotent, and exits 0 when the bucket is ready either way.
#
# Every step is a real Garage CLI call against the real daemon. Syntax verified against
# `garage <cmd> --help` in dxflrs/garage:v2.3.0 on 2026-09-05.

set -eu

BUCKET="${S3_BUCKET:-gather}"
KEY_ID="${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID must be set}"
KEY_SECRET="${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY must be set}"
KEY_NAME="gather-app"
# Garage stores no data beyond what Gather puts in it; the capacity is an allocation
# hint for the layout, not a quota that will reject an upload.
CAPACITY="${GARAGE_CAPACITY:-100G}"

say() { printf '%s garage-init: %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

say "waiting for the Garage daemon"
i=0
until garage status >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    say "Garage did not answer on its admin socket after 60s. Its logs will say why:"
    garage status || true
    exit 1
  fi
  sleep 1
done

# ── Layout ───────────────────────────────────────────────────────────────────
# `garage status` lists the node under "HEALTHY NODES" once it has a role, and under
# "NO ROLE ASSIGNED" before that. Rather than parse a table whose columns are free to
# change between releases, ask the node for its own id.
NODE_ID="$(garage node id -q | cut -d@ -f1)"

if garage layout show 2>/dev/null | grep -q "$(echo "$NODE_ID" | cut -c1-16)"; then
  say "layout already assigned"
else
  say "assigning layout to node ${NODE_ID%"${NODE_ID#????????}"}…"
  # No `-t/--tag`: it takes a variadic list, so anything after it — including the node id
  # this command exists to pass — is swallowed as another tag. A single-node layout gains
  # nothing from a tag anyway.
  garage layout assign -z gather -c "$CAPACITY" "$NODE_ID"
  # Version 1 is the first applied layout. On a re-run of a fresh volume this is right;
  # on an existing cluster the branch above has already skipped it.
  garage layout apply --version 1
fi

# The layout needs a moment to propagate before the bucket API will accept writes.
say "waiting for the layout to take effect"
i=0
until garage bucket list >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 30 ] && break
  sleep 1
done

# ── Key ──────────────────────────────────────────────────────────────────────
# Imported rather than created, so the credentials are the ones already in .env and the
# web container can be configured before Garage has ever run. `key create` would mint
# its own and leave the operator copying them out of a log line.
if garage key info "$KEY_ID" >/dev/null 2>&1; then
  say "access key $KEY_ID already present"
else
  say "importing access key $KEY_ID"
  garage key import "$KEY_ID" "$KEY_SECRET" -n "$KEY_NAME" --yes
fi

# ── Bucket ───────────────────────────────────────────────────────────────────
if garage bucket info "$BUCKET" >/dev/null 2>&1; then
  say "bucket $BUCKET already present"
else
  say "creating bucket $BUCKET"
  garage bucket create "$BUCKET"
fi

# Read and write, never --owner: Gather puts objects in and gets them out. It has no
# business deleting the bucket or making it a website.
say "granting $KEY_NAME read+write on $BUCKET"
garage bucket allow --read --write "$BUCKET" --key "$KEY_ID"

say "ready — bucket '$BUCKET' is writable by $KEY_ID"
garage bucket info "$BUCKET"
