# Drunkify

Self-hosted, mobile-first PWA for a friend group's trip drink log and end-of-trip Wrapped.

This repository is being implemented from the engineering handoff in `docs/spec/`.

## Requirements

- Node.js 22 LTS
- Corepack / pnpm 10
- Docker with Buildx and Compose for container verification

## Development

```sh
corepack enable
pnpm install
pnpm dev
```

The web app runs on `http://localhost:5173`; Vite proxies API and SSE traffic to the Fastify server on port 3000.

## Checks

```sh
pnpm build
pnpm lint
pnpm format:check
pnpm typecheck
pnpm content:check
```

## Containers

```sh
docker compose --profile local up --build
docker compose --profile prod up --build
```

No Git remote is configured for this local-only project.
