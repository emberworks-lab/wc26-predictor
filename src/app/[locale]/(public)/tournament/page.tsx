import { getLocale, getTranslations } from "next-intl/server";

import KickoffTime from "@/components/KickoffTime";
import type { GroupId } from "@/engine/types";
import { GROUP_IDS } from "@/engine/types";
import { Link } from "@/i18n/navigation";
import { matchdayDateOf } from "@/lib/leaderboards";
import type { TeamDTO } from "@/lib/predictions/types";
import { createClient } from "@/lib/supabase/server";

import RealBracket, { type RealKoMatchDTO } from "./RealBracket";

const SUB_TABS = ["groups", "matches", "scorers", "bracket"] as const;
type SubTab = (typeof SUB_TABS)[number];

const LIVE_STATUSES = ["in_play", "paused"] as const;

interface TeamRef {
  fifa_code: string;
  name: string;
  flag_emoji: string;
}

function TeamLabel({ team, muted }: { team: TeamRef | null; muted?: boolean }) {
  return team ? (
    <>
      <span aria-hidden="true">{team.flag_emoji}</span>
      <span className={muted ? "text-text-muted" : undefined}>{team.fifa_code}</span>
    </>
  ) : (
    <span className="text-xs italic text-text-muted">—</span>
  );
}

