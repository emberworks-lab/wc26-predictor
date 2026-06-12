# Stage 2 — Domain engines (pure, unit-tested, correctness-critical)

You are the orchestrator for Stage 2 of WC26 Predictor. Read `SPEC.md` and `STATE.md` first.
Follow the session protocol in `PLAN.md`. Branch: `stage/2-engines` → PR → merge.

**This is the most correctness-critical stage of the project. Do NOT delegate the engine
logic to subagents — design and implement it at orchestrator level. Subagents (Sonnet) may
only write ADDITIONAL test cases for engines you already implemented, and only after you
hand them an exact spec of expected behavior.**

Everything in this stage is pure TypeScript in `src/engine/` — no I/O, no Supabase, no React.
Each module exports pure functions over plain data types defined in `src/engine/types.ts`
(team ids, match results, predictions). DB row ↔ engine type adapters come in Stage 3/5.

## Deliverables (each = module + exhaustive Vitest suite)

### 1. `groupTable.ts` — group standings + tiebreakers
`computeGroupTable(matches: PlayedMatch[], teams: TeamId[]): GroupTableRow[]`
FIFA order per SPEC: points → GD → goals scored → head-to-head among tied teams
(points, GD, goals, applied recursively to the tied subset) → fair play points →
deterministic fallback (FIFA ranking seed). Works on partial results (mid-group state) —
used live for both real standings and users' predicted tables.
Tests: 2-way and 3-way ties resolved by each successive criterion; full head-to-head
sub-table case; partial-group state.

### 2. `bestThirds.ts` — best 8 third-placed teams
`rankThirds(thirds: GroupTableRow[]): { qualified: TeamId[]; ranking: ... }`
Criteria per SPEC. Tests: ties on points/GD; exactly 8 of 12 qualify.

### 3. `r32Mapping.ts` — FIFA Round-of-32 bracket mapping ⚠️ hardest piece
`buildR32(winners: ByGroup, runnersUp: ByGroup, thirds: QualifiedThirds): R32Match[]`
- Encode the FULL official FIFA 2026 bracket: which R32 slot each group winner/runner-up
  goes to, and the official annex assigning third-placed teams to specific R32 slots based
  on WHICH 8 groups they come from (C(12,8) = 495 combinations).
- Source the official table from FIFA's WC2026 regulations / official bracket annex
  (WebSearch/WebFetch the FIFA regulations PDF or a reliable secondary source; cross-check
  two sources). Encode it as a data table (`r32annex.data.ts`) keyed by the sorted
  8-group combination, plus a lookup function. If the full 495-row table is genuinely
  unobtainable, STOP and report — do not invent it.
- Tests: at least 10 distinct combinations verified against the source, including the
  actual real-tournament combination once known; structural invariants over ALL 495 rows
  (every row assigns exactly 8 distinct groups to 8 distinct slots; assignments respect
  FIFA's allowed-slot constraints; no team meets its own group's winner where the rules
  forbid it).

### 4. `knockoutSim.ts` — bracket progression
Given R32 matches + per-match winner picks, produce R16/QF/SF/final/3rd-place pairings per
the official bracket graph. Used to walk a user's predicted bracket. Tests: full walk-through.

### 5. `scoring.ts` — points engine
`computePoints(input: { results, groupPredictions, bracketPredictions (versioned by
redistribution), funAnswers, entryMeta }): PointsRow[]`
Implements the ENTIRE SPEC scoring table: group outcomes, exact-order bonus, qualifier
bonuses, knockout reach points, champion, AET/pens flag bonus, hardcore layer (exact score,
GD, penalties pick), fun questions (closeness formula), redistribution multipliers applied
from the redistributed stage onward to knockout rows of the active bracket version.
**Idempotent & total**: same input → same output; missing/partial results → partial points.
Tests: every scoring rule individually + combined scenarios + a hardcore-derives-outcome
case + a redistribution case (points before keep full value, after get ×0.7/×0.6/...).

### 6. `locks.ts` — deadline/lock logic
`isMatchLocked(match, now)`, `isChallengeLocked(challenge, now)`, `canEditPrediction(...)`,
`fullChallengeLockTime(matches)` (= kickoff of last matchday-1 match), playoff open/lock
rules. Pure over injected `now`. Tests: boundary conditions (exactly at kickoff), late
joiner, manual admin override flag.

### 7. Tiebreaker for leaderboards
`compareEntries(a, b): number` implementing SPEC tiebreaker chain. Tests included.

## Done means

- `pnpm test` green with meaningful coverage of every rule in SPEC's scoring table —
  cross-check the suite against SPEC line by line and say so in the report.
- No I/O imports anywhere under `src/engine/`.
- Annex source URL(s) documented in `r32Mapping.ts` header comment and STATE.md.
- PR merged, CI green, STATE.md updated.
