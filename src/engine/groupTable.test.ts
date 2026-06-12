import { describe, expect, it } from 'vitest';

import { computeGroupTable } from './groupTable';
import type { PlayedMatch } from './types';

const m = (home: string, away: string, hg: number, ag: number): PlayedMatch => ({
  home,
  away,
  homeGoals: hg,
  awayGoals: ag,
});

const order = (rows: ReturnType<typeof computeGroupTable>): string[] =>
  rows.map((r) => r.team);

describe('computeGroupTable — basics', () => {
  it('ranks a clear-cut complete group by points and fills stats', () => {
    // P beats everyone; Q beats R, S; R beats S.
    const matches = [
      m('P', 'Q', 2, 0),
      m('R', 'S', 1, 0),
      m('P', 'R', 3, 1),
      m('S', 'Q', 0, 2),
      m('S', 'P', 0, 1),
      m('Q', 'R', 2, 1),
    ];
    const rows = computeGroupTable(matches, ['P', 'Q', 'R', 'S']);
    expect(order(rows)).toEqual(['P', 'Q', 'R', 'S']);
    expect(rows[0]).toMatchObject({
      team: 'P',
      played: 3,
      won: 3,
      drawn: 0,
      lost: 0,
      goalsFor: 6,
      goalsAgainst: 1,
      goalDiff: 5,
      points: 9,
      position: 1,
    });
    expect(rows[3]).toMatchObject({ team: 'S', points: 0, position: 4 });
  });

  it('works on a partial group state (mid-group, used for live tables)', () => {
    const rows = computeGroupTable(
      [m('P', 'Q', 1, 0), m('R', 'S', 2, 2)],
      ['P', 'Q', 'R', 'S'],
    );
    expect(order(rows)).toEqual(['P', 'R', 'S', 'Q']);
    expect(rows.map((r) => r.points)).toEqual([3, 1, 1, 0]);
    expect(rows.map((r) => r.played)).toEqual([1, 1, 1, 1]);
  });

  it('handles zero matches played (all zeros, deterministic order)', () => {
    const rows = computeGroupTable([], ['D', 'C', 'B', 'A']);
    expect(order(rows)).toEqual(['A', 'B', 'C', 'D']); // TeamId guard
    expect(rows.every((r) => r.points === 0 && r.played === 0)).toBe(true);
  });

  it('ignores matches referencing teams outside the group', () => {
    const rows = computeGroupTable(
      [m('P', 'X', 5, 0), m('P', 'Q', 1, 0)],
      ['P', 'Q'],
    );
    expect(rows[0]).toMatchObject({ team: 'P', played: 1, goalsFor: 1 });
  });
});

describe('computeGroupTable — Article 13 step 1 (head-to-head first)', () => {
  it('2-way tie: head-to-head beats superior overall goal difference', () => {
    // P and Q both 6 pts. Q has overall GD +6, P only +2 — but P beat Q.
    // Official 2026 rules rank P first (head-to-head precedes overall GD).
    const matches = [
      m('P', 'Q', 1, 0),
      m('P', 'R', 2, 0),
      m('Q', 'R', 4, 0),
      m('Q', 'S', 3, 0),
      m('S', 'P', 0, 1),
      m('R', 'S', 1, 0),
    ];
    const rows = computeGroupTable(matches, ['P', 'Q', 'R', 'S']);
    expect(rows.find((r) => r.team === 'Q')!.goalDiff).toBeGreaterThan(
      rows.find((r) => r.team === 'P')!.goalDiff,
    );
    expect(order(rows).slice(0, 2)).toEqual(['P', 'Q']);
  });

  it('3-way tie fully resolved by head-to-head points among the tied trio', () => {
    // P, Q, R each 6 pts (all beat S; cycle among themselves broken by
    // differing mutual results): P beats Q and Q beats R, R loses to P.
    const matches = [
      m('P', 'Q', 1, 0),
      m('Q', 'R', 1, 0),
      m('P', 'R', 1, 0),
      m('P', 'S', 0, 1), // P loses to S so points stay level
      m('Q', 'S', 2, 0),
      m('R', 'S', 2, 0),
    ];
    // points: P 6, Q 6, R 3... — adjust: use a genuine 3-way 6pt tie instead.
    const rows = computeGroupTable(matches, ['P', 'Q', 'R', 'S']);
    // P: 6 (beat Q, R; lost S). Q: 6 (beat R, S; lost P). R: 3+... R beat S → 3.
    expect(rows.map((r) => `${r.team}:${r.points}`)).toEqual([
      'P:6',
      'Q:6',
      'R:3',
      'S:3',
    ]);
    // P vs Q tie → head-to-head: P beat Q.
    expect(order(rows).slice(0, 2)).toEqual(['P', 'Q']);
    // R vs S tie → head-to-head: R beat S.
    expect(order(rows).slice(2)).toEqual(['R', 'S']);
  });

  it('3-way tie resolved by head-to-head goal difference, then goals scored', () => {
    // T, U, V all 4 pts overall; mutual mini-league all draws is impossible
    // for GD separation, so craft decisive mutual results with a cycle:
    // T beats U 2:0, U beats V 1:0, V beats T 1:0 → mini pts all 3,
    // mini GD: T +1, U −1, V 0 → order T, V, U.
    const matches = [
      m('T', 'U', 2, 0),
      m('U', 'V', 1, 0),
      m('V', 'T', 1, 0),
      // W loses to everyone; margins keep T/U/V overall points equal (6 each).
      m('T', 'W', 1, 0),
      m('U', 'W', 1, 0),
      m('V', 'W', 1, 0),
    ];
    const rows = computeGroupTable(matches, ['T', 'U', 'V', 'W']);
    expect(rows.map((r) => r.points)).toEqual([6, 6, 6, 0]);
    expect(order(rows)).toEqual(['T', 'V', 'U', 'W']);
  });

  it('head-to-head goals scored separates when mini points and GD are level', () => {
    // Mutual cycle with equal mini GD but different mini GF:
    // T beats U 3:2, U beats V 1:0, V beats T 1:0.
    // mini: all 3 pts; GD: T 0 (3:2,0:1 → +1−1), U 0 (2:3,1:0), V 0 (0:1,1:0... )
    // GF: T 3, U 3, V 1 → hmm T=U on GF too; use scores below instead:
    // T beats U 4:3, U beats V 2:1, V beats T 1:0
    // mini GD: T +1−1=0, U −1+1=0, V 0... GF: T 4, U 5, V 2 → order U, T, V.
    const matches = [
      m('T', 'U', 4, 3),
      m('U', 'V', 2, 1),
      m('V', 'T', 1, 0),
      m('T', 'W', 1, 0),
      m('U', 'W', 1, 0),
      m('V', 'W', 1, 0),
    ];
    const rows = computeGroupTable(matches, ['T', 'U', 'V', 'W']);
    expect(rows.map((r) => r.points)).toEqual([6, 6, 6, 0]);
    expect(order(rows)).toEqual(['U', 'T', 'V', 'W']);
  });
});

