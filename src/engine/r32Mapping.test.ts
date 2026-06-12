import { describe, expect, it } from 'vitest';

import { R32_ANNEX, THIRD_SLOT_HOSTS } from './r32annex.data';
import {
  ALLOWED_THIRD_GROUPS,
  R32_LAYOUT,
  buildR32,
  lookupThirdAllocation,
} from './r32Mapping';
import type { GroupId, TeamId } from './types';
import { GROUP_IDS } from './types';

function combinations<T>(pool: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (pool.length < k) return [];
  const [head, ...rest] = pool;
  return [
    ...combinations(rest, k - 1).map((c) => [head, ...c]),
    ...combinations(rest, k),
  ];
}

describe('R32_ANNEX — structural invariants over ALL 495 rows', () => {
  const keys = Object.keys(R32_ANNEX);

  it('has exactly 495 rows covering every C(12,8) combination once', () => {
    expect(keys).toHaveLength(495);
    const all = combinations(GROUP_IDS, 8).map((c) => c.join(''));
    expect(all).toHaveLength(495);
    expect(new Set(keys)).toEqual(new Set(all));
  });

  it('every row assigns exactly its 8 qualified groups to 8 distinct slots', () => {
    for (const [key, assignment] of Object.entries(R32_ANNEX)) {
      expect(assignment).toHaveLength(8);
      expect([...assignment].sort().join('')).toBe(key);
    }
  });

  it('every assignment respects the allowed-slot constraints of regulations art. 12.6', () => {
    for (const assignment of Object.values(R32_ANNEX)) {
      THIRD_SLOT_HOSTS.forEach((host, i) => {
        expect(ALLOWED_THIRD_GROUPS[host]).toContain(assignment[i]);
      });
    }
  });

  it('no third-placed team ever meets its own group winner', () => {
    for (const assignment of Object.values(R32_ANNEX)) {
      THIRD_SLOT_HOSTS.forEach((host, i) => {
        expect(assignment[i]).not.toBe(host);
      });
    }
  });
});

describe('R32_ANNEX — rows verified against the FIFA regulations PDF', () => {
  // Hand-read from "Regulations for the FIFA World Cup 26" (May 2026),
  // Annex C, pp. 80–97. Column order: 1A 1B 1D 1E 1G 1I 1K 1L.
  const PDF_ROWS: Array<[option: number, assignment: string]> = [
    [1, 'EJIFHGLK'], // p.80
    [2, 'HGIDJFLK'], // p.80
    [10, 'HGICJFLK'], // p.80
    [19, 'CJIDHFLK'], // p.81
    [48, 'EJBFIHLK'], // p.82
    [54, 'HJBDIGLK'], // p.82
    [77, 'HGBDJFLE'], // p.83
    [82, 'HJBCIGLK'], // p.83
    [106, 'HGBCJFEK'], // p.84
    [110, 'HJBCIDLK'], // p.84
    [115, 'HGBCJDIK'], // p.84
    [454, 'CGBDAFLI'], // p.96
    [461, 'EJBCADLK'], // p.96
    [487, 'HFBCADLE'], // p.97
    [495, 'HGBCAFDE'], // p.97
  ];

  it.each(PDF_ROWS)('option %i matches the official table', (option, assignment) => {
    const key = [...assignment].sort().join('');
    expect(R32_ANNEX[key]).toBe(assignment);
  });

  it('lookupThirdAllocation maps option 1 (thirds from E,F,G,H,I,J,K,L)', () => {
    const allocation = lookupThirdAllocation([
      'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
    ]);
    expect(allocation).toEqual({
      A: 'E', B: 'J', D: 'I', E: 'F', G: 'H', I: 'G', K: 'L', L: 'K',
    });
  });

  it('lookup is input-order independent and validates cardinality', () => {
    const shuffled: GroupId[] = ['L', 'E', 'K', 'F', 'J', 'G', 'I', 'H'];
    expect(lookupThirdAllocation(shuffled)).toEqual(
      lookupThirdAllocation(['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']),
    );
    expect(() => lookupThirdAllocation(['A', 'B', 'C'])).toThrow(/exactly 8/);
    expect(() =>
      lookupThirdAllocation(['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G']),
    ).toThrow(/exactly 8/);
  });
});

