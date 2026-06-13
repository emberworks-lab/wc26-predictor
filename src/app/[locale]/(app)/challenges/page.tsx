import { getTranslations } from "next-intl/server";

import {
  computeBracketCompletion,
  computeFunCompletion,
  computeGroupCompletion,
  type EntryCompletion,
} from "@/lib/predictions/completion";
import type { GroupId } from "@/engine/types";
import type { GroupMatchDTO } from "@/lib/predictions/types";
import { createClient } from "@/lib/supabase/server";

import ChallengeCard, { type ChallengeRow, type EntryRow } from "./ChallengeCard";

const KIND_ORDER: Array<ChallengeRow["kind"]> = ["full", "groups", "playoff", "fun"];

export default async function ChallengesPage() {
  const t = await getTranslations("ChallengesHome");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: challenges }, { data: entries }] = await Promise.all([
    supabase.from("challenges").select("id, kind, opens_at, locks_at, manual_override"),
    supabase
      .from("challenge_entries")
      .select("id, challenge_id, hardcore, submitted_at")
      .eq("user_id", user!.id),
  ]);

  const sorted = (challenges ?? []).sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const kindById = new Map((challenges ?? []).map((c) => [c.id, c.kind]));
  const entryList = entries ?? [];
  const entryByChallenge = new Map(
    entryList.map((e) => [e.challenge_id, e as EntryRow & { challenge_id: number }]),
  );

  // --- completion summaries (Stage 9 item 4) ---------------------------------
  const fullEntry = entryList.find((e) => kindById.get(e.challenge_id) === "full");
  const groupsEntry = entryList.find((e) => kindById.get(e.challenge_id) === "groups");
  const funEntry = entryList.find((e) => kindById.get(e.challenge_id) === "fun");
  const groupEntryIds = [fullEntry, groupsEntry].filter(Boolean).map((e) => e!.id);

  const [
    { data: groupMatches },
    { data: groupPreds },
    { data: bracketRows },
    { data: teams },
    { data: funQuestions },
    { data: funAnswers },
  ] = await Promise.all([
    groupEntryIds.length
      ? supabase
          .from("matches")
          .select("id, group_code, matchday, kickoff_utc, status, home_team_id, away_team_id")
          .eq("stage", "group")
          .order("kickoff_utc")
      : Promise.resolve({ data: [] as never[] }),
    groupEntryIds.length
      ? supabase
          .from("match_predictions")
          .select("entry_id, match_id, home_score")
          .in("entry_id", groupEntryIds)
      : Promise.resolve({ data: [] as never[] }),
    fullEntry
      ? supabase
          .from("bracket_predictions")
          .select("slot, winner_team_id")
          .eq("entry_id", fullEntry.id)
          .eq("generation", 0)
      : Promise.resolve({ data: [] as never[] }),
    fullEntry
      ? supabase.from("teams").select("id, name")
      : Promise.resolve({ data: [] as never[] }),
    funEntry
      ? supabase.from("fun_questions").select("id")
      : Promise.resolve({ data: [] as never[] }),
    funEntry
      ? supabase.from("fun_answers").select("question_id").eq("entry_id", funEntry.id)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const now = new Date();
  const matchDTOs: GroupMatchDTO[] = (groupMatches ?? [])
    .filter((m) => m.home_team_id != null && m.away_team_id != null)
    .map((m) => ({
      id: m.id,
      group: m.group_code as GroupId,
      matchday: m.matchday,
      kickoffUtc: m.kickoff_utc,
      status: m.status,
      homeTeamId: m.home_team_id!,
      awayTeamId: m.away_team_id!,
      homeScore: null,
      awayScore: null,
    }));

  /** Match ids with a scoring-valid prediction for this entry. */
  const validPredsFor = (entryId: string, hardcore: boolean): Set<number> => {
    const set = new Set<number>();
    for (const p of groupPreds ?? []) {
      if (p.entry_id !== entryId) continue;
      if (hardcore && p.home_score == null) continue; // scoreless hardcore = not done
      set.add(p.match_id);
    }
    return set;
  };

  const completionByChallenge = new Map<number, EntryCompletion>();
  if (fullEntry) {
    const teamNameById = new Map((teams ?? []).map((tm) => [tm.id, tm.name]));
    completionByChallenge.set(fullEntry.challenge_id, {
      group: computeGroupCompletion(matchDTOs, validPredsFor(fullEntry.id, fullEntry.hardcore), now),
      bracket: computeBracketCompletion(
        (bracketRows ?? []).map((b) => ({ slot: b.slot, winnerTeamId: b.winner_team_id })),
        teamNameById,
      ),
    });
  }
  if (groupsEntry) {
    completionByChallenge.set(groupsEntry.challenge_id, {
      group: computeGroupCompletion(
        matchDTOs,
        validPredsFor(groupsEntry.id, groupsEntry.hardcore),
        now,
      ),
    });
  }
  if (funEntry) {
    completionByChallenge.set(funEntry.challenge_id, {
      fun: computeFunCompletion((funAnswers ?? []).length, (funQuestions ?? []).length),
    });
  }

  // --- copy-as-template source (Stage 9 item 3) ------------------------------
  // Offer "copy from Full" on Groups (group matches) and, once it opens,
  // Playoff (R32 picks) when the user's Full entry actually has those picks.
  const fullHasGroupPreds =
    !!fullEntry && (groupPreds ?? []).some((p) => p.entry_id === fullEntry.id);
  const fullHasR32Picks =
    !!fullEntry &&
    (bracketRows ?? []).some((b) => b.slot >= 73 && b.slot <= 88 && b.winner_team_id != null);
  const copySourceFor = (kind: ChallengeRow["kind"]): string | null => {
    if (!fullEntry) return null;
    if (kind === "groups") return fullHasGroupPreds ? fullEntry.id : null;
    if (kind === "playoff") return fullHasR32Picks ? fullEntry.id : null;
    return null;
  };

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1>
      {sorted.map((challenge) => (
        <ChallengeCard
          key={challenge.id}
          challenge={challenge}
          entry={entryByChallenge.get(challenge.id) ?? null}
          completion={completionByChallenge.get(challenge.id) ?? null}
          copySourceEntryId={copySourceFor(challenge.kind)}
        />
      ))}
    </section>
  );
}
