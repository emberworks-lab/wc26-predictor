import { describe, expect, it } from 'vitest';

import { rankThirds, type ThirdPlaceEntry } from './bestThirds';
import type { GroupId, GroupTableRow } from './types';
import { GROUP_IDS } from './types';

const third = (
  group: GroupId,
  team: string,
  points: number,
  goalDiff: number,
  goalsFor: number,
): ThirdPlaceEntry => ({
  group,
  row: {
    team,
    played: 3,
    won: Math.floor(points / 3),
    drawn: points % 3,
    lost: 3 - Math.floor(points / 3) - (points % 3),
    goalsFor,
    goalsAgainst: goalsFor - goalDiff,
    goalDiff,
    points,
    position: 3,
  } satisfies GroupTableRow,
});

describe('rankThirds', () => {
  it('qualifies exactly 8 of 12 by points, then GD, then goals scored', () => {
    const thirds = GROUP_IDS.map((g, i) =>
      // A..D on 6 pts, E..H on 4 pts, I..L on 3 pts with descending GD.
      third(g, `${g}3`, i < 4 ? 6 : i < 8 ? 4 : 3, 12 - i, 10),
    );
    const { ranking, qualified, qualifiedByGroup } = rankThirds(thirds);
    expect(ranking.map((e) => e.group)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
    ]);
    expect(qualified).toHaveLength(8);
    expect(Object.keys(qualifiedByGroup).sort()).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
    ]);
    expect(qualifiedByGroup.A).toBe('A3');
  });

  it('ties on points resolved by GD; ties on GD resolved by goals scored', () => {
    const thirds: ThirdPlaceEntry[] = [
      third('A', 'A3', 4, 0, 2),
      third('B', 'B3', 4, 2, 1),
      third('C', 'C3', 4, 0, 5),
      third('D', 'D3', 6, -3, 0),
    ];
    const { ranking } = rankThirds(thirds);
    // D first on points; B next on GD; then C over A on goals scored.
    expect(ranking.map((e) => e.group)).toEqual(['D', 'B', 'C', 'A']);
  });

  it('uses conduct then FIFA ranking when fully level on the pitch', () => {
    const thirds: ThirdPlaceEntry[] = [
      third('A', 'A3', 3, 0, 3),
      third('B', 'B3', 3, 0, 3),
      third('C', 'C3', 3, 0, 3),
    ];
    const { ranking } = rankThirds(thirds, {
      conduct: { A3: -2, B3: 0, C3: -2 },
      fifaRanking: { A3: 40, C3: 4 },
    });
    // B3 wins on conduct; C3 beats A3 on FIFA ranking.
    expect(ranking.map((e) => e.row.team)).toEqual(['B3', 'C3', 'A3']);
  });

  it('is deterministic without any context (TeamId guard)', () => {
    const thirds: ThirdPlaceEntry[] = [
      third('B', 'Zeta', 3, 0, 3),
      third('A', 'Alpha', 3, 0, 3),
    ];
    expect(rankThirds(thirds).ranking.map((e) => e.row.team)).toEqual([
      'Alpha',
      'Zeta',
    ]);
  });

  it('the 9th-ranked third does not qualify (boundary)', () => {
    const thirds = GROUP_IDS.map((g, i) => third(g, `${g}3`, 3, 11 - i, 5));
    const { qualified, qualifiedByGroup } = rankThirds(thirds);
    expect(qualified.map((e) => e.group)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
    ]);
    expect(qualifiedByGroup.I).toBeUndefined();
  });
});
