# Stage 5 — Prediction flows (Full + Groups challenges)

You are the orchestrator for Stage 5 of WC26 Predictor. Read `SPEC.md` and `STATE.md` first.
Follow the session protocol in `PLAN.md`. Branch: `stage/5-predictions` → PR → merge.

This is the core UX of the product. The prediction state machine is correctness-critical:
design it yourself or via one Opus subagent with your review. UI components go to Sonnet
subagents AFTER the state machine and data contracts are fixed.

## Deliverables

### 1. Group-stage prediction wizard (shared by Full + Groups challenges)
- Step through all 72 group matches, grouped by group (A→L), mobile-first:
  - Casual entry: tap W / D / L (home win / draw / away win).
  - Hardcore entry: numeric score input (fast steppers, sensible defaults), outcome derived.
- **Live predicted group table** beside/below each group's matches, computed with
  `engine/groupTable.ts` — updates as the user picks. Show qualification cut (top-2 + "3rd"
  marker).
- After all 12 groups: predicted third-place ranking via `engine/bestThirds.ts`, show which
  8 qualify; then their personal R32 bracket built with `engine/r32Mapping.ts`.
- Already-kicked-off matches: rendered locked (real result shown if finished, "locked — 0 pts"
  badge for the user's missing prediction). Lock check server-side on save (RLS +
  server action validation via `engine/locks.ts`); client state mirrors it.
- Progress indicator (x/72), resume where you left off, save per-match or per-group
  (autosave on change; optimistic UI with rollback on RLS rejection).

### 2. Knockout picker (Full challenge; reused by Playoff in Stage 7)
- Renders the user's personal R32 bracket (from their predicted groups) as a tappable
  bracket, mobile-first (horizontal scroll per round or stacked rounds — pick the cleaner UX).
- Casual: tap winner per match; optional "after extra time / penalties" flag.
- Hardcore: 90' score per match; if draw → must pick who advances. Winner derived.
- Progression via `engine/knockoutSim.ts` — changing an early pick invalidates downstream
  picks of eliminated teams (visual warning + auto-clear, never silently keep a team the
  user eliminated).
- Champion + third-place match included. Summary screen: full predicted path to the title.

### 3. Groups challenge
Same wizard, scoped to the group stage only (stops after thirds resolution screen).

### 4. Persistence contract
- Casual: `match_predictions.outcome`; hardcore: scores (+ derived outcome column, written
  server-side or via generated column so the global leaderboard never trusts the client).
- Bracket picks in `bracket_predictions` keyed by bracket version (generation 0 now;
  redistribution generations come in Stage 7 — keep the column).
- Hardcore toggle allowed until challenge lock: flipping casual→hardcore keeps outcomes,
  prompts for scores progressively; hardcore→casual collapses scores to outcomes (warn,
  irreversible after lock).

### 5. Edit-until-lock UX
Countdown banner ("predictions lock in 2d 4h"), per-match lock icons, post-lock read-only
view of own predictions.

## Done means

- A test user on the deployed URL can: join Full (hardcore and casual paths), fill 72 group
  picks with live tables, see thirds + personal R32, complete a knockout bracket to a
  champion, sign out/in and find everything persisted.
- Attempting to write a prediction for a kicked-off match via direct API/SQL-as-user is
  rejected by RLS (prove it with a test script using anon key + user JWT — keep it in
  `scripts/rls-check.ts`).
- Groups challenge flow works end to end.
- All strings in en + uk. CI green, deployed, PR merged, STATE.md updated.
