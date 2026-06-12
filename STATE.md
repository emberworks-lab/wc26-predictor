# STATE — living handoff between build sessions

> Every session updates this file before finishing. Newest entries on top inside each section.

## Current status

- **Stage 5 COMPLETE** (Full + Groups prediction flows: group wizard, live predicted
  tables, thirds ranking, personal R32 bracket picker, locking UX, RLS proof).
  Branch `stage/5-predictions` → PR → merged. Next up: Stage 6
  (`prompts/stage-6-leaderboards-live.md`).
- Live URL: **https://wc26-predictor-gilt.vercel.app** (en + uk verified). CI green.

## Decisions

- **Late-joiner derived-table fallback (Stage 5, SPEC updated in same commit)**:
  `computePredictedGroups` in `engine/scoring.ts` falls back to the REAL result of a
  FINISHED match when a prediction is missing (and to the stored outcome when a hardcore
  prediction has no scores — the casual→hardcore-flip-on-locked-match case). Rationale:
  the opener finished before launch, so without the fallback no real user could ever
  complete group A → no thirds, no qualifier points, no derived R32 for the Full bracket.
  Match-outcome points and hardcore score bonuses still require a stored prediction.
  Tested in `scoring.lateJoiner.test.ts`; UI derives through the same exported helpers
  (`src/lib/predictions/derive.ts`), so wizard tables and scoring can never diverge.
- **Prediction persistence contract (Stage 5)**: `match_predictions` upserted per match
  via server action (`saveMatchPrediction`) — casual sends `outcome`, hardcore sends
  scores (DB trigger derives outcome; never trusts the client). Bracket gen-0 is saved
  as a FULL SNAPSHOT (`saveBracket`): slots missing from the snapshot are deleted —
  that's how downstream picks invalidated by an upstream change get purged. Engine
  `TeamId` = `fifa_code`, engine match id = `String(matches.id)` (sync convention).
- **Knockout FIFA match numbers are resolved lazily, not guessed from kickoff order**:
  the provider sends knockout fixtures unnumbered with null teams. `matches.fifa_match_number`
  (73–104, the engine/bracket key) is filled by `src/lib/sync/knockoutSlots.ts` —
  once groups complete, `buildR32` over the real tables gives each number's pairing;
  later rounds resolve from `KO_GRAPH` feeds. Pairs match unordered (provider home/away
  orientation kept; scoring uses advancers only). Unit-tested incl. full-tournament fixed point.
- **Sync Edge Function is esbuild-bundled before deploy** (`scripts/bundle-sync.mjs` →
  `.build/sync/index.ts`): the pure engines use extensionless TS imports Deno can't resolve.
  Source lives in `supabase/functions/sync/index.ts` (excluded from tsc/eslint); deploy =
  bundle + `supabase functions deploy sync --no-verify-jwt` from a temp workdir (see script header).
  Function auth = `x-sync-secret` header (secret in Vault `sync_secret`, Supabase function
  secrets, Vercel env, `.env.local`); deployed with verify_jwt OFF so pg_net can call it.
- **Playoff `opens_at` sentinel `2999-01-01Z`** = "not open yet"; the sync function flips it
  to `now()` the moment all 72 group matches are finished (mirrors the engine's +infinity
  convention in `locks.ts`). Seed never claws back an already-opened playoff.
- **provider status flapping**: football-data.org's match list flaps between SCHEDULED and
  TIMED for unstarted matches; sync treats the two as equal in its change detection.
- **`standings_cache` is engine-computed** (Article 13 tiebreakers), never copied from the
  API's standings endpoint. Conduct/FIFA-ranking tiebreak inputs aren't available on the free
  tier; the engine's deterministic fallback covers it (documented engine-only rule).
- **Stage 3 schema additions** (migration 5): `entry_stats` (tiebreaker counters per entry),
  `replace_entry_points(uuid, jsonb, jsonb)` RPC (atomic delete+insert per entry, service-role
  only), `leaderboard_totals` view (security invoker), `invoke_sync(text)` + 3 pg_cron jobs.
  Leaderboard rank-movement snapshots (`leaderboard_snapshots`) are NOT yet written by
  recompute — deferred to Stage 6 (needs a matchday-boundary policy).
