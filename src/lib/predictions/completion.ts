/**
 * Challenge completion summary for the challenges-home cards (Stage 9 item 4).
 *
 * The old card showed a raw "70 / 72 picks" that read as a bug: 72 counts the
 * group matches that kicked off BEFORE the user joined (permanently locked, can
 * never be predicted). This computes an honest "done / available" where the
 * denominator excludes matches the user can no longer touch, plus the bracket
 * and fun completion the card surfaces alongside it.
 *
 * Pure — operates on already-loaded rows so it stays trivially testable and
 * the home page does the I/O.
 */

import { FINAL_MATCH } from "@/engine/knockoutSim";
import { isGroupMatchLocked } from "@/lib/predictions/derive";
import type { GroupMatchDTO } from "@/lib/predictions/types";

export interface GroupCompletion {
  /** Every group match in the tournament (72). */
  total: number;
  /** Kicked off before the user predicted them — can never be filled. */
  locked: number;
  /** Predictable now, plus the ones already predicted (the real denominator). */
  available: number;
  /** Valid predictions among the available set. */
  done: number;
  complete: boolean;
}

export interface BracketCompletion {
  /** Knockout matches (R32→final, incl. third place) = 32. */
  total: number;
  done: number;
  complete: boolean;
  championName: string | null;
}

export interface FunCompletion {
  total: number;
  done: number;
  complete: boolean;
}

export interface EntryCompletion {
  group?: GroupCompletion;
  bracket?: BracketCompletion;
  fun?: FunCompletion;
}

const KNOCKOUT_MATCH_COUNT = 32;

/**
 * @param predictedValidIds match ids the entry has a SCORING-valid prediction
 *        for (casual: any stored row; hardcore: a row with scores).
 */
export function computeGroupCompletion(
  matches: readonly GroupMatchDTO[],
  predictedValidIds: ReadonlySet<number>,
  now: Date,
): GroupCompletion {
  let locked = 0;
  let available = 0;
  let done = 0;
  for (const m of matches) {
    const predicted = predictedValidIds.has(m.id);
    if (predicted) {
      done++;
      available++;
    } else if (isGroupMatchLocked(m, now)) {
      locked++;
    } else {
      available++;
    }
  }
  return {
    total: matches.length,
    locked,
    available,
    done,
    complete: available > 0 && done === available,
  };
}

/**
 * Bracket completion from saved generation-0 rows. We count persisted picks
 * rather than re-deriving the engine bracket — the card answers "did my final /
 * third-place picks save?", and saved rows are exactly what scoring reads.
 */
export function computeBracketCompletion(
  bracketRows: ReadonlyArray<{ slot: number; winnerTeamId: number | null }>,
  teamNameById: ReadonlyMap<number, string>,
): BracketCompletion {
  const withWinner = bracketRows.filter((b) => b.winnerTeamId != null);
  const finalRow = bracketRows.find((b) => b.slot === FINAL_MATCH && b.winnerTeamId != null);
  const championName = finalRow ? (teamNameById.get(finalRow.winnerTeamId!) ?? null) : null;
  return {
    total: KNOCKOUT_MATCH_COUNT,
    done: withWinner.length,
    complete: withWinner.length === KNOCKOUT_MATCH_COUNT,
    championName,
  };
}

export function computeFunCompletion(answered: number, total: number): FunCompletion {
  return { total, done: answered, complete: total > 0 && answered >= total };
}
