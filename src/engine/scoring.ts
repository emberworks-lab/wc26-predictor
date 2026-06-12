/**
 * Points engine — implements the entire SPEC scoring table (v1).
 *
 * Idempotent & total: `(all results, all predictions, redistribution log) →
 * points rows`. Same input → same output; missing/partial results produce
 * partial points; nothing is ever mutated incrementally.
 *
 * Scoring rules (SPEC.md → "Scoring table"):
 *  Group (global board):
 *   - correct match outcome (W/D/L)                       3
 *   - exact final group order (all 4 positions)          10 per group
 *   - correct top-2 qualifier (team really in top 2)      3 per team
 *   - correct third-place qualifier (among the best 8)    4 per team
 *  Knockout (global board) — per real team predicted to reach a round:
 *   - R16 4, QF 6, SF 8, Final 12, Champion 20, third-place-match winner 6
 *   - correct AET/pens flag on a correctly picked match (outcome users) +1
 *  Hardcore layer (hardcore board only):
 *   - exact score (group match or knockout 90')           5
 *   - correct goal difference, non-draw, not exact        2
 *   - correct ET/pens advancer after a predicted 90' draw 2
 *  Fun: numeric closeness round(max(0, maxPts·(1−|g−a|/tol))), pick 15, y/n 5.
 *  Redistribution: the multiplier (0.7/0.6/0.5/0.4/0.3) applies to knockout
 *  rows decided at the redistributed stage and onward; rows decided earlier
 *  keep multiplier 1 ("points earned before redistribution keep full value").
 *
 * Engine decisions documented here (not spelled out in SPEC):
 *  - Outcome-only group predictions are normalised to synthetic scores
 *    (1:0 / 0:0 / 0:1) so predicted tables can run the real tiebreaker
 *    engine; hardcore predictions use their exact scores. A hardcore
 *    prediction without scores (made while casual, match locked before the
 *    flip) falls back to its stored outcome — for the synthetic table AND
 *    the outcome point — but earns no hardcore score bonus.
 *  - Late joiners: a match that kicked off before a user joined can never be
 *    predicted. For TABLE DERIVATION ONLY (predicted tables → thirds →
 *    personal R32) a missing prediction on a FINISHED real match falls back
 *    to the real result — public information, equal for everyone, so no
 *    cheating vector. Match-outcome points still require a stored
 *    prediction (SPEC: "late joiners simply score 0 on those matches").
 *  - A bracket version's pairings are derived purely from data: the original
 *    Full bracket walks the user's predicted groups → R32 → knockout graph;
 *    Playoff brackets and redistribution versions sit on the real bracket
 *    (real results before their start stage, own picks from it onward).
 *  - Hardcore exact-score / GD / advancer bonuses on knockout matches apply
 *    only when the user's derived pairing for that match number equals the
 *    real pairing — no score bonuses on a match predicted between other teams.
 *  - Exact-score (5) and goal-difference (2) hardcore bonuses are exclusive
 *    tiers: an exact score earns 5, not 7.
 *  - AET/pens flag bonus: outcome-only entries, flag set, real match decided
 *    after 90', and the advancer pick for that match number was correct.
 *  - Third-place qualifier bonuses are awarded only once ALL 12 groups are
 *    complete (the best-8 ranking is cross-group).
 */

import { rankThirds, type ThirdPlaceEntry } from './bestThirds';
import { computeGroupTable } from './groupTable';
import {
  FINAL_MATCH,
  KO_GRAPH,
  MATCHES_BY_ROUND,
  THIRD_PLACE_MATCH,
  resolveAdvancer,
} from './knockoutSim';
import { buildR32 } from './r32Mapping';
import type {
  BracketVersion,
  GroupId,
  KnockoutRound,
  MatchNumber,
  MatchOutcome,
  PlayedMatch,
  RealKnockoutMatch,
  TeamId,
  TiebreakContext,
} from './types';
import { GROUP_IDS, KO_ROUND_ORDER } from './types';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface GroupMatchDef {
  id: string;
  group: GroupId;
  home: TeamId;
  away: TeamId;
  /** Present only when the match is finished. */
  homeGoals?: number;
  awayGoals?: number;
}

