/**
 * FIFA WC26 Round-of-32 bracket construction.
 *
 * Sources (cross-checked, identical):
 *  - FIFA "Regulations for the FIFA World Cup 26" (May 2026), art. 12.6
 *    https://digitalhub.fifa.com/m/636f5c9c6f29771f/original/FWC2026_regulations_EN.pdf
 *  - https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage
 *
 * Fixed pairings (match numbers official):
 *  M73 2A–2B   M74 1E–3rd   M75 1F–2C   M76 1C–2F
 *  M77 1I–3rd  M78 2E–2I    M79 1A–3rd  M80 1L–3rd
 *  M81 1D–3rd  M82 1G–3rd   M83 2K–2L   M84 1H–2J
 *  M85 1B–3rd  M86 1J–2H    M87 1K–3rd  M88 2D–2G
 *
 * Which third-placed team fills each slot depends on WHICH 8 groups qualify
 * a third — the official Annex C table (495 combinations) in r32annex.data.ts.
 */

import { R32_ANNEX, THIRD_SLOT_HOSTS } from './r32annex.data';
import type { BracketMatch, GroupId, TeamId } from './types';

/**
 * Allowed source groups per third-place slot (host group winner → candidate
 * groups), straight from regulations art. 12.6. Exported for tests.
 */
export const ALLOWED_THIRD_GROUPS: Readonly<Record<string, readonly GroupId[]>> = {
  A: ['C', 'E', 'F', 'H', 'I'],
  B: ['E', 'F', 'G', 'I', 'J'],
  D: ['B', 'E', 'F', 'I', 'J'],
  E: ['A', 'B', 'C', 'D', 'F'],
  G: ['A', 'E', 'H', 'I', 'J'],
  I: ['C', 'D', 'F', 'G', 'H'],
  K: ['D', 'E', 'I', 'J', 'L'],
  L: ['E', 'H', 'I', 'J', 'K'],
} as const;

type R32Slot =
  | { kind: 'winner'; group: GroupId }
  | { kind: 'runnerUp'; group: GroupId }
  | { kind: 'third'; host: GroupId };

const W = (group: GroupId): R32Slot => ({ kind: 'winner', group });
const R = (group: GroupId): R32Slot => ({ kind: 'runnerUp', group });
const T = (host: GroupId): R32Slot => ({ kind: 'third', host });

export const R32_LAYOUT: ReadonlyArray<{
  matchNumber: number;
  home: R32Slot;
  away: R32Slot;
}> = [
  { matchNumber: 73, home: R('A'), away: R('B') },
  { matchNumber: 74, home: W('E'), away: T('E') },
  { matchNumber: 75, home: W('F'), away: R('C') },
  { matchNumber: 76, home: W('C'), away: R('F') },
  { matchNumber: 77, home: W('I'), away: T('I') },
  { matchNumber: 78, home: R('E'), away: R('I') },
  { matchNumber: 79, home: W('A'), away: T('A') },
  { matchNumber: 80, home: W('L'), away: T('L') },
  { matchNumber: 81, home: W('D'), away: T('D') },
  { matchNumber: 82, home: W('G'), away: T('G') },
  { matchNumber: 83, home: R('K'), away: R('L') },
  { matchNumber: 84, home: W('H'), away: R('J') },
  { matchNumber: 85, home: W('B'), away: T('B') },
  { matchNumber: 86, home: W('J'), away: R('H') },
  { matchNumber: 87, home: W('K'), away: T('K') },
  { matchNumber: 88, home: R('D'), away: R('G') },
] as const;

export interface R32Sources {
  winners: Readonly<Record<GroupId, TeamId>>;
  runnersUp: Readonly<Record<GroupId, TeamId>>;
  /** Exactly the 8 qualified third-placed teams, keyed by their group. */
  thirds: Readonly<Partial<Record<GroupId, TeamId>>>;
}

/**
 * Looks up the Annex C allocation for a qualified-thirds combination.
 * Returns host-group → third's source group. Throws unless exactly 8 groups.
 */
export function lookupThirdAllocation(
  qualifiedGroups: readonly GroupId[],
): Record<GroupId, GroupId> {
  const sorted = [...qualifiedGroups].sort();
  if (sorted.length !== 8 || new Set(sorted).size !== 8) {
    throw new Error(
      `Annex C lookup needs exactly 8 distinct groups, got: ${qualifiedGroups.join(',')}`,
    );
  }
  const key = sorted.join('');
  const assignment = R32_ANNEX[key];
  if (!assignment) {
    // Unreachable: the table covers all C(12,8) combinations (tested).
    throw new Error(`No Annex C row for combination ${key}`);
  }
  const allocation = {} as Record<GroupId, GroupId>;
  THIRD_SLOT_HOSTS.forEach((host, i) => {
    allocation[host] = assignment[i] as GroupId;
  });
  return allocation;
}

/** Builds the 16 R32 matches from group results per the official bracket. */
export function buildR32(sources: R32Sources): BracketMatch[] {
  const thirdGroups = Object.keys(sources.thirds).sort() as GroupId[];
  const allocation = lookupThirdAllocation(thirdGroups);

  const resolve = (slot: R32Slot): TeamId => {
    if (slot.kind === 'winner') return sources.winners[slot.group];
    if (slot.kind === 'runnerUp') return sources.runnersUp[slot.group];
    const sourceGroup = allocation[slot.host];
    const team = sources.thirds[sourceGroup];
    if (!team) {
      throw new Error(
        `Annex C assigned 3${sourceGroup} to host 1${slot.host}, but no third given for group ${sourceGroup}`,
      );
    }
    return team;
  };

  return R32_LAYOUT.map(({ matchNumber, home, away }) => ({
    matchNumber,
    round: 'R32' as const,
    home: resolve(home),
    away: resolve(away),
  }));
}
