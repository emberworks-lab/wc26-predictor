import { describe, expect, it } from 'vitest';

import { KO_GRAPH } from './knockoutSim';
import { buildR32 } from './r32Mapping';
import {
  computePoints,
  type GroupMatchDef,
  type PointsRow,
  type RealResults,
  type ScoringEntry,
} from './scoring';
import type {
  BracketVersion,
  GroupId,
  KnockoutPick,
  MatchNumber,
  RealKnockoutMatch,
  TeamId,
} from './types';
import { GROUP_IDS } from './types';

/**
 * Stage 7 integration test (stage prompt: "entry with gen-0 wrecked bracket +
 * gen-1 redistribution at R16 → hand-computed expected totals").
 *
 * World: the synthetic tournament from scoring.test.ts (group g: g1 > g2 >
 * g3 > g4; thirds of A–H qualify; knockout home side advances, M73 on pens)
 * — but mid-tournament: groups + R32 + R16 are FINISHED, QF onward unplayed.
 *
 * Entries (one casual, one hardcore), both Full with perfect group
 * predictions (predicted R32 = real R32) and:
 *  - gen 0 (×1): R32 picks correct for M73–M80, wrong for M81–M88;
 *    everything from R16 on picks the away side of its own wrecked bracket.
 *  - gen 1 (redistributedBefore R16, ×0.6): perfect picks on the real
 *    bracket from R16 onward.
 *
 * HAND-COMPUTED (casual):
 *   groups: outcomes 72×3 = 216, exact orders 12×10 = 120,
 *           top-2 24×3 = 72, thirds 8×4 = 32                    → 440
 *   R16-reach (decided in R32, gen 0, ×1): 8 correct × 4        → 32
 *   AET flag on M73 (correct pick + flag + pens, gen 0, ×1)     → 1
 *   QF-reach (decided in R16, gen 1, ×0.6): 8 × 6 × 0.6         → 28.8
 *   SF/F/champion/third-place: no real results yet              → 0
 *   GLOBAL TOTAL                                                → 501.8
 *
 * HAND-COMPUTED (hardcore, global board):
 *   groups 440 + R16-reach 32 + QF-reach 28.8 (no AET bonus —
 *   hardcore entries don't use the flag)                        → 500.8
 * HAND-COMPUTED (hardcore board):
 *   group exact scores 72×5 = 360
 *   R32 exact scores, gen 0 ×1: M73–M80 predicted 1:0 — real is
 *     1:0 except M73 (1:1 pens) → 7×5 = 35; wrong half predicted
 *     0:1 vs real 1:0 → neither exact nor GD                    → 35
 *   R16 exact scores, gen 1 ×0.6: 8 × 5 × 0.6                   → 24
 *   HARDCORE TOTAL                                              → 419
 */

// --- world (mirrors scoring.test.ts) ----------------------------------------

const THIRD_MARGIN: Record<GroupId, number> = {
  A: 10, B: 9, C: 8, D: 7, E: 6, F: 5, G: 4, H: 3, I: 2, J: 1, K: 1, L: 1,
};

const GROUP_FIXTURE: ReadonlyArray<[home: number, away: number]> = [
  [1, 2], [3, 4], [1, 3], [4, 2], [4, 1], [2, 3],
];

function realScore(group: GroupId, home: TeamId, away: TeamId): [number, number] {
  const rank = (t: TeamId): number => Number(t[1]);
  const [h, a] = [rank(home), rank(away)];
  if (h === 3 && a === 4) return [THIRD_MARGIN[group], 0];
  if (h === 4 && a === 3) return [0, THIRD_MARGIN[group]];
  return h < a ? [1, 0] : [0, 1];
}

function playedGroupMatches(): GroupMatchDef[] {
  return GROUP_IDS.flatMap((g) =>
    GROUP_FIXTURE.map(([h, a], i) => {
      const home = `${g}${h}`;
      const away = `${g}${a}`;
      const [homeGoals, awayGoals] = realScore(g, home, away);
      return { id: `${g}${i + 1}`, group: g, home, away, homeGoals, awayGoals };
    }),
  );
}

