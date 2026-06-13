# STATE — living handoff between build sessions

> Every session updates this file before finishing. Newest entries on top inside each section.

## Current status

- **Stage 8 COMPLETE — code, prod, AND shipped.** Admin area live, security
  suite green against prod, ship report delivered (`docs/SHIP_REPORT.md`).
  Applied to prod Jun 13:
  1. **Migration 9** (`20260612130000_admin.sql`) — `a.chontoroh@gmail.com`
     profile set to `role = 'admin'`. **Migration 10**
     (`20260612140000_search_path_hardening.sql`) — pinned `search_path` on
     `ko_stage_index` / `ko_round_start` (advisor WARNs).
  2. **Sync Edge Function redeployed** — `refreshStandings` extracted to
     `src/lib/sync/standings.ts` (shared with the admin correction action);
     fixtures mode now also recomputes on a *changed-but-not-newly-finished*
     finished match (`resultChanged`), so clearing a correction + re-sync
     restores points. Bundled via `scripts/bundle-sync.mjs`, deployed
     `--no-verify-jwt`.
  3. The Playoff challenge has NOT auto-opened yet (group stage in progress —
     4/72 group matches finished as of Jun 13). Auto-open is a post-groups TODO.
- **The tournament is live with real users.** 3 real profiles
  (achontoroh=admin, bibliary, Demanlol); 4 group matches finished and scored
  (MEX 2-0 RSA, KOR 2-1 CZE, CAN 1-1 BIH, USA 4-1 PAR); achontoroh has real
  points (GROUP_OUTCOME 3 + HC_EXACT_SCORE 5). Cron writing matchday snapshots.
- Next up: post-groups TODO list (see `docs/SHIP_REPORT.md`): verify Playoff
  auto-open ~Jun 27-28 + pin real-thirds annex test; enter fun correct answers
  after the final (Jul 19); `cron.unschedule` the 3 jobs + un-pause PantryPal
  after the tournament. **Stage 9** backlog (`prompts/stage-9-improvements.md`)
  is a separate iteration.
- Live URL: **https://wc26-predictor-gilt.vercel.app** (en + uk verified). CI green.

### Stage 7 status (prior)

- **Stage 7 COMPLETE — code AND prod.** The two manual prod steps were applied
  Jun 12:
  1. **Migration 8 applied to prod** as remote version `20260612110000`
     (`redistribute_entry()` RPC + `ko_stage_index`/`ko_round_start` +
     `can_edit_bracket` round-F fix). Prod's migration history uses
     MCP-timestamp version names, so plain `supabase db push --linked` fails on
     history drift — applied via a temp workdir mirroring the remote history
     (stub files for the 7 applied versions + migration 8 renamed past the
     remote head). RPC verified live (bogus call returns the function's own
     "redistribute: not your entry").
  2. **Sync Edge Function redeployed** from a fresh `scripts/bundle-sync.mjs`
     bundle (refactored `src/lib/sync/recompute.ts` + 1-decimal rounding) via
     `supabase functions deploy sync --use-api` from a temp workdir (`--use-api`
     skips the Docker bundler, which can't see /tmp). Manual
     `?mode=recompute` after deploy: `sync_log` id 50 `status=ok`
     (entries 2, rows 0).
- Next up: Stage 8 (`prompts/stage-8-admin-ship.md`).
- Live URL: **https://wc26-predictor-gilt.vercel.app** (en + uk verified). CI green.

## Decisions

- **Submit gating = `challenge_entries.submitted_at` + a view filter (Stage 9 item 4)**:
  an entry ranks on the leaderboards only once `submitted_at is not null`. Enforced in ONE
  place — `leaderboard_entry_rows` filters it (every ranked/overall view builds on that
  view), so per-board code needed no changes. The column is user-settable via the existing
  `entries_update` RLS policy (no new grant; same path as the hardcore toggle), which means
  the lock check is automatic: submit allowed only while unlocked, frozen after. The
  migration grandfathered all entries existing at apply time to `now()` so live users
  didn't drop off the boards. Editing predictions never touches `submitted_at` (separate
  rows) → "submitted stays submitted". Verify scripts must now set `submitted_at` on any
  entry they expect to see on a board.
