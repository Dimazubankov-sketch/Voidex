# syntax=docker/dockerfile:1
# VOIDEX production image: one Node process serving the API and the built web
# client from the same origin. Contains no secrets — configuration comes from
# the environment at runtime (/opt/voidex/.env on the server).

# ---- build -------------------------------------------------------------------
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/calculator/package.json packages/calculator/
COPY packages/notes/package.json packages/notes/
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
# The server bundle is self-contained (tsup inlines every dependency), so the
# runtime stage needs no node_modules at all.
RUN pnpm --filter @voidex/web build && pnpm --filter @voidex/server build

# ---- runtime -----------------------------------------------------------------
FROM node:22-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    WEB_DIST=/app/web
WORKDIR /app/server
COPY --from=build --chown=node:node /app/apps/server/dist ./dist
COPY --from=build --chown=node:node /app/apps/server/drizzle ./drizzle
COPY --from=build --chown=node:node /app/apps/server/legal ./legal
COPY --from=build --chown=node:node /app/apps/web/dist /app/web
ARG VOIDEX_VERSION=dev
# su.voidex.otpcom / su.voidex.smsaero tell the deploy script which SMS_PROVIDER values this build supports
# (older builds refuse that value, so a rollback to them keeps SMS off instead).
LABEL org.opencontainers.image.source="https://github.com/Dimazubankov-sketch/Voidex" \
      org.opencontainers.image.revision="${VOIDEX_VERSION}" \
      su.voidex.otpcom="1" \
      su.voidex.smsaero="1"
ENV VOIDEX_VERSION=${VOIDEX_VERSION}
USER node
EXPOSE 4000
# Healthy only when the API answers AND PostgreSQL responds (/api/health runs `select 1`).
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
