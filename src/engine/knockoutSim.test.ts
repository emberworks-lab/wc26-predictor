import { describe, expect, it } from 'vitest';

import {
  FINAL_MATCH,
  KO_GRAPH,
  MATCHES_BY_ROUND,
  THIRD_PLACE_MATCH,
  resolveAdvancer,
  roundOfMatch,
  simulateBracket,
} from './knockoutSim';
import { buildR32 } from './r32Mapping';
import type { BracketMatch, GroupId, KnockoutPick, MatchNumber, TeamId } from './types';
import { GROUP_IDS } from './types';

const winners = Object.fromEntries(GROUP_IDS.map((g) => [g, `1${g}`])) as Record<
  GroupId,
  TeamId
>;
const runnersUp = Object.fromEntries(GROUP_IDS.map((g) => [g, `2${g}`])) as Record<
  GroupId,
  TeamId
>;
const thirds = Object.fromEntries(
  (['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as GroupId[]).map((g) => [g, `3${g}`]),
);

const r32: BracketMatch[] = buildR32({ winners, runnersUp, thirds });

/** Picks the home team of every match it can see, all the way down. */
function homePicks(matches: readonly BracketMatch[]): Record<MatchNumber, KnockoutPick> {
  const picks: Record<MatchNumber, KnockoutPick> = {};
  for (const m of matches) picks[m.matchNumber] = { advancer: m.home };
  return picks;
}

describe('bracket graph', () => {
  it('covers matches 89–104 with the official feeds', () => {
    expect(KO_GRAPH.map((n) => n.matchNumber)).toEqual([
      89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104,
    ]);
    expect(roundOfMatch(73)).toBe('R32');
    expect(roundOfMatch(96)).toBe('R16');
    expect(roundOfMatch(100)).toBe('QF');
    expect(roundOfMatch(102)).toBe('SF');
    expect(roundOfMatch(THIRD_PLACE_MATCH)).toBe('F');
    expect(roundOfMatch(FINAL_MATCH)).toBe('F');
    expect(() => roundOfMatch(72)).toThrow();
    expect(() => roundOfMatch(105)).toThrow();
  });
});

describe('simulateBracket — full walk-through', () => {
  it('walks a fully picked bracket from R32 to champion and third place', () => {
    // Pick iteratively: pick home of each R32 match, then home of each
    // produced match, until the final.
    const picks: Record<MatchNumber, KnockoutPick> = homePicks(r32);
    // Resolve in waves: after each simulate, add home picks for newly
    // resolved matches until everything settles.
    for (let i = 0; i < 5; i += 1) {
      const sim = simulateBracket(r32, picks);
      for (const m of sim.matches) {
        if (m.home !== undefined && picks[m.matchNumber] === undefined) {
          picks[m.matchNumber] = { advancer: m.home };
        }
      }
    }
    const sim = simulateBracket(r32, picks);

    // R16 pairings per the official graph, e.g. M89 = W74 vs W77.
    const m89 = sim.byNumber.get(89)!;
    expect(m89.home).toBe(sim.byNumber.get(74)!.winner);
    expect(m89.away).toBe(sim.byNumber.get(77)!.winner);
    for (const node of KO_GRAPH) {
      const sm = sim.byNumber.get(node.matchNumber)!;
      const src = (feed: { match: MatchNumber; take: 'winner' | 'loser' }) =>
        feed.take === 'winner'
          ? sim.byNumber.get(feed.match)!.winner
          : sim.byNumber.get(feed.match)!.loser;
      expect(sm.home).toBe(src(node.homeFrom));
      expect(sm.away).toBe(src(node.awayFrom));
    }

    // With home-side picks all the way down: M73 home is 2A, M90 = W73 vs
    // W75 (1F), QF M97 = W89 (1E) vs W90 (2A), …, champion comes from M104.
    expect(sim.byNumber.get(73)!.winner).toBe('2A');
    expect(sim.byNumber.get(90)).toMatchObject({ home: '2A', away: '1F' });
    expect(sim.byNumber.get(97)).toMatchObject({ home: '1E', away: '2A' });
    expect(sim.reaching.R16).toHaveLength(16);
    expect(sim.reaching.QF).toHaveLength(8);
    expect(sim.reaching.SF).toHaveLength(4);
    expect(sim.reaching.F).toHaveLength(2);
    expect(sim.champion).toBe(sim.byNumber.get(FINAL_MATCH)!.winner);
    expect(sim.thirdPlaceWinner).toBe(sim.byNumber.get(THIRD_PLACE_MATCH)!.winner);

    // Third-place match hosts the two semi-final losers.
    const m103 = sim.byNumber.get(THIRD_PLACE_MATCH)!;
    expect([m103.home, m103.away]).toEqual([
      sim.byNumber.get(101)!.loser,
      sim.byNumber.get(102)!.loser,
    ]);
  });

  it('leaves downstream matches unresolved when picks are missing', () => {
    const onlyR32 = homePicks(r32);
    const sim = simulateBracket(r32, onlyR32);
    expect(sim.reaching.R16).toHaveLength(16);
    expect(sim.reaching.QF).toHaveLength(0);
    const m89 = sim.byNumber.get(89)!;
    expect(m89.home).toBeDefined();
    expect(m89.winner).toBeUndefined();
    expect(sim.byNumber.get(97)!.home).toBeUndefined();
    expect(sim.champion).toBeUndefined();
  });

  it('ignores picks naming a team not in the match', () => {
    const picks = homePicks(r32);
    picks[73] = { advancer: 'NOT_IN_MATCH' };
    const sim = simulateBracket(r32, picks);
    expect(sim.byNumber.get(73)!.winner).toBeUndefined();
    expect(sim.byNumber.get(90)!.home).toBeUndefined(); // W73 feed missing
    expect(sim.byNumber.get(90)!.away).toBe('1F'); // W75 feed intact
  });

  it('derives the advancer from a decisive hardcore 90-minute score', () => {
    const picks: Record<MatchNumber, KnockoutPick> = {
      73: { homeGoals: 0, awayGoals: 2 }, // away (2B) wins outright
      75: { homeGoals: 1, awayGoals: 1, advancer: '2C' }, // draw → explicit advancer
    };
    const sim = simulateBracket(r32, picks);
    expect(sim.byNumber.get(73)!.winner).toBe('2B');
    expect(sim.byNumber.get(75)!.winner).toBe('2C');
    expect(sim.byNumber.get(90)).toMatchObject({ home: '2B', away: '2C' });
  });
});

describe('resolveAdvancer', () => {
  it('prefers a decisive score over the advancer field', () => {
    expect(resolveAdvancer({ homeGoals: 2, awayGoals: 0, advancer: 'Y' }, 'X', 'Y')).toBe('X');
  });
  it('uses the advancer field on a drawn score', () => {
    expect(resolveAdvancer({ homeGoals: 1, awayGoals: 1, advancer: 'Y' }, 'X', 'Y')).toBe('Y');
  });
  it('returns undefined for missing picks or foreign teams', () => {
    expect(resolveAdvancer(undefined, 'X', 'Y')).toBeUndefined();
    expect(resolveAdvancer({ advancer: 'Z' }, 'X', 'Y')).toBeUndefined();
  });
});

describe('MATCHES_BY_ROUND', () => {
  it('partitions matches 73–104 exactly', () => {
    const all = Object.values(MATCHES_BY_ROUND).flat().sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 32 }, (_, i) => 73 + i));
  });
});
