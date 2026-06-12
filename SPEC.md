# WC26 Predictor — Canonical Product Spec

> **This file is the single source of truth for domain rules.** Every build session reads this
> before writing code. If a session must deviate, it records the deviation in `STATE.md` and
> updates this file in the same commit.

## What we're building

A production web app where friends predict the FIFA World Cup 2026. Open registration,
mobile-first, dark "stadium night" theme with gold accents, EN + UK locales.
Live URL on Vercel, data + auth on Supabase, real tournament data synced from a football API.

**The tournament started June 11, 2026.** Ship a correct core fast. Scope-cut order if needed:
fun challenge → assists/scorers stats → rank movement indicators → admin niceties.
Never cut: auth, Full challenge, scoring correctness, deadlines/locking, leaderboards, data sync.

## Tournament structure (WC 2026)

- 48 teams, 12 groups (A–L) of 4. 72 group matches.
- Top 2 of each group + **8 best third-placed teams** advance to a **Round of 32**.
- Knockout: R32 (16 matches) → R16 (8) → QF (4) → SF (2) → third-place match → Final. 104 matches total, June 11 – July 19, 2026.
- Third-place teams are assigned to specific R32 slots via FIFA's official annex
  (one row per combination of 8 qualifying groups out of 12 — C(12,8) = 495 combinations).
  This mapping MUST be a pure, unit-tested function backed by the official FIFA table.
- Group tiebreakers (in order): points → goal difference → goals scored → head-to-head
  (points, GD, goals among tied teams) → fair play points → drawing of lots (we model as
  deterministic fallback: FIFA ranking seed, documented).
- "Best 8 thirds" ranking: points → GD → goals scored → fair play → drawing of lots (same fallback).

## Challenges (4)

Every challenge has ONE version with a per-user **hardcore switch**:
- Hardcore ON: user predicts exact scores. Outcome predictions are *derived* from scorelines.
- Hardcore OFF: outcome-only (W/D/L in groups; winner in knockout).
- Hardcore users appear in the global leaderboards via derived outcome points AND in a
  separate hardcore leaderboard ranked by score-prediction bonus points.
- The hardcore switch is per challenge entry, chosen at join time; may be toggled until the
  challenge locks, never after.

### 1. Full Tournament
- User steps through all 72 group matches (W/D/L or exact score).
- App computes their predicted group tables live (using the real tiebreaker engine),
  resolves their predicted 8 third-place qualifiers, builds their personal R32 bracket via
  the official FIFA mapping, then they pick through the knockout to the champion
  (+ third-place match).
- Knockout, outcome-only users: pick a winner per match; may optionally flag
  "decided after extra time / penalties" (small bonus if right).
- Knockout, hardcore users: give a 90-minute score; if it's a draw they must also pick who
  advances (penalties/ET).

### 2. Groups Only
- Predict all 12 group tables, match-by-match (reuses the Full group flow). Stops after groups.

### 3. Playoff Only
- Locked until the group stage finishes. Then opens with the REAL qualified 32 teams and the
  real bracket. Same outcome/hardcore knockout mechanics as Full. Deadline: kickoff of the
  first R32 match.

### 4. Fun / Bonus
One-off questions, same deadline as Full. Question set (12):

| # | Question | Type | Scoring |
|---|---|---|---|
| 1 | Total goals in the tournament | numeric | closeness |
| 2 | Total red cards | numeric | closeness |
| 3 | Number of penalty shootouts | numeric | closeness |
| 4 | Number of in-game penalties scored | numeric | closeness |
| 5 | Golden Ball winner | pick (player) | exact |
| 6 | Golden Boot winner | pick (player) | exact |
| 7 | Golden Boot goal count | numeric | closeness |
| 8 | Will there be a hat-trick? | yes/no | exact |
| 9 | Fastest goal (minute, 1–90+) | numeric | closeness |
| 10 | Total own goals | numeric | closeness |
| 11 | Will a host nation (USA/MEX/CAN) reach the QF? | yes/no | exact |
| 12 | Highest-scoring single match (total goals in it) | numeric | closeness |

Numeric closeness scoring: `points = max(0, MAX_PTS * (1 - |guess - actual| / tolerance))`,
rounded; per-question `MAX_PTS` and `tolerance` live in the DB (`fun_questions` table) so they
are tunable without redeploy. Defaults: MAX_PTS 10, tolerance scaled to the metric
(e.g. total goals tolerance 30, red cards 6, fastest goal 60s window → tolerance 2 min).
Picks: exact = 15 pts, else 0. Yes/no: 5 pts.

## Deadlines & locking (anti-cheat — CRITICAL)

- **Full, Groups, Fun**: open for joining/editing until **kickoff of the LAST first-round
  group match** (end of matchday 1). HOWEVER any individual match that has already kicked
  off is locked for everyone — late joiners simply score 0 on those matches.
- **Playoff**: opens when the group stage is complete (last group match finished),
  locks at the first R32 kickoff.
- Knockout picks inside Full: editable until the Full challenge lock (same matchday-1
  deadline), because the predicted bracket derives from predicted groups.
