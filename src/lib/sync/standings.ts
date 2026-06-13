/**
 * Engine-computed standings cache refresh (Article 13 tiebreakers — never the
 * provider's standings endpoint). Shared by the sync Edge Function (inlined
 * by the esbuild bundle) and the admin result-correction action, so a manual
 * correction refreshes group tables through the exact same code as the cron
 * sync.
 */

import { computeGroupTable } from '@/engine/groupTable';
import type { PlayedMatch } from '@/engine/types';
import { GROUP_IDS } from '@/engine/types';
import { loadTeams, type DbMatch, type SyncDb } from '@/lib/sync/recompute';

export async function refreshStandings(supabase: SyncDb, matches: DbMatch[]) {
  const { codeById, idByCode } = await loadTeams(supabase);
  const rows: Array<Record<string, unknown>> = [];

  for (const group of GROUP_IDS) {
    const inGroup = matches.filter(
      (m) => m.stage === 'group' && m.group_code === group,
    );
    const teamCodes = [
      ...new Set(
        inGroup
          .flatMap((m) => [m.home_team_id, m.away_team_id])
          .filter((id): id is number => id != null)
          .map((id) => codeById.get(id)!),
      ),
    ];
    if (teamCodes.length === 0) continue;
    const played: PlayedMatch[] = inGroup
      .filter((m) => m.status === 'finished')
      .map((m) => ({
        home: codeById.get(m.home_team_id!)!,
        away: codeById.get(m.away_team_id!)!,
        homeGoals: m.home_score!,
        awayGoals: m.away_score!,
      }));
    for (const row of computeGroupTable(played, teamCodes)) {
      rows.push({
        group_code: group,
        team_id: idByCode.get(row.team)!,
        position: row.position,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        goals_for: row.goalsFor,
        goals_against: row.goalsAgainst,
        goal_difference: row.goalDiff,
        points: row.points,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('standings_cache')
      .upsert(rows, { onConflict: 'group_code,team_id' });
    if (error) throw new Error(`standings upsert: ${error.message}`);
  }
  return rows.length;
}
