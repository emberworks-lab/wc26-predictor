/**
 * Leaderboard ordering (SPEC.md → "Leaderboard tiebreakers"):
 *  points, then
 *  1. more correctly predicted qualifiers (top-2 + thirds)
 *  2. more correct knockout advancing picks
 *  3. more correct group match outcomes
 *  4. earlier registration (created_at)
 */

export interface LeaderboardEntry {
  points: number;
  correctQualifiers: number;
  correctKoPicks: number;
  correctOutcomes: number;
  createdAtUtc: Date | string;
}

const toMs = (d: Date | string): number => (d instanceof Date ? d.getTime() : Date.parse(d));

/** Comparator for Array.prototype.sort — best entry first. */
export function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.correctQualifiers !== b.correctQualifiers) {
    return b.correctQualifiers - a.correctQualifiers;
  }
  if (a.correctKoPicks !== b.correctKoPicks) return b.correctKoPicks - a.correctKoPicks;
  if (a.correctOutcomes !== b.correctOutcomes) return b.correctOutcomes - a.correctOutcomes;
  return toMs(a.createdAtUtc) - toMs(b.createdAtUtc);
}