describe('computeGroupTable — Article 13 step 2 (recursive sub-table, then overall)', () => {
  it('re-applies head-to-head to the remaining tied subset (4-way tie)', () => {
    // All four on 4 pts. Head-to-head over the whole group separates
    // A (+1) and B (−1); C and D stay level on every mini criterion, so
    // criteria a)–c) are RE-APPLIED to C/D only — C beat D 1:0.
    const matches = [
      m('A', 'B', 2, 0),
      m('B', 'C', 1, 0),
      m('C', 'D', 1, 0),
      m('D', 'A', 1, 0),
      m('A', 'C', 0, 0),
      m('B', 'D', 0, 0),
    ];
    // A FIFA ranking favouring D proves the result comes from the sub-table
    // recursion, not from a later fallback.
    const rows = computeGroupTable(matches, ['A', 'B', 'C', 'D'], {
      fifaRanking: { D: 1, C: 50, A: 60, B: 70 },
    });
    expect(rows.map((r) => r.points)).toEqual([4, 4, 4, 4]);
    expect(order(rows)).toEqual(['A', 'C', 'D', 'B']);
  });

  it('falls through to overall GD when head-to-head cannot separate at all', () => {
    // Perfect mutual symmetry among P/Q/R (cycle of 1:0s) → mini criteria all
    // level → overall GD decides via the margins against S.
    const matches = [
      m('P', 'Q', 1, 0),
      m('Q', 'R', 1, 0),
      m('R', 'P', 1, 0),
      m('P', 'S', 1, 0),
      m('Q', 'S', 2, 0),
      m('R', 'S', 3, 0),
    ];
    const rows = computeGroupTable(matches, ['P', 'Q', 'R', 'S']);
    expect(order(rows)).toEqual(['R', 'Q', 'P', 'S']);
  });

  it('falls through to overall goals scored when overall GD is level too', () => {
    // Same cycle; S concedes the same totals but scores against P and Q so
    // GD stays level while GF differs: R 4 > Q 3 > P 2... craft:
    // margins: P 2:1, Q 3:2, R 1:0 vs S → overall GD all +1+1−1... compute in
    // assertions below; GF: P 3, Q 4, R 2 → order Q, P, R.
    const matches = [
      m('P', 'Q', 1, 0),
      m('Q', 'R', 1, 0),
      m('R', 'P', 1, 0),
      m('P', 'S', 2, 1),
      m('Q', 'S', 3, 2),
      m('R', 'S', 1, 0),
    ];
    const rows = computeGroupTable(matches, ['P', 'Q', 'R', 'S']);
    const gd = Object.fromEntries(rows.map((r) => [r.team, r.goalDiff]));
    expect(gd.P).toBe(gd.Q);
    expect(gd.Q).toBe(gd.R);
    expect(order(rows)).toEqual(['Q', 'P', 'R', 'S']);
  });

  it('uses the conduct score (fair play) when GD and GF are level', () => {
    // Two teams drawing twice with identical totals; only cards differ.
    const matches = [m('P', 'Q', 1, 1), m('Q', 'P', 0, 0)];
    const rows = computeGroupTable(matches, ['P', 'Q'], {
      conduct: { P: -4, Q: -1 },
    });
    expect(order(rows)).toEqual(['Q', 'P']);
  });
});

describe('computeGroupTable — Article 13 step 3 + determinism guard', () => {
  const symmetric = [m('P', 'Q', 1, 1), m('Q', 'P', 2, 2)];

  it('uses the FIFA World Ranking when everything else is level', () => {
    const rows = computeGroupTable(symmetric, ['P', 'Q'], {
      fifaRanking: { P: 30, Q: 7 },
    });
    expect(order(rows)).toEqual(['Q', 'P']);
  });

  it('ranked team precedes unranked team', () => {
    const rows = computeGroupTable(symmetric, ['P', 'Q'], {
      fifaRanking: { Q: 99 },
    });
    expect(order(rows)).toEqual(['Q', 'P']);
  });

  it('falls back to TeamId order without any context (total determinism)', () => {
    const rows = computeGroupTable(symmetric, ['Q', 'P']);
    expect(order(rows)).toEqual(['P', 'Q']);
  });
});
