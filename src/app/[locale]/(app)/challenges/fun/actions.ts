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

export async function saveFunAnswer(input: {
  entryId: string;
  questionId: number;
  numericAnswer?: number;
  textAnswer?: string;
  boolAnswer?: boolean;
}): Promise<SaveResult> {
  const { entryId, questionId, numericAnswer, textAnswer, boolAnswer } = input;

  const provided = [numericAnswer, textAnswer, boolAnswer].filter((v) => v !== undefined);
  if (
    !entryId ||
    !Number.isInteger(questionId) ||
    provided.length !== 1 ||
    (numericAnswer !== undefined &&
      (!Number.isFinite(numericAnswer) || numericAnswer < 0 || numericAnswer > MAX_NUMERIC)) ||
    (textAnswer !== undefined &&
      (textAnswer.trim().length === 0 || textAnswer.length > MAX_TEXT))
  ) {
    return { ok: false, code: "invalid" };
  }

  const supabase = await createClient();
  const state = await entryState(supabase, entryId);
  if (state === null || state.kind !== "fun") return { ok: false, code: "invalid" };
  if (state.locked) return { ok: false, code: "locked" };

  const { error } = await supabase.from("fun_answers").upsert(
    {
      entry_id: entryId,
      question_id: questionId,
      numeric_answer: numericAnswer ?? null,
      text_answer: textAnswer?.trim() ?? null,
      bool_answer: boolAnswer ?? null,
    },
    { onConflict: "entry_id,question_id" },
  );
  if (error) return { ok: false, code: failureCode(error.code) };
  return { ok: true };
}