- **Group tiebreakers follow the official FIFA WC26 Regulations Article 13, which differ
  from the original SPEC draft**: head-to-head among tied teams comes FIRST (then overall
  GD, overall goals, conduct score, FIFA World Ranking — no drawing of lots at all).
  SPEC.md was corrected in the same commit (Stage 2). Source: FIFA regulations PDF
  (May 2026 edition), pp. 26–27:
  https://digitalhub.fifa.com/m/636f5c9c6f29771f/original/FWC2026_regulations_EN.pdf
- **Annex C (third-place → R32 slot mapping, all 495 combinations)** extracted
  programmatically from the same FIFA PDF (Annex C, pp. 80–97) into
  `src/engine/r32annex.data.ts`; cross-checked against the per-slot candidate lists on
  https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage (all assignments
  consistent). Invariant tests cover all 495 rows; 15 rows are pinned to hand-read PDF
  values. Third-place slots are hosted by winners of A, B, D, E, G, I, K, L
  (matches M79, M85, M81, M74, M82, M77, M87, M80).
- **Engine scoring conventions** (documented in `src/engine/scoring.ts` header):
  outcome-only predictions become synthetic 1:0/0:0/0:1 scores for predicted tables;
  hardcore knockout score bonuses require the user's derived pairing to equal the real
  pairing; exact-score (5) and GD (2) hardcore bonuses are exclusive tiers; AET/pens flag
  pays +1 only on a correct, flagged, beyond-90' match; third-place qualifier bonuses pay
  only once all 12 groups are complete.
- GitHub owner for the repo: **`emberworks-lab` org**, repo is **PUBLIC** (confirmed by
  user, June 12 2026 — Vercel Hobby cannot deploy private org repos; never commit secrets).
- Supabase project: **`wc26-predictor`**, ref `ejiuelstlbncfaljthfr`, region `eu-central-1`,
  free tier. URL `https://ejiuelstlbncfaljthfr.supabase.co`. NOTE: PantryPal project was
  PAUSED to free the 2-active-free-projects slot (user approved; un-pause after the WC if needed).
- Vercel: user `achontoroh-8067`, team `team_xZTl8i4cPEKsFO60nyTFLzd7` (Hobby), token in
  `.secrets/vercel_token`.
- `src/middleware.ts` is named `src/proxy.ts` (Next.js 16 convention — middleware.ts deprecated).
- Security advisors: remaining WARNs are accepted — boolean helper functions
  (is_admin/owns_entry/match_is_locked/...) must stay executable by anon/authenticated
  because RLS policies evaluate them; they leak no data. Trigger functions are revoked.
- Data API: **football-data.org, free tier** (verified June 12, 2026: World Cup is
  `plan: TIER_ONE` = free). Competition id **2000**, code **`WC`**, base
  `https://api.football-data.org/v4`. Endpoints: `/competitions/WC/matches`,
  `/competitions/WC/standings`, `/competitions/WC/scorers?limit=100` (scorers schema
  includes goals, assists, penalties). Auth header `X-Auth-Token`. Rate limit:
  10 req/min, no daily cap. Key location: `.env.local` → `FOOTBALL_API_KEY` (+ Vercel env
  + Supabase function secret).
  - NOT available on free tier: true in-play live scores (free scores are slightly delayed —
    acceptable at 15-min polling), lineups, substitutions, cards, per-match goal events.
    Cards/lineups features in SPEC live tab: **cut unless upgraded** (€29/mo Deep Data).
  - Fallback for assists if the free scorers endpoint disappoints in practice:
    API-Football free tier (100 req/day), league id 1, season 2026,
    `players/topassists` once a day — registering a second free key costs nothing.
- Scoring table v1 fixed in SPEC.md.
- Stack fixed in SPEC.md (Next.js App Router + TS + Tailwind + next-intl + Supabase + Vitest + pnpm).

## Access / credentials status

