# Stage 3 — Data layer: API client, seed, sync jobs, recompute pipeline

You are the orchestrator for Stage 3 of WC26 Predictor. Read `SPEC.md` and `STATE.md` first
(STATE.md → Decisions tells you which football API we use, its key location, rate limits and
WC2026 competition ID). Follow the session protocol in `PLAN.md`.
Branch: `stage/3-data-sync` → PR → merge.

## Deliverables

### 1. API client (`src/lib/football-api/`)
Typed client for the chosen provider: fixtures (with UTC kickoffs), results, group
standings, top scorers (+ assists/cards if available — check STATE.md for what the plan
covers). Built-in politeness: respect rate limits, retry with backoff on 429/5xx, and map
provider statuses to our `matches.status` enum. Unit-test the response→row mappers with
recorded JSON fixtures (commit small fixture files).

### 2. Seed script (`scripts/seed.ts`)
Idempotent (upsert by external_api_id): fetch real WC2026 teams, groups A–L, all 104
fixtures with kickoff timestamps → populate `teams`, `tournament_groups`, `matches`.
Create the 4 challenge rows with computed `locks_at` (Full/Groups/Fun = kickoff of last
matchday-1 match via `engine/locks.ts`; Playoff = opens on group-stage completion, locks at
first R32 kickoff — store strategy, resolve dynamically). Seed `fun_questions` from SPEC.
Run it against the real Supabase project. Verify counts: 48 teams, 12 groups, 104 matches.
**Matches already played before seeding must come in with real scores and status finished.**

### 3. Sync Edge Function (`supabase/functions/sync/`)
Deno Edge Function, service-role, secured by a shared secret header:
- `mode=fixtures`: pull fixtures/results diff → upsert matches (scores incl. ET/pens, status).
- `mode=stats`: standings cache + scorers/assists cache.
- On any newly-finished match: recompute real standings (reuse `engine/groupTable.ts` —
  engines are pure TS, import them into the function), resolve group-stage-complete →
  flip Playoff challenge open with real bracket via `engine/r32Mapping.ts`, then trigger
  full points recompute.
- Log every run to `sync_log` (status, matches changed, API calls used).

### 4. Points recompute (`supabase/functions/recompute/` or same function, `mode=recompute`)
Loads results + all entries' predictions + redistribution logs, runs `engine/scoring.ts`
per entry, **transactionally replaces** that entry's `points` rows (delete+insert or
truncate-partition approach), refreshes leaderboard views. Idempotent — running twice
changes nothing. Must handle all entries in one run within Edge Function limits (we're a
friend group, <100 entries; still batch sanely).

### 5. pg_cron schedule
- Every 15 min between 14:00–06:00 UTC during June 11 – July 19 (match windows, generous),
  hourly otherwise: call sync `mode=fixtures` (use `net.http_post` via `pg_net` to invoke the
  Edge Function with the secret).
- 4×/day: `mode=stats`.
- Schedule via migration. Verify by running each job manually once and checking `sync_log`.

### 6. Budget check
Compute worst-case API calls/day from the schedule vs the provider limit from STATE.md.
If over budget, lengthen intervals and note it. Record current quota usage in STATE.md.

## Orchestration

- Recompute pipeline + sync orchestration logic: yourself or one Opus subagent with this
  prompt section as spec; review its diff yourself before merging.
- API client mappers + fixture tests + seed script: Sonnet subagents (parallel, files don't overlap).

## Done means

- Real data in production DB (verified counts + spot-check a known result vs flashscore).
- Manual run of each cron job succeeds; `sync_log` rows prove it; pg_cron jobs scheduled.
- Recompute run on real data produces points rows (0 entries is fine — function must still
  succeed) and is idempotent (second run = identical state; verify with a checksum query).
- CI green, PR merged, STATE.md updated (API quota status included).
