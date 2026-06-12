import { describe, expect, it } from 'vitest';

import { rankThirds, type ThirdPlaceEntry } from '@/engine/bestThirds';
import { computeGroupTable } from '@/engine/groupTable';
import { KO_GRAPH } from '@/engine/knockoutSim';
import { buildR32 } from '@/engine/r32Mapping';
import type { GroupId, PlayedMatch, TeamId } from '@/engine/types';
import { GROUP_IDS } from '@/engine/types';

import {
  resolveKnockoutSlots,
  type GroupResultInput,
  type KoSlotMatch,
} from './knockoutSlots';

/**
 * Deterministic full group stage: in group G (index i), teams G1..G4 finish
 * exactly in label order; thirds get distinct goal differences across groups
 * so the best-8 ranking is unambiguous.
 */
function buildGroupResults(): GroupResultInput[] {
  const results: GroupResultInput[] = [];
  GROUP_IDS.forEach((group, i) => {
    const t = (n: number) => `${group}${n}`;
    const fixtures: Array<[string, string, number, number]> = [
      [t(1), t(2), 2, 0],
      [t(1), t(3), 2, 0],
      [t(1), t(4), 3, 0],
      [t(2), t(3), 1, 0],
      [t(2), t(4), 2, 0],
      [t(3), t(4), i + 1, 0], // third's win size varies per group
    ];
    for (const [home, away, homeGoals, awayGoals] of fixtures) {
      results.push({ group, home, away, homeGoals, awayGoals });
    }
  });
  return results;
}

/** Expected R32 pairings straight from the engine (the oracle). */
function expectedR32(groupResults: GroupResultInput[]) {
  const winners = {} as Record<GroupId, TeamId>;
  const runnersUp = {} as Record<GroupId, TeamId>;
  const thirdEntries: ThirdPlaceEntry[] = [];
  for (const group of GROUP_IDS) {
    const inGroup = groupResults.filter((m) => m.group === group);
    const teams = [...new Set(inGroup.flatMap((m) => [m.home, m.away]))];
    const played: PlayedMatch[] = inGroup.map((m) => ({
      home: m.home,
      away: m.away,
      homeGoals: m.homeGoals!,
      awayGoals: m.awayGoals!,
    }));
    const table = computeGroupTable(played, teams);
    winners[group] = table[0].team;
    runnersUp[group] = table[1].team;
    thirdEntries.push({ group, row: table[2] });
  }
  return buildR32({
    winners,
    runnersUp,
    thirds: rankThirds(thirdEntries).qualifiedByGroup,
  });
}

const stageOf = (n: number) =>
  n === 103
    ? ('third_place' as const)
    : n === 104
      ? ('final' as const)
      : n <= 88
        ? ('r32' as const)
        : n <= 96
          ? ('r16' as const)
          : n <= 100
            ? ('qf' as const)
            : ('sf' as const);

describe('resolveKnockoutSlots', () => {
  const groupResults = buildGroupResults();
  const bracket = expectedR32(groupResults);

  it('assigns nothing while the group stage is incomplete', () => {
    const partial = groupResults.map((m, i) =>
      i === 0 ? { ...m, homeGoals: null, awayGoals: null } : m,
    );
    const api: KoSlotMatch[] = bracket.map((b, i) => ({
      apiId: 1000 + i,
      stage: 'r32',
      homeCode: b.home,
      awayCode: b.away,
      fifaMatchNumber: null,
      finished: false,
      winnerCode: null,
    }));
    expect(resolveKnockoutSlots(partial, api)).toEqual([]);
  });

  it('assigns all 16 R32 numbers from completed groups, ignoring home/away order', () => {
    // Provider orientation deliberately swapped vs the FIFA layout.
    const api: KoSlotMatch[] = bracket.map((b, i) => ({
      apiId: 1000 + i,
      stage: 'r32',
      homeCode: b.away,
      awayCode: b.home,
      fifaMatchNumber: null,
      finished: false,
      winnerCode: null,
    }));

    const assignments = resolveKnockoutSlots(groupResults, api);
    expect(assignments).toHaveLength(16);
    expect(new Set(assignments.map((a) => a.fifaMatchNumber))).toEqual(
      new Set(bracket.map((b) => b.matchNumber)),
    );
    for (const a of assignments) {
      const expectedPair = bracket.find((b) => b.matchNumber === a.fifaMatchNumber)!;
      const apiMatch = api.find((m) => m.apiId === a.apiId)!;
      expect(new Set([apiMatch.homeCode, apiMatch.awayCode])).toEqual(
        new Set([expectedPair.home, expectedPair.away]),
      );
    }
  });

  it('resolves an entire finished tournament to a fixed point in one call', () => {
    // Simulate every knockout match finished, home side (per FIFA layout)
    // always advancing; the provider knows pairs but no numbers.
    const winnerOf = new Map<number, TeamId>();
    const loserOf = new Map<number, TeamId>();
    const pairs = new Map<number, { home: TeamId; away: TeamId }>();

    for (const b of bracket) {
      pairs.set(b.matchNumber, { home: b.home, away: b.away });
      winnerOf.set(b.matchNumber, b.home);
      loserOf.set(b.matchNumber, b.away);
    }
    for (const node of KO_GRAPH) {
      const take = (f: typeof node.homeFrom) =>
        f.take === 'winner' ? winnerOf.get(f.match)! : loserOf.get(f.match)!;
      const home = take(node.homeFrom);
      const away = take(node.awayFrom);
      pairs.set(node.matchNumber, { home, away });
      winnerOf.set(node.matchNumber, home);
      loserOf.set(node.matchNumber, away);
    }

    const api: KoSlotMatch[] = [...pairs.entries()].map(([n, p], i) => ({
      apiId: 2000 + i,
      stage: stageOf(n),
      homeCode: p.home,
      awayCode: p.away,
      fifaMatchNumber: null,
      finished: true,
      winnerCode: winnerOf.get(n)!,
    }));

    const assignments = resolveKnockoutSlots(groupResults, api);
    expect(assignments).toHaveLength(32);
    for (const a of assignments) {
      const apiMatch = api.find((m) => m.apiId === a.apiId)!;
      const expectedPair = pairs.get(a.fifaMatchNumber)!;
      expect(new Set([apiMatch.homeCode, apiMatch.awayCode])).toEqual(
        new Set([expectedPair.home, expectedPair.away]),
      );
    }
    // Third place vs final share teams' SF losers/winners — make sure the
    // stage discriminator put them on the right numbers.
    const third = assignments.find((a) => a.fifaMatchNumber === 103)!;
    expect(api.find((m) => m.apiId === third.apiId)!.stage).toBe('third_place');
    const final = assignments.find((a) => a.fifaMatchNumber === 104)!;
    expect(api.find((m) => m.apiId === final.apiId)!.stage).toBe('final');
  });

  it('is idempotent: already-assigned matches are inputs, not outputs', () => {
    const api: KoSlotMatch[] = bracket.map((b, i) => ({
      apiId: 1000 + i,
      stage: 'r32',
      homeCode: b.home,
      awayCode: b.away,
      fifaMatchNumber: b.matchNumber,
      finished: false,
      winnerCode: null,
    }));
    expect(resolveKnockoutSlots(groupResults, api)).toEqual([]);
  });
});
