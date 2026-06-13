import { getTranslations } from "next-intl/server";

import type { GroupId } from "@/engine/types";
import type { PointsSource } from "@/engine/scoring";
import type {
  BracketPickDTO,
  GroupMatchDTO,
  MatchPredictionDTO,
  PredictionOutcome,
  TeamDTO,
} from "@/lib/predictions/types";
import { createClient } from "@/lib/supabase/server";

import ProfileBracket from "./ProfileBracket";

/** Breakdown display order = SPEC scoring table order. */
const CATEGORY_ORDER: PointsSource[] = [
  "GROUP_OUTCOME",
  "GROUP_EXACT_ORDER",
  "QUALIFIER_TOP2",
  "QUALIFIER_THIRD",
  "KO_REACH",
  "KO_AET_FLAG",
  "HC_EXACT_SCORE",
  "HC_GOAL_DIFF",
  "HC_ADVANCE_PICK",
  "FUN",
];

const OUTCOME_SHORT = { home: "1", draw: "X", away: "2" } as const;

/**
 * Per-challenge cards: totals + rank, per-rule point breakdown, and the
 * user's predictions next to real results. Everything is read through the
 * VIEWER's RLS-scoped client — for someone else's profile only predictions
 * on locked (kicked-off) matches and post-lock bracket picks come back, so
 * "predictions visible only for locked matches" needs no extra logic here.
 */