const winners = Object.fromEntries(GROUP_IDS.map((g) => [g, `${g}1`])) as Record<GroupId, TeamId>;
const runnersUp = Object.fromEntries(GROUP_IDS.map((g) => [g, `${g}2`])) as Record<GroupId, TeamId>;
const qualifiedThirds = Object.fromEntries(
  (['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as GroupId[]).map((g) => [g, `${g}3`]),
);

/** Pairings of the full real bracket (home side always advances). */
function realPairings(): { home: Map<MatchNumber, TeamId>; away: Map<MatchNumber, TeamId> } {
  const home = new Map<MatchNumber, TeamId>();
  const away = new Map<MatchNumber, TeamId>();
  for (const m of buildR32({ winners, runnersUp, thirds: qualifiedThirds })) {
    home.set(m.matchNumber, m.home);
    away.set(m.matchNumber, m.away);
  }
  for (const node of KO_GRAPH) {
    const pick = (feed: { match: MatchNumber; take: 'winner' | 'loser' }): TeamId =>
      feed.take === 'winner' ? home.get(feed.match)! : away.get(feed.match)!;
    home.set(node.matchNumber, pick(node.homeFrom));
    away.set(node.matchNumber, pick(node.awayFrom));
  }
  return { home, away };
}

/** Finished knockout matches: R32 (73–88) + R16 (89–96) only. M73 on pens. */
function playedKnockout(): RealKnockoutMatch[] {
  const { home, away } = realPairings();
  return Array.from({ length: 24 }, (_, i) => {
    const n = 73 + i;
    const isPens = n === 73;
    return {
      matchNumber: n,
      home: home.get(n)!,
      away: away.get(n)!,
      homeGoals90: 1,
      awayGoals90: isPens ? 1 : 0,
      advancer: home.get(n)!,
      decidedBy: isPens ? ('PEN' as const) : ('REG' as const),
    };
  });
}

const fifaRanking = Object.fromEntries(GROUP_IDS.map((g, i) => [`${g}3`, i + 1]));

const real: RealResults = {
  groupMatches: playedGroupMatches(),
  knockoutMatches: playedKnockout(),
  ctx: { fifaRanking },
};

// --- entries -----------------------------------------------------------------

const CORRECT_R32 = new Set<MatchNumber>([73, 74, 75, 76, 77, 78, 79, 80]);

/**
 * Gen 0, wrecked: correct (home) advancer for M73–M80, wrong (away) for
 * M81–M88, then the away side of its OWN resulting bracket all the way up.
 */
function wreckedGen0(hardcore: boolean): BracketVersion {
  const { home, away } = realPairings();
  const myWinner = new Map<MatchNumber, TeamId>();
  const myLoser = new Map<MatchNumber, TeamId>();
  const picks: Record<MatchNumber, KnockoutPick> = {};

  const pickSide = (n: MatchNumber, h: TeamId, a: TeamId): void => {
    const homeWins = n >= 73 && n <= 88 ? CORRECT_R32.has(n) : false;
    myWinner.set(n, homeWins ? h : a);
    myLoser.set(n, homeWins ? a : h);
    picks[n] = hardcore
      ? { homeGoals: homeWins ? 1 : 0, awayGoals: homeWins ? 0 : 1 }
      : { advancer: homeWins ? h : a, aetFlag: n === 73 };
  };

  for (let n = 73 as MatchNumber; n <= 88; n += 1) pickSide(n, home.get(n)!, away.get(n)!);
  for (const node of KO_GRAPH) {
    const feed = (f: { match: MatchNumber; take: 'winner' | 'loser' }): TeamId =>
      f.take === 'winner' ? myWinner.get(f.match)! : myLoser.get(f.match)!;
    pickSide(node.matchNumber, feed(node.homeFrom), feed(node.awayFrom));
  }
  return { multiplier: 1, picks };
}

/** Gen 1 (before R16, ×0.6): the real advancer (home side) from M89 onward. */
function redistributedGen1(hardcore: boolean): BracketVersion {
  const { home } = realPairings();
  const picks: Record<MatchNumber, KnockoutPick> = {};
  for (let n = 89 as MatchNumber; n <= 104; n += 1) {
    picks[n] = hardcore ? { homeGoals: 1, awayGoals: 0 } : { advancer: home.get(n)! };
  }
  return { redistributedBefore: 'R16', multiplier: 0.6, picks };
}

function groupPredictions(hardcore: boolean) {
  return playedGroupMatches().map((m) =>
    hardcore
      ? { matchId: m.id, homeGoals: m.homeGoals!, awayGoals: m.awayGoals! }
      : {
          matchId: m.id,
          outcome:
            m.homeGoals! > m.awayGoals!
              ? ('HOME' as const)
              : m.homeGoals! < m.awayGoals!
                ? ('AWAY' as const)
                : ('DRAW' as const),
        },
  );
}

function entry(id: string, hardcore: boolean): ScoringEntry {
  return {
    entryId: id,
    challenge: 'FULL',
    hardcore,
    groupPredictions: groupPredictions(hardcore),
    bracket: [wreckedGen0(hardcore), redistributedGen1(hardcore)],
  };
}

const sum = (rows: readonly PointsRow[]): number =>
  rows.reduce((acc, r) => acc + r.points, 0);

// ---------------------------------------------------------------------------

describe('redistribution integration — wrecked gen 0 + gen 1 before R16 (hand-computed)', () => {
  const { rows, stats } = computePoints({
    real,
    entries: [entry('casual', false), entry('hardcore', true)],
  });
  const casual = rows.filter((r) => r.entryId === 'casual');
  const hc = rows.filter((r) => r.entryId === 'hardcore');

  it('casual entry: global total is exactly 501.8', () => {
    const groups = casual.filter((r) =>
      ['GROUP_OUTCOME', 'GROUP_EXACT_ORDER', 'QUALIFIER_TOP2', 'QUALIFIER_THIRD'].includes(r.source),
    );
    expect(sum(groups)).toBe(216 + 120 + 72 + 32);

    const r16Reach = casual.filter((r) => r.source === 'KO_REACH' && r.ref.endsWith(':R16'));
    expect(r16Reach).toHaveLength(8);
    expect(r16Reach.every((r) => r.multiplier === 1 && r.points === 4)).toBe(true);

    const aet = casual.filter((r) => r.source === 'KO_AET_FLAG');
    expect(aet).toEqual([
      expect.objectContaining({ ref: 'M73', points: 1, multiplier: 1 }),
    ]);

    const qfReach = casual.filter((r) => r.source === 'KO_REACH' && r.ref.endsWith(':QF'));
    expect(qfReach).toHaveLength(8);
    expect(qfReach.every((r) => r.multiplier === 0.6 && r.basePoints === 6)).toBe(true);
    expect(sum(qfReach)).toBeCloseTo(28.8, 10);

    // No SF / final / champion / third-place rows — those matches are unplayed.
    const later = casual.filter(
      (r) =>
        r.source === 'KO_REACH' &&
        !r.ref.endsWith(':R16') &&
        !r.ref.endsWith(':QF'),
    );
    expect(later).toHaveLength(0);

    expect(sum(casual)).toBeCloseTo(440 + 32 + 1 + 28.8, 10);
    expect(casual.every((r) => r.board === 'GLOBAL')).toBe(true);
  });

  it('hardcore entry: global 500.8, hardcore board exactly 419', () => {
    const global = hc.filter((r) => r.board === 'GLOBAL');
    expect(sum(global)).toBeCloseTo(440 + 32 + 28.8, 10);

    const board = hc.filter((r) => r.board === 'HARDCORE');
    const groupExact = board.filter(
      (r) => r.source === 'HC_EXACT_SCORE' && !r.ref.startsWith('M'),
    );
    expect(sum(groupExact)).toBe(72 * 5);

    // Gen-0 R32 exact scores at full value: M74–M80 (M73's real 90' was 1:1).
    const r32Exact = board.filter(
      (r) => r.source === 'HC_EXACT_SCORE' && r.ref.startsWith('M') && Number(r.ref.slice(1)) <= 88,
    );
    expect(r32Exact).toHaveLength(7);
    expect(r32Exact.every((r) => r.multiplier === 1 && r.points === 5)).toBe(true);

    // Gen-1 R16 exact scores at ×0.6.
    const r16Exact = board.filter(
      (r) => r.source === 'HC_EXACT_SCORE' && r.ref.startsWith('M') && Number(r.ref.slice(1)) >= 89,
    );
    expect(r16Exact).toHaveLength(8);
    expect(r16Exact.every((r) => r.multiplier === 0.6 && r.points === 3)).toBe(true);

    expect(board.filter((r) => r.source === 'HC_GOAL_DIFF')).toHaveLength(0);
    expect(sum(board)).toBe(360 + 35 + 24);
  });

  it('tiebreaker stats count picks across the active generations', () => {
    for (const s of stats) {
      expect(s.correctQualifiers).toBe(24 + 8);
      expect(s.correctOutcomes).toBe(72);
      // 8 correct R32 picks (gen 0) + 8 correct R16 picks (gen 1).
      expect(s.correctKoPicks).toBe(16);
    }
  });

  it('is idempotent', () => {
    const again = computePoints({
      real,
      entries: [entry('casual', false), entry('hardcore', true)],
    });
    expect(again.rows).toEqual(rows);
    expect(again.stats).toEqual(stats);
  });
});
