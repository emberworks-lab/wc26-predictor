# WC26 Predictor — Ship Report

_Stage 8 (admin area, security verification, final QA). Delivered June 13, 2026 — the
tournament is live (group stage in progress) with real users predicting._

## Live URL

**https://wc26-predictor-gilt.vercel.app** (en + uk, mobile-first dark stadium theme).
Auto-deploys from `main` via the Vercel GitHub integration.

## Admin access

- **Who:** the profile for auth email `a.chontoroh@gmail.com` has `role = 'admin'`
  (set via migration `20260612130000_admin.sql`). To add another admin, run
  `update profiles set role = 'admin' where id = '<auth user id>';`.
- **How:** sign in normally → a ⚙️ gear appears in the header → `/admin`.
- **Gate:** role-checked server-side. The `/admin` layout redirects non-admins to
  `/challenges`; every admin server action independently re-checks `is_admin` and runs
  through the service role (RLS has no admin-write policies by design).

### Admin runbook

| Problem | Fix in `/admin` |
|---|---|
| API died / data stale | **Sync & logs** → run `fixtures` / `stats` / `recompute`. Job log shows every run + JSON detail. |
| A result is wrong | **Matches** → search → fix score/status → Save. Row is flagged `manually_corrected` (sync won't overwrite it); points + standings recompute immediately. **Clear flag** restores the feed result once it's correct. |
| Open/close a challenge early | **Challenges** → Force open / Force locked / Automatic. Override beats the timestamps; a kicked-off match stays locked regardless. |
| A user is a troll | **Users** → Ban (hidden from boards + all writes blocked + session killed; predictions retained), Rename, or delete a single entry. |
| Enter fun answers | **Fun answers** → set each correct answer after the tournament. Player picks use the same suggestion list players see (scoring is exact-string-match). Recompute runs on every save. |

## Scoring table

Authoritative copy: [SPEC.md](../SPEC.md) → "Scoring table (v1)". The in-app **Rules**
page renders the same values straight from `src/engine/scoring.POINTS`, so they can't
drift. Summary:

- **Group (global):** correct outcome 3 · exact group order 10/group · top-2 qualifier
  3/team · third-place qualifier 4/team.
- **Knockout (global), per real team predicted to reach:** R16 4 · QF 6 · SF 8 · Final 12
  · Champion 20 · third-place-match winner 6 · correct AET/pens flag +1 (outcome-only).
- **Hardcore layer (hardcore board only):** exact score 5 · correct GD non-draw 2 ·
  correct pens/ET advance after a predicted draw 2.
- **Fun:** numeric closeness `max(0, MAX_PTS·(1−|guess−actual|/tolerance))` · pick exact
  15 · yes/no 5 (per-question MAX_PTS/tolerance tunable in the `fun_questions` table).
- **Tiebreakers:** qualifiers → knockout picks → group outcomes → earlier registration.
- **Redistribution (Full):** multiplier on all knockout points from the redistributed
  stage onward — R32 ×0.7, R16 ×0.6, QF ×0.5, SF ×0.4, Final ×0.3.

## What's stubbed or cut (honest list)

- **Live in-play scores, lineups, cards, per-match goal events** — not on football-data.org's
  free tier. Scores arrive slightly delayed (acceptable at 15-min polling). The "cards/conduct"
  group tiebreaker input isn't available, so the engine's documented deterministic fallback
  (FIFA ranking → lexicographic TeamId) covers those rare cases. Upgrading to Deep Data
  (€29/mo) would restore them; not done.
- **Assists** are shown when the free scorers endpoint provides them (it does — non-null
  values observed); nulls render as "—".
- **MFA / leaked-password protection** (Supabase Auth) left at defaults — accepted for a
  friends' game (see advisors below).
- **Real-thirds annex test pin** — the test pinning the *actual* qualified-thirds combination
  to its annex row can only be added once the group stage ends (~June 27); the full 495-row
  invariant suite already passes. Tracked in the post-groups TODO.

## Security & RLS

- **`pnpm verify:rls`** — 25 checks against production, self-cleaning, **ALL PASS**:
  prediction locking (read/write before & after lock), forged-entry rejection, hardcore/
  casual trigger enforcement, bracket generation rules, **admin surface** (non-admin can't
  read `sync_log` / write `matches` / `challenges` / `fun_questions` / set own role; admin
  can), and **banned-user** lockout (writes refused, joins refused, hidden from boards).
  Runs nightly in CI (`.github/workflows/security.yml`) and on demand.
- **`pnpm verify:stage8`** — 15 checks, **ALL PASS**: proves the manual-correction pipeline
  end-to-end — a corrected match survives the next real `fixtures` sync (the
  `manually_corrected` flag protects it), points + standings recompute through the same
  `sync_log` → snapshot-trigger path as a cron run, clearing the flag restores the provider
  result, challenge override beats the timestamps, and fun actuals drive scoring. The probe
  only ever touches a finished, prediction-free match and a throwaway user; everything is
  restored on exit.
- **Supabase advisors:** security advisors reviewed. The two new migration-8 helpers
  (`ko_stage_index`, `ko_round_start`) had their `search_path` pinned
  (`20260612140000_search_path_hardening.sql`). Remaining WARNs are **accepted and
  expected**: the boolean helper functions (`is_admin`, `owns_entry`, `match_is_locked`, …)
  must stay executable by anon/authenticated because RLS policies evaluate them as the
  querying role (they leak no data — booleans about the caller's own state or public timing);
  `redistribute_entry` is intentionally callable by `authenticated` (it's the one
  redistribution write path, self-validating); `pg_net` in public, and the Auth
  MFA/leaked-password WARNs, are left as-is for a friends' game. Performance advisors are all
  INFO (unindexed FKs on tables with ≤104 rows / a handful of predictions — negligible) plus
  `auth_rls_initplan` hints on three policies (micro-optimization, not worth a churn on live
  RLS mid-tournament).

## API quota

football-data.org **free tier** (10 req/min, **no daily cap**), competition `WC`.
Last 24h: **74 fixtures + 4 stats = ~78 provider calls/day** (1 call per run; recompute
makes 0). The 4 fixtures errors in 24h were transient "connection reset by peer" from the
provider, auto-retried the next cycle. Projected through July 19: same ~78/day during the
group stage, dropping as fewer matches remain. Comfortably inside the limit.

## Cron health (verified, last 24h)

`wc26_sync_fixtures_fast` (*/15 in the 14:00–06:00 UTC match window),
`wc26_sync_fixtures_hourly` (:05 outside it), `wc26_sync_stats` (4×/day) all fired on
schedule — confirmed in `sync_log` (e.g. fixtures every 15 min 03:15→04:00 UTC on June 13,
recompute fired automatically when a match finished overnight). 4 real matches are
finished and scored; leaderboard snapshots are being written at matchday boundaries.

## Local dev guide

See [README.md](../README.md) → "Local development" for env vars, the verification-script
table, and the sync-bundle deploy step. `pnpm lint && pnpm typecheck && pnpm test &&
pnpm build` is the full local gate (154 unit tests). Migrations live in
`supabase/migrations/`; the remote is managed via Supabase MCP/CLI.

## Known issues

- 4 transient provider connection-reset errors per ~74 fixtures runs (≈5%); harmless,
  self-healing on the next cycle. No data loss.
- Group-stage tiebreaker conduct score and FIFA-ranking inputs aren't on the free tier;
  the engine's deterministic fallback covers the (so far hypothetical) exact-tie case.

## Post-groups TODO (do these on the real days)

- [ ] **~June 27–28 (group stage ends):** verify the **Playoff challenge auto-opens** the
      moment the 72nd group match finishes (the sync flip is dry-run-proven, but confirm on
      the real day), and that real R32 pairings resolve in the Tournament tab. Add the
      unit-test pinning the **real qualified-thirds combination** to its annex row.
- [ ] **First R32 kickoff:** confirm Playoff + Full knockout picks lock correctly.
- [ ] **After the final (July 19):** the deployed sync is **already the ranged-Fun
      version** (v4, verified 2026-06-13 — see STATE.md "Sync redeploy verification"),
      so no redeploy is needed first. Just enter the **fun-challenge correct answers** in
      `/admin/fun` (Golden Ball/Boot, totals/ranges, etc.) — recompute runs on each save
      and finalizes the fun leaderboard.
- [ ] **After the tournament:** `cron.unschedule` the three sync jobs (July 19+), and
      **un-pause the PantryPal Supabase project** (it was paused to free the 2-active-free-
      project slot for WC26 — see STATE.md).
