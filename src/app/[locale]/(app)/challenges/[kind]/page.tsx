import { redirect } from "@/i18n/navigation";
import type { GroupId } from "@/engine/types";
import type {
  BracketPickDTO,
  ChallengeDTO,
  GroupMatchDTO,
  MatchPredictionDTO,
  PredictionOutcome,
  TeamDTO,
} from "@/lib/predictions/types";
import { createClient } from "@/lib/supabase/server";

import PredictionFlow from "./PredictionFlow";

const PREDICTABLE_KINDS = ["full", "groups"] as const;
type PredictableKind = (typeof PREDICTABLE_KINDS)[number];

/**
 * Prediction flow entry for the Full / Groups challenges. Requires a joined
 * entry (join happens on the challenges home); Playoff/Fun land in Stage 7.
 */
export default async function PredictPage({
  params,
}: {
  params: Promise<{ locale: string; kind: string }>;
}) {
  const { locale, kind } = await params;
  if (!(PREDICTABLE_KINDS as readonly string[]).includes(kind)) {
    redirect({ href: "/challenges", locale });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: challenge } = await supabase
    .from("challenges")
    .select("id, kind, opens_at, locks_at, manual_override")
    .eq("kind", kind as PredictableKind)
    .single();
  if (!challenge) redirect({ href: "/challenges", locale });

  const { data: entry } = await supabase
    .from("challenge_entries")
    .select("id, hardcore")
    .eq("user_id", user!.id)
    .eq("challenge_id", challenge!.id)
    .maybeSingle();
  if (!entry) redirect({ href: "/challenges", locale });

  const [{ data: teams }, { data: matches }, { data: predictions }, { data: bracket }] =
    await Promise.all([
      supabase
        .from("teams")
        .select("id, fifa_code, name, flag_emoji, group_code")
        .not("group_code", "is", null),
      supabase
        .from("matches")
        .select(
          "id, group_code, matchday, kickoff_utc, status, home_team_id, away_team_id, home_score, away_score",
        )
        .eq("stage", "group")
        .order("kickoff_utc"),
      supabase
        .from("match_predictions")
        .select("match_id, outcome, home_score, away_score")
        .eq("entry_id", entry!.id),
      kind === "full"
        ? supabase
            .from("bracket_predictions")
            .select("slot, home_team_id, away_team_id, winner_team_id, home_score, away_score, aet_pens")
            .eq("entry_id", entry!.id)
            .eq("generation", 0)
        : Promise.resolve({ data: [] as never[] }),
    ]);

  const teamDTOs: TeamDTO[] = (teams ?? []).map((t) => ({
    id: t.id,
    code: t.fifa_code,
    name: t.name,
    flag: t.flag_emoji,
    group: t.group_code as GroupId,
  }));

  const matchDTOs: GroupMatchDTO[] = (matches ?? [])
    .filter((m) => m.home_team_id != null && m.away_team_id != null)
    .map((m) => ({
      id: m.id,
      group: m.group_code as GroupId,
      matchday: m.matchday,
      kickoffUtc: m.kickoff_utc,
      status: m.status,
      homeTeamId: m.home_team_id!,
      awayTeamId: m.away_team_id!,
      homeScore: m.home_score,
      awayScore: m.away_score,
    }));

  const predictionDTOs: MatchPredictionDTO[] = (predictions ?? []).map((p) => ({
    matchId: p.match_id,
    outcome: p.outcome as PredictionOutcome,
    homeScore: p.home_score,
    awayScore: p.away_score,
  }));

  const bracketDTOs: BracketPickDTO[] = (bracket ?? []).map((b) => ({
    slot: b.slot,
    homeTeamId: b.home_team_id,
    awayTeamId: b.away_team_id,
    winnerTeamId: b.winner_team_id,
    homeScore: b.home_score,
    awayScore: b.away_score,
    aetPens: b.aet_pens,
  }));

  const challengeDTO: ChallengeDTO = {
    id: challenge!.id,
    kind: challenge!.kind,
    opensAt: challenge!.opens_at,
    locksAt: challenge!.locks_at,
    manualOverride: challenge!.manual_override,
  };

  return (
    <PredictionFlow
      challengeKind={kind as PredictableKind}
      entry={{ id: entry!.id, hardcore: entry!.hardcore }}
      challenge={challengeDTO}
      teams={teamDTOs}
      matches={matchDTOs}
      initialPredictions={predictionDTOs}
      initialBracket={bracketDTOs}
      serverNow={new Date().toISOString()}
    />
  );
}
