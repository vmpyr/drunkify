# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/content/package.json packages/content/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @drunkify/shared build \
 && pnpm --filter @drunkify/content build \
 && pnpm --filter @drunkify/web build \
 && pnpm --filter @drunkify/server build \
 && pnpm --filter @drunkify/server deploy --prod /out

FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd --system drunkify \
 && useradd --system --gid drunkify --home-dir /app drunkify \
 && mkdir -p /data/backups \
 && chown -R drunkify:drunkify /data
COPY --from=build /out ./
COPY --from=build /app/apps/server/assets ./assets
COPY --from=build /app/apps/web/dist ./dist/public
RUN printf '#!/bin/sh\nexec node /app/dist/cli.js "$@"\n' > /usr/local/bin/drunkify \
 && chmod +x /usr/local/bin/drunkify
USER drunkify
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node ./dist/cli/healthcheck.js || exit 1
ENTRYPOINT ["node", "./dist/server.js"]