- **Redistribution stage rule (Stage 7)**: SPEC's "one redistribution per stage max,
  multiplier never increases" is enforced as *every new redistribution must target a
  STRICTLY LATER stage than all existing ones* — otherwise a later-generation
  redistribution at an earlier stage would RAISE the multiplier for rounds between
  the two stages (engine `activeVersionForRound` takes the newest generation whose
  start ≤ round). Enforced in `redistribute_entry()`.
- **`redistribute_entry(entry, stage)` DB function is the ONE redistribution write
  path** (migration 8): SECURITY DEFINER, granted to `authenticated`, runs as the
  calling user (`owns_entry`), validates atomically (groups complete — same
  72-finished condition as the playoff flip; target ROUND not started; strictly-later
  stage; gen = max+1), inserts the log row AND prefills the new generation with real
  results of already-played knockout matches (hardcore prefill carries the real 90'
  score, casual is winner-only). The server action `redistribute` is a thin RPC
  wrapper; the UI never writes `redistributions` directly.
- **Round-F lock boundary (migration 8)**: the engine's final round includes the
  third-place match (M103), which kicks off BEFORE the final — `can_edit_bracket`
  and `redistribute_entry` use `ko_round_start()` (third_place+final = one round),
  closing the "edit slot 103 after the third-place match started" hole.
- **Engine points are rounded to one decimal** (`scoring.ts` add()): multipliers have
  exactly one decimal so 6×0.6 must persist as 3.6, not IEEE 3.5999999999999996
  (found by the stage-7 DB integration test asserting raw numeric row values).
- **Recompute + playoff flip live in `src/lib/sync/recompute.ts`** (extracted from the
  Edge Function verbatim): the deployed function and the verification scripts run the
  IDENTICAL pipeline (esbuild inlines it into the bundle; scripts import it via tsx).
  `maybeOpenPlayoff(supabase, groupMatches)` is the flip — dry-run-proven idempotent
  in `verify-stage7.ts` (flips the sentinel exactly once when 72/72 finished).
- **Stage-7 testing runs on the LOCAL Supabase stack** (`supabase start`; colima must
  be running; analytics containers excluded — docker-socket mount fails under colima:
  `supabase start -x vector,logflare,studio,imgproxy,inbucket,edge-runtime`).
  `pnpm verify:stage7` resets the local DB, seeds the synthetic complete-groups world
  from `scoring.redistribution.test.ts`, and proves 30 checks incl. hand-computed
  multiplied totals landing in `leaderboard_ranked`. NEVER run against prod (hard
  localhost guard in the script).
- **Fun player suggestions**: static star list `src/lib/predictions/funPlayers.ts`
  (~114 players, filtered at render to teams present in the DB) merged with
  `scorers_cache` names (static spelling wins dedup); free text always allowed.
  **Stage 8 note: the admin UI for `correct_text` must offer the SAME suggestion
  list** — scoring is exact string match, so the actual answer should be entered
  with the suggestion spelling (e.g. "Kylian Mbappé").
- **"use server" files may export ONLY async functions** — even `export type`
  re-exports crash the server-actions loader at runtime (`SaveResult is not
  defined`, every action in the file 500s). Shared action types live in
  `src/lib/predictions/entryLock.ts`.
- **Leaderboard "registration" tiebreaker = `profiles.created_at`** (Stage 6): SPEC's
  "earlier registration (created_at)" is read as ACCOUNT registration, not challenge-entry
  creation — one consistent instant per user across per-challenge and overall boards.
  Implemented in migration 6's ranked views (`leaderboard_entry_rows`,
  `leaderboard_ranked`, `leaderboard_overall_ranked`); parity with
  `engine/leaderboard.compareEntries` proven by `scripts/verify-stage6.ts` on an
  equal-points fixture exercising every tier of the chain. Full ties share a rank
  (SQL `rank()` ≡ comparator returning 0).
