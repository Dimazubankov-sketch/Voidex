# VOIDEX

**One account. Every device. Your space.**

VOIDEX is a unified personal digital space: a VOIDEX Account, an OS-like
workspace with its own window system and App Registry, and system apps —
**Settings** and **VOIDEX Mail** (internal mail between VOIDEX users). This is
Step 1: the foundation of the future VOIDEX OS. Architecture, security model
and audit: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

| | |
|---|---|
| Client | Vite, React 19, TypeScript, Tailwind CSS v4, motion, TanStack Query, zustand |
| Server | Node 22, Fastify 5, Drizzle ORM, PostgreSQL 16, Server-Sent Events |
| Shared | `packages/shared` — validation, schemas, DTOs, app & legal registries |
| Tests | Vitest (shared + API integration against PostgreSQL), Playwright e2e (phone + desktop) |

## Run locally

Requirements: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
createdb voidex                               # or: docker compose up -d db
cp apps/server/.env.example apps/server/.env  # edit DATABASE_URL if needed
pnpm db:migrate
pnpm dev                                      # API on :4000, web on http://localhost:5173
```

In development SMS codes are **not sent**: the dev provider logs them and the UI
shows them in a yellow "development mode" notice. Configure Twilio or SMS.ru for
real delivery — production refuses to start with the dev provider.

## Tests

```bash
createdb voidex_test
pnpm test                 # shared unit tests + API integration tests
pnpm test:e2e             # Playwright; starts server and web if not running
```

For e2e set `RATE_LIMIT_SCALE=50` in `apps/server/.env` (many test accounts come
from one IP; must stay `1` in production).

## Production

Live at **https://voidex.su**. Every push to `main` is tested, built into a
Docker image on GitHub and released to the server automatically, with health
checks and automatic rollback. Operations (status, logs, rollback) run from the
GitHub Actions tab. Details: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
