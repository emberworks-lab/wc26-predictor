/**
 * Pure planning for "copy predictions as a template across challenges"
 * (Stage 9 item 3). A user who predicted the Full Tournament can prefill the
 * Groups challenge (group matches) or, once it opens, the Playoff challenge
 * (knockout slots) with those picks — a ONE-TIME prefill, not a live link.
 *
 * These functions decide WHAT to write; the server action does the I/O on the
 * USER's JWT so RLS enforces ownership and kickoff locks (a copy can never
 * write a locked match — same validation as a normal save). Kept pure so the
 * collapse/skip rules are unit-tested without a database.
 */

import { isGroupMatchLocked } from "./derive";
import type { GroupMatchDTO, PredictionOutcome } from "./types";

/**
 * Result of the copy server action. Lives here (not in the "use server" file)
 * because a "use server" module may export only async functions — re-exporting
 * a type from it crashes the server-actions loader.
 */
export type CopyResult =
  | {
      ok: true;
      copied: number;
      skippedLocked: number;
      skippedNeedsScore: number;
      skippedMismatch: number;
    }
  | { ok: false; code: "invalid" | "locked" | "error" };

// ---------------------------------------------------------------------------
// Group-stage copy (full ↔ groups): the 72 group-match predictions
// ---------------------------------------------------------------------------

export interface SourceGroupPrediction {
  matchId: number;
  outcome: PredictionOutcome;
  homeScore: number | null;
  awayScore: number | null;
}

/** A row to upsert into the target entry's match_predictions. */
export interface GroupCopyRow {
  matchId: number;
  outcome: PredictionOutcome;
  /** Present only for a hardcore target (the trigger derives outcome from these). */
  homeScore?: number;
  awayScore?: number;
}

export interface GroupCopyPlan {
  rows: GroupCopyRow[];
  /** Source matches already kicked off in the target — never writable. */
  skippedLocked: number;
  /** Casual source → hardcore target: no scores to fill, can't write outcome-only. */
  skippedNeedsScore: number;
}

/**
 * Maps the source's group predictions onto the target entry, respecting the
 * hardcore mismatch rules:
 *   - hardcore source → casual target: scores collapse to the stored outcome.
 *   - casual source   → casual target: outcome copied as-is.
 *   - hardcore source → hardcore target: scores copied (outcome re-derived).
 *   - casual source   → hardcore target: nothing to write (a hardcore row
 *     needs a score; an outcome-only hardcore row is rejected by the trigger)
 *     — counted as skippedNeedsScore so the UI can say "add scores".
 * Locked target matches (kicked off) are skipped — RLS would refuse them too.
 */
export function planGroupCopy(
  source: readonly SourceGroupPrediction[],
  targetHardcore: boolean,
  groupMatches: readonly GroupMatchDTO[],
  now: Date,
): GroupCopyPlan {
  const matchById = new Map(groupMatches.map((m) => [m.id, m]));
  const rows: GroupCopyRow[] = [];
  let skippedLocked = 0;
  let skippedNeedsScore = 0;

  for (const pred of source) {
    const match = matchById.get(pred.matchId);
    if (!match) continue; // not a target match (shouldn't happen — same 72)
    if (isGroupMatchLocked(match, now)) {
      skippedLocked++;
      continue;
    }
    const hasScores = pred.homeScore != null && pred.awayScore != null;
    if (targetHardcore) {
      if (!hasScores) {
        skippedNeedsScore++;
        continue;
      }
      rows.push({
        matchId: pred.matchId,
        outcome: pred.outcome,
        homeScore: pred.homeScore!,
        awayScore: pred.awayScore!,
      });
    } else {
      rows.push({ matchId: pred.matchId, outcome: pred.outcome });
    }
  }

  return { rows, skippedLocked, skippedNeedsScore };
}

// ---------------------------------------------------------------------------
// Playoff copy (full → playoff): knockout R32 slots where the user's predicted
// pairing matches the real one
// ---------------------------------------------------------------------------

/** One of the user's saved Full bracket rows (winner always resolved). */
export interface PredictedBracketSlot {
  slot: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  winnerTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  aetPens: boolean | null;
}

/** A real Round-of-32 pairing from the synced bracket. */
export interface RealBracketSlot {
  slot: number;
  homeTeamId: number;
  awayTeamId: number;
  locked: boolean;
}

/** A row to upsert into the playoff entry's bracket_predictions (generation 0). */
export interface BracketCopyRow {
  slot: number;
  homeTeamId: number;
  awayTeamId: number;
  winnerTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  aetPens: boolean | null;
}

export interface PlayoffCopyPlan {
  rows: BracketCopyRow[];
  /** Predicted pairing differs from the real one — left empty per the design. */
  skippedMismatch: number;
  /** Real slot already kicked off — never writable. */
  skippedLocked: number;
  /** Casual source → hardcore target: no 90' score to copy. */
  skippedNeedsScore: number;
}

/** Unordered pair equality. */
function samePairing(a1: number, a2: number, b1: number, b2: number): boolean {
  return (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1);
}

/**
 * Copies the user's Full R32 picks onto the real Round-of-32, slot by slot,
 * only where their predicted pairing equals the real one (SPEC item 3:
 * "leave mismatched slots empty"). Scores are re-oriented to the real
 * home/away order. A casual source can't fill a hardcore target's score.
 */
export function planPlayoffCopy(
  predicted: readonly PredictedBracketSlot[],
  real: readonly RealBracketSlot[],
  targetHardcore: boolean,
): PlayoffCopyPlan {
  const predBySlot = new Map(predicted.map((p) => [p.slot, p]));
  const rows: BracketCopyRow[] = [];
  let skippedMismatch = 0;
  let skippedLocked = 0;
  let skippedNeedsScore = 0;

  for (const r of real) {
    const p = predBySlot.get(r.slot);
    if (!p || p.homeTeamId == null || p.awayTeamId == null) continue;
    if (r.locked) {
      skippedLocked++;
      continue;
    }
    if (!samePairing(p.homeTeamId, p.awayTeamId, r.homeTeamId, r.awayTeamId)) {
      skippedMismatch++;
      continue;
    }
    if (targetHardcore) {
      if (p.homeScore == null || p.awayScore == null) {
        skippedNeedsScore++;
        continue;
      }
      // Re-orient the predicted score to the real home/away order.
      const flipped = p.homeTeamId !== r.homeTeamId;
      rows.push({
        slot: r.slot,
        homeTeamId: r.homeTeamId,
        awayTeamId: r.awayTeamId,
        winnerTeamId: p.winnerTeamId,
        homeScore: flipped ? p.awayScore : p.homeScore,
        awayScore: flipped ? p.homeScore : p.awayScore,
        aetPens: p.aetPens,
      });
    } else {
      rows.push({
        slot: r.slot,
        homeTeamId: r.homeTeamId,
        awayTeamId: r.awayTeamId,
        winnerTeamId: p.winnerTeamId,
        homeScore: null,
        awayScore: null,
        aetPens: p.aetPens,
      });
    }
  }

  return { rows, skippedMismatch, skippedLocked, skippedNeedsScore };
}