| Thing | Status |
|---|---|
| GitHub | ✅ `gh` authed as `achontoroh` (repo, workflow scopes) |
| Supabase | ✅ MCP access to org Emberworks Lab (`kjrrdcebvoepffmaqxgq`) — can create project, run migrations, deploy edge functions |
| Vercel | ✅ token in `.secrets/vercel_token`; project `prj_jPTbl9jkwCv2qVLo3VwIKPcLx8Dg` linked to repo, env vars set (SUPABASE_URL, ANON_KEY, FOOTBALL_API_KEY) |
| Football API | ✅ key in `.env.local` + Vercel env + Supabase function secret as `FOOTBALL_API_KEY` |
| Supabase service role key | ✅ in `.env.local` + Vercel env (prod+preview) as `SUPABASE_SERVICE_ROLE_KEY`; auto-injected into Edge Functions |
| Sync shared secret | ✅ `SYNC_SECRET` in `.env.local` + Vercel env + Supabase function secrets + Vault (`sync_secret`) |
| Google OAuth | ✅ fully configured server-side: OAuth client created (Google Cloud `wc26-predictor`), Supabase Google provider enabled via `supabase config push` (see supabase/config.toml), consent screen published to production, site_url + redirect URLs set. Credentials in `.secrets/google_oauth`. Stage 4 builds the UI/flow only |

## Stage log

### Stage 5 — June 12, 2026
- Branch `stage/5-predictions` → PR → merged. 150 unit tests green (was 131).
- **Engine extension** (see Decisions): late-joiner real-result fallback +
  hardcore-flip outcome fallback in `computePredictedGroups` / `predictedOutcome`;
  `predictionAsPlayedMatch` + `predictedOutcome` now exported for UI reuse.
  SPEC.md "Deadlines & locking" gained the derived-table clarification.
- **Shared derivation layer** `src/lib/predictions/` (types.ts + derive.ts, unit-tested):
  DTO↔engine adapters, `deriveGroups` (live tables → thirds → personal R32 via
  `buildR32`), `deriveBracket` (`simulateBracket`), `staleSlots` (downstream-invalidation
  detection; a hardcore draw awaiting its advancer is NOT stale), `bracketSnapshot`
  (gen-0 persistence rows = only fully resolved slots).
- **Routes**: `/[locale]/challenges/[kind]` (kind ∈ full|groups; others redirect).
  Challenge cards link "Make predictions" / "View predictions" for full+groups.
- **PredictionFlow** (client state machine): optimistic autosave with latest-wins
  sequencing + rollback on RLS rejection (per-match debounce 500ms, bracket 800ms full
  snapshot); server-clock offset (UI lock moments match RLS); resume at first group
  needing attention; A–L chips + 3rd-place + bracket nav; progress x/72; countdown
  banner; read-only mode when the challenge locks. Group-pred edits that reshape the
  R32 auto-clear newly-stale bracket picks with a toast; stale-on-load is flagged
  visually and purged on first edit (never silently kept).
- **Group wizard**: W/D/L segmented buttons (casual) or score steppers (hardcore;
  outcome derived); locked matches render real result + "No pick — 0 pts" badge;
  flipped casual→hardcore predictions show "Add an exact score"; live predicted table
  with top-2/3rd qualification cut per group.
- **Thirds + bracket**: bestThirds ranking screen (8 IN / 4 OUT); bracket as
  round-tabbed list (R32→Finals incl. third-place match), casual tap-winner +
  AET/pens flag, hardcore 90' steppers + draw advancer chips; champion/third-place
  summary card.
- **RLS proof** `scripts/rls-check.ts` (extends the stage-4 pattern; 14 checks, ALL
  PASS against prod): kicked-off write refused, unlocked predictions invisible to
  others, locked readable, locked not updatable by owner, cross-entry forgery refused,
  hardcore trigger enforcement (scores required, outcome derived server-side), casual
  scores stripped, bracket gen rules (gen-1 without redistribution refused, winner ∉
  pairing refused).
- **UI verified** on local dev against prod DB (session-cookie injection, mobile
  viewport, en + uk): 72-match flow with the 2 real finished group-A matches locked,
  live tables (Article 13 h2h tiebreak visible), thirds, full bracket walk to a
  champion, downstream-invalidation toast, hardcore steppers persisting scores,
  Groups challenge stopping at thirds. Post-merge re-verified on the deployed URL.
