import type { GroupId } from "@/engine/types";
import { redirect } from "@/i18n/navigation";
import type { BracketPickDTO, ChallengeDTO, TeamDTO } from "@/lib/predictions/types";
import { createClient } from "@/lib/supabase/server";

import PlayoffFlow, { type RealSlotDTO } from "./PlayoffFlow";

/**
 * Playoff challenge: the Stage 5 knockout picker fed with the REAL bracket.
 * Joinable only once the sync job flips `opens_at` (group stage complete) —
 * so an entry existing implies the real R32 pairings are resolved
 * (`matches.fifa_match_number` 73–88 with both teams). Locks at the first
 * R32 kickoff (challenge `locks_at`), no per-match locking inside.
 */
export default async function PlayoffPage({
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
    .eq("kind", "playoff")
    .single();
  if (!challenge) redirect({ href: "/challenges", locale });

  const { data: entry } = await supabase
    .from("challenge_entries")
    .select("id, hardcore, submitted_at")
    .eq("user_id", user!.id)
    .eq("challenge_id", challenge!.id)
    .maybeSingle();
  if (!entry) redirect({ href: "/challenges", locale });

  const [{ data: teams }, { data: koMatches }, { data: bracket }] = await Promise.all([
    supabase
      .from("teams")
      .select("id, fifa_code, name, flag_emoji, group_code")
      .not("group_code", "is", null),
    supabase
      .from("matches")
      .select("fifa_match_number, home_team_id, away_team_id")
      .neq("stage", "group")
      .not("fifa_match_number", "is", null)
      .order("fifa_match_number"),
    supabase
      .from("bracket_predictions")
      .select("slot, home_team_id, away_team_id, winner_team_id, home_score, away_score, aet_pens")
      .eq("entry_id", entry!.id)
      .eq("generation", 0),
  ]);

  const teamDTOs: TeamDTO[] = (teams ?? []).map((t) => ({
    id: t.id,
    code: t.fifa_code,
    name: t.name,
    flag: t.flag_emoji,
    group: t.group_code as GroupId,
  }));

  const slotDTOs: RealSlotDTO[] = (koMatches ?? []).map((m) => ({
    slot: m.fifa_match_number!,
    homeTeamId: m.home_team_id,
    awayTeamId: m.away_team_id,
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
    <PlayoffFlow
      entry={{ id: entry!.id, hardcore: entry!.hardcore }}
      submitted={entry!.submitted_at != null}
      challenge={challengeDTO}
      teams={teamDTOs}
      realSlots={slotDTOs}
      initialBracket={bracketDTOs}
      serverNow={new Date().toISOString()}
    />
  );
}