- All locking is enforced **server-side** (RLS policies + API validation against
  `matches.kickoff_utc` / challenge lock timestamps). Client-side disabling is cosmetic only.
- All times stored UTC; UI shows local time (default Europe/Kyiv).
- RLS guarantee: a user can never read another user's predictions for a match/challenge that
  is not yet locked, and can never write to a locked prediction.

## Knockout redistribution (Full challenge only)

After the group stage a Full user may **redistribute**: re-pick their knockout bracket using
the real qualified 32 teams, at a cost — a multiplier on ALL knockout points earned from the
redistribution stage onward:

| Redistributed before | Multiplier |
|---|---|
| R32 | 0.7 |
| R16 | 0.6 |
| QF | 0.5 |
| SF | 0.4 |
| Final | 0.3 |

- One redistribution per stage max. Multiplier never increases. Applies from the stage of
  redistribution through the final. Points earned before redistribution keep full value.
- UI must state the trade-off explicitly: "you'll earn X% of further knockout points".

## Scoring table (v1 — document in README + in-app Rules page)

### Group stage (global leaderboard)
| Event | Points |
|---|---|
| Correct match outcome (W/D/L) | 3 |
| Exact final group order (all 4 positions) | 10 per group |
| Correctly predicted top-2 qualifier (team + advancing) | 3 per team |
| Correctly predicted third-place qualifier (among the 8) | 4 per team |

### Knockout (global leaderboard) — per real team the user predicted to reach that round
| Predicted team reaches | Points |
|---|---|
| R16 | 4 |
| QF | 6 |
| SF | 8 |
| Final | 12 |
| Champion | 20 |
| Third-place match winner | 6 |
| Correct AET/pens flag on a correctly picked match (outcome-only users) | +1 |

A predicted team that didn't reach a match scores 0 for it (redistribution exists for this).
Redistribution multiplier applies to knockout rows from the redistributed stage onward.

### Hardcore layer (hardcore leaderboard ONLY)
| Event | Points |
|---|---|
| Exact score (group match or knockout 90') | 5 |
| Correct goal difference, non-draw (e.g. predicted 2:0, real 3:1) | 2 |
| Correct penalties/ET advance pick after a predicted draw | 2 |

### Leaderboard tiebreakers (in order)
1. More correctly predicted qualifiers (top-2 + thirds)
2. More correct knockout advancing picks
3. More correct group match outcomes
4. Earlier registration (created_at)

### Recompute rule
Points are **recomputed idempotently from raw results** on every sync — never incrementally
mutated. One pure function: `(all results, all predictions, redistribution log) → points rows`.

## Leaderboards

- Per-challenge boards + one combined "overall" board (sum across challenges).
- Hardcore boards: per-challenge + combined, ranked by hardcore bonus points.
- Rank movement (▲▼ since last matchday). User profile page: their predictions vs reality.

## Live data tab ("Tournament")

Read-only real data: group tables (P/W/D/L/GF/GA/GD/Pts), full schedule with scores,
top scorers, top assists (if API provides), real knockout bracket after groups.

### Sync jobs (Supabase pg_cron + Edge Functions — NOT Vercel crons)
- Every 15 min during match windows / hourly otherwise: fixtures & results.
- After each finished match: recompute standings cache + ALL user points + leaderboards.
- Cache aggressively in Postgres; respect API rate limits.

## Auth & users

- Email magic link + Google OAuth (Supabase Auth). Open registration, no invites.
- Abuse protection: rate limit signups, unique display names (case-insensitive),
  admin can ban/remove users.
- Roles: `user`, `admin` (admin = Anton, set manually in DB).

## Admin area

Gated by role: force data sync, manually correct a result, view job logs,
open/close challenges manually (override), ban/remove user.

## Stack decisions (fixed)

- Next.js (App Router, TypeScript) on Vercel. pnpm. Tailwind CSS.
- Supabase: Postgres, Auth, RLS, Edge Functions, pg_cron.
- i18n: next-intl, locales `en` (default) + `uk`, all strings in locale files from day one,
  language switcher in header, persist choice, auto-detect browser locale on first visit.
- Flag emojis for teams. Dark stadium-night theme, gold accents, mobile-first.
- Unit tests: Vitest. CI: GitHub Actions (lint + typecheck + test on PR).
  Deploy: Vercel GitHub integration (auto-deploy on push to main).
- Football data API: see `STATE.md` → "Data API" (decided in Stage 0 research).

## Quality bar (definition of done)

- Unit tests: third-place R32 mapping (multiple annex combinations), group tiebreakers,
  best-8-thirds ranking, points calculation incl. hardcore bonuses + redistribution
  multipliers, deadline/lock logic.
- RLS tested: cannot read others' unlocked predictions; cannot edit locked predictions.
- Seeded with real WC2026 teams, groups, full schedule from the API.
- CI green, deployed, migrations applied, cron jobs scheduled + verified with a manual run.
- Final report: live URL, admin setup, scoring table, what's stubbed/cut, API quota status,
  local dev guide.