- **Matchday snapshot policy (Stage 6, migration 6+7)**: a "matchday" is the football
  night `(kickoff_utc - 6h)::date` (kickoffs 14:00→05:59 UTC group together, matching
  the cron match window); it is COMPLETE when every match on or before it is settled
  (`finished/awarded/cancelled/postponed`; suspended/in-play block).
  `write_leaderboard_snapshots()` writes one snapshot set (per-challenge + overall ×
  global/hardcore, keyed `matchday_date`, unique index `nulls not distinct`) per
  completed matchday, idempotently; `p_matchday` override exists for backfills/tests.
  **Wired via DB trigger on `sync_log`** (status→'ok', kind fixtures/recompute) instead
  of inside the Edge Function — fires after the inline recompute by construction, needs
  no function redeploy (the deployed sync function is unchanged since Stage 3/5).
  UI movement baseline = newest snapshot OLDER than the matchday of the most recent
  finished match (`src/lib/leaderboards.ts`) — arrows keep showing last night's movement
  through the idle morning instead of resetting at the boundary snapshot.
- **Tournament tab is public** (Stage 6, per SPEC "read-only real data"): lives in route
  group `(public)` — same Header/TabNav shell as `(app)` but no auth redirect.
- **Scorers: assists column kept** — football-data.org free-tier scorers DOES return
  assists (non-null values observed in `scorers_cache` June 12); nulls render as "—".
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

### Stage 9 — iteration 2 — June 13, 2026
- Branch `stage/9-iteration-2` → PR #12 → merged. 167 unit tests green (was 160;
  +7 for the copy planners). Cleared the remaining pre-lock-relevant P1 items
  (3, 8, 15) ahead of the Jun 18 02:00 UTC main lock, plus the conditional P1
  (11). lucide-react added.
- **Item 3 — copy predictions as a template (the large one).** Pure planners
  `src/lib/predictions/copy.ts` (`planGroupCopy` + `planPlayoffCopy`) decide what
  to write; `copyPredictions` server action (in `challenges/actions.ts`) runs on
  the **user's JWT** so RLS enforces ownership + kickoff locks — never service
  role, never bypasses RLS. **Full → Groups** copies the 72 group predictions
  (hardcore→casual collapses scores to outcomes; casual→hardcore skips scoreless
  rows since the trigger rejects outcome-only hardcore rows; locked matches
  skipped). **Full → Playoff** copies R32 picks where the predicted pairing
  matches reality (score re-oriented to real home/away); wired + unit-tested but
  the UI is gated on the Playoff challenge being open (post-groups — untestable
  live until ~Jun 27). `CopyFromFull` client button on the target ChallengeCard
  (`copySourceEntryId` passed from the page when the Full entry has the relevant
  picks); confirm + "copied N / skipped …" toast; `router.refresh()`. Copied
  entries stay drafts until submitted (iter-1 submit gate unchanged).
  **The `CopyResult` type lives in `copy.ts`, not the "use server" file** (the
  loader rejects non-async exports).
- **Item 8 — landing dropped.** `(marketing)/page.tsx` now redirects
  `/[locale]` → `/tournament`; `HeroSection`/`ChallengesSection` deleted; the
  `Hero` + `Challenges.heading` + per-item `emoji` message keys removed
  (`Challenges.items.*.title/description` kept — used by ChallengeCard +
  ProfileView). Sign-in page kept.
- **Item 15 — branding.** `src/components/Brand.tsx` (inline SVG football mark,
  `currentColor`) in the header; `src/components/ChallengeIcon.tsx` maps kinds →
  lucide. Decorative emojis replaced with lucide across header gear (Settings),
  tab bar (Target/Goal/Medal/CircleUser), challenge cards
  (Trophy/LayoutGrid/Swords/Dices), hardcore badges (Flame), BracketView
  champion/third (Trophy/Medal), tournament empty-bracket (CalendarDays),
  leaderboard board labels + empty state. 🔥 stripped from message strings.
  **Team flag emojis + the `🏳️` FALLBACK_FLAG stay** (data, not decoration).