describe('buildR32', () => {
  const winners = Object.fromEntries(GROUP_IDS.map((g) => [g, `1${g}`])) as Record<
    GroupId,
    TeamId
  >;
  const runnersUp = Object.fromEntries(GROUP_IDS.map((g) => [g, `2${g}`])) as Record<
    GroupId,
    TeamId
  >;

  it('produces the official 16 pairings for the option-1 combination', () => {
    const thirds = Object.fromEntries(
      (['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as GroupId[]).map((g) => [g, `3${g}`]),
    );
    const r32 = buildR32({ winners, runnersUp, thirds });
    const byNumber = new Map(r32.map((m) => [m.matchNumber, m]));

    // Fixed winner/runner-up slots (regulations art. 12.6).
    expect(byNumber.get(73)).toMatchObject({ home: '2A', away: '2B' });
    expect(byNumber.get(75)).toMatchObject({ home: '1F', away: '2C' });
    expect(byNumber.get(76)).toMatchObject({ home: '1C', away: '2F' });
    expect(byNumber.get(78)).toMatchObject({ home: '2E', away: '2I' });
    expect(byNumber.get(83)).toMatchObject({ home: '2K', away: '2L' });
    expect(byNumber.get(84)).toMatchObject({ home: '1H', away: '2J' });
    expect(byNumber.get(86)).toMatchObject({ home: '1J', away: '2H' });
    expect(byNumber.get(88)).toMatchObject({ home: '2D', away: '2G' });

    // Third-place slots per Annex C option 1.
    expect(byNumber.get(79)).toMatchObject({ home: '1A', away: '3E' });
    expect(byNumber.get(85)).toMatchObject({ home: '1B', away: '3J' });
    expect(byNumber.get(81)).toMatchObject({ home: '1D', away: '3I' });
    expect(byNumber.get(74)).toMatchObject({ home: '1E', away: '3F' });
    expect(byNumber.get(82)).toMatchObject({ home: '1G', away: '3H' });
    expect(byNumber.get(77)).toMatchObject({ home: '1I', away: '3G' });
    expect(byNumber.get(87)).toMatchObject({ home: '1K', away: '3L' });
    expect(byNumber.get(80)).toMatchObject({ home: '1L', away: '3K' });

    expect(r32.every((m) => m.round === 'R32')).toBe(true);
  });

  it('produces the official pairings for the option-495 combination (groups A–H)', () => {
    const thirds = Object.fromEntries(
      (['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as GroupId[]).map((g) => [g, `3${g}`]),
    );
    const byNumber = new Map(
      buildR32({ winners, runnersUp, thirds }).map((m) => [m.matchNumber, m]),
    );
    // Option 495: 1A↔3H, 1B↔3G, 1D↔3B, 1E↔3C, 1G↔3A, 1I↔3F, 1K↔3D, 1L↔3E.
    expect(byNumber.get(79)).toMatchObject({ home: '1A', away: '3H' });
    expect(byNumber.get(85)).toMatchObject({ home: '1B', away: '3G' });
    expect(byNumber.get(81)).toMatchObject({ home: '1D', away: '3B' });
    expect(byNumber.get(74)).toMatchObject({ home: '1E', away: '3C' });
    expect(byNumber.get(82)).toMatchObject({ home: '1G', away: '3A' });
    expect(byNumber.get(77)).toMatchObject({ home: '1I', away: '3F' });
    expect(byNumber.get(87)).toMatchObject({ home: '1K', away: '3D' });
    expect(byNumber.get(80)).toMatchObject({ home: '1L', away: '3E' });
  });

  it('every R32 layout slot uses each winner and runner-up exactly once', () => {
    const winnerGroups = R32_LAYOUT.flatMap((m) =>
      [m.home, m.away].filter((s) => s.kind === 'winner').map((s) => s.group),
    );
    const runnerUpGroups = R32_LAYOUT.flatMap((m) =>
      [m.home, m.away].filter((s) => s.kind === 'runnerUp').map((s) => s.group),
    );
    expect([...winnerGroups].sort()).toEqual([...GROUP_IDS]);
    expect([...runnerUpGroups].sort()).toEqual([...GROUP_IDS]);
  });

  it('throws when a third assigned by the annex has no team in the input', () => {
    const thirds: Partial<Record<GroupId, TeamId | undefined>> = Object.fromEntries(
      (['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as GroupId[]).map((g) => [g, `3${g}`]),
    );
    thirds.E = undefined; // key present (combination intact), team missing
    expect(() =>
      buildR32({
        winners,
        runnersUp,
        thirds: thirds as Partial<Record<GroupId, TeamId>>,
      }),
    ).toThrow(/no third given/);
  });
});
