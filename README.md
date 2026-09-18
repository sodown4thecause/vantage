# Vantage

Social listening / lead capture platform (M1 scaffold).

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind
- **Neon** Postgres via **Drizzle ORM**
- **Neon Auth** (Managed Better Auth)
- Free-lane **Collector** interface for HN / RSS / Substack workers

## Setup

```bash
pnpm install
cp .env.example .env.local
# Fill DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET
pnpm db:migrate   # applies drizzle/0000_m1_core.sql
pnpm dev
```

### Neon project

1. Create a Neon project and enable **Managed Better Auth**.
2. Copy the pooled `DATABASE_URL` and Auth base URL into `.env.local`.
3. Generate a cookie secret: `openssl rand -base64 32`.

## M1 schema

Tables in `lib/db/schema.ts`:

| Table | Purpose |
|-------|---------|
| `workspace` | Tenant + plan/budget/consents |
| `source` | Collector feeds (etag/cursor/config) |
| `document` | Normalized collected content |
| `lead` | Scored opportunities tied to documents |

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Next dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:generate` | Generate migrations from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:push` | Push schema (dev) |

## Ref orchestration

See `.warp/REF_ORCHESTRATOR_SETUP.md` for Warp Oz ↔ Ref Plans wiring.
