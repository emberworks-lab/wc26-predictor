/**
 * Knockout bracket progression per the official FIFA WC26 match graph
 * (Regulations art. 12.7–12.11, cross-checked with Wikipedia):
 *
 *  R16: M89 W74–W77   M90 W73–W75   M91 W76–W78   M92 W79–W80
 *       M93 W83–W84   M94 W81–W82   M95 W86–W88   M96 W85–W87
 *  QF:  M97 W89–W90   M98 W93–W94   M99 W91–W92   M100 W95–W96
 *  SF:  M101 W97–W98  M102 W99–W100
 *  Third place: M103 L101–L102.  Final: M104 W101–W102.
 */

import type { BracketMatch, KnockoutPick, KnockoutRound, MatchNumber, TeamId } from './types';

interface Feed {
  match: MatchNumber;
  take: 'winner' | 'loser';
}

export interface KnockoutNode {
  matchNumber: MatchNumber;
  round: KnockoutRound;
  homeFrom: Feed;
  awayFrom: Feed;
}

const w = (match: MatchNumber): Feed => ({ match, take: 'winner' });
const l = (match: MatchNumber): Feed => ({ match, take: 'loser' });

/** Matches 89–104; matches 73–88 come from buildR32. */
export const KO_GRAPH: readonly KnockoutNode[] = [
  { matchNumber: 89, round: 'R16', homeFrom: w(74), awayFrom: w(77) },
  { matchNumber: 90, round: 'R16', homeFrom: w(73), awayFrom: w(75) },
  { matchNumber: 91, round: 'R16', homeFrom: w(76), awayFrom: w(78) },
  { matchNumber: 92, round: 'R16', homeFrom: w(79), awayFrom: w(80) },
  { matchNumber: 93, round: 'R16', homeFrom: w(83), awayFrom: w(84) },
  { matchNumber: 94, round: 'R16', homeFrom: w(81), awayFrom: w(82) },
  { matchNumber: 95, round: 'R16', homeFrom: w(86), awayFrom: w(88) },
  { matchNumber: 96, round: 'R16', homeFrom: w(85), awayFrom: w(87) },
  { matchNumber: 97, round: 'QF', homeFrom: w(89), awayFrom: w(90) },
  { matchNumber: 98, round: 'QF', homeFrom: w(93), awayFrom: w(94) },
  { matchNumber: 99, round: 'QF', homeFrom: w(91), awayFrom: w(92) },
  { matchNumber: 100, round: 'QF', homeFrom: w(95), awayFrom: w(96) },
  { matchNumber: 101, round: 'SF', homeFrom: w(97), awayFrom: w(98) },
  { matchNumber: 102, round: 'SF', homeFrom: w(99), awayFrom: w(100) },
  { matchNumber: 103, round: 'F', homeFrom: l(101), awayFrom: l(102) },
  { matchNumber: 104, round: 'F', homeFrom: w(101), awayFrom: w(102) },
] as const;

export const THIRD_PLACE_MATCH = 103;
export const FINAL_MATCH = 104;

export function roundOfMatch(matchNumber: MatchNumber): KnockoutRound {
  if (matchNumber >= 73 && matchNumber <= 88) return 'R32';
  if (matchNumber >= 89 && matchNumber <= 96) return 'R16';
  if (matchNumber >= 97 && matchNumber <= 100) return 'QF';
  if (matchNumber === 101 || matchNumber === 102) return 'SF';
  if (matchNumber === THIRD_PLACE_MATCH || matchNumber === FINAL_MATCH) return 'F';
  throw new Error(`Not a knockout match number: ${matchNumber}`);
}

export const MATCHES_BY_ROUND: Readonly<Record<KnockoutRound, readonly MatchNumber[]>> = {
  R32: [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88],
  R16: [89, 90, 91, 92, 93, 94, 95, 96],
  QF: [97, 98, 99, 100],
  SF: [101, 102],
  F: [THIRD_PLACE_MATCH, FINAL_MATCH],
} as const;

