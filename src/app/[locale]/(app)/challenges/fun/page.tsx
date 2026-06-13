import { redirect } from "@/i18n/navigation";
import { buildPlayerSuggestions } from "@/lib/predictions/funSuggestions";
import type { ChallengeDTO } from "@/lib/predictions/types";
import { createClient } from "@/lib/supabase/server";

import FunForm, { type FunAnswerDTO, type FunQuestionDTO } from "./FunForm";

/**
 * Fun challenge: 12 one-off questions over `fun_questions`, answers in
 * `fun_answers` (RLS-locked at the shared Full/Groups/Fun deadline).
 * Golden Ball/Boot suggestions = static star list (filtered to qualified
 * teams) merged with whatever `scorers_cache` already knows; free text
 * always allowed.
 */
export default async function FunPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: challenge } = await supabase
    .from("challenges")
    .select("id, kind, opens_at, locks_at, manual_override")
    .eq("kind", "fun")
    .single();
  if (!challenge) redirect({ href: "/challenges", locale });

  const { data: entry } = await supabase
    .from("challenge_entries")
    .select("id")
    .eq("user_id", user!.id)
    .eq("challenge_id", challenge!.id)
    .maybeSingle();
  if (!entry) redirect({ href: "/challenges", locale });

  const [{ data: questions }, { data: answers }, players] = await Promise.all([
    supabase
      .from("fun_questions")
      .select("id, key, qtype, max_pts, tolerance, sort_order")
      .order("sort_order"),
    supabase
      .from("fun_answers")
      .select("question_id, numeric_answer, text_answer, bool_answer")
      .eq("entry_id", entry!.id),
    buildPlayerSuggestions(supabase),
  ]);

  const questionDTOs: FunQuestionDTO[] = (questions ?? []).map((q) => ({
    id: q.id,
    key: q.key,
    qtype: q.qtype,
    maxPts: q.max_pts,
  }));

  const answerDTOs: FunAnswerDTO[] = (answers ?? []).map((a) => ({
    questionId: a.question_id,
    numeric: a.numeric_answer != null ? Number(a.numeric_answer) : null,
    text: a.text_answer,
    bool: a.bool_answer,
  }));

  const challengeDTO: ChallengeDTO = {
    id: challenge!.id,
    kind: challenge!.kind,
    opensAt: challenge!.opens_at,
    locksAt: challenge!.locks_at,
    manualOverride: challenge!.manual_override,
  };

  return (
    <FunForm
      entryId={entry!.id}
      challenge={challengeDTO}
      questions={questionDTOs}
      initialAnswers={answerDTOs}
      players={players}
      serverNow={new Date().toISOString()}
    />
  );
}