- **Follow-up fix (same day)**: `saveBracket` for a hardcore entry excludes
  scoreless rows from the upsert AND protects them from the snapshot delete —
  bracket rows saved while casual (pre-flip) stay as-is until progressively
  scored; without this, any bracket edit after a casual→hardcore flip failed
  wholesale on the "hardcore requires a score" trigger. Verified live.
- **DEVIATION from the stage-5 prompt (orchestration)**: state machine AND UI written
  by the orchestrator directly instead of delegating UI to Sonnet subagents — single
  session had full context; correctness-critical pieces stayed under one review.
- NOT in this stage (per plan): leaderboard wiring of `entry_stats`/points UI (Stage 6),
  Playoff + Fun flows and redistribution (Stage 7).

### Stage 4 — June 12, 2026
- Same branch/PR as Stage 3 (`stage/3-4-data-auth`).
- **Auth**: magic link + Google via @supabase/ssr. `src/proxy.ts` chains next-intl with
  Supabase session refresh; `/auth/callback` (outside the locale tree, excluded from the
  middleware matcher) exchanges the code and redirects to a locale-prefixed `next`.
  Sign-in page with both flows (server actions in `(marketing)/sign-in/actions.ts`).
  Magic link uses the default PKCE flow — the link must be opened in the browser that
  requested it (fine for the friend group; copy says so on the sent screen).
- **DEVIATION from the stage-4 prompt**: no `on auth.users` profile trigger. The Stage 1
  schema deliberately ships a `profiles_insert` self-policy + column grants instead —
  onboarding (`/[locale]/onboarding`) creates the profile row (unique display name,
  case-insensitive via citext; locale; hardcore explainer). "Profile exists" = onboarded;
  the `(app)` layout redirects no-session → sign-in, no-profile → onboarding. This avoids
  placeholder names leaking to public profile reads.
- **App shell**: route groups `(marketing)` (landing, sign-in, rules — public) and `(app)`
  (challenges, tournament, leaderboards, profile — gated). `TabNav` bottom bar on mobile /
  horizontal under header on desktop. Header shows auth state (profile chip or sign-in CTA).
- **Challenges home**: 4 cards from real `challenges` rows — status (open / locked /
  opens-after-groups via the 2999 sentinel), lock time + live countdown, join with hardcore
  checkbox, joined state, hardcore toggle until lock. Join/toggle are thin server actions;
  RLS does the enforcement.
- **Rules page**: scoring tables render from `engine/scoring.POINTS` (can't drift from the
  engine); deadlines pull real `locks_at` from the DB; both locales.
- **`<KickoffTime>`**: shared UTC→local renderer (SSR Europe/Kyiv default per SPEC, browser
  tz after hydration). `<Countdown>` for lock deadlines.
- **Verified server-side** (`scripts/verify-stage4.ts`, all PASS, run against prod):
  case-insensitive display-name uniqueness (23505), join open challenge creates entry,
  playoff join refused (42501), cross-user entry insert refused (42501), hardcore toggle,
  Google authorize 302 → accounts.google.com. Local prod build: en/uk landing, sign-in,
  rules render; signed-out /challenges 307s to sign-in. Entries metadata (incl. hardcore
  flag) is public by design — predictions are the protected thing (SPEC).
- Abuse limits: kept Supabase defaults (magic-link 60s cooldown, built-in email ~2-4/h cap,
  30 sign-ins/5min/IP) — already tight for a friend group; not customized.
- Magic-link E2E on the deployed URL verified post-merge (see PR notes / below).

### Stage 3 — June 12, 2026
- Branch `stage/3-4-data-auth` (shared with Stage 4, one PR for both).
- **API client** `src/lib/football-api/` (types, polite client with 429/5xx backoff +
  6.5s spacing, mappers, flag-emoji table for all 48 TLAs) — mappers unit-tested against
  recorded JSON fixtures (`fixtures/*.sample.json`) + synthetic ET/pens shape.
- **Seed** `pnpm seed` (`scripts/seed.ts`, idempotent, verified twice): 48 teams /
  12 groups / 104 matches in prod, opener seeded finished (MEX 2–0 RSA, matches reality);
  Full/Groups/Fun lock `2026-06-18T02:00Z` (last matchday-1 kickoff), Playoff locks
  `2026-06-28T19:00Z` (first R32 kickoff); 12 fun questions with SPEC tolerances.
