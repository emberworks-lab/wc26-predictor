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

Next.js 16 (App Router, TypeScript) · Tailwind v4 · next-intl · Supabase
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
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API keys (secret) — server actions + verification scripts |
| `SYNC_SECRET` | shared secret for the sync Edge Function (also in Supabase Vault + function secrets) |

Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Verification scripts (run against the live project; each is self-cleaning — throwaway
users/data only, never touches real rows):

| Command | What it proves |
|---|---|
| `pnpm verify:rls` | 25 RLS/admin/ban checks (also runs nightly in CI — `.github/workflows/security.yml`) |
| `pnpm verify:stage8` | admin result-correction → recompute → leaderboard, end-to-end |
| `pnpm verify:stage7` | redistribution pipeline (local Supabase stack only) |
| `pnpm verify:stage6` | leaderboard ranking parity + snapshots |

Database migrations live in `supabase/migrations/` and are applied to the remote project
(they are the source of truth for schema review; the remote is managed via Supabase MCP/CLI).
The sync Edge Function is bundled before deploy: `node scripts/bundle-sync.mjs` →
`.build/sync/index.ts` → `supabase functions deploy sync --no-verify-jwt`.

## Admin area (`/admin`)

Role-gated (`profiles.role = 'admin'`, enforced server-side: layout guard + every server
action re-checks). The gear icon appears in the header for admins. Runbook:

| Problem | Fix in `/admin` |
|---|---|
| **API died / data stale** | **Sync & logs** → `fixtures` (pull results), `stats` (scorers), or `recompute` (rebuild points). The job log shows every run with status + detail. |
| **A result is wrong** | **Matches** → search the match → fix the score/status → Save. The row is flagged `manually_corrected` so the next sync won't overwrite it, and points + standings recompute immediately. Once the feed is correct again, **Clear flag** restores the provider result. |
| **A challenge should open/close early** | **Challenges** → Force open / Force locked / Automatic. Override beats the timestamps; an already-kicked-off match stays locked regardless (anti-cheat). |
| **A user is a troll** | **Users** → Ban (hides them from leaderboards, blocks all writes, kills their session; predictions are retained), Rename (offensive display names), or delete a single challenge entry. |
| **Enter fun answers** | **Fun answers** → set each question's correct answer after the tournament (player picks use the same suggestion list as players see — scoring is exact-string-match). Recompute runs on every save. |

## Scoring (v1)

See [SPEC.md](./SPEC.md) → "Scoring table" for the full point values; the in-app Rules page
renders the same table.

## Infrastructure

- **Supabase project**: `wc26-predictor` (org Emberworks Lab, `eu-central-1`)
- **Vercel project**: `wc26-predictor` (auto-deploys `main`)
- **CI**: lint + typecheck + test on every PR and push to `main`