export interface RealResults {
  /** Full 72-match group schedule; finished matches carry goals. */
  groupMatches: readonly GroupMatchDef[];
  /** Finished knockout matches only. */
  knockoutMatches: readonly RealKnockoutMatch[];
  /** Conduct + FIFA ranking for real-table tiebreaks (and predicted-table determinism). */
  ctx?: TiebreakContext;
}

export interface GroupMatchPrediction {
  matchId: string;
  /** Outcome-only entries. */
  outcome?: MatchOutcome;
  /** Hardcore entries. */
  homeGoals?: number;
  awayGoals?: number;
}

export type ChallengeKind = 'FULL' | 'GROUPS' | 'PLAYOFF' | 'FUN';

export interface FunQuestionConfig {
  id: string;
  type: 'NUMERIC' | 'PICK' | 'YESNO';
  /** NUMERIC only; default maxPts 10. */
  maxPts?: number;
  tolerance?: number;
}

export type FunValue = number | string | boolean;

export interface ScoringEntry {
  entryId: string;
  challenge: ChallengeKind;
  hardcore: boolean;
  groupPredictions?: readonly GroupMatchPrediction[];
  /**
   * Knockout bracket versions, oldest first; index 0 is the original
   * (multiplier 1, no `redistributedBefore`). PLAYOFF has one version.
   */
  bracket?: readonly BracketVersion[];
  funAnswers?: Readonly<Record<string, FunValue>>;
}