- **Item 11 — read-only graphical bracket on the profile.** `ProfileBracket`
  client wrapper derives the user's R32 from their group picks
  (`deriveGroups`→`deriveBracket`) and renders `BracketView` in `mode="results"`
  (no affordances, no progress copy) under a "Predicted bracket" disclosure on
  Full entries. RLS-scoped: complete on your own profile, degrades to BracketView's
  "finish the groups" message for another user until their picks unlock (no
  pre-lock value by design). ProfileView gained group-matches + full-bracket-row +
  team-group queries to feed it.
- **Verification.** Browser (local dev vs prod DB, mobile 375px): `/en` →
  `/en/tournament` redirect; branding screenshot (gold mark + lucide tab icons,
  flags intact). Server-rendered HTML (en + uk) confirmed the copy button on the
  Groups card and "Predicted bracket" + "Round of 32" + match cards on the
  profile. **Copy RLS write-path proven** on a throwaway user: Full→Groups
  upsert on the user's JWT lands 68 rows; a finished (locked) match write is
  refused (42501). Throwaway user cleaned up (prod back to 3 profiles / 3
  entries). The interactive copy-button CLICK could NOT be exercised in this
  preview session — the page-content Suspense fallback didn't get replaced
  client-side (same environmental non-hydration quirk recorded in iter 1; server
  returns 200); to be confirmed on the deployed URL post-merge.

### Stage 9 — iteration 1 — June 13, 2026
- Branch `stage/9-iteration-1` → PR #11 → merged. 160 unit tests green (was 154;
  +6 for the new completion helper). Cleared ALL P0-prelock backlog items
  (4, 5, 6, 7, 13) ahead of the Jun 18 02:00 UTC main lock; stopped before P1.
- **Item 4 — explicit submit gating (the big one).** Migration
  `20260613000000_submit_gating` (applied to prod via MCP `apply_migration`,
  recorded remote version): `challenge_entries.submitted_at timestamptz`,
  **all 3 existing entries grandfathered to `now()`**, `leaderboard_totals`
  gains the column + `leaderboard_entry_rows` filters `submitted_at is not null`
  (every downstream ranked/overall view inherits the gate). No new grant —
  `authenticated` already has table-wide UPDATE on `challenge_entries`, gated by
  the existing `entries_update` policy (owner + not banned + not locked), so a
  submit after the deadline is RLS-refused and a submitted entry can't be
  withdrawn post-lock. New `submitEntry` action; `ChallengeCard` shows honest
  completion (group "done/available available (N locked)", bracket "N/32 ·
  Champion: X", fun "N/12"), a Submit button (warns on missing picks, allowed
  anyway) that becomes "Edit predictions" + a "Submitted" badge. Completion math
  is the pure `src/lib/predictions/completion.ts` (counts saved rows; excludes
  permanently-locked-before-join matches from the denominator — that was the
  "70/72" bug). DB types regenerated.
- **Item 7 — leaderboard switching.** `fetchAllBoards()` loads every board in
  ~5 queries (was ~4 per board × 10 boards); page delegates to a client
  `LeaderboardsBrowser` that switches tab/board in state (no nav/refetch) and
  syncs the URL via `history.replaceState`.
- **Items 5/6/13 — UI/copy.** Group A–L strip + knockout round tabs now
  `flex-wrap` (no more horizontal scrollbar); round tabs turn green + ✓ on
  completion like the group bubbles; knockout score copy reworded in both
  locales to "score after 90 minutes (regulation); on a draw pick who advances".
- **Verification:** `verify:rls` 25/25 PASS vs prod (incl. submit-gated board
  visibility + banned-hidden, after updating the verify scripts to submit their
  throwaway entries). Migration grandfathering verified on prod (3/3 still on
  boards). UI verified via the cookie-injection pattern with a throwaway user
  (card "Groups 68/68 ✓ (4 locked before you joined)", Submit → SUBMITTED + Edit
  predictions, board membership flipped on submit), then the throwaway user was
  deleted (prod back to 3 profiles / 3 submitted entries / 3 board rows).
  NOTE: page-content client islands did not hydrate in THIS preview session
  (a known-good live component, PredictionFlow, failed identically — environmental,
  not a regression); item 7's client switching to be confirmed on the deployed URL.
