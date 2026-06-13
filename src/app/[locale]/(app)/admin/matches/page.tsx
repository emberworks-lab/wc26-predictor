import { getTranslations } from "next-intl/server";

import MatchEditor, {
  type AdminMatchDTO,
} from "@/app/[locale]/(app)/admin/matches/MatchEditor";
import { createClient } from "@/lib/supabase/server";

/**
 * Manual result correction (SPEC admin area): pick a match, fix its
 * score/status, the row is flagged manually_corrected (sync skips it until
 * the flag is cleared) and points recompute through the sync pipeline.
 * Default view = most recently kicked-off first (the likely targets).
 */
export default async function AdminMatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const t = await getTranslations("Admin.matches");
  const supabase = await createClient();

  const [{ data: teams }, { data: matches }] = await Promise.all([
    supabase.from("teams").select("id, fifa_code, name, flag_emoji"),
    supabase
      .from("matches")
      .select(
        "id, stage, group_code, matchday, fifa_match_number, kickoff_utc, status, home_team_id, away_team_id, home_score, away_score, home_score_et, away_score_et, home_pens, away_pens, winner_team_id, manually_corrected",
      )
      .order("kickoff_utc", { ascending: false }),
  ]);

  const teamById = new Map((teams ?? []).map((team) => [team.id, team]));
  const label = (id: number | null) => {
    const team = id != null ? teamById.get(id) : undefined;
    return team ? `${team.flag_emoji} ${team.fifa_code}` : "—";
  };

  const needle = q?.trim().toLowerCase();
  const filtered = (matches ?? []).filter((m) => {
    if (!needle) return true;
    const home = m.home_team_id != null ? teamById.get(m.home_team_id) : undefined;
    const away = m.away_team_id != null ? teamById.get(m.away_team_id) : undefined;
    return [home?.fifa_code, home?.name, away?.fifa_code, away?.name, m.group_code]
      .filter((s): s is string => !!s)
      .some((s) => s.toLowerCase().includes(needle));
  });

  const dtos: AdminMatchDTO[] = filtered.slice(0, 40).map((m) => ({
    id: m.id,
    stage: m.stage,
    groupCode: m.group_code,
    fifaMatchNumber: m.fifa_match_number,
    kickoffUtc: m.kickoff_utc,
    status: m.status,
    homeTeamId: m.home_team_id,
    awayTeamId: m.away_team_id,
    homeLabel: label(m.home_team_id),
    awayLabel: label(m.away_team_id),
    homeScore: m.home_score,
    awayScore: m.away_score,
    homeScoreEt: m.home_score_et,
    awayScoreEt: m.away_score_et,
    homePens: m.home_pens,
    awayPens: m.away_pens,
    winnerTeamId: m.winner_team_id,
    manuallyCorrected: m.manually_corrected,
  }));

  return (
    <div className="flex flex-col gap-3">
      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={t("searchPlaceholder")}
          className="h-9 w-full rounded-lg border border-pitch-700 bg-pitch-950 px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-gold-500/60"
        />
        <button
          type="submit"
          className="rounded-lg border border-pitch-700 bg-pitch-800 px-3 text-xs font-semibold text-text-primary"
        >
          {t("search")}
        </button>
      </form>
      <p className="text-xs text-text-muted">{t("hint")}</p>
      <ul className="flex flex-col gap-1.5">
        {dtos.map((m) => (
          <li key={m.id}>
            <MatchEditor match={m} />
          </li>
        ))}
        {dtos.length === 0 && <li className="text-sm text-text-muted">{t("noRows")}</li>}
      </ul>
    </div>
  );
}