export interface ScoringInput {
  real: RealResults;
  funQuestions?: readonly FunQuestionConfig[];
  /** Admin-resolved actuals; absent/null = not yet known (no rows yet). */
  funActuals?: Readonly<Record<string, FunValue | null>>;
  entries: readonly ScoringEntry[];
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type PointsSource =
  | 'GROUP_OUTCOME'
  | 'GROUP_EXACT_ORDER'
  | 'QUALIFIER_TOP2'
  | 'QUALIFIER_THIRD'
  | 'KO_REACH'
  | 'KO_AET_FLAG'
  | 'HC_EXACT_SCORE'
  | 'HC_GOAL_DIFF'
  | 'HC_ADVANCE_PICK'
  | 'FUN';

export interface PointsRow {
  entryId: string;
  board: 'GLOBAL' | 'HARDCORE';
  source: PointsSource;
  /** matchId | group | `${group}:${team}` | `${team}:${milestone}` | `M${n}` | questionId. */
  ref: string;
  basePoints: number;
  /** Redistribution multiplier in force for this row (1 otherwise). */
  multiplier: number;
  points: number;
}

/** Pre-aggregated counters for the leaderboard tiebreaker chain. */
export interface EntryScoringStats {
  entryId: string;
  correctQualifiers: number;
  correctKoPicks: number;
  correctOutcomes: number;
}

export interface ScoringOutput {
  rows: PointsRow[];
  stats: EntryScoringStats[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const POINTS = {
  groupOutcome: 3,
  groupExactOrder: 10,
  qualifierTop2: 3,
  qualifierThird: 4,
  reach: { R16: 4, QF: 6, SF: 8, F: 12 } as Readonly<
    Record<'R16' | 'QF' | 'SF' | 'F', number>
  >,
  champion: 20,
  thirdPlaceWinner: 6,
  aetFlag: 1,
  hcExactScore: 5,
  hcGoalDiff: 2,
  hcAdvancePick: 2,
  funPickExact: 15,
  funYesNo: 5,
  funNumericMaxDefault: 10,
} as const;

// ---------------------------------------------------------------------------
// Real-results digest (computed once per call, shared across entries)
// ---------------------------------------------------------------------------

interface Pairing {
  home: TeamId;
  away: TeamId;
}

interface RealDigest {
  outcomes: Map<string, MatchOutcome>;
  playedById: Map<string, GroupMatchDef>;
  matchesByGroup: Map<GroupId, GroupMatchDef[]>;
  /** Groups whose 6 matches are all finished → final ordered teams. */
  finalTables: Map<GroupId, TeamId[]>;
  allGroupsComplete: boolean;
  /** Only populated when allGroupsComplete. */
  qualifiedThirds: Set<TeamId>;
  top2: Map<GroupId, Set<TeamId>>;
  koByNumber: Map<MatchNumber, RealKnockoutMatch>;
  /** Official R32 pairings of the real bracket (known once groups complete). */
  realR32: Map<MatchNumber, Pairing>;
  /** Real teams reaching each round (advancers of the previous round). */
  realReaching: Record<'R16' | 'QF' | 'SF' | 'F', Set<TeamId>>;
  champion?: TeamId;
  thirdPlaceWinner?: TeamId;
}

function outcomeOf(homeGoals: number, awayGoals: number): MatchOutcome {
  if (homeGoals > awayGoals) return 'HOME';
  if (homeGoals < awayGoals) return 'AWAY';
  return 'DRAW';
}

function tablesToR32Sources(tables: Map<GroupId, TeamId[]>, thirds: Set<TeamId>, thirdRows: ThirdPlaceEntry[]) {
  const winners = {} as Record<GroupId, TeamId>;
  const runnersUp = {} as Record<GroupId, TeamId>;
  for (const [group, ordered] of tables) {
    winners[group] = ordered[0];
    runnersUp[group] = ordered[1];
  }
  const thirdsByGroup: Partial<Record<GroupId, TeamId>> = {};
  for (const e of thirdRows) {
    if (thirds.has(e.row.team)) thirdsByGroup[e.group] = e.row.team;
  }
  return { winners, runnersUp, thirds: thirdsByGroup };
}

function digestReal(real: RealResults): RealDigest {
  const outcomes = new Map<string, MatchOutcome>();
  const playedById = new Map<string, GroupMatchDef>();
  const matchesByGroup = new Map<GroupId, GroupMatchDef[]>();

  for (const m of real.groupMatches) {
    let list = matchesByGroup.get(m.group);
    if (!list) matchesByGroup.set(m.group, (list = []));
    list.push(m);
    if (m.homeGoals !== undefined && m.awayGoals !== undefined) {
      playedById.set(m.id, m);
      outcomes.set(m.id, outcomeOf(m.homeGoals, m.awayGoals));
    }
  }

  const finalTables = new Map<GroupId, TeamId[]>();
  const top2 = new Map<GroupId, Set<TeamId>>();
  const thirdEntries: ThirdPlaceEntry[] = [];
  for (const [group, defs] of matchesByGroup) {
    const teams = [...new Set(defs.flatMap((d) => [d.home, d.away]))];
    const played = defs.filter(
      (d): d is GroupMatchDef & PlayedMatch =>
        d.homeGoals !== undefined && d.awayGoals !== undefined,
    );
    if (teams.length !== 4 || played.length !== 6) continue;
    const table = computeGroupTable(played, teams, real.ctx);
    finalTables.set(group, table.map((r) => r.team));
    top2.set(group, new Set([table[0].team, table[1].team]));
    thirdEntries.push({ group, row: table[2] });
  }

  const allGroupsComplete = GROUP_IDS.every((g) => finalTables.has(g));
  const qualifiedThirds = new Set<TeamId>();
  const realR32 = new Map<MatchNumber, Pairing>();
  if (allGroupsComplete) {
    for (const q of rankThirds(thirdEntries, real.ctx).qualified) {
      qualifiedThirds.add(q.row.team);
    }
    const sources = tablesToR32Sources(finalTables, qualifiedThirds, thirdEntries);
    for (const m of buildR32(sources)) {
      realR32.set(m.matchNumber, { home: m.home, away: m.away });
    }
  }

  const koByNumber = new Map<MatchNumber, RealKnockoutMatch>();
  for (const m of real.knockoutMatches) {
    koByNumber.set(m.matchNumber, m);
    // Played real matches are authoritative for pairings.
    if (m.matchNumber >= 73 && m.matchNumber <= 88) {
      realR32.set(m.matchNumber, { home: m.home, away: m.away });
    }
  }

  const advancersOf = (numbers: readonly MatchNumber[]): Set<TeamId> => {
    const set = new Set<TeamId>();
    for (const n of numbers) {
      const m = koByNumber.get(n);
      if (m) set.add(m.advancer);
    }
    return set;
  };

  return {
    outcomes,
    playedById,
    matchesByGroup,
    finalTables,
    allGroupsComplete,
    qualifiedThirds,
    top2,
    koByNumber,
    realR32,
    realReaching: {
      R16: advancersOf(MATCHES_BY_ROUND.R32),
      QF: advancersOf(MATCHES_BY_ROUND.R16),
      SF: advancersOf(MATCHES_BY_ROUND.QF),
      F: advancersOf(MATCHES_BY_ROUND.SF),
    },
    champion: koByNumber.get(FINAL_MATCH)?.advancer,
    thirdPlaceWinner: koByNumber.get(THIRD_PLACE_MATCH)?.advancer,
  };
}

// ---------------------------------------------------------------------------
// Predicted group tables
// ---------------------------------------------------------------------------

/**
 * Normalises a prediction to a synthetic played match for table purposes.
 * Hardcore scores win; otherwise the stored outcome becomes a synthetic
 * 1:0 / 0:0 / 0:1 (covers casual entries AND hardcore entries whose
 * prediction predates a casual→hardcore flip on a locked match).
 */
export function predictionAsPlayedMatch(
  def: GroupMatchDef,
  pred: GroupMatchPrediction,
  hardcore: boolean,
): PlayedMatch | undefined {
  if (hardcore && pred.homeGoals !== undefined && pred.awayGoals !== undefined) {
    return {
      home: def.home,
      away: def.away,
      homeGoals: pred.homeGoals,
      awayGoals: pred.awayGoals,
    };
  }
  if (pred.outcome === undefined) return undefined;
  const [homeGoals, awayGoals] =
    pred.outcome === 'HOME' ? [1, 0] : pred.outcome === 'AWAY' ? [0, 1] : [0, 0];
  return { home: def.home, away: def.away, homeGoals, awayGoals };
}

export function predictedOutcome(
  pred: GroupMatchPrediction,
  hardcore: boolean,
): MatchOutcome | undefined {
  if (hardcore && pred.homeGoals !== undefined && pred.awayGoals !== undefined) {
    return outcomeOf(pred.homeGoals, pred.awayGoals);
  }
  return pred.outcome;
}

/**
 * Table-derivation fallback for a match the user has no usable prediction
 * for: the REAL result, if the match is finished. Late joiners (and flipped
 * entries) keep complete predicted tables; gaps on unplayed matches stay open.
 */
function realResultAsPlayedMatch(def: GroupMatchDef): PlayedMatch | undefined {
  if (def.homeGoals === undefined || def.awayGoals === undefined) return undefined;
  return { home: def.home, away: def.away, homeGoals: def.homeGoals, awayGoals: def.awayGoals };
}

interface PredictedGroups {
  tables: Map<GroupId, TeamId[]>;
  top2: Map<GroupId, Set<TeamId>>;
  qualifiedThirds: Set<TeamId>;
  thirdEntries: ThirdPlaceEntry[];
  /** All 12 groups fully predicted. */
  complete: boolean;
}

function computePredictedGroups(
  real: RealResults,
  entry: ScoringEntry,
  matchesByGroup: Map<GroupId, GroupMatchDef[]>,
): PredictedGroups {
  const predById = new Map<string, GroupMatchPrediction>();
  for (const p of entry.groupPredictions ?? []) predById.set(p.matchId, p);

  // Predicted tables run the same tiebreaker engine; conduct is unknowable
  // for predictions, so below head-to-head only the FIFA-ranking and TeamId
  // fallbacks apply.
  const ctx: TiebreakContext = { fifaRanking: real.ctx?.fifaRanking };

  const tables = new Map<GroupId, TeamId[]>();
  const top2 = new Map<GroupId, Set<TeamId>>();
  const thirdEntries: ThirdPlaceEntry[] = [];
  let complete = GROUP_IDS.every((g) => matchesByGroup.has(g));

  for (const [group, defs] of matchesByGroup) {
    const teams = [...new Set(defs.flatMap((d) => [d.home, d.away]))];
    const predicted: PlayedMatch[] = [];
    for (const def of defs) {
      const pred = predById.get(def.id);
      const asMatch =
        (pred && predictionAsPlayedMatch(def, pred, entry.hardcore)) ??
        realResultAsPlayedMatch(def);
      if (asMatch) predicted.push(asMatch);
    }
    if (teams.length !== 4 || predicted.length !== 6) {
      complete = false;
      continue;
    }
    const table = computeGroupTable(predicted, teams, ctx);
    tables.set(group, table.map((r) => r.team));
    top2.set(group, new Set([table[0].team, table[1].team]));
    thirdEntries.push({ group, row: table[2] });
  }

  const qualifiedThirds = new Set<TeamId>();
  if (complete) {
    for (const q of rankThirds(thirdEntries, ctx).qualified) {
      qualifiedThirds.add(q.row.team);
    }
  }

  return { tables, top2, qualifiedThirds, thirdEntries, complete };
}

// ---------------------------------------------------------------------------
// Bracket versions / redistribution
// ---------------------------------------------------------------------------

const roundIndex = (r: KnockoutRound): number => KO_ROUND_ORDER.indexOf(r);

/**
 * The bracket version whose picks govern matches of `round`: the LAST version
 * whose start stage (R32 for the original, `redistributedBefore` otherwise)
 * is ≤ `round`.
 */
export function activeVersionForRound(
  versions: readonly BracketVersion[],
  round: KnockoutRound,
): BracketVersion | undefined {
  let active: BracketVersion | undefined;
  for (const v of versions) {
    const start = v.redistributedBefore ?? 'R32';
    if (roundIndex(start) <= roundIndex(round)) active = v;
  }
  return active;
}

/**
 * Derives a version's pairing for every knockout match it governs.
 *
 * Base R32 pairings: the user's predicted bracket for the original Full
 * version (`predictedR32`); the real bracket otherwise. Upstream matches
 * before the version's start stage resolve with REAL advancers; matches from
 * the start stage onward resolve with the version's own picks.
 */
function computeVersionPairings(
  version: BracketVersion,
  baseR32: ReadonlyMap<MatchNumber, Pairing> | undefined,
  digest: RealDigest,
): Map<MatchNumber, Pairing> {
  const pairings = new Map<MatchNumber, Pairing>();
  if (!baseR32) return pairings;
  const start = roundIndex(version.redistributedBefore ?? 'R32');

  const winners = new Map<MatchNumber, TeamId>();
  const losers = new Map<MatchNumber, TeamId>();

  const settle = (n: MatchNumber, round: KnockoutRound): void => {
    const pairing = pairings.get(n);
    if (!pairing) return;
    let advancer: TeamId | undefined;
    if (roundIndex(round) < start) {
      advancer = digest.koByNumber.get(n)?.advancer;
      // A real advancer can only feed downstream if it belongs to the pairing
      // we derived (it always does for real bases; guard for safety).
      if (advancer !== pairing.home && advancer !== pairing.away) advancer = undefined;
    } else {
      advancer = resolveAdvancer(version.picks[n], pairing.home, pairing.away);
    }
    if (advancer === undefined) return;
    winners.set(n, advancer);
    losers.set(n, advancer === pairing.home ? pairing.away : pairing.home);
  };

  for (const n of MATCHES_BY_ROUND.R32) {
    const p = baseR32.get(n);
    if (p) pairings.set(n, p);
    settle(n, 'R32');
  }
  for (const node of KO_GRAPH) {
    const home =
      node.homeFrom.take === 'winner'
        ? winners.get(node.homeFrom.match)
        : losers.get(node.homeFrom.match);
    const away =
      node.awayFrom.take === 'winner'
        ? winners.get(node.awayFrom.match)
        : losers.get(node.awayFrom.match);
    if (home !== undefined && away !== undefined) {
      pairings.set(node.matchNumber, { home, away });
    }
    settle(node.matchNumber, node.round);
  }
  return pairings;
}

// ---------------------------------------------------------------------------
// Fun questions
// ---------------------------------------------------------------------------

export function scoreFunQuestion(
  q: FunQuestionConfig,
  answer: FunValue,
  actual: FunValue,
): number {
  switch (q.type) {
    case 'NUMERIC': {
      const guess = Number(answer);
      const real = Number(actual);
      const tolerance = q.tolerance ?? 1;
      const maxPts = q.maxPts ?? POINTS.funNumericMaxDefault;
      if (!Number.isFinite(guess) || !Number.isFinite(real) || tolerance <= 0) return 0;
      return Math.round(Math.max(0, maxPts * (1 - Math.abs(guess - real) / tolerance)));
    }
    case 'PICK':
      return answer === actual ? POINTS.funPickExact : 0;
    case 'YESNO':
      return answer === actual ? POINTS.funYesNo : 0;
  }
}

// ---------------------------------------------------------------------------
// Per-entry scoring
// ---------------------------------------------------------------------------

function scoreEntry(
  entry: ScoringEntry,
  real: RealResults,
  digest: RealDigest,
  funQuestions: readonly FunQuestionConfig[],
  funActuals: Readonly<Record<string, FunValue | null>>,
): { rows: PointsRow[]; stats: EntryScoringStats } {
  const rows: PointsRow[] = [];
  const stats: EntryScoringStats = {
    entryId: entry.entryId,
    correctQualifiers: 0,
    correctKoPicks: 0,
    correctOutcomes: 0,
  };
  const add = (
    board: PointsRow['board'],
    source: PointsSource,
    ref: string,
    basePoints: number,
    multiplier = 1,
  ): void => {
    rows.push({
      entryId: entry.entryId,
      board,
      source,
      ref,
      basePoints,
      multiplier,
      points: basePoints * multiplier,
    });
  };

  // --- Group stage (FULL + GROUPS) -----------------------------------------
  let predicted: PredictedGroups | undefined;
  if (entry.challenge === 'FULL' || entry.challenge === 'GROUPS') {
    predicted = computePredictedGroups(real, entry, digest.matchesByGroup);

    for (const pred of entry.groupPredictions ?? []) {
      const realOutcome = digest.outcomes.get(pred.matchId);
      if (!realOutcome) continue; // not played yet
      const mine = predictedOutcome(pred, entry.hardcore);
      if (mine !== undefined && mine === realOutcome) {
        add('GLOBAL', 'GROUP_OUTCOME', pred.matchId, POINTS.groupOutcome);
        stats.correctOutcomes += 1;
      }
      if (entry.hardcore && pred.homeGoals !== undefined && pred.awayGoals !== undefined) {
        const def = digest.playedById.get(pred.matchId)!;
        const exact =
          pred.homeGoals === def.homeGoals && pred.awayGoals === def.awayGoals;
        if (exact) {
          add('HARDCORE', 'HC_EXACT_SCORE', pred.matchId, POINTS.hcExactScore);
        } else if (
          realOutcome !== 'DRAW' &&
          pred.homeGoals - pred.awayGoals === def.homeGoals! - def.awayGoals!
        ) {
          add('HARDCORE', 'HC_GOAL_DIFF', pred.matchId, POINTS.hcGoalDiff);
        }
      }
    }

    for (const [group, realTable] of digest.finalTables) {
      const mineTable = predicted.tables.get(group);
      if (
        mineTable &&
        mineTable.length === realTable.length &&
        mineTable.every((t, i) => t === realTable[i])
      ) {
        add('GLOBAL', 'GROUP_EXACT_ORDER', group, POINTS.groupExactOrder);
      }
      const realTop2 = digest.top2.get(group)!;
      const mineTop2 = predicted.top2.get(group);
      if (mineTop2) {
        for (const team of mineTop2) {
          if (realTop2.has(team)) {
            add('GLOBAL', 'QUALIFIER_TOP2', `${group}:${team}`, POINTS.qualifierTop2);
            stats.correctQualifiers += 1;
          }
        }
      }
    }

    if (digest.allGroupsComplete && predicted.complete) {
      for (const team of predicted.qualifiedThirds) {
        if (digest.qualifiedThirds.has(team)) {
          add('GLOBAL', 'QUALIFIER_THIRD', team, POINTS.qualifierThird);
          stats.correctQualifiers += 1;
        }
      }
    }
  }

  // --- Knockout (FULL + PLAYOFF) -------------------------------------------
  if ((entry.challenge === 'FULL' || entry.challenge === 'PLAYOFF') && entry.bracket?.length) {
    const versions = entry.bracket;

    // The original Full bracket sits on the user's PREDICTED R32 (derived
    // from their predicted groups); every other version sits on the real one.
    let predictedR32: Map<MatchNumber, Pairing> | undefined;
    if (entry.challenge === 'FULL' && predicted?.complete) {
      const sources = tablesToR32Sources(
        predicted.tables,
        predicted.qualifiedThirds,
        predicted.thirdEntries,
      );
      predictedR32 = new Map(
        buildR32(sources).map((m) => [m.matchNumber, { home: m.home, away: m.away }]),
      );
    }

    const pairingsOf = new Map<BracketVersion, Map<MatchNumber, Pairing>>();
    versions.forEach((v, i) => {
      const isOriginalFull = entry.challenge === 'FULL' && i === 0;
      const base = isOriginalFull
        ? predictedR32
        : digest.realR32.size === 16
          ? digest.realR32
          : undefined;
      pairingsOf.set(v, computeVersionPairings(v, base, digest));
    });

    /** Resolved advancer of the version's pick for match n (pairing-aware). */
    const pickedAdvancer = (version: BracketVersion, n: MatchNumber): TeamId | undefined => {
      const pick = version.picks[n];
      if (!pick) return undefined;
      const pairing = pairingsOf.get(version)?.get(n);
      if (pairing) return resolveAdvancer(pick, pairing.home, pairing.away);
      // Pairing unknown (incomplete predictions): trust the explicit field.
      return pick.advancer;
    };

    // Reach milestones: predicted-to-reach sets vs real sets.
    const milestones: Array<{
      decidingRound: KnockoutRound;
      decidingMatches: readonly MatchNumber[];
      realSet: ReadonlySet<TeamId>;
      base: number;
      refSuffix: string;
    }> = [
      { decidingRound: 'R32', decidingMatches: MATCHES_BY_ROUND.R32, realSet: digest.realReaching.R16, base: POINTS.reach.R16, refSuffix: 'R16' },
      { decidingRound: 'R16', decidingMatches: MATCHES_BY_ROUND.R16, realSet: digest.realReaching.QF, base: POINTS.reach.QF, refSuffix: 'QF' },
      { decidingRound: 'QF', decidingMatches: MATCHES_BY_ROUND.QF, realSet: digest.realReaching.SF, base: POINTS.reach.SF, refSuffix: 'SF' },
      { decidingRound: 'SF', decidingMatches: MATCHES_BY_ROUND.SF, realSet: digest.realReaching.F, base: POINTS.reach.F, refSuffix: 'F' },
      {
        decidingRound: 'F',
        decidingMatches: [FINAL_MATCH],
        realSet: digest.champion ? new Set([digest.champion]) : new Set<TeamId>(),
        base: POINTS.champion,
        refSuffix: 'CHAMPION',
      },
      {
        decidingRound: 'F',
        decidingMatches: [THIRD_PLACE_MATCH],
        realSet: digest.thirdPlaceWinner
          ? new Set([digest.thirdPlaceWinner])
          : new Set<TeamId>(),
        base: POINTS.thirdPlaceWinner,
        refSuffix: 'THIRD_PLACE_WINNER',
      },
    ];

    for (const ms of milestones) {
      const version = activeVersionForRound(versions, ms.decidingRound);
      if (!version) continue;
      const predictedSet = new Set<TeamId>();
      for (const n of ms.decidingMatches) {
        const team = pickedAdvancer(version, n);
        if (team !== undefined) predictedSet.add(team);
      }
      for (const team of predictedSet) {
        if (ms.realSet.has(team)) {
          add('GLOBAL', 'KO_REACH', `${team}:${ms.refSuffix}`, ms.base, version.multiplier);
        }
      }
    }

    // Per-match comparisons: correct-advancer stat, AET flag, hardcore layer.
    for (const round of KO_ROUND_ORDER) {
      const version = activeVersionForRound(versions, round);
      if (!version) continue;
      for (const n of MATCHES_BY_ROUND[round]) {
        const realMatch = digest.koByNumber.get(n);
        const pick = version.picks[n];
        if (!realMatch || !pick) continue;

        const mine = pickedAdvancer(version, n);
        const advancerCorrect = mine !== undefined && mine === realMatch.advancer;
        if (advancerCorrect) stats.correctKoPicks += 1;

        if (!entry.hardcore) {
          if (advancerCorrect && pick.aetFlag === true && realMatch.decidedBy !== 'REG') {
            add('GLOBAL', 'KO_AET_FLAG', `M${n}`, POINTS.aetFlag, version.multiplier);
          }
          continue;
        }

        if (pick.homeGoals === undefined || pick.awayGoals === undefined) continue;
        const pairing = pairingsOf.get(version)?.get(n);
        const samePairing =
          pairing !== undefined &&
          pairing.home === realMatch.home &&
          pairing.away === realMatch.away;
        if (!samePairing) continue;

        const exact =
          pick.homeGoals === realMatch.homeGoals90 &&
          pick.awayGoals === realMatch.awayGoals90;
        const realDraw = realMatch.homeGoals90 === realMatch.awayGoals90;
        if (exact) {
          add('HARDCORE', 'HC_EXACT_SCORE', `M${n}`, POINTS.hcExactScore, version.multiplier);
        } else if (
          !realDraw &&
          pick.homeGoals - pick.awayGoals === realMatch.homeGoals90 - realMatch.awayGoals90
        ) {
          add('HARDCORE', 'HC_GOAL_DIFF', `M${n}`, POINTS.hcGoalDiff, version.multiplier);
        }
        if (
          pick.homeGoals === pick.awayGoals &&
          realDraw &&
          realMatch.decidedBy !== 'REG' &&
          pick.advancer === realMatch.advancer
        ) {
          add('HARDCORE', 'HC_ADVANCE_PICK', `M${n}`, POINTS.hcAdvancePick, version.multiplier);
        }
      }
    }
  }

  // --- Fun -------------------------------------------------------------------
  if (entry.challenge === 'FUN' && entry.funAnswers) {
    for (const q of funQuestions) {
      const answer = entry.funAnswers[q.id];
      const actual = funActuals[q.id];
      if (answer === undefined || actual === undefined || actual === null) continue;
      const pts = scoreFunQuestion(q, answer, actual);
      if (pts > 0) add('GLOBAL', 'FUN', q.id, pts);
    }
  }

  return { rows, stats };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computePoints(input: ScoringInput): ScoringOutput {
  const digest = digestReal(input.real);
  const rows: PointsRow[] = [];
  const stats: EntryScoringStats[] = [];
  for (const entry of input.entries) {
    const r = scoreEntry(
      entry,
      input.real,
      digest,
      input.funQuestions ?? [],
      input.funActuals ?? {},
    );
    rows.push(...r.rows);
    stats.push(r.stats);
  }
  return { rows, stats };
}
