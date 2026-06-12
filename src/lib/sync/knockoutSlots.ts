/**
 * Lazy FIFA-match-number resolution for knockout fixtures.
 *
 * The data provider gives knockout matches without FIFA numbering, with team
 * slots that fill in as rounds resolve. We need `matches.fifa_match_number`
 * (73–104) because the engine's bracket graph and `bracket_predictions.slot`
 * are keyed by it. Kickoff-order guessing is fragile, so instead we match
 * *expected pairings* from the engine against the provider's team pairs:
 *
 *  - R32 (73–88): once all 72 group matches are finished, `buildR32` over the
 *    real tables gives each match number's pairing.
 *  - R16..Final (89–104): `KO_GRAPH` feeds give the expected pairing once the
 *    feeding matches are assigned and finished.
 *
 * Pairs are matched unordered — the provider's home/away orientation is kept
 * in the DB and doesn't affect scoring (the engine works with advancers).
 */

import { rankThirds, type ThirdPlaceEntry } from '@/engine/bestThirds';
import { computeGroupTable } from '@/engine/groupTable';
import { FINAL_MATCH, KO_GRAPH, THIRD_PLACE_MATCH } from '@/engine/knockoutSim';
import { buildR32 } from '@/engine/r32Mapping';
import type { GroupId, PlayedMatch, TeamId } from '@/engine/types';
import { GROUP_IDS } from '@/engine/types';

import type { DbMatchStage } from '@/lib/football-api/mappers';

export interface KoSlotMatch {
  apiId: number;
  stage: DbMatchStage;
  homeCode: string | null;
  awayCode: string | null;
  fifaMatchNumber: number | null;
  finished: boolean;
  /** Winner / advancer fifa code, set when finished. */
  winnerCode: string | null;
}

export interface GroupResultInput {
  group: GroupId;
  home: TeamId;
  away: TeamId;
  /** Both null until the match finishes. */
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface SlotAssignment {
  apiId: number;
  fifaMatchNumber: number;
}

const STAGE_OF_NUMBER = (n: number): DbMatchStage => {
  if (n === THIRD_PLACE_MATCH) return 'third_place';
  if (n === FINAL_MATCH) return 'final';
  if (n >= 73 && n <= 88) return 'r32';
  if (n >= 89 && n <= 96) return 'r16';
  if (n >= 97 && n <= 100) return 'qf';
  return 'sf';
};

const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/**
 * Returns fifa_match_number assignments for knockout matches that don't have
 * one yet but whose pairing has become determinable. Idempotent: already
 * assigned matches are used as inputs and never re-assigned.
 */
export function resolveKnockoutSlots(
  groupMatches: readonly GroupResultInput[],
  koMatches: readonly KoSlotMatch[],
): SlotAssignment[] {
  // Expected pairing per match number, built up as we resolve.
  const expected = new Map<number, { a: TeamId; b: TeamId }>();

  // --- R32 from real group tables (only once the group stage is complete) ---
  const groupsComplete =
    groupMatches.length === 72 &&
    groupMatches.every((m) => m.homeGoals != null && m.awayGoals != null);

  if (groupsComplete) {
    const winners = {} as Record<GroupId, TeamId>;
    const runnersUp = {} as Record<GroupId, TeamId>;
    const thirdEntries: ThirdPlaceEntry[] = [];

    for (const group of GROUP_IDS) {
      const inGroup = groupMatches.filter((m) => m.group === group);
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

    const thirds = rankThirds(thirdEntries).qualifiedByGroup;
    for (const m of buildR32({ winners, runnersUp, thirds })) {
      expected.set(m.matchNumber, { a: m.home, b: m.away });
    }
  }

  // --- Later rounds from already-assigned finished matches ------------------
  const byNumber = new Map<number, KoSlotMatch>();
  for (const m of koMatches) {
    if (m.fifaMatchNumber != null) byNumber.set(m.fifaMatchNumber, m);
  }

  const assignments: SlotAssignment[] = [];
  const unassigned = koMatches.filter((m) => m.fifaMatchNumber == null);

  // Winner/loser of an assigned, finished match.
  const outcomeOf = (n: number): { winner: TeamId; loser: TeamId } | null => {
    const m = byNumber.get(n);
    if (!m || !m.finished || !m.winnerCode || !m.homeCode || !m.awayCode) return null;
    const loser = m.winnerCode === m.homeCode ? m.awayCode : m.homeCode;
    return { winner: m.winnerCode, loser };
  };

  // Iterate to a fixed point: an assignment made in one pass can feed the
  // next round's expectations in the same sync run.
  for (;;) {
    for (const node of KO_GRAPH) {
      if (expected.has(node.matchNumber) || byNumber.has(node.matchNumber)) continue;
      const home = outcomeOf(node.homeFrom.match);
      const away = outcomeOf(node.awayFrom.match);
      if (!home || !away) continue;
      expected.set(node.matchNumber, {
        a: node.homeFrom.take === 'winner' ? home.winner : home.loser,
        b: node.awayFrom.take === 'winner' ? away.winner : away.loser,
      });
    }

    let progressed = false;
    for (const [number, pair] of expected) {
      if (byNumber.has(number)) continue;
      const stage = STAGE_OF_NUMBER(number);
      const match = unassigned.find(
        (m) =>
          m.fifaMatchNumber == null &&
          m.stage === stage &&
          m.homeCode &&
          m.awayCode &&
          pairKey(m.homeCode, m.awayCode) === pairKey(pair.a, pair.b) &&
          !assignments.some((a) => a.apiId === m.apiId),
      );
      if (!match) continue;
      assignments.push({ apiId: match.apiId, fifaMatchNumber: number });
      byNumber.set(number, { ...match, fifaMatchNumber: number });
      progressed = true;
    }

    if (!progressed) break;
  }

  return assignments;
}
