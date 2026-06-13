import { getTranslations } from "next-intl/server";

import FunAnswersForm, {
  type AdminFunQuestionDTO,
} from "@/app/[locale]/(app)/admin/fun/FunAnswersForm";
import { buildPlayerSuggestions } from "@/lib/predictions/funSuggestions";
import { createClient } from "@/lib/supabase/server";

/**
 * Post-tournament actuals for the fun challenge (SPEC admin area). Pick
 * questions use the SAME suggestion list as the user form — fun pick scoring
 * is an exact string match, so actuals must be entered with the suggestion
 * spelling (e.g. "Kylian Mbappé").
 */
export default async function AdminFunPage() {
  const t = await getTranslations("Admin.fun");
  const supabase = await createClient();

  const [{ data: questions }, players] = await Promise.all([
    supabase
      .from("fun_questions")
      .select("id, key, qtype, max_pts, tolerance, correct_numeric, correct_text, correct_bool, sort_order")
      .order("sort_order"),
    buildPlayerSuggestions(supabase),
  ]);

  const dtos: AdminFunQuestionDTO[] = (questions ?? []).map((q) => ({
    id: q.id,
    key: q.key,
    qtype: q.qtype,
    maxPts: q.max_pts,
    tolerance: q.tolerance != null ? Number(q.tolerance) : null,
    correctNumeric: q.correct_numeric != null ? Number(q.correct_numeric) : null,
    correctText: q.correct_text,
    correctBool: q.correct_bool,
  }));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-muted">{t("hint")}</p>
      <FunAnswersForm questions={dtos} players={players} />
    </div>
  );
}
