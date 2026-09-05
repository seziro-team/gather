# syntax=docker/dockerfile:1

# Two runtime images from one build: the Next.js app, and the reminder worker.
#
# They are separate containers because a slow mail server must not make the dashboard
# slow, and because restarting the sender should not sign every firm user out. They share
# a build stage because they share four workspace packages, and building those twice would
# be twice the wait for the same bytes.
#
#   docker build --target runner .   # the web app  (the default)
#   docker build --target worker .   # the reminder worker

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

# Manifests first so the dependency layer is reused whenever only source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/mail/package.json ./packages/mail/
COPY packages/reminders/package.json ./packages/reminders/
COPY packages/storage/package.json ./packages/storage/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
# Order matters: each package compiles against the previous one's dist/.
RUN pnpm --filter @gather/core build \
  && pnpm --filter @gather/db build \
  && pnpm --filter @gather/mail build \
  && pnpm --filter @gather/storage build \
  && pnpm --filter @gather/reminders build \
  && pnpm --filter @gather/worker build \
  && pnpm --filter @gather/web build

# The worker is a plain Node process, so it needs a real node_modules — Next's standalone
# tracing only covers the web app. `pnpm deploy` resolves the workspace links into a
# self-contained tree with production dependencies only.
RUN pnpm deploy --filter @gather/worker --prod --legacy /worker

# ── web ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN addgroup -S gather && adduser -S -G gather gather

# Next's standalone output already contains the traced node_modules.
COPY --from=builder --chown=gather:gather /app/apps/web/.next/standalone ./
COPY --from=builder --chown=gather:gather /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=gather:gather /app/apps/web/public ./apps/web/public

# Migration SQL, applied at boot by apps/web/src/instrumentation.ts. These files are
# read with fs at runtime rather than imported, so file tracing cannot see them; the
# path matches what `import.meta.url` resolves to inside the standalone bundle.
COPY --from=builder --chown=gather:gather /app/packages/db/drizzle ./packages/db/drizzle

# Writable state: the generated secrets, and uploads when STORAGE_DRIVER=local.
# Backing this volume up, alongside the database, is backing Gather up.
RUN mkdir -p /app/data/uploads && chown -R gather:gather /app/data

COPY --chown=gather:gather docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER gather
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD wget -q -O- http://127.0.0.1:3000/api/health | grep -q '"status":"ok"'

ENTRYPOINT ["/app/entrypoint.sh"]

# ── worker ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS worker
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S gather && adduser -S -G gather gather

COPY --from=builder --chown=gather:gather /worker ./

# The worker shares the data volume with the web app so that a future job which touches
# stored files — the retention purge in Phase 6 — finds them, and so that both read the
# same generated encryption key.
RUN mkdir -p /app/data && chown -R gather:gather /app/data

COPY --chown=gather:gather docker/worker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER gather

# No healthcheck endpoint: the worker serves nothing. It exits non-zero if it cannot reach
# the database at startup, which is what `restart: unless-stopped` and compose's own
# restart accounting are for.
ENTRYPOINT ["/app/entrypoint.sh"]
