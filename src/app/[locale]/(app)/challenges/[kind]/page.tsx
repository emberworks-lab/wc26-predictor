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
import RedistributionPanel, {
  type RealKoResultDTO,
  type RedistributionDTO,
} from "./RedistributionPanel";
import type { RedistributionStage } from "./actions";

const PREDICTABLE_KINDS = ["full", "groups"] as const;
type PredictableKind = (typeof PREDICTABLE_KINDS)[number];

/** Playoff `opens_at` far-future sentinel = "group stage not finished yet". */
const isOpensSentinel = (opensAt: string | null) =>
  opensAt != null && new Date(opensAt).getFullYear() > 2900;

/**
 * Prediction flow entry for the Full / Groups challenges (Playoff and Fun
 * have their own static routes). Requires a joined entry (join happens on
 * the challenges home). Once the group stage completes (signalled by the
 * sync job opening the Playoff challenge), the Full page additionally
 * shows the knockout redistribution panel over the real bracket.
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

  // --- redistribution (Full, group stage complete) ---------------------------
  // "Groups complete" = the sync job opened the Playoff challenge (same run
  // resolves the real R32 slot pairings, so the real bracket is available).
  let redistribution: {
    redistributions: RedistributionDTO[];
    realKo: RealKoResultDTO[];
    roundStarts: Partial<Record<RedistributionStage, string | null>>;
    genBracket: BracketPickDTO[];
  } | null = null;

  if (kind === "full") {
    const { data: playoff } = await supabase
      .from("challenges")
      .select("opens_at")
      .eq("kind", "playoff")
      .single();
    const groupsComplete =
      playoff?.opens_at != null &&
      !isOpensSentinel(playoff.opens_at) &&
      new Date(playoff.opens_at) <= new Date();

    if (groupsComplete) {
      const [{ data: redistRows }, { data: koMatches }] = await Promise.all([
        supabase
          .from("redistributions")
          .select("generation, stage, multiplier")
          .eq("entry_id", entry!.id)
          .order("generation"),
        supabase
          .from("matches")
          .select(
            "stage, fifa_match_number, kickoff_utc, status, home_team_id, away_team_id, home_score, away_score, home_score_et, away_score_et, home_pens, away_pens, winner_team_id",
          )
          .neq("stage", "group")
          .not("fifa_match_number", "is", null),
      ]);

      const redistributions: RedistributionDTO[] = (redistRows ?? []).map((r) => ({
        generation: r.generation,
        stage: r.stage as RedistributionStage,
        multiplier: Number(r.multiplier),
      }));

      const maxGen = redistributions.length
        ? redistributions[redistributions.length - 1].generation
        : 0;
      const { data: genRows } =
        maxGen > 0
          ? await supabase
              .from("bracket_predictions")
              .select(
                "slot, home_team_id, away_team_id, winner_team_id, home_score, away_score, aet_pens",
              )
              .eq("entry_id", entry!.id)
              .eq("generation", maxGen)
          : { data: [] as never[] };

      const realKo: RealKoResultDTO[] = (koMatches ?? []).map((m) => {
        const finished = m.status === "finished" || m.status === "awarded";
        return {
          slot: m.fifa_match_number!,
          homeTeamId: m.home_team_id,
          awayTeamId: m.away_team_id,
          winnerTeamId: finished ? m.winner_team_id : null,
          homeScore90: finished ? m.home_score : null,
          awayScore90: finished ? m.away_score : null,
          homeScoreEt: finished ? m.home_score_et : null,
          awayScoreEt: finished ? m.away_score_et : null,
          homePens: finished ? m.home_pens : null,
          awayPens: finished ? m.away_pens : null,
          finished,
        };
      });

      // First kickoff per redistribution stage's ROUND (the engine's final
      // round F includes the third-place match — same rule as the DB).
      const roundOfStage = (stage: string): RedistributionStage | null =>
        stage === "third_place" || stage === "final"
          ? "final"
          : stage === "r32" || stage === "r16" || stage === "qf" || stage === "sf"
            ? (stage as RedistributionStage)
            : null;
      const roundStarts: Partial<Record<RedistributionStage, string | null>> = {};
      for (const m of koMatches ?? []) {
        const r = roundOfStage(m.stage);
        if (!r) continue;
        const current = roundStarts[r];
        if (current == null || m.kickoff_utc < current) roundStarts[r] = m.kickoff_utc;
      }

      redistribution = {
        redistributions,
        realKo,
        roundStarts,
        genBracket: (genRows ?? []).map((b) => ({
          slot: b.slot,
          homeTeamId: b.home_team_id,
          awayTeamId: b.away_team_id,
          winnerTeamId: b.winner_team_id,
          homeScore: b.home_score,
          awayScore: b.away_score,
          aetPens: b.aet_pens,
        })),
      };
    }
  }

  const serverNow = new Date().toISOString();

  return (
    <div className="flex flex-col gap-4">
      {redistribution && (
        <RedistributionPanel
          entry={{ id: entry!.id, hardcore: entry!.hardcore }}
          redistributions={redistribution.redistributions}
          realKo={redistribution.realKo}
          roundStarts={redistribution.roundStarts}
          genBracket={redistribution.genBracket}
          teams={teamDTOs}
          serverNow={serverNow}
        />
      )}
      <PredictionFlow
        challengeKind={kind as PredictableKind}
        entry={{ id: entry!.id, hardcore: entry!.hardcore }}
        challenge={challengeDTO}
        teams={teamDTOs}
        matches={matchDTOs}
        initialPredictions={predictionDTOs}
        initialBracket={bracketDTOs}
        serverNow={serverNow}
      />
    </div>
  );
}
