# ---- build -------------------------------------------------------------------
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @voidex/web build && pnpm --filter @voidex/server build

# ---- run ---------------------------------------------------------------------
# The server bundle inlines @voidex/shared; npm dependencies come from the
# workspace install. Web assets are served by the same process (one origin).
FROM node:22-slim
ENV NODE_ENV=production PORT=4000 WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/server
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/index.js"]