- **Edge Function `sync`** (deployed, verify_jwt off, `x-sync-secret` auth):
  `mode=fixtures` (diff upsert, KO slot resolution, engine standings cache, playoff flip,
  inline recompute on changes), `mode=stats` (scorers + standings cache), `mode=recompute`
  (full idempotent points rebuild via `engine/scoring.computePoints`, atomic per entry via
  `replace_entry_points` RPC, also rewrites `entry_stats`). Every run logs to `sync_log`.
  Manual runs of all 3 modes verified OK; 401 without secret; fixtures stable at
  `changed:0` on re-run; recompute idempotent (0 entries — points checksum identical;
  re-verify with real entries in Stage 5).
- **pg_cron** (migration 5): `wc26_sync_fixtures_fast` */15 within 14:00–06:00 UTC during
  Jun 11–Jul 21, `wc26_sync_fixtures_hourly` at :05 outside the window, `wc26_sync_stats`
  4×/day. Verified end-to-end via `select invoke_sync('fixtures')` → pg_net → function →
  `sync_log` ok row. **API budget: worst case ≈76 calls/day** (64 fast + 8 hourly + 4 stats),
  1 provider call per run, vs 10 req/min free-tier limit, no daily cap — ample headroom.
  Quota status: ~15 calls used today (seed + manual verification).
- DB types regenerated (`src/lib/database.types.ts` now includes entry_stats,
  leaderboard_totals, RPCs).
- Post-tournament cleanup TODO: `cron.unschedule` the three jobs after July 19.

### Stage 2 — June 12, 2026
- Branch `stage/2-engines` → PR → merged to main. All pure TypeScript under `src/engine/`
  (no I/O imports — verified): `types.ts`, `groupTable.ts` (Article 13 tiebreakers incl.
  recursive head-to-head sub-tables), `bestThirds.ts`, `r32annex.data.ts` (full 495-row
  Annex C), `r32Mapping.ts` (`buildR32` + allowed-slot constants), `knockoutSim.ts`
  (official match graph M73–M104, `simulateBracket`), `scoring.ts` (`computePoints`:
  entire SPEC table incl. hardcore layer, fun closeness formula, redistribution
  multipliers, idempotent/total), `locks.ts` (match/challenge locks, matchday-1 deadline,
  playoff window, admin override), `leaderboard.ts` (`compareEntries`).
- Test suite: every SPEC scoring rule covered (see scoring.test.ts), 495-row annex
  invariants + 15 PDF-pinned rows, knockout walk-through, lock boundary conditions.
- TODO for a later stage: once the real qualified-thirds combination is known
  (group stage ends June 27), add a test pinning the REAL combination's annex row, per
  the stage-2 prompt.

### Stage 1 — June 12, 2026
- Repo `emberworks-lab/wc26-predictor` (PUBLIC), main branch, CI green (lint/typecheck/test).
- Next.js 15 + TS + Tailwind v4 + next-intl (en/uk, `localePrefix: always`, `src/proxy.ts`).
- Supabase `ejiuelstlbncfaljthfr`: 4 migrations applied (core_schema, functions_triggers,
  rls_policies, security_hardening); RLS on all 15 tables; TS types in src/lib/database.types.ts.
- Vercel project linked, env vars set, production deploy verified:
  https://wc26-predictor-gilt.vercel.app (`wc26-predictor.vercel.app` was taken).
- Landing page + theme tokens + language switcher live in both locales.
- NOT done in Stage 1 (deferred as planned): seed data (Stage 3), auth (Stage 4),
  service-role key in env (Stage 3).

### Stage 0 — June 12, 2026
- Authored SPEC.md, PLAN.md, STATE.md, prompts/stage-1..8.
- football-data.org chosen + key verified; GitHub/Supabase/Vercel access confirmed.

## Known issues / deviations from SPEC

- Stage 2: SPEC's original group-tiebreaker order was wrong vs the official FIFA
  regulations (overall GD before head-to-head). Fixed in SPEC.md + implemented per
  Article 13 (head-to-head first); see Decisions. Not a runtime issue — recorded here
  because the SPEC text changed.
