/**
 * Ranking of third-placed teams — the best 8 of 12 qualify for the R32.
 *
 * Source: FIFA WC26 Regulations, Article 13 ("The eight best-ranked teams
 * among those finishing third"):
 *  a) points  b) goal difference  c) goals scored (all group matches)
 *  d) team conduct score  e/f) FIFA World Ranking.
 * Engine-only final guard: lexicographic TeamId (determinism without data).
 */

import type { GroupId, GroupTableRow, TeamId, TiebreakContext } from './types';

export interface ThirdPlaceEntry {
  group: GroupId;
  row: GroupTableRow;
}

export interface ThirdsRanking {
  /** All input entries, best first. */
  ranking: ThirdPlaceEntry[];
  /** The first min(8, n) entries of `ranking`. */
  qualified: ThirdPlaceEntry[];
  /** Convenience: qualified teams keyed by their group. */
  qualifiedByGroup: Partial<Record<GroupId, TeamId>>;
}

export function rankThirds(
  thirds: readonly ThirdPlaceEntry[],
  ctx: TiebreakContext = {},
): ThirdsRanking {
  const ranking = [...thirds].sort((a, b) => {
    if (a.row.points !== b.row.points) return b.row.points - a.row.points;
    if (a.row.goalDiff !== b.row.goalDiff) return b.row.goalDiff - a.row.goalDiff;
    if (a.row.goalsFor !== b.row.goalsFor) return b.row.goalsFor - a.row.goalsFor;
    const ca = ctx.conduct?.[a.row.team] ?? 0;
    const cb = ctx.conduct?.[b.row.team] ?? 0;
    if (ca !== cb) return cb - ca;
    const ra = ctx.fifaRanking?.[a.row.team] ?? Number.POSITIVE_INFINITY;
    const rb = ctx.fifaRanking?.[b.row.team] ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.row.team < b.row.team ? -1 : a.row.team > b.row.team ? 1 : 0;
  });

  const qualified = ranking.slice(0, 8);
  const qualifiedByGroup: Partial<Record<GroupId, TeamId>> = {};
  for (const q of qualified) qualifiedByGroup[q.group] = q.row.team;

  return { ranking, qualified, qualifiedByGroup };
}