- Updated the verify scripts (`rls-check`, `verify-stage6/7/8`) to set
  `submitted_at` on the entries they expect on boards — required now that boards
  filter on it.

### Stage 8 — June 13, 2026
- Branch `stage/8-admin-ship` → PR → merged. 154 unit tests green (stage adds
  admin UI + server actions + verification scripts; correctness proven against
  prod via scripts). Final report in `docs/SHIP_REPORT.md`.
- **Admin area** `/admin` (role-gated: `getAdminUserId` layout guard +
  per-action re-check; service-role writes, RLS has no admin-write policies by
  design). Sections: **Sync & logs** (force fixtures/stats/recompute buttons +
  filterable `sync_log` viewer — read through the viewer's own client, so it
  also exercises the `is_admin()` policy), **Matches** (search + per-match
  editor → `manually_corrected` flag + recompute), **Challenges**
  (open/locked/auto override), **Users** (ban/unban/rename/delete-entry; admins
  & self protected; emails via service client), **Fun answers** (correct-answer
  form, player picks reuse the user-facing suggestion list). Header gained an
  admin-only ⚙️ link; `(app)` layout redirects banned users to
  `/sign-in?banned=1` (sign-in page shows a notice instead of looping).
- **Decision — admin writes via service role, not RLS**: keeps the RLS surface
  small (the rls_policies migration always intended this). Server actions are
  the trust boundary; each calls `getAdminUserId()` then `createServiceClient()`.
- **Decision — manual correction goes through the deployed sync function**:
  `correctMatch`/`clearCorrection`/`saveFunCorrectAnswer` call the sync Edge
  Function's `recompute` mode over HTTP (`src/lib/sync/invoke.ts`) so points
  rebuild + the `sync_log`→snapshot trigger fire on the SAME path as cron — no
  separate recompute code. Standings are refreshed inline via the shared
  `refreshStandings`.
- **Sync function fix (redeployed)**: fixtures mode now recomputes when a
  *finished* match's row changes without a fresh finish (`resultChanged`) — the
  case where clearing a correction lets the feed restore truth. Without it,
  `clearCorrection`'s re-sync would restore the score but not the points.
- **Refactor**: `refreshStandings` moved out of the Edge Function into
  `src/lib/sync/standings.ts` (shared by the function bundle + the admin action);
  `PlayerPicker` extracted to `src/components/PlayerPicker.tsx` and the fun
  suggestion-builder to `src/lib/predictions/funSuggestions.ts` (one list for the
  user form AND admin — fun pick scoring is exact-string-match).
- **Security suite** consolidated into `scripts/rls-check.ts` (14 → **25
  checks**, ALL PASS vs prod): added non-admin denial on `sync_log`/`matches`/
  `challenges`/`fun_questions`/own-role, admin positive reads, and full
  banned-user lockout (insert/update/join refused, hidden from boards). Wired
  into nightly CI (`.github/workflows/security.yml`, `pnpm verify:rls`; repo
  secrets set). **`scripts/verify-stage8.ts`** (15 checks, ALL PASS vs prod,
  self-cleaning): proves manual correction → flag protects from sync overwrite →
  recompute → leaderboard, clear-flag → feed restored → points revert, challenge
  override, fun actuals. Safety: only ever corrects a finished prediction-free
  match + a throwaway user, aborts if a snapshot boundary could be crossed,
  restores everything on exit.
