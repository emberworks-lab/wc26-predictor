# Stage 6 — Leaderboards + live Tournament tab + profile

You are the orchestrator for Stage 6 of WC26 Predictor. Read `SPEC.md` and `STATE.md` first.
Follow the session protocol in `PLAN.md`. Branch: `stage/6-leaderboards-live` → PR → merge.

Mostly well-specified read-only UI over data Stage 3 already syncs and Stage 3's recompute
already produces — good Sonnet-subagent territory. You own the leaderboard SQL (views +
tiebreakers) and review everything that touches points.

## Deliverables

### 1. Leaderboard backend
- SQL views (or materialized views refreshed by the recompute job) per SPEC:
  - Global per-challenge: sum of outcome-level points per entry.
  - Overall global: sum across a user's challenges.
  - Hardcore per-challenge + overall: hardcore bonus points only, hardcore entries only.
- Tiebreakers in the ORDER BY exactly per SPEC (qualifiers → knockout picks → group
  outcomes → registration time) — reuse the comparator semantics from `engine/` (tested in
  Stage 2); if implemented in SQL, add a test comparing SQL order vs engine comparator on
  fixture data.
- Rank movement: snapshot table written by recompute after each matchday completes
  (`leaderboard_snapshots`); ▲▼n vs previous snapshot.

### 2. Leaderboard UI
- Tabs: challenge selector + Overall; Global / Hardcore switch (hardcore tab visible to all,
  contains only hardcore entries).
- Rows: rank, movement ▲▼, display name, points, key tiebreaker stat; current user pinned/highlighted.
- Tapping a user → their profile (respecting RLS: their predictions visible only for locked
  matches — which by now is everything locked).

### 3. Live Tournament tab (read-only, public)
- Group tables A–L from `standings_cache` (P W D L GF GA GD Pts, flag emojis, qualification cut).
- Full schedule by matchday/date with scores + status (live indicator if API gives in-play),
  kickoff in local time.
- Top scorers (+ assists if STATE.md says the API plan provides them; otherwise hide the
  column and note the cut).
- After group stage: real bracket view R32→final with results (reuse the bracket component
  from Stage 5 in read-only mode).

### 4. Profile page (predictions vs reality)
- Per joined challenge: their predictions side-by-side with real results, per-rule point
  breakdown (groups, qualifiers, knockout rounds, hardcore bonuses, fun answers, redistribution
  multiplier if any), total per leaderboard.
- Own profile always fully visible; others' only locked content (RLS does this — verify).

## Done means

- Leaderboards on the deployed URL show correct totals for at least 2 seeded test entries
  with hand-computed expected points (write the expectation in the test, not by eyeball).
- Tiebreaker order proven by a fixture where points are equal.
- Tournament tab shows real current data matching the live tournament (spot-check vs a
  public source).
- Rank movement appears after two recompute+snapshot runs.
- en + uk complete. CI green, deployed, PR merged, STATE.md updated.
