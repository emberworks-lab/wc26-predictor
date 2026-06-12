# WC26 Predictor

A World Cup 2026 prediction game for friends. Predict all 104 matches, build your bracket,
climb the leaderboards. Mobile-first, dark stadium-night theme, English + Ukrainian.

> Canonical domain spec: [SPEC.md](./SPEC.md) · Build plan: [PLAN.md](./PLAN.md) ·
> Session handoff state: [STATE.md](./STATE.md)

## Architecture

```
┌────────────────────────┐        ┌──────────────────────────────┐
│  Next.js (App Router)  │  SSR/  │  Supabase                    │
│  on Vercel             │  RSC   │  ├─ Postgres + RLS           │
│  ├─ next-intl (en/uk)  │───────▶│  ├─ Auth (magic link/Google) │
│  ├─ Tailwind v4        │        │  ├─ Edge Functions (sync)    │
│  └─ Server Actions     │        │  └─ pg_cron schedules        │
└────────────────────────┘        └──────────────┬───────────────┘
                                                 │ 15-min sync
                                  ┌──────────────▼───────────────┐
                                  │  football-data.org (free)    │
                                  │  WC competition id 2000      │
                                  └──────────────────────────────┘
```

- **All prediction locking is server-side** — RLS policies check `matches.kickoff_utc` and
  challenge lock timestamps; the UI only mirrors it.
- **Points are recomputed idempotently** from raw results after every sync — never
  incrementally mutated.
- Pure domain engines (group tiebreakers, best-thirds ranking, FIFA R32 bracket mapping,
  scoring, redistribution) live in `src/engine/` with unit tests — no I/O.

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind v4 · next-intl · Supabase
(Postgres, Auth, RLS, Edge Functions, pg_cron) · Vitest · GitHub Actions · Vercel.

## Local development

```bash
pnpm install
# create .env.local with the vars below
pnpm dev
```

`.env.local`:

| Var | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project API keys (publishable) |
| `FOOTBALL_API_KEY` | football-data.org account token |

Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Database migrations live in `supabase/migrations/` and are applied to the remote project
(they are the source of truth for schema review; the remote is managed via Supabase MCP/CLI).

## Scoring (v1)

See [SPEC.md](./SPEC.md) → "Scoring table" for the full point values; the in-app Rules page
renders the same table.

## Infrastructure

- **Supabase project**: `wc26-predictor` (org Emberworks Lab, `eu-central-1`)
- **Vercel project**: `wc26-predictor` (auto-deploys `main`)
- **CI**: lint + typecheck + test on every PR and push to `main`