- **Advisors**: pinned `search_path` on the 2 flagged migration-8 helpers
  (migration 10). Remaining security WARNs accepted (boolean RLS helpers must
  stay anon/authenticated-executable; `redistribute_entry` intentionally
  authenticated; `pg_net`-in-public + Auth MFA/leaked-password left for a
  friends' game). Performance advisors all INFO (tiny tables) — not actioned.
- **UI verified** on local dev against prod DB (cookie-injection pattern, admin +
  non-admin throwaway users, mobile 375px + desktop): all 5 admin sections render
  and function (match editor expand, filter, player picker suggests "Kylian
  Mbappé", challenge override toggles, user ban/rename buttons gated correctly),
  non-admin → `/admin` redirects to `/challenges`, no header gear for non-admins.
  **Fixed a mobile header overflow** (the new ⚙️ gear pushed the header past
  375px with a long account name) — wordmark now `min-w-0 truncate`, right
  cluster `shrink-0`. Throwaway users + the temp mint script cleaned up after
  (prod back to 3 real profiles / 4 finished matches / real points only).
- NOT in this stage: Playoff auto-open verification (post-groups), real-thirds
  annex test pin (needs group-stage end), Stage 9 backlog (separate iteration).

### Stage 7 — June 12, 2026
- Branch `stage/7-playoff-fun-redistribution` → PR → merged. 154 unit tests green
  (was 150). Migration 8 written + proven on the local stack; prod application +
  sync-function redeploy done in a follow-up session Jun 12 (see Current status).
- **Fun challenge** (`/challenges/fun`, ship-critical before the Jun 18 lock):
  autosave form over `fun_questions` (numeric input + steppers, Golden Ball/Boot
  player picker with suggestion dropdown, yes/no segmented buttons), per-question
  optimistic save with rollback (Stage 5 pattern), `saveFunAnswer` action;
  RLS/trigger enforcement verified (wrong-shape refused, post-lock immutable,
  cross-user invisible pre-lock / visible post-lock). Verified on prod data with a
  throwaway user (12 questions, picker suggests "Kylian Mbappé" for "mbap", answers
  persist across reload) — cleaned up after (prod back to 3 profiles / 2 entries /
  0 fun answers).
- **Playoff flow** (`/challenges/playoff`): Stage 5 `BracketView` fed with the real
  R32 from synced `fifa_match_number` pairings; same autosave/stale-invalidation
  mechanics (PlayoffFlow); locks at first R32 kickoff via existing challenge lock.
  ChallengeCard now links every joined challenge to its flow. Auto-open wiring
  verified end-to-end on simulated complete-groups data (flip + idempotency +
  join-before-flip refused + picks immutable post-lock).
- **Redistribution**: migration 8 (`redistribute_entry` RPC, `ko_stage_index`/
  `ko_round_start` helpers, `can_edit_bracket` round-F fix), generation-aware
  `saveBracket`, `redistribute` action, `RedistributionPanel` on the Full page once
  the playoff flip signals groups-complete (explainer, per-SPEC trade-off CTA
  "you'll earn N% of further knockout points", confirm dialog, generation editor
  with past rounds locked to real results incl. result strings, editable until the
  round starts). BracketView gained an additive `lockedSlots` prop.
- **Tests**: `scoring.redistribution.test.ts` — wrecked gen-0 + gen-1 before R16 on
  a groups+R32+R16-finished world, every total hand-computed (casual 501.8 global;
  hardcore 500.8 global + 419 hardcore board). `scripts/verify-stage7.ts` (30 checks,
  ALL PASS vs local stack) drives the same scenario through the REAL pipeline — RLS →
  `redistribute_entry` → prefill shape per hardcore flag → double/earlier/foreign
  redistribution rejected → gen-1 edit window honored → `runRecompute` →
  `leaderboard_ranked` shows 501.8 / 500.8 / 419 / playoff 113 / fun 23 → recompute
  idempotent with generations + fun answers present.
- **UI verified** on the local stack (mobile viewport, en + uk, zero console
  errors) with the verify-script users: redistribution panel badge/log/CTA/confirm
  → gen-2 created live (qf ×0.5, 16 prefill rows); gen-1 R16 pick flip persisted with
  downstream stale picks purged; playoff pick flip + invalidation persisted; fun form
  in Ukrainian with steppers + autosave. Fun re-verified against prod data (above).
- `.claude/launch.json` gained a `dev-local` config (port 3001, local-stack env) for
  future local-stack UI verification.
- NOT in this stage (per plan): admin entry of fun `correct_*` actuals + manual
  result correction (Stage 8); stage-9 item #3 copy-as-template (explicitly out of
  scope); scorers-driven fun autofill of actuals (admin manual entry is the path).

### Stage 6 — June 12, 2026
- Branch `stage/6-leaderboards-live` → PR → merged. 150 unit tests still green
  (stage adds SQL views + read-only UI; correctness proofs run against prod via script).
- **Migration 6** (`leaderboards`): `leaderboard_entry_rows` (extends Stage 3's
  `leaderboard_totals` with profiles + entry_stats), `leaderboard_ranked`
  (per-challenge global/hardcore boards, SPEC tiebreaker chain in rank() ORDER BY),
  `leaderboard_overall_ranked` (per-user sums; hardcore board = users with ≥1 hardcore
  entry), `leaderboard_snapshots.matchday_date` column + unique index,
  `write_leaderboard_snapshots(p_matchday default null)`.
  **Migration 7** (`snapshot_trigger`): `sync_log` AFTER UPDATE trigger calls the
  snapshot function on every successful fixtures/recompute run (see Decisions).
- **`scripts/verify-stage6.ts`** (16 checks, ALL PASS against prod, cleans up after
  itself): SQL order == engine compareEntries on a 5-way equal-points fixture (each
  tier decides one pair incl. registration time); snapshot idempotency (dup run = 0
  rows, auto-mode skips done matchday); rank movement vs baseline after a points
  change; hand-computed totals through the REAL recompute (casual 3/0, hardcore 6/7 —
  expectations in the script, premises guarded); hardcore board excludes casual
  entries; overall mirrors per-challenge for single-entry users; **recompute
  idempotency with real entries present (deferred Stage 3 item — points checksum
  identical across two runs)**.
- **Leaderboards UI** `/[locale]/leaderboards?c=&b=`: challenge tabs + Overall,
  Global/🔥Hardcore switch, rows = rank / ▲▼ movement (NEW badge for unseeded) /
  name / tiebreaker stat line / points; current user highlighted + pinned "your
  position" card; rows link to `/profile/[userId]`.
- **Tournament tab** `/[locale]/tournament?t=` (PUBLIC — moved to `(public)` route
  group): Groups (standings_cache tables, top-2 cut line + dashed thirds line),
  Matches (all 104 grouped by matchday night, scores/FT, pulsing live dot for
  in_play/paused, kickoff via KickoffTime in local tz), Scorers (goals/assists/pens,
  top 30), Bracket (placeholder until R32 pairings resolve; then `RealBracket` =
  Stage 5 `BracketView` in new read-only `mode="results"` with per-slot result
  strings incl. AET/pens). `BracketView` moved to `src/components/` (shared).
- **Profile pages**: shared `ProfileView` (RLS-scoped through the viewer's client) —
  per-entry rank+points chips (global & hardcore), per-rule point breakdown in SPEC
  table order, predictions-vs-results for kicked-off matches with ✓/✗, champion pick,
  redistribution badge; own page (`/profile`) adds it under the account card;
  `/profile/[userId]` is the public view (redirects to /profile for self, 404 unknown).
  Verified live: another user's not-yet-locked predictions are invisible (17 hidden),
  own always visible.
- **Stage-9 quick wins** shipped: #1 pointer cursor (globals.css base layer, verified
  computed style), #2 loading.tsx skeletons for all top-level routes + tab-bar
  `prefetch` (marked ✅ in `prompts/stage-9-improvements.md`; caching/fan-out reduction
  left open).
- **UI verified** on local dev against prod DB (mobile viewport, en + uk, zero console
  errors) with throwaway users (session-cookie injection pattern): boards, movement
  arrows after a controlled rank change, hardcore filtering, profile breakdowns, public
  tournament signed-out. Re-verified on the deployed URL post-merge; all throwaway
  users/snapshots removed (cleanup verified by count).
- DB types regenerated (`database.types.ts`: new views, matchday_date, RPC).
- NOT in this stage (per plan): Playoff + Fun flows, redistribution UI (Stage 7);
  admin area (Stage 8); fun answers display on profile becomes meaningful with Stage 7.

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