export default async function TournamentPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const params = await searchParams;
  const tab: SubTab = (SUB_TABS as readonly string[]).includes(params.t ?? "")
    ? (params.t as SubTab)
    : "groups";

  const locale = await getLocale();
  const t = await getTranslations("Tournament");
  const supabase = await createClient();

  const [{ data: teams }, { data: matches }, { data: standings }, { data: scorers }] =
    await Promise.all([
      supabase.from("teams").select("id, fifa_code, name, flag_emoji, group_code"),
      supabase
        .from("matches")
        .select(
          "id, stage, group_code, fifa_match_number, kickoff_utc, status, home_team_id, away_team_id, home_score, away_score, home_score_et, away_score_et, home_pens, away_pens, winner_team_id",
        )
        .order("kickoff_utc"),
      supabase
        .from("standings_cache")
        .select("group_code, team_id, position, played, won, drawn, lost, goals_for, goals_against, goal_difference, points")
        .order("position"),
      supabase
        .from("scorers_cache")
        .select("player_name, team_id, goals, assists, penalties")
        .order("goals", { ascending: false })
        .order("player_name")
        .limit(30),
    ]);

  const teamById = new Map((teams ?? []).map((x) => [x.id, x]));

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1>

      <nav aria-label={t("sections")} className="flex flex-wrap gap-1.5">
        {SUB_TABS.map((s) => (
          <Link
            key={s}
            href={{ pathname: "/tournament", query: s === "groups" ? {} : { t: s } }}
            aria-current={s === tab ? "page" : undefined}
            className={[
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              s === tab
                ? "bg-gold-500 text-pitch-950"
                : "bg-pitch-800 text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {t(`tabs.${s}`)}
          </Link>
        ))}
      </nav>

      {tab === "groups" && (
        <>
          <p className="text-[11px] text-text-muted">{t("groupsHint")}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {GROUP_IDS.map((g: GroupId) => {
              const rows = (standings ?? []).filter((r) => r.group_code === g);
              if (rows.length === 0) return null;
              return (
                <div
                  key={g}
                  className="overflow-hidden rounded-2xl border border-pitch-700 bg-pitch-800"
                >
                  <h2 className="border-b border-pitch-700 px-4 py-2 text-sm font-bold text-gold-400">
                    {t("group", { group: g })}
                  </h2>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-text-muted">
                        <th className="px-3 py-1.5 text-left font-medium">{t("table.team")}</th>
                        <th className="w-7 py-1.5 text-center font-medium">{t("table.played")}</th>
                        <th className="w-7 py-1.5 text-center font-medium">{t("table.won")}</th>
                        <th className="w-7 py-1.5 text-center font-medium">{t("table.drawn")}</th>
                        <th className="w-7 py-1.5 text-center font-medium">{t("table.lost")}</th>
                        <th className="w-9 py-1.5 text-center font-medium">{t("table.goals")}</th>
                        <th className="w-8 py-1.5 text-center font-medium">{t("table.goalDiff")}</th>
                        <th className="w-8 px-2 py-1.5 text-center font-medium">{t("table.points")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const team = teamById.get(r.team_id);
                        return (
                          <tr
                            key={r.team_id}
                            className={[
                              "border-t border-pitch-700/50",
                              r.position === 2 ? "border-b-2 border-b-gold-500/60" : "",
                              r.position === 3 ? "border-b border-b-gold-500/25 border-dashed" : "",
                            ].join(" ")}
                          >
                            <td className="flex items-center gap-1.5 px-3 py-1.5 font-semibold">
                              <span className="w-3 text-[10px] text-text-muted">{r.position}</span>
                              <span aria-hidden="true">{team?.flag_emoji}</span>
                              <span className="truncate">{team?.name}</span>
                            </td>
                            <td className="text-center text-text-muted">{r.played}</td>
                            <td className="text-center text-text-muted">{r.won}</td>
                            <td className="text-center text-text-muted">{r.drawn}</td>
                            <td className="text-center text-text-muted">{r.lost}</td>
                            <td className="text-center text-text-muted">
                              {r.goals_for}:{r.goals_against}
                            </td>
                            <td className="text-center text-text-muted">
                              {r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}
                            </td>
                            <td className="px-2 text-center font-mono font-bold text-gold-400">
                              {r.points}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "matches" && (
        <div className="flex flex-col gap-4">
          {[...new Set((matches ?? []).map((m) => matchdayDateOf(m.kickoff_utc)))].map(
            (day) => {
              const dayMatches = (matches ?? []).filter(
                (m) => matchdayDateOf(m.kickoff_utc) === day,
              );
              return (
                <div key={day} className="flex flex-col gap-1.5">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "full",
                      timeZone: "UTC",
                    }).format(new Date(day))}
                  </h2>
                  {dayMatches.map((m) => {
                    const home = m.home_team_id != null ? (teamById.get(m.home_team_id) ?? null) : null;
                    const away = m.away_team_id != null ? (teamById.get(m.away_team_id) ?? null) : null;
                    const live = (LIVE_STATUSES as readonly string[]).includes(m.status);
                    const finished = m.status === "finished" || m.status === "awarded";
                    const hs = m.home_score_et ?? m.home_score;
                    const as = m.away_score_et ?? m.away_score;
                    return (
                      <div
                        key={m.id}
                        className="flex items-center gap-2 rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2 text-sm"
                      >
                        <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-muted">
                          {m.stage === "group"
                            ? t("group", { group: m.group_code ?? "" })
                            : t(`stages.${m.stage}`)}
                        </span>
                        <span className="flex flex-1 items-center justify-end gap-1.5 font-semibold">
                          <TeamLabel team={home} />
                        </span>
                        <span className="w-16 shrink-0 text-center">
                          {finished || live ? (
                            <span className="flex items-center justify-center gap-1">
                              {live && (
                                <span
                                  aria-label={t("live")}
                                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-success"
                                />
                              )}
                              <span className="font-mono font-bold">
                                {hs ?? "–"}:{as ?? "–"}
                              </span>
                              {m.home_pens != null && (
                                <span className="text-[9px] text-text-muted">
                                  ({m.home_pens}:{m.away_pens})
                                </span>
                              )}
                            </span>
                          ) : (
                            <KickoffTime
                              utc={m.kickoff_utc}
                              dateStyle="none"
                              className="font-mono text-xs text-text-muted"
                            />
                          )}
                        </span>
                        <span className="flex flex-1 items-center gap-1.5 font-semibold">
                          <TeamLabel team={away} />
                        </span>
                        <span className="w-7 shrink-0 text-right text-[9px] uppercase text-text-muted">
                          {finished ? t("fullTime") : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            },
          )}
        </div>
      )}

      {tab === "scorers" &&
        ((scorers ?? []).length === 0 ? (
          <div className="rounded-2xl border border-pitch-700 bg-pitch-800 p-8 text-center text-sm text-text-muted">
            {t("noScorers")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-pitch-700 bg-pitch-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-pitch-700 text-[10px] uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-2 text-left font-medium">{t("scorerCols.player")}</th>
                  <th className="w-12 py-2 text-center font-medium">{t("scorerCols.goals")}</th>
                  <th className="w-12 py-2 text-center font-medium">{t("scorerCols.assists")}</th>
                  <th className="w-12 px-2 py-2 text-center font-medium">{t("scorerCols.penalties")}</th>
                </tr>
              </thead>
              <tbody>
                {(scorers ?? []).map((s) => {
                  const team = s.team_id != null ? teamById.get(s.team_id) : undefined;
                  return (
                    <tr key={`${s.player_name}-${s.team_id}`} className="border-t border-pitch-700/50">
                      <td className="flex items-center gap-2 px-4 py-2">
                        <span aria-hidden="true">{team?.flag_emoji ?? "🏳️"}</span>
                        <span className="truncate font-semibold">{s.player_name}</span>
                      </td>
                      <td className="text-center font-mono font-bold text-gold-400">{s.goals}</td>
                      <td className="text-center font-mono text-text-muted">{s.assists ?? "—"}</td>
                      <td className="px-2 text-center font-mono text-text-muted">{s.penalties ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "bracket" &&
        (() => {
          const ko = (matches ?? []).filter((m) => m.stage !== "group");
          const anyKnown = ko.some(
            (m) => m.fifa_match_number != null && (m.home_team_id != null || m.away_team_id != null),
          );
          if (!anyKnown) {
            return (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-pitch-700 bg-pitch-800 p-10 text-center">
                <span aria-hidden="true" className="text-3xl">
                  🗓️
                </span>
                <p className="text-sm text-text-muted">{t("bracketAfterGroups")}</p>
              </div>
            );
          }
          const code = (id: number | null) =>
            id != null ? (teamById.get(id)?.fifa_code ?? null) : null;
          const koDTOs: RealKoMatchDTO[] = ko
            .filter((m) => m.fifa_match_number != null)
            .map((m) => {
              const finished = m.status === "finished" || m.status === "awarded";
              const hs = m.home_score_et ?? m.home_score;
              const as = m.away_score_et ?? m.away_score;
              let result: string | null = null;
              if (finished && hs != null && as != null) {
                result =
                  m.home_pens != null
                    ? `${hs}:${as} (${m.home_pens}:${m.away_pens} ${t("pens")})`
                    : m.home_score_et != null
                      ? `${hs}:${as} ${t("aet")}`
                      : `${hs}:${as}`;
              }
              return {
                slot: m.fifa_match_number!,
                home: code(m.home_team_id),
                away: code(m.away_team_id),
                winner: finished ? code(m.winner_team_id) : null,
                result,
              };
            });
          const teamDTOs: TeamDTO[] = (teams ?? [])
            .filter((x) => x.group_code != null)
            .map((x) => ({
              id: x.id,
              code: x.fifa_code,
              name: x.name,
              flag: x.flag_emoji,
              group: x.group_code as GroupId,
            }));
          return <RealBracket matches={koDTOs} teams={teamDTOs} />;
        })()}
    </section>
  );
}
