# syntax=docker/dockerfile:1

# ── build ────────────────────────────────────────────────────────────────────
FROM node:25-alpine AS builder
RUN corepack enable
WORKDIR /app

# Manifests first so the dependency layer is reused whenever only source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm --filter @gather/core build \
  && pnpm --filter @gather/db build \
  && pnpm --filter @gather/web build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:25-alpine AS runner
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

# Writable state: the generated auth secret, and uploads from Phase 3 onward.
RUN mkdir -p /app/data && chown gather:gather /app/data

COPY --chown=gather:gather docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER gather
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD wget -q -O- http://127.0.0.1:3000/api/health | grep -q '"status":"ok"'

ENTRYPOINT ["/app/entrypoint.sh"]
