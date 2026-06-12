import { describe, expect, it } from 'vitest';

import { KO_GRAPH } from './knockoutSim';
import { buildR32 } from './r32Mapping';
import {
  activeVersionForRound,
  computePoints,
  scoreFunQuestion,
  type FunQuestionConfig,
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

// ---------------------------------------------------------------------------
// Big fixture: a full synthetic tournament.
//
// Group g: teams g1 > g2 > g3 > g4. g1 wins all, g2 beats g3/g4, g3 beats g4
// by a group-specific margin so that exactly the thirds of groups A–H qualify
// (combination ABCDEFGH = Annex C option 495). All knockout matches are won
// by the home side 1:0 in regular time, except M73 (1:1, pens).
// ---------------------------------------------------------------------------

const THIRD_MARGIN: Record<GroupId, number> = {
  A: 10, B: 9, C: 8, D: 7, E: 6, F: 5, G: 4, H: 3, I: 2, J: 1, K: 1, L: 1,
};

/** matchday-1: 1v2, 3v4 — matchday-2: 1v3, 4v2 — matchday-3: 4v1, 2v3. */
const GROUP_FIXTURE: ReadonlyArray<[home: number, away: number]> = [
  [1, 2], [3, 4], [1, 3], [4, 2], [4, 1], [2, 3],
];

function groupSchedule(): GroupMatchDef[] {
  return GROUP_IDS.flatMap((g) =>
    GROUP_FIXTURE.map(([h, a], i) => ({
      id: `${g}${i + 1}`,
      group: g,
      home: `${g}${h}`,
      away: `${g}${a}`,
    })),
  );
}

/** Real scores: ranks decide winners; g3 beats g4 by the group margin. */
function realScore(def: GroupMatchDef): [number, number] {
  const rank = (t: TeamId): number => Number(t[1]);
  const [h, a] = [rank(def.home), rank(def.away)];
  if (h === 3 && a === 4) return [THIRD_MARGIN[def.group], 0];
  if (h === 4 && a === 3) return [0, THIRD_MARGIN[def.group]];
  return h < a ? [1, 0] : [0, 1];
}

function playedGroupMatches(): GroupMatchDef[] {
  return groupSchedule().map((def) => {
    const [homeGoals, awayGoals] = realScore(def);
    return { ...def, homeGoals, awayGoals };
  });
}

const winners = Object.fromEntries(GROUP_IDS.map((g) => [g, `${g}1`])) as Record<
  GroupId,
  TeamId
>;
const runnersUp = Object.fromEntries(GROUP_IDS.map((g) => [g, `${g}2`])) as Record<
  GroupId,
  TeamId
>;
const qualifiedThirds = Object.fromEntries(
  (['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as GroupId[]).map((g) => [g, `${g}3`]),
);

/** Real knockout: home side of every match advances; M73 needs pens. */
function realKnockout(): RealKnockoutMatch[] {
  const r32 = buildR32({ winners, runnersUp, thirds: qualifiedThirds });
  const home = new Map<MatchNumber, TeamId>();
  const away = new Map<MatchNumber, TeamId>();
  for (const m of r32) {
    home.set(m.matchNumber, m.home);
    away.set(m.matchNumber, m.away);
  }
  for (const node of KO_GRAPH) {
    const pick = (feed: { match: MatchNumber; take: 'winner' | 'loser' }): TeamId =>
      feed.take === 'winner' ? home.get(feed.match)! : away.get(feed.match)!;
    home.set(node.matchNumber, pick(node.homeFrom));
    away.set(node.matchNumber, pick(node.awayFrom));
  }
  return Array.from({ length: 32 }, (_, i) => {
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

/** FIFA ranking that makes predicted thirds (all level on synthetic 1:0s) resolve to A3 > B3 > … > L3. */
const fifaRanking = Object.fromEntries(GROUP_IDS.map((g, i) => [`${g}3`, i + 1]));

const fullReal: RealResults = {
  groupMatches: playedGroupMatches(),
  knockoutMatches: realKnockout(),
  ctx: { fifaRanking },
};

/** Outcome predictions matching every real outcome. */
function perfectOutcomePredictions() {
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

/** Bracket picks naming every real advancer; AET flag on M73. */
function perfectBracket(): BracketVersion {
  const picks: Record<MatchNumber, KnockoutPick> = {};
  for (const m of realKnockout()) {
    picks[m.matchNumber] = { advancer: m.advancer, aetFlag: m.matchNumber === 73 };
  }
  return { multiplier: 1, picks };
}

const sum = (rows: readonly PointsRow[]): number =>
  rows.reduce((acc, r) => acc + r.points, 0);
const ofSource = (rows: readonly PointsRow[], source: PointsRow['source']) =>
  rows.filter((r) => r.source === source);

// ---------------------------------------------------------------------------

describe('computePoints — perfect Full entry (integration over every group rule)', () => {
  const entry: ScoringEntry = {
    entryId: 'perfect',
    challenge: 'FULL',
    hardcore: false,
    groupPredictions: perfectOutcomePredictions(),
    bracket: [perfectBracket()],
  };
  const { rows, stats } = computePoints({ real: fullReal, entries: [entry] });

  it('awards every scoring-table category at its SPEC value', () => {
    expect(sum(ofSource(rows, 'GROUP_OUTCOME'))).toBe(72 * 3);
    expect(sum(ofSource(rows, 'GROUP_EXACT_ORDER'))).toBe(12 * 10);
    expect(sum(ofSource(rows, 'QUALIFIER_TOP2'))).toBe(24 * 3);
    expect(sum(ofSource(rows, 'QUALIFIER_THIRD'))).toBe(8 * 4);
    // KO reach: 16×4 + 8×6 + 4×8 + 2×12 + champion 20 + third-place winner 6.
    expect(sum(ofSource(rows, 'KO_REACH'))).toBe(64 + 48 + 32 + 24 + 20 + 6);
    expect(sum(ofSource(rows, 'KO_AET_FLAG'))).toBe(1);
    expect(sum(rows)).toBe(216 + 120 + 72 + 32 + 194 + 1);
  });

  it('emits only GLOBAL rows for a non-hardcore entry', () => {
    expect(rows.every((r) => r.board === 'GLOBAL')).toBe(true);
  });

  it('labels milestone rows with team and round', () => {
    const champion = ofSource(rows, 'KO_REACH').find((r) => r.ref.endsWith(':CHAMPION'));
    expect(champion).toMatchObject({ ref: 'E1:CHAMPION', basePoints: 20, multiplier: 1 });
    const third = ofSource(rows, 'KO_REACH').find((r) =>
      r.ref.endsWith(':THIRD_PLACE_WINNER'),
    );
    expect(third).toMatchObject({ ref: 'K2:THIRD_PLACE_WINNER', basePoints: 6 });
  });

  it('fills the leaderboard tiebreaker stats', () => {
    expect(stats[0]).toEqual({
      entryId: 'perfect',
      correctQualifiers: 24 + 8,
      correctKoPicks: 32,
      correctOutcomes: 72,
    });
  });

  it('is idempotent: same input → identical output', () => {
    const again = computePoints({ real: fullReal, entries: [entry] });
    expect(again).toEqual({ rows, stats });
  });
});

describe('computePoints — group-stage rules in isolation', () => {
  // One group, complete, including a draw: A1 9, A2 4, A4 2, A3 1.
  const miniSchedule: GroupMatchDef[] = [
    { id: 'A1m', group: 'A', home: 'A1', away: 'A2', homeGoals: 1, awayGoals: 0 },
    { id: 'A2m', group: 'A', home: 'A3', away: 'A4', homeGoals: 2, awayGoals: 2 },
    { id: 'A3m', group: 'A', home: 'A1', away: 'A3', homeGoals: 2, awayGoals: 0 },
    { id: 'A4m', group: 'A', home: 'A4', away: 'A2', homeGoals: 1, awayGoals: 1 },
    { id: 'A5m', group: 'A', home: 'A4', away: 'A1', homeGoals: 0, awayGoals: 3 },
    { id: 'A6m', group: 'A', home: 'A2', away: 'A3', homeGoals: 1, awayGoals: 0 },
  ];
  const miniReal: RealResults = { groupMatches: miniSchedule, knockoutMatches: [] };

  it('correct outcome = 3, wrong outcome = 0, unplayed match = no row', () => {
    const real: RealResults = {
      groupMatches: [
        miniSchedule[0],
        miniSchedule[1],
        { id: 'A3m', group: 'A', home: 'A1', away: 'A3' }, // not played
      ],
      knockoutMatches: [],
    };
    const { rows } = computePoints({
      real,
      entries: [
        {
          entryId: 'e',
          challenge: 'GROUPS',
          hardcore: false,
          groupPredictions: [
            { matchId: 'A1m', outcome: 'HOME' }, // correct
            { matchId: 'A2m', outcome: 'HOME' }, // real was a draw
            { matchId: 'A3m', outcome: 'HOME' }, // not played yet
          ],
        },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        source: 'GROUP_OUTCOME',
        ref: 'A1m',
        points: 3,
        board: 'GLOBAL',
      }),
    ]);
  });

  it('exact group order pays 10 only when predicted order matches all 4 positions', () => {
    const right: ScoringEntry = {
      entryId: 'right',
      challenge: 'GROUPS',
      hardcore: false,
      groupPredictions: [
        { matchId: 'A1m', outcome: 'HOME' },
        { matchId: 'A2m', outcome: 'DRAW' },
        { matchId: 'A3m', outcome: 'HOME' },
        { matchId: 'A4m', outcome: 'DRAW' },
        { matchId: 'A5m', outcome: 'AWAY' },
        { matchId: 'A6m', outcome: 'HOME' },
      ],
    };
    // Same outcomes except A2m: predicts A3 win → predicted order flips A3/A4.
    const wrong: ScoringEntry = {
      ...right,
      entryId: 'wrong',
      groupPredictions: right.groupPredictions!.map((p) =>
        p.matchId === 'A2m' ? { matchId: 'A2m', outcome: 'HOME' as const } : p,
      ),
    };
    const { rows } = computePoints({ real: miniReal, entries: [right, wrong] });
    const exactRows = ofSource(rows, 'GROUP_EXACT_ORDER');
    expect(exactRows).toHaveLength(1);
    expect(exactRows[0]).toMatchObject({ entryId: 'right', ref: 'A', points: 10 });
    // Both still get the top-2 qualifier bonuses (A1, A2 in both predictions).
    const top2 = ofSource(rows, 'QUALIFIER_TOP2');
    expect(top2.filter((r) => r.entryId === 'right')).toHaveLength(2);
    expect(top2.filter((r) => r.entryId === 'wrong')).toHaveLength(2);
  });

  it('top-2 qualifier pays per team, independent of predicted position order', () => {
    // Predict A2 above A1 (swap first two): both still in real top 2 → 2 × 3.
    const { rows } = computePoints({
      real: miniReal,
      entries: [
        {
          entryId: 'swapped',
          challenge: 'GROUPS',
          hardcore: false,
          groupPredictions: [
            { matchId: 'A1m', outcome: 'AWAY' }, // A2 beats A1
            { matchId: 'A2m', outcome: 'DRAW' },
            { matchId: 'A3m', outcome: 'HOME' },
            { matchId: 'A4m', outcome: 'AWAY' },
            { matchId: 'A5m', outcome: 'AWAY' },
            { matchId: 'A6m', outcome: 'HOME' },
          ],
        },
      ],
    });
    expect(ofSource(rows, 'QUALIFIER_TOP2').map((r) => r.ref).sort()).toEqual([
      'A:A1',
      'A:A2',
    ]);
    expect(ofSource(rows, 'GROUP_EXACT_ORDER')).toHaveLength(0);
  });

  it('hardcore: exact score 5; GD bonus 2 only for non-draws; outcome still derived', () => {
    const { rows } = computePoints({
      real: miniReal,
      entries: [
        {
          entryId: 'hc',
          challenge: 'GROUPS',
          hardcore: true,
          groupPredictions: [
            { matchId: 'A1m', homeGoals: 1, awayGoals: 0 }, // exact → 5 + outcome 3
            { matchId: 'A2m', homeGoals: 1, awayGoals: 1 }, // draw, right outcome, GD equal → NO GD bonus
            { matchId: 'A3m', homeGoals: 3, awayGoals: 1 }, // 2:0 real → GD +2 ✓ → 2 + outcome 3
            { matchId: 'A4m', homeGoals: 2, awayGoals: 1 }, // real 1:1 → nothing
          ],
        },
      ],
    });
    expect(ofSource(rows, 'HC_EXACT_SCORE')).toEqual([
      expect.objectContaining({ ref: 'A1m', points: 5, board: 'HARDCORE' }),
    ]);
    expect(ofSource(rows, 'HC_GOAL_DIFF')).toEqual([
      expect.objectContaining({ ref: 'A3m', points: 2, board: 'HARDCORE' }),
    ]);
    expect(ofSource(rows, 'GROUP_OUTCOME').map((r) => r.ref).sort()).toEqual([
      'A1m',
      'A2m',
      'A3m',
    ]);
  });

  it('GROUPS challenge ignores brackets; PLAYOFF ignores group predictions', () => {
    const { rows } = computePoints({
      real: fullReal,
      entries: [
        {
          entryId: 'groups-with-bracket',
          challenge: 'GROUPS',
          hardcore: false,
          groupPredictions: perfectOutcomePredictions(),
          bracket: [perfectBracket()],
        },
        {
          entryId: 'playoff-with-groups',
          challenge: 'PLAYOFF',
          hardcore: false,
          groupPredictions: perfectOutcomePredictions(),
          bracket: [perfectBracket()],
        },
      ],
    });
    const groupsRows = rows.filter((r) => r.entryId === 'groups-with-bracket');
    const playoffRows = rows.filter((r) => r.entryId === 'playoff-with-groups');
    expect(groupsRows.some((r) => r.source.startsWith('KO_'))).toBe(false);
    expect(groupsRows.some((r) => r.source === 'GROUP_OUTCOME')).toBe(true);
    expect(playoffRows.every((r) => r.source.startsWith('KO_'))).toBe(true);
    expect(sum(ofSource(playoffRows, 'KO_REACH'))).toBe(194);
  });
});

describe('computePoints — knockout details', () => {
  it('AET/pens flag: +1 only when flagged, correct, and decided after 90 minutes', () => {
    const picks: Record<MatchNumber, KnockoutPick> = {};
    for (const m of realKnockout()) picks[m.matchNumber] = { advancer: m.advancer };
    picks[73] = { advancer: 'A2', aetFlag: true }; // real: pens → +1
    picks[74] = { advancer: 'E1', aetFlag: true }; // real: regular time → no bonus
    picks[75] = { advancer: 'C2', aetFlag: true }; // wrong advancer (real F1) → no bonus
    const { rows } = computePoints({
      real: fullReal,
      entries: [
        { entryId: 'e', challenge: 'PLAYOFF', hardcore: false, bracket: [{ multiplier: 1, picks }] },
      ],
    });
    expect(ofSource(rows, 'KO_AET_FLAG')).toEqual([
      expect.objectContaining({ ref: 'M73', points: 1 }),
    ]);
  });

  it('a predicted team that did not reach a round scores 0 for it', () => {
    // Predict B2 to win M73 (real winner A2): no reach row for B2.
    const { rows } = computePoints({
      real: fullReal,
      entries: [
        {
          entryId: 'e',
          challenge: 'PLAYOFF',
          hardcore: false,
          bracket: [{ multiplier: 1, picks: { 73: { advancer: 'B2' } } }],
        },
      ],
    });
    expect(ofSource(rows, 'KO_REACH')).toHaveLength(0);
  });

  it('hardcore knockout: exact 90-minute score 5, GD 2, draw + correct advancer 2', () => {
    const picks: Record<MatchNumber, KnockoutPick> = {
      73: { homeGoals: 1, awayGoals: 1, advancer: 'A2' }, // real 1:1 pens A2 → ADVANCE_PICK 2
      74: { homeGoals: 1, awayGoals: 0 }, // real 1:0 → EXACT 5
      75: { homeGoals: 2, awayGoals: 1 }, // real 1:0 → GD 2
      76: { homeGoals: 0, awayGoals: 1 }, // real 1:0 → wrong sign → nothing
    };
    const { rows } = computePoints({
      real: fullReal,
      entries: [
        { entryId: 'hc', challenge: 'PLAYOFF', hardcore: true, bracket: [{ multiplier: 1, picks }] },
      ],
    });
    expect(ofSource(rows, 'HC_ADVANCE_PICK')).toEqual([
      expect.objectContaining({ ref: 'M73', points: 2, board: 'HARDCORE' }),
    ]);
    // M73's 1:1 is ALSO the exact 90' score → stacks with the advance pick.
    expect(ofSource(rows, 'HC_EXACT_SCORE')).toEqual([
      expect.objectContaining({ ref: 'M73', points: 5 }),
      expect.objectContaining({ ref: 'M74', points: 5 }),
    ]);
    expect(ofSource(rows, 'HC_GOAL_DIFF')).toEqual([
      expect.objectContaining({ ref: 'M75', points: 2 }),
    ]);
    // Reach rows derive from decisive scores too: M74 1:0 → E1 reached R16.
    expect(
      ofSource(rows, 'KO_REACH').map((r) => r.ref),
    ).toEqual(expect.arrayContaining(['E1:R16', 'A2:R16', 'F1:R16']));
  });

  it('hardcore score bonuses require the predicted pairing to match the real one', () => {
    // Full hardcore entry predicting group C upside down: C2 wins the group.
    // Their predicted M76 is C2 v F2 (real: C1 v F2) → no exact-score bonus
    // there even though the scoreline matches the real M76.
    const preds = playedGroupMatches().map((m) => {
      let [hg, ag] = [m.homeGoals!, m.awayGoals!];
      if (m.group === 'C') {
        const flip = (t: TeamId): TeamId => (t === 'C1' ? 'C2' : t === 'C2' ? 'C1' : t);
        // Swap C1 and C2 results by re-deriving the score for flipped ranks.
        const rank = (t: TeamId): number => Number(flip(t)[1]);
        const [h, a] = [rank(m.home), rank(m.away)];
        if (h === 3 && a === 4) [hg, ag] = [THIRD_MARGIN.C, 0];
        else if (h === 4 && a === 3) [hg, ag] = [0, THIRD_MARGIN.C];
        else [hg, ag] = h < a ? [1, 0] : [0, 1];
      }
      return { matchId: m.id, homeGoals: hg, awayGoals: ag };
    });
    const picks: Record<MatchNumber, KnockoutPick> = {
      76: { homeGoals: 1, awayGoals: 0 }, // their pairing C2vF2 ≠ real C1vF2
      77: { homeGoals: 1, awayGoals: 0 }, // pairing I1v F3 — unaffected → exact
    };
    const { rows } = computePoints({
      real: fullReal,
      entries: [
        {
          entryId: 'hc',
          challenge: 'FULL',
          hardcore: true,
          groupPredictions: preds,
          bracket: [{ multiplier: 1, picks }],
        },
      ],
    });
    // Group-match hardcore rows (refs like 'A1') are unaffected; only the
    // knockout rows (refs 'M«n»') are under test here.
    const koExact = ofSource(rows, 'HC_EXACT_SCORE').filter((r) => r.ref.startsWith('M'));
    expect(koExact.map((r) => r.ref)).toEqual(['M77']);
  });
});

describe('computePoints — redistribution multipliers', () => {
  it('rows decided before the redistributed stage keep full value; later rows scale', () => {
    const original = perfectBracket();
    const redistributed: BracketVersion = {
      redistributedBefore: 'QF',
      multiplier: 0.5,
      picks: original.picks, // same (correct) picks, lower reward
    };
    const { rows } = computePoints({
      real: fullReal,
      entries: [
        {
          entryId: 'redist',
          challenge: 'FULL',
          hardcore: false,
          groupPredictions: perfectOutcomePredictions(),
          bracket: [original, redistributed],
        },
      ],
    });
    const reach = ofSource(rows, 'KO_REACH');
    const byRound = (suffix: string) => reach.filter((r) => r.ref.endsWith(`:${suffix}`));
    // Reaching R16 (decided in R32) and QF (decided in R16) predate the QF
    // redistribution → ×1. SF and beyond are decided from QF onward → ×0.5.
    expect(byRound('R16').every((r) => r.multiplier === 1 && r.points === 4)).toBe(true);
    expect(byRound('QF').every((r) => r.multiplier === 1 && r.points === 6)).toBe(true);
    expect(byRound('SF').every((r) => r.multiplier === 0.5 && r.points === 4)).toBe(true);
    expect(byRound('F').every((r) => r.multiplier === 0.5 && r.points === 6)).toBe(true);
    expect(byRound('CHAMPION')[0]).toMatchObject({ multiplier: 0.5, points: 10 });
    expect(byRound('THIRD_PLACE_WINNER')[0]).toMatchObject({ multiplier: 0.5, points: 3 });
    expect(sum(reach)).toBe(64 + 48 + 0.5 * (32 + 24 + 20 + 6));
  });

  it('activeVersionForRound picks the latest version whose start stage covers the round', () => {
    const v0: BracketVersion = { multiplier: 1, picks: {} };
    const v1: BracketVersion = { redistributedBefore: 'R16', multiplier: 0.6, picks: {} };
    const v2: BracketVersion = { redistributedBefore: 'SF', multiplier: 0.4, picks: {} };
    const versions = [v0, v1, v2];
    expect(activeVersionForRound(versions, 'R32')).toBe(v0);
    expect(activeVersionForRound(versions, 'R16')).toBe(v1);
    expect(activeVersionForRound(versions, 'QF')).toBe(v1);
    expect(activeVersionForRound(versions, 'SF')).toBe(v2);
    expect(activeVersionForRound(versions, 'F')).toBe(v2);
  });

  it('redistributed picks replace the original from their stage onward', () => {
    // Original picks the WRONG team everywhere; redistribution before R32
    // (×0.7) picks every real advancer → all reach rows exist at ×0.7.
    const wrongPicks: Record<MatchNumber, KnockoutPick> = {};
    for (const m of realKnockout()) {
      wrongPicks[m.matchNumber] = { advancer: m.away === m.advancer ? m.home : m.away };
    }
    const right = perfectBracket();
    const { rows } = computePoints({
      real: fullReal,
      entries: [
        {
          entryId: 'e',
          challenge: 'FULL',
          hardcore: false,
          groupPredictions: perfectOutcomePredictions(),
          bracket: [
            { multiplier: 1, picks: wrongPicks },
            { redistributedBefore: 'R32', multiplier: 0.7, picks: right.picks },
          ],
        },
      ],
    });
    const reach = ofSource(rows, 'KO_REACH');
    expect(reach.every((r) => r.multiplier === 0.7)).toBe(true);
    expect(sum(reach)).toBeCloseTo(0.7 * 194, 10);
  });
});

describe('computePoints — fun challenge', () => {
  const questions: FunQuestionConfig[] = [
    { id: 'goals', type: 'NUMERIC', maxPts: 10, tolerance: 30 },
    { id: 'reds', type: 'NUMERIC', maxPts: 10, tolerance: 6 },
    { id: 'ball', type: 'PICK' },
    { id: 'hattrick', type: 'YESNO' },
  ];

  it('scores numeric closeness, exact picks, and yes/no per SPEC', () => {
    const { rows } = computePoints({
      real: { groupMatches: [], knockoutMatches: [] },
      funQuestions: questions,
      funActuals: { goals: 170, reds: 4, ball: 'Messi', hattrick: true },
      entries: [
        {
          entryId: 'fun',
          challenge: 'FUN',
          hardcore: false,
          funAnswers: { goals: 155, reds: 10, ball: 'Messi', hattrick: false },
        },
      ],
    });
    const byRef = Object.fromEntries(rows.map((r) => [r.ref, r.points]));
    expect(byRef.goals).toBe(5); // 10·(1−15/30) = 5
    expect(byRef.reds).toBeUndefined(); // |10−4| = tolerance → 0 → no row
    expect(byRef.ball).toBe(15);
    expect(byRef.hattrick).toBeUndefined(); // wrong yes/no
    expect(rows).toHaveLength(2);
  });

  it('skips questions whose actual value is not resolved yet (partial input)', () => {
    const { rows } = computePoints({
      real: { groupMatches: [], knockoutMatches: [] },
      funQuestions: questions,
      funActuals: { goals: null },
      entries: [
        {
          entryId: 'fun',
          challenge: 'FUN',
          hardcore: false,
          funAnswers: { goals: 170, ball: 'Messi' },
        },
      ],
    });
    expect(rows).toHaveLength(0);
  });

  it('scoreFunQuestion: closeness formula boundaries and rounding', () => {
    const q: FunQuestionConfig = { id: 'q', type: 'NUMERIC', maxPts: 10, tolerance: 30 };
    expect(scoreFunQuestion(q, 100, 100)).toBe(10); // exact → max
    expect(scoreFunQuestion(q, 70, 100)).toBe(0); // |diff| = tolerance → 0
    expect(scoreFunQuestion(q, 40, 100)).toBe(0); // beyond tolerance → clamped
    expect(scoreFunQuestion(q, 99, 100)).toBe(10); // round(9.67) = 10
    expect(scoreFunQuestion(q, 92, 100)).toBe(7); // round(7.33) = 7
    expect(scoreFunQuestion({ ...q, maxPts: undefined }, 100, 100)).toBe(10); // default
  });
});

describe('computePoints — totality & partial results', () => {
  it('no results → no rows (never throws)', () => {
    const { rows, stats } = computePoints({
      real: { groupMatches: groupSchedule(), knockoutMatches: [] },
      entries: [
        {
          entryId: 'e',
          challenge: 'FULL',
          hardcore: false,
          groupPredictions: perfectOutcomePredictions(),
          bracket: [perfectBracket()],
        },
      ],
    });
    expect(rows).toHaveLength(0);
    expect(stats[0]).toMatchObject({
      correctQualifiers: 0,
      correctKoPicks: 0,
      correctOutcomes: 0,
    });
  });

  it('mid-tournament state yields partial points only for decided things', () => {
    // Only group A fully played, nothing else.
    const partial: RealResults = {
      groupMatches: groupSchedule().map((def) =>
        def.group === 'A'
          ? { ...def, ...(([h, a]) => ({ homeGoals: h, awayGoals: a }))(realScore(def)) }
          : def,
      ),
      knockoutMatches: [],
      ctx: { fifaRanking },
    };
    const { rows } = computePoints({
      real: partial,
      entries: [
        {
          entryId: 'e',
          challenge: 'FULL',
          hardcore: false,
          groupPredictions: perfectOutcomePredictions(),
          bracket: [perfectBracket()],
        },
      ],
    });
    expect(sum(ofSource(rows, 'GROUP_OUTCOME'))).toBe(6 * 3);
    expect(sum(ofSource(rows, 'GROUP_EXACT_ORDER'))).toBe(10);
    expect(sum(ofSource(rows, 'QUALIFIER_TOP2'))).toBe(2 * 3);
    // Best-thirds undecided until all groups complete → no third rows yet.
    expect(ofSource(rows, 'QUALIFIER_THIRD')).toHaveLength(0);
    expect(ofSource(rows, 'KO_REACH')).toHaveLength(0);
  });
});
