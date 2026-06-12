/**
 * Late-joiner / hardcore-flip fallbacks (Stage 5 engine extension).
 *
 * Live reality: matches kick off before some users join (or finish before a
 * casual→hardcore flip), so predictions for them can never be written. For
 * TABLE-DERIVATION purposes (predicted group tables → thirds → personal R32)
 * a missing prediction on a FINISHED real match falls back to the real
 * result; a hardcore prediction without scores falls back to its stored
 * outcome (synthetic 1:0/0:0/0:1). Match-outcome points and hardcore score
 * bonuses still require an actual stored prediction ("late joiners simply
 * score 0 on those matches").
 */

import { describe, expect, it } from 'vitest';

import {
  computePoints,
  POINTS,
  type GroupMatchDef,
  type GroupMatchPrediction,
  type PointsRow,
  type RealResults,
  type ScoringEntry,
} from './scoring';
import type { GroupId, TeamId } from './types';
import { GROUP_IDS } from './types';

// Same synthetic-tournament shape as scoring.test.ts: in group g, g1 > g2 >
// g3 > g4; g3 beats g4 by a margin that qualifies the thirds of A–H.
const THIRD_MARGIN: Record<GroupId, number> = {
  A: 10, B: 9, C: 8, D: 7, E: 6, F: 5, G: 4, H: 3, I: 2, J: 1, K: 1, L: 1,
};
const GROUP_FIXTURE: ReadonlyArray<[home: number, away: number]> = [
  [1, 2], [3, 4], [1, 3], [4, 2], [4, 1], [2, 3],
];

function playedGroupMatches(): GroupMatchDef[] {
  return GROUP_IDS.flatMap((g) =>
    GROUP_FIXTURE.map(([h, a], i) => {
      const def = { id: `${g}${i + 1}`, group: g, home: `${g}${h}`, away: `${g}${a}` };
      const rank = (t: TeamId): number => Number(t[1]);
      const [rh, ra] = [rank(def.home), rank(def.away)];
      const [homeGoals, awayGoals] =
        rh === 3 && ra === 4
          ? [THIRD_MARGIN[g], 0]
          : rh === 4 && ra === 3
            ? [0, THIRD_MARGIN[g]]
            : rh < ra
              ? [1, 0]
              : [0, 1];
      return { ...def, homeGoals, awayGoals };
    }),
  );
}

const fifaRanking = Object.fromEntries(GROUP_IDS.map((g, i) => [`${g}3`, i + 1]));
const real: RealResults = {
  groupMatches: playedGroupMatches(),
  knockoutMatches: [],
  ctx: { fifaRanking },
};

function perfectOutcomePredictions(): GroupMatchPrediction[] {
  return playedGroupMatches().map((m) => ({
    matchId: m.id,
    outcome:
      m.homeGoals! > m.awayGoals!
        ? ('HOME' as const)
        : m.homeGoals! < m.awayGoals!
          ? ('AWAY' as const)
          : ('DRAW' as const),
  }));
}

const ofSource = (rows: readonly PointsRow[], source: PointsRow['source']) =>
  rows.filter((r) => r.source === source);

describe('late joiner: missing prediction on a finished match', () => {
  // Joined after A1 (A: 1v2) kicked off — no prediction for it, perfect otherwise.
  const entry: ScoringEntry = {
    entryId: 'late',
    challenge: 'GROUPS',
    hardcore: false,
    groupPredictions: perfectOutcomePredictions().filter((p) => p.matchId !== 'A1'),
  };
  const { rows } = computePoints({ real, entries: [entry] });

  it('scores 0 outcome points on the missed match', () => {
    expect(ofSource(rows, 'GROUP_OUTCOME').some((r) => r.ref === 'A1')).toBe(false);
    expect(ofSource(rows, 'GROUP_OUTCOME')).toHaveLength(71);
  });

  it('still earns exact group order for the gap group (real result fills the table)', () => {
    expect(ofSource(rows, 'GROUP_EXACT_ORDER').map((r) => r.ref)).toContain('A');
    expect(ofSource(rows, 'GROUP_EXACT_ORDER')).toHaveLength(12);
  });

  it('still earns top-2 and third-place qualifier points (predicted groups complete)', () => {
    expect(ofSource(rows, 'QUALIFIER_TOP2')).toHaveLength(24);
    expect(ofSource(rows, 'QUALIFIER_THIRD')).toHaveLength(8);
  });
});

describe('late joiner: gap on an UNFINISHED match stays open', () => {
  // Same fixture but match A1 has no real result either: group A cannot
  // resolve, so no exact-order/top2 for A and no cross-group thirds at all.
  const unfinished: RealResults = {
    groupMatches: playedGroupMatches().map((m) =>
      m.id === 'A1' ? { id: m.id, group: m.group, home: m.home, away: m.away } : m,
    ),
    knockoutMatches: [],
    ctx: { fifaRanking },
  };
  const entry: ScoringEntry = {
    entryId: 'late-unfinished',
    challenge: 'GROUPS',
    hardcore: false,
    groupPredictions: perfectOutcomePredictions().filter((p) => p.matchId !== 'A1'),
  };
  const { rows } = computePoints({ real: unfinished, entries: [entry] });

  it('does not invent a table for the incomplete group', () => {
    expect(ofSource(rows, 'GROUP_EXACT_ORDER').map((r) => r.ref)).not.toContain('A');
    expect(ofSource(rows, 'QUALIFIER_THIRD')).toHaveLength(0);
  });
});

describe('casual→hardcore flip: outcome-only prediction on a locked match', () => {
  // Hardcore entry whose A1 prediction has an outcome but no scores (was made
  // while casual; the match locked before the flip).
  const preds = perfectOutcomePredictions().map((p) =>
    p.matchId === 'A1'
      ? p
      : {
          matchId: p.matchId,
          // Exact real scores everywhere else (hardcore predictions).
          homeGoals: playedGroupMatches().find((m) => m.id === p.matchId)!.homeGoals!,
          awayGoals: playedGroupMatches().find((m) => m.id === p.matchId)!.awayGoals!,
        },
  );
  const entry: ScoringEntry = {
    entryId: 'flipped',
    challenge: 'GROUPS',
    hardcore: true,
    groupPredictions: preds,
  };
  const { rows } = computePoints({ real, entries: [entry] });

  it('still pays the outcome point from the stored outcome', () => {
    expect(ofSource(rows, 'GROUP_OUTCOME').some((r) => r.ref === 'A1')).toBe(true);
    expect(ofSource(rows, 'GROUP_OUTCOME')).toHaveLength(72);
  });

  it('pays no hardcore score bonus without scores', () => {
    expect(ofSource(rows, 'HC_EXACT_SCORE').some((r) => r.ref === 'A1')).toBe(false);
    expect(ofSource(rows, 'HC_EXACT_SCORE')).toHaveLength(71);
  });

  it('derives the predicted table with the synthetic outcome (exact order still pays)', () => {
    // A1 was 1v2 = 1:0 real; the synthetic 1:0 for HOME matches it exactly, so
    // group A's predicted order matches reality.
    expect(ofSource(rows, 'GROUP_EXACT_ORDER').map((r) => r.ref)).toContain('A');
    expect(ofSource(rows, 'GROUP_EXACT_ORDER')).toHaveLength(12);
  });

  it('sanity: per-match points value unchanged', () => {
    const a1 = ofSource(rows, 'GROUP_OUTCOME').find((r) => r.ref === 'A1')!;
    expect(a1.points).toBe(POINTS.groupOutcome);
  });
});