export interface SimulatedMatch {
  matchNumber: MatchNumber;
  round: KnockoutRound;
  /** undefined while an upstream pick is missing or invalid. */
  home?: TeamId;
  away?: TeamId;
  /** The pick, if present and consistent with the participants. */
  winner?: TeamId;
  loser?: TeamId;
}

export interface SimulatedBracket {
  matches: SimulatedMatch[];
  byNumber: Map<MatchNumber, SimulatedMatch>;
  /** Teams the picks send into each round (R16 = winners of R32 picks, …). */
  reaching: Record<'R16' | 'QF' | 'SF' | 'F', TeamId[]>;
  champion?: TeamId;
  thirdPlaceWinner?: TeamId;
}

/**
 * Resolves a pick's advancing team against a known pairing: a decisive 90'
 * score implies the winner; a drawn (or absent) score defers to the explicit
 * `advancer` field. Returns undefined when the pick is missing or names a
 * team outside the pairing.
 */
export function resolveAdvancer(
  pick: KnockoutPick | undefined,
  home: TeamId,
  away: TeamId,
): TeamId | undefined {
  if (!pick) return undefined;
  let advancer: TeamId | undefined;
  if (
    pick.homeGoals !== undefined &&
    pick.awayGoals !== undefined &&
    pick.homeGoals !== pick.awayGoals
  ) {
    advancer = pick.homeGoals > pick.awayGoals ? home : away;
  } else {
    advancer = pick.advancer;
  }
  return advancer === home || advancer === away ? advancer : undefined;
}

/**
 * Walks a predicted bracket: 16 R32 matches plus winner picks per match
 * number, producing every pairing through the final. Total function — missing
 * or inconsistent picks just leave downstream matches unresolved.
 */
export function simulateBracket(
  r32: readonly BracketMatch[],
  picks: Readonly<Record<MatchNumber, KnockoutPick>>,
): SimulatedBracket {
  const byNumber = new Map<MatchNumber, SimulatedMatch>();

  for (const m of r32) {
    byNumber.set(m.matchNumber, {
      matchNumber: m.matchNumber,
      round: 'R32',
      home: m.home,
      away: m.away,
    });
  }
  for (const node of KO_GRAPH) {
    byNumber.set(node.matchNumber, { matchNumber: node.matchNumber, round: node.round });
  }

  const settle = (sm: SimulatedMatch): void => {
    if (sm.home === undefined || sm.away === undefined) return;
    const advancer = resolveAdvancer(picks[sm.matchNumber], sm.home, sm.away);
    if (advancer === undefined) return;
    sm.winner = advancer;
    sm.loser = advancer === sm.home ? sm.away : sm.home;
  };

  for (const m of r32) settle(byNumber.get(m.matchNumber)!);
  for (const node of KO_GRAPH) {
    const sm = byNumber.get(node.matchNumber)!;
    const homeSrc = byNumber.get(node.homeFrom.match);
    const awaySrc = byNumber.get(node.awayFrom.match);
    sm.home = node.homeFrom.take === 'winner' ? homeSrc?.winner : homeSrc?.loser;
    sm.away = node.awayFrom.take === 'winner' ? awaySrc?.winner : awaySrc?.loser;
    settle(sm);
  }

  const winnersOf = (numbers: readonly MatchNumber[]): TeamId[] =>
    numbers
      .map((n) => byNumber.get(n)?.winner)
      .filter((t): t is TeamId => t !== undefined);

  return {
    matches: [...byNumber.values()].sort((a, b) => a.matchNumber - b.matchNumber),
    byNumber,
    reaching: {
      R16: winnersOf(MATCHES_BY_ROUND.R32),
      QF: winnersOf(MATCHES_BY_ROUND.R16),
      SF: winnersOf(MATCHES_BY_ROUND.QF),
      F: winnersOf(MATCHES_BY_ROUND.SF),
    },
    champion: byNumber.get(FINAL_MATCH)?.winner,
    thirdPlaceWinner: byNumber.get(THIRD_PLACE_MATCH)?.winner,
  };
}
