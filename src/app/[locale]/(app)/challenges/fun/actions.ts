"use server";

import { entryState, failureCode, type SaveResult } from "@/lib/predictions/entryLock";
import { createClient } from "@/lib/supabase/server";

/**
 * Fun-challenge answer autosave. RLS (`fun_answers_*` policies +
 * `enforce_fun_answer` trigger) is the enforcement point — challenge lock,
 * ownership and answer-shape-vs-question-type are all checked server-side in
 * the DB; this action adds the engine/locks pre-check for a clean "locked"
 * code and validates basic shape so garbage never reaches PostgREST.
 */

const MAX_NUMERIC = 9999;
const MAX_TEXT = 120;
const MAX_RANGE_INDEX = 19;

/**
 * Fun-answer autosave. Three answer channels, exactly one per call:
 *  - ranged numeric (Stage 9 item 23): `rangeIndex` (casual pick) + optional
 *    `exact` (hardcore exact-number bonus → numeric_answer)
 *  - pick: `textAnswer`
 *  - yes/no: `boolAnswer`
 * RLS + the enforce_fun_answer trigger are the enforcement point (challenge
 * lock, submit lock, ownership, shape-vs-question-type, valid range_index).
 */
export async function saveFunAnswer(input: {
  entryId: string;
  questionId: number;
  rangeIndex?: number;
  exact?: number;
  textAnswer?: string;
  boolAnswer?: boolean;
}): Promise<SaveResult> {
  const { entryId, questionId, rangeIndex, exact, textAnswer, boolAnswer } = input;

  // Exactly one answer channel (exact only rides along with rangeIndex).
  const channels = [rangeIndex, textAnswer, boolAnswer].filter((v) => v !== undefined);
  const validInt = (v: number | undefined, max: number) =>
    v === undefined || (Number.isInteger(v) && v >= 0 && v <= max);
  if (
    !entryId ||
    !Number.isInteger(questionId) ||
    channels.length !== 1 ||
    (exact !== undefined && rangeIndex === undefined) ||
    !validInt(rangeIndex, MAX_RANGE_INDEX) ||
    !validInt(exact, MAX_NUMERIC) ||
    (textAnswer !== undefined &&
      (textAnswer.trim().length === 0 || textAnswer.length > MAX_TEXT))
  ) {
    return { ok: false, code: "invalid" };
  }

  const supabase = await createClient();
  const state = await entryState(supabase, entryId);
  if (state === null || state.kind !== "fun") return { ok: false, code: "invalid" };
  if (state.locked || state.submitted) return { ok: false, code: "locked" };

  const { error } = await supabase.from("fun_answers").upsert(
    {
      entry_id: entryId,
      question_id: questionId,
      range_index: rangeIndex ?? null,
      numeric_answer: rangeIndex !== undefined ? (exact ?? null) : null,
      text_answer: textAnswer?.trim() ?? null,
      bool_answer: boolAnswer ?? null,
    },
    { onConflict: "entry_id,question_id" },
  );
  if (error) return { ok: false, code: failureCode(error.code) };
  return { ok: true };
}
