/**
 * Group standings with the official FIFA WC26 tiebreakers.
 *
 * Source: FIFA "Regulations for the FIFA World Cup 26" (May 2026), Article 13
 * (https://digitalhub.fifa.com/m/636f5c9c6f29771f/original/FWC2026_regulations_EN.pdf):
 *
 * Teams equal on points (3/1/0 league system) are ranked by:
 *  Step 1 (head-to-head among ALL teams concerned):
 *    a) points  b) goal difference  c) goals scored — in matches between them.
 *  Step 2:
 *    If a)–c) separate some teams, criteria a)–c) are re-applied to the
 *    matches between the remaining tied teams only (recursively while the
 *    tied subset keeps shrinking). If no decision can be made:
 *    d) overall goal difference  e) overall goals scored
 *    f) team conduct score (cards) — applied in order WITHOUT restarting.
 *  Step 3:
 *    g/h) FIFA World Ranking (we receive one ranking snapshot as input).
 *
 * Engine-only final guard (not a FIFA rule): lexicographic TeamId order, so
 * the function is total and deterministic even without ranking data.
 *
 * Works on partial results (mid-group state): only finished matches are
 * passed in; unplayed teams simply have zeros.
 */

import type {
  GroupTableRow,
  PlayedMatch,
  TeamId,
  TiebreakContext,
} from './types';

interface Stats {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

function emptyStats(): Stats {
  return { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 };
}

function accumulate(stats: Map<TeamId, Stats>, matches: readonly PlayedMatch[]): void {
  for (const m of matches) {
    const h = stats.get(m.home);
    const a = stats.get(m.away);
    if (!h || !a) continue; // match referencing a team outside the set — ignore
    h.played += 1;
    a.played += 1;
    h.goalsFor += m.homeGoals;
    h.goalsAgainst += m.awayGoals;
    a.goalsFor += m.awayGoals;
    a.goalsAgainst += m.homeGoals;
    if (m.homeGoals > m.awayGoals) {
      h.won += 1;
      a.lost += 1;
    } else if (m.homeGoals < m.awayGoals) {
      a.won += 1;
      h.lost += 1;
    } else {
      h.drawn += 1;
      a.drawn += 1;
    }
  }
}

const points = (s: Stats): number => s.won * 3 + s.drawn;
const goalDiff = (s: Stats): number => s.goalsFor - s.goalsAgainst;

function statsFor(teams: readonly TeamId[], matches: readonly PlayedMatch[]): Map<TeamId, Stats> {
  const map = new Map<TeamId, Stats>(teams.map((t) => [t, emptyStats()]));
  accumulate(map, matches);
  return map;
}

function compareDesc(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
}

/** Splits `teams` into ordered classes of equal value under `key` (descending lexicographic). */
function partitionBy(teams: readonly TeamId[], key: (t: TeamId) => number[]): TeamId[][] {
  const sorted = [...teams].sort((x, y) => compareDesc(key(x), key(y)));
  const classes: TeamId[][] = [];
  for (const t of sorted) {
    const last = classes[classes.length - 1];
    if (last && compareDesc(key(last[0]), key(t)) === 0) last.push(t);
    else classes.push([t]);
  }
  return classes;
}

/**
 * Step 2 d)–f) + step 3: overall GD, overall GF, conduct, FIFA ranking,
 * TeamId guard — applied in order without restart (= lexicographic sort).
 */
function rankByOverallCriteria(
  tied: readonly TeamId[],
  overall: Map<TeamId, Stats>,
  ctx: TiebreakContext,
): TeamId[] {
  return [...tied].sort((x, y) => {
    const sx = overall.get(x)!;
    const sy = overall.get(y)!;
    if (goalDiff(sx) !== goalDiff(sy)) return goalDiff(sy) - goalDiff(sx);
    if (sx.goalsFor !== sy.goalsFor) return sy.goalsFor - sx.goalsFor;
    const cx = ctx.conduct?.[x] ?? 0;
    const cy = ctx.conduct?.[y] ?? 0;
    if (cx !== cy) return cy - cx; // higher conduct score ranks first
    const rx = ctx.fifaRanking?.[x] ?? Number.POSITIVE_INFINITY;
    const ry = ctx.fifaRanking?.[y] ?? Number.POSITIVE_INFINITY;
    if (rx !== ry) return rx - ry; // lower ranking position ranks first
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/**
 * Ranks a set of teams equal on overall points, per Article 13 steps 1–3.
 * `matches` is the full set of group matches (the head-to-head sub-table is
 * derived from it).
 */
function rankTied(
  tied: readonly TeamId[],
  matches: readonly PlayedMatch[],
  overall: Map<TeamId, Stats>,
  ctx: TiebreakContext,
): TeamId[] {
  if (tied.length === 1) return [...tied];

  const tiedSet = new Set(tied);
  const mutual = matches.filter((m) => tiedSet.has(m.home) && tiedSet.has(m.away));
  const h2h = statsFor(tied, mutual);

  // Step 1: lexicographic (h2h points, h2h GD, h2h GF).
  const classes = partitionBy(tied, (t) => {
    const s = h2h.get(t)!;
    return [points(s), goalDiff(s), s.goalsFor];
  });

  const result: TeamId[] = [];
  for (const cls of classes) {
    if (cls.length === 1) {
      result.push(cls[0]);
    } else if (cls.length < tied.length) {
      // Step 2 first sentence: re-apply a)–c) to the remaining teams only.
      result.push(...rankTied(cls, matches, overall, ctx));
    } else {
      // No separation at all: fall through to d)–f) and step 3.
      result.push(...rankByOverallCriteria(cls, overall, ctx));
    }
  }
  return result;
}

/**
 * Computes the group table for `teams` over the finished `matches`.
 * Returns rows ordered 1 → n with `position` filled in.
 */
export function computeGroupTable(
  matches: readonly PlayedMatch[],
  teams: readonly TeamId[],
  ctx: TiebreakContext = {},
): GroupTableRow[] {
  const overall = statsFor(teams, matches);

  const ordered: TeamId[] = [];
  for (const cls of partitionBy(teams, (t) => [points(overall.get(t)!)])) {
    ordered.push(...rankTied(cls, matches, overall, ctx));
  }

  return ordered.map((team, i) => {
    const s = overall.get(team)!;
    return {
      team,
      played: s.played,
      won: s.won,
      drawn: s.drawn,
      lost: s.lost,
      goalsFor: s.goalsFor,
      goalsAgainst: s.goalsAgainst,
      goalDiff: goalDiff(s),
      points: points(s),
      position: i + 1,
    };
  });
}