export default async function ProfileView({
  userId,
  isOwner,
}: {
  userId: string;
  isOwner: boolean;
}) {
  const t = await getTranslations("Profile");
  const tc = await getTranslations("Challenges.items");
  const supabase = await createClient();

  const { data: entries } = await supabase
    .from("challenge_entries")
    .select("id, hardcore, challenge_id, challenges(kind)")
    .eq("user_id", userId)
    .order("challenge_id");
  if (!entries || entries.length === 0) {
    return (
      <p className="rounded-2xl border border-pitch-700 bg-pitch-800 p-6 text-center text-sm text-text-muted">
        {t("noEntries")}
      </p>
    );
  }
  const entryIds = entries.map((e) => e.id);

  const [
    { data: ranks },
    { data: points },
    { data: redistributions },
    { data: preds },
    { data: brackets },
    { data: teams },
    { data: groupMatchRows },
  ] = await Promise.all([
    supabase
      .from("leaderboard_ranked")
      .select("board, challenge_id, points, rank")
      .eq("user_id", userId),
    supabase
      .from("points")
      .select("entry_id, category, points, hardcore")
      .in("entry_id", entryIds),
    supabase
      .from("redistributions")
      .select("entry_id, stage, multiplier")
      .in("entry_id", entryIds),
    supabase
      .from("match_predictions")
      .select(
        "entry_id, outcome, home_score, away_score, matches(id, status, kickoff_utc, group_code, home_team_id, away_team_id, home_score, away_score)",
      )
      .in("entry_id", entryIds),
    supabase
      .from("bracket_predictions")
      .select(
        "entry_id, generation, slot, home_team_id, away_team_id, winner_team_id, home_score, away_score, aet_pens",
      )
      .in("entry_id", entryIds),
    supabase.from("teams").select("id, fifa_code, name, flag_emoji, group_code"),
    supabase
      .from("matches")
      .select(
        "id, group_code, matchday, kickoff_utc, status, home_team_id, away_team_id, home_score, away_score",
      )
      .eq("stage", "group")
      .order("kickoff_utc"),
  ]);

  const teamById = new Map((teams ?? []).map((x) => [x.id, x]));

  // Shared inputs for the read-only graphical bracket (Stage 9 item 11).
  const teamDTOs: TeamDTO[] = (teams ?? [])
    .filter((tm) => tm.group_code != null)
    .map((tm) => ({
      id: tm.id,
      code: tm.fifa_code,
      name: tm.name,
      flag: tm.flag_emoji,
      group: tm.group_code as GroupId,
    }));
  const groupMatchDTOs: GroupMatchDTO[] = (groupMatchRows ?? [])
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

  return (
    <div className="flex flex-col gap-4">
      {entries.map((entry) => {
        const kind = entry.challenges!.kind;
        const rankRows = (ranks ?? []).filter((r) => r.challenge_id === entry.challenge_id);
        const globalRank = rankRows.find((r) => r.board === "global");
        const hardcoreRank = rankRows.find((r) => r.board === "hardcore");

        const entryPoints = (points ?? []).filter((p) => p.entry_id === entry.id);
        const byCategory = CATEGORY_ORDER.map((cat) => {
          const rows = entryPoints.filter((p) => p.category === cat);
          return {
            cat,
            count: rows.length,
            sum: rows.reduce((acc, r) => acc + Number(r.points), 0),
          };
        }).filter((c) => c.count > 0);

        const redist = (redistributions ?? []).filter((r) => r.entry_id === entry.id);

        // Predictions vs reality: only matches that already kicked off tell a
        // story (and are all a visitor can see anyway).
        const entryPreds = (preds ?? [])
          .filter((p) => p.entry_id === entry.id && p.matches != null)
          .filter((p) => {
            const m = p.matches!;
            return m.status !== "scheduled" && m.status !== "timed";
          })
          .sort((a, b) => a.matches!.kickoff_utc.localeCompare(b.matches!.kickoff_utc));

        const gen = Math.max(0, ...(brackets ?? []).filter((b) => b.entry_id === entry.id).map((b) => b.generation));
        const championPick = (brackets ?? []).find(
          (b) => b.entry_id === entry.id && b.generation === gen && b.slot === 104,
        );
        const champion = championPick ? teamById.get(championPick.winner_team_id) : undefined;

        // Read-only graphical bracket inputs (Stage 9 item 11): their latest
        // generation's picks + their visible group predictions, derived
        // client-side. RLS already scopes what's visible.
        const entryBracketPicks: BracketPickDTO[] = (brackets ?? [])
          .filter((b) => b.entry_id === entry.id && b.generation === gen)
          .map((b) => ({
            slot: b.slot,
            homeTeamId: b.home_team_id,
            awayTeamId: b.away_team_id,
            winnerTeamId: b.winner_team_id,
            homeScore: b.home_score,
            awayScore: b.away_score,
            aetPens: b.aet_pens,
          }));
        const entryBracketPreds: MatchPredictionDTO[] = (preds ?? [])
          .filter((p) => p.entry_id === entry.id && p.matches != null)
          .map((p) => ({
            matchId: p.matches!.id,
            outcome: p.outcome as PredictionOutcome,
            homeScore: p.home_score,
            awayScore: p.away_score,
          }));

        return (
          <div
            key={entry.id}
            className="flex flex-col gap-3 rounded-2xl border border-pitch-700 bg-pitch-800 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                {tc(`${kind}.title`)}
                {entry.hardcore && (
                  <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-400">
                    {t("hardcore")}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-3 font-mono text-sm">
                {globalRank && (
                  <span>
                    <span className="text-text-muted">#{Number(globalRank.rank)}</span>{" "}
                    <span className="font-extrabold text-gold-400">
                      {Number(globalRank.points)}
                    </span>
                  </span>
                )}
                {hardcoreRank && (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <span className="font-semibold text-gold-400">{t("hardcore")}</span>
                    <span className="text-text-muted">#{Number(hardcoreRank.rank)}</span>{" "}
                    <span className="font-bold text-gold-400">{Number(hardcoreRank.points)}</span>
                  </span>
                )}
              </div>
            </div>

            {redist.length > 0 && (
              <p className="rounded-lg bg-gold-500/10 px-3 py-1.5 text-[11px] text-gold-400">
                {t("redistributed", {
                  stage: redist[redist.length - 1].stage.toUpperCase(),
                  percent: Math.round(Number(redist[redist.length - 1].multiplier) * 100),
                })}
              </p>
            )}

            {byCategory.length > 0 ? (
              <dl className="flex flex-col gap-1">
                {byCategory.map((c) => (
                  <div key={c.cat} className="flex items-baseline justify-between gap-2 text-xs">
                    <dt className="text-text-muted">
                      {t(`categories.${c.cat}`)}{" "}
                      <span className="text-[10px]">×{c.count}</span>
                    </dt>
                    <dd className="font-mono font-bold text-gold-400">+{c.sum}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-text-muted">{t("noPointsYet")}</p>
            )}

            {(kind === "full" || kind === "groups") && (
              <div className="flex flex-col gap-1.5 border-t border-pitch-700 pt-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("vsReality")}
                </h4>
                {entryPreds.length === 0 ? (
                  <p className="text-xs text-text-muted">
                    {isOwner ? t("noLockedPredsOwn") : t("noLockedPreds")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {entryPreds.map((p) => {
                      const m = p.matches!;
                      const home = m.home_team_id != null ? teamById.get(m.home_team_id) : undefined;
                      const away = m.away_team_id != null ? teamById.get(m.away_team_id) : undefined;
                      const finished = m.status === "finished" || m.status === "awarded";
                      const realOutcome =
                        finished && m.home_score != null && m.away_score != null
                          ? m.home_score > m.away_score
                            ? "home"
                            : m.home_score < m.away_score
                              ? "away"
                              : "draw"
                          : null;
                      const correct = realOutcome != null && realOutcome === p.outcome;
                      const pick =
                        p.home_score != null && p.away_score != null
                          ? `${p.home_score}:${p.away_score}`
                          : OUTCOME_SHORT[p.outcome];
                      return (
                        <li key={m.id} className="flex items-center gap-2 text-xs">
                          <span className="flex flex-1 items-center gap-1 truncate">
                            <span aria-hidden="true">{home?.flag_emoji}</span>
                            <span className="font-semibold">{home?.fifa_code}</span>
                            <span className="font-mono text-text-muted">
                              {finished ? `${m.home_score}:${m.away_score}` : "–"}
                            </span>
                            <span className="font-semibold">{away?.fifa_code}</span>
                            <span aria-hidden="true">{away?.flag_emoji}</span>
                          </span>
                          <span className="font-mono text-text-muted">
                            {t("pick")} {pick}
                          </span>
                          {realOutcome != null && (
                            <span className={correct ? "text-success" : "text-danger"}>
                              {correct ? "✓" : "✗"}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {kind === "full" && (
              <div className="flex items-center gap-2 border-t border-pitch-700 pt-3 text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("championPick")}
                </span>
                {champion ? (
                  <span className="font-semibold text-gold-400">
                    {champion.flag_emoji} {champion.name}
                  </span>
                ) : (
                  <span className="text-text-muted">
                    {isOwner ? t("noChampionOwn") : t("hiddenUntilLock")}
                  </span>
                )}
              </div>
            )}

            {kind === "full" && (
              <details className="border-t border-pitch-700 pt-3">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("predictedBracket")}
                </summary>
                <div className="mt-3">
                  <ProfileBracket
                    teams={teamDTOs}
                    matches={groupMatchDTOs}
                    predictions={entryBracketPreds}
                    bracketPicks={entryBracketPicks}
                    hardcore={entry.hardcore}
                  />
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
