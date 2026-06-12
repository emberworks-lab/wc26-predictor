# Stage 7 — Playoff challenge, Fun challenge, redistribution mechanic

You are the orchestrator for Stage 7 of WC26 Predictor. Read `SPEC.md` and `STATE.md` first.
Follow the session protocol in `PLAN.md`. Branch: `stage/7-playoff-fun-redistribution` → PR → merge.

## Deliverables

### 1. Playoff challenge
- Stays "opens after the group stage" (card state from Stage 4) until the sync job flips it
  open with the REAL 32 qualified teams and real R32 bracket (Stage 3 already flips the
  challenge row; verify that wiring end-to-end now, fix if stubbed).
- Reuse the Stage 5 knockout picker 1:1 (real bracket as input instead of personal bracket).
  Same casual/hardcore mechanics. Locks at first R32 kickoff (already in `engine/locks.ts`).
- If the group stage hasn't finished at build time (likely — check the date), test by
  simulating: a fixture dataset + a staging toggle (admin-only "simulate groups complete"
  against a Supabase branch DB or local stack — do NOT fake data in production tables).

### 2. Fun challenge
- Form over `fun_questions` (numeric steppers, player search picker for Golden Ball/Boot —
  a simple text+suggestions input over a `players` list from the scorers sync or a static
  squad list; static fallback is fine, note it), yes/no toggles.
- Same lock as Full; editable until lock; answers in `fun_answers` under RLS like other
  predictions.
- Scoring already lives in `engine/scoring.ts` (Stage 2) and recompute (Stage 3); admin
  enters `correct_answer` values post-tournament (or sync fills what it can: total goals,
  red cards — wire what the API provides, leave the rest to admin manual entry in Stage 8).

### 3. Redistribution (Full challenge) — correctness-critical, implement yourself
- Server action `redistribute(entry, stage)`: validates (group stage done; stage not started;
  no prior redistribution at this stage; entry in Full), creates a NEW bracket generation
  prefilled with the real bracket state so far, records `{stage, multiplier}` in the entry's
  redistribution log per SPEC's table (0.7 → 0.3).
- New generation's picks for already-played knockout matches are fixed to real results
  (you can't re-predict the past); only future rounds are pickable.
- UI: on the user's Full bracket after groups — "Redistribute" CTA showing the explicit
  trade-off ("you'll earn 70% of further knockout points"), confirmation dialog, badge on
  their entry + profile breakdown showing the multiplier.
- Scoring engine (Stage 2) already supports generations + multipliers — wire real data
  through and add an integration test: entry with gen-0 wrecked bracket + gen-1
  redistribution at R16 → hand-computed expected totals.

## Orchestration

Redistribution server action + generation logic: orchestrator-level.
Fun form UI, playoff UI reuse, locale strings: Sonnet subagents.

## Done means

- Fun challenge fully playable on the deployed URL; answers persist; lock enforced
  server-side.
- Playoff flow proven on simulated complete-groups data (branch DB), wiring to the real
  flip verified by code review + a dry-run log.
- Redistribution integration test green with hand-computed numbers; UI shows correct
  multiplier %; double-redistribution at same stage rejected server-side.
- en + uk complete. CI green, deployed, PR merged, STATE.md updated.
