/**
 * The points recompute pipeline (SPEC recompute rule): loads every result,
 * prediction, bracket generation, redistribution and fun answer, runs the
 * ONE pure call (`engine/scoring.computePoints`) and atomically replaces
 * each entry's points rows via the `replace_entry_points` RPC.
 *
 * Lives in src/ (not in the Edge Function) so the deployed sync function and
 * the verification scripts run EXACTLY the same code — the function imports
 * this module and gets it inlined by the esbuild bundle
 * (`node scripts/bundle-sync.mjs`); scripts import it directly via tsx. The
 * Supabase client is injected and only referenced as a type, so nothing
 * client-side gets bundled.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { computePoints } from '@/engine/scoring';
import type {
  FunAnswer,
  FunQuestionConfig,
  FunRange,
  FunValue,
  GroupMatchDef,
  GroupMatchPrediction,
  ScoringEntry,
} from '@/engine/scoring';
import type {
  BracketVersion,
  GroupId,
  KnockoutRound,
  MatchOutcome,
  RealKnockoutMatch,
} from '@/engine/types';

// The injected client is used untyped (the Edge runtime builds it from
// npm:@supabase/supabase-js, scripts from node_modules — same shape).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SyncDb = SupabaseClient<any, any, any>;

export interface DbTeam {
  id: number;
  api_id: number;
  fifa_code: string;
}

export interface DbMatch {
  id: number;
  api_id: number;
  stage: string;
  group_code: string | null;
  matchday: number | null;
  fifa_match_number: number | null;
  kickoff_utc: string;
  status: string;
  home_team_id: number | null;
  away_team_id: number | null;
  home_score: number | null;
  away_score: number | null;
  home_score_et: number | null;
  away_score_et: number | null;
  home_pens: number | null;
  away_pens: number | null;
  winner_team_id: number | null;
  manually_corrected: boolean;
}

const ROUND_OF_STAGE: Record<string, KnockoutRound> = {
  r32: 'R32',
  r16: 'R16',
  qf: 'QF',
  sf: 'SF',
  third_place: 'F',
  final: 'F',
};

const OUTCOME_MAP: Record<string, MatchOutcome> = {
  home: 'HOME',
  draw: 'DRAW',
  away: 'AWAY',
};

export function need<T>(data: T | null, error: { message: string } | null, what: string): T {
  if (error) throw new Error(`${what}: ${error.message}`);
  if (data == null) throw new Error(`${what}: no data`);
  return data;
}

export async function loadTeams(supabase: SyncDb) {
  const { data, error } = await supabase.from('teams').select('id, api_id, fifa_code');
  const teams = need(data, error, 'teams select') as DbTeam[];
  return {
    teams,
    idByApiId: new Map(teams.map((t) => [t.api_id, t.id])),
    codeById: new Map(teams.map((t) => [t.id, t.fifa_code])),
    idByCode: new Map(teams.map((t) => [t.fifa_code, t.id])),
  };
}

export async function loadMatches(supabase: SyncDb): Promise<DbMatch[]> {
  const { data, error } = await supabase.from('matches').select('*');
  return need(data, error, 'matches select') as DbMatch[];
}

export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// (all results, all predictions, redistribution log) → points
// ---------------------------------------------------------------------------

export async function runRecompute(supabase: SyncDb) {
  const { codeById } = await loadTeams(supabase);
  const matches = await loadMatches(supabase);

  const sel = async <T>(table: string, columns: string): Promise<T[]> => {
    const { data, error } = await supabase.from(table).select(columns);
    return need(data, error, `${table} select`) as T[];
  };

  const challenges = await sel<{ id: number; kind: string }>('challenges', 'id, kind');
  const entries = await sel<{ id: string; challenge_id: number; hardcore: boolean }>(
    'challenge_entries',
    'id, challenge_id, hardcore',
  );
  const matchPreds = await sel<{
    entry_id: string;
    match_id: number;
    outcome: string;
    home_score: number | null;
    away_score: number | null;
  }>('match_predictions', 'entry_id, match_id, outcome, home_score, away_score');
  const bracketPreds = await sel<{
    entry_id: string;
    generation: number;
    slot: number;
    winner_team_id: number;
    home_score: number | null;
    away_score: number | null;
    aet_pens: boolean | null;
  }>(
    'bracket_predictions',
    'entry_id, generation, slot, winner_team_id, home_score, away_score, aet_pens',
  );
  const redistributions = await sel<{
    entry_id: string;
    generation: number;
    stage: string;
    multiplier: number;
  }>('redistributions', 'entry_id, generation, stage, multiplier');
  const funQuestions = await sel<{
    id: number;
    key: string;
    qtype: string;
    max_pts: number;
    tolerance: number | null;
    ranges: FunRange[] | null;
    correct_numeric: number | null;
    correct_text: string | null;
    correct_bool: boolean | null;
  }>('fun_questions', '*');
  const funAnswers = await sel<{
    entry_id: string;
    question_id: number;
    range_index: number | null;
    numeric_answer: number | null;
    text_answer: string | null;
    bool_answer: boolean | null;
  }>('fun_answers', 'entry_id, question_id, range_index, numeric_answer, text_answer, bool_answer');

  // --- real results ----------------------------------------------------------
  const groupMatches: GroupMatchDef[] = matches
    .filter((m) => m.stage === 'group')
    .map((m) => ({
      id: String(m.id),
      group: m.group_code as GroupId,
      home: codeById.get(m.home_team_id!)!,
      away: codeById.get(m.away_team_id!)!,
      ...(m.status === 'finished'
        ? { homeGoals: m.home_score!, awayGoals: m.away_score! }
        : {}),
    }));

  const knockoutMatches: RealKnockoutMatch[] = matches
    .filter(
      (m) =>
        m.stage !== 'group' &&
        m.status === 'finished' &&
        m.fifa_match_number != null &&
        m.home_team_id != null &&
        m.away_team_id != null &&
        m.winner_team_id != null,
    )
    .map((m) => ({
      matchNumber: m.fifa_match_number!,
      home: codeById.get(m.home_team_id!)!,
      away: codeById.get(m.away_team_id!)!,
      homeGoals90: m.home_score!,
      awayGoals90: m.away_score!,
      advancer: codeById.get(m.winner_team_id!)!,
      decidedBy: m.home_pens != null ? 'PEN' : m.home_score_et != null ? 'ET' : 'REG',
    }));

  // --- fun config / actuals ------------------------------------------------------
  const questionKeyById = new Map(funQuestions.map((q) => [q.id, q.key]));
  const rangesByKey = new Map(funQuestions.map((q) => [q.key, q.ranges]));
  const funConfig: FunQuestionConfig[] = funQuestions.map((q) => ({
    id: q.key,
    type: q.qtype.toUpperCase() as FunQuestionConfig['type'],
    maxPts: q.max_pts,
    tolerance: q.tolerance ?? undefined,
    ...(q.ranges ? { ranges: q.ranges } : {}),
  }));
  const funActuals: Record<string, FunValue | null> = {};
  for (const q of funQuestions) {
    funActuals[q.key] =
      q.qtype === 'numeric'
        ? q.correct_numeric
        : q.qtype === 'pick'
          ? q.correct_text
          : q.correct_bool;
  }

  // --- entries ----------------------------------------------------------------
  const kindById = new Map(challenges.map((c) => [c.id, c.kind]));
  const predsByEntry = groupBy(matchPreds, (p) => p.entry_id);
  const bracketsByEntry = groupBy(bracketPreds, (p) => p.entry_id);
  const redistByEntry = groupBy(redistributions, (r) => r.entry_id);
  const funByEntry = groupBy(funAnswers, (a) => a.entry_id);

  const scoringEntries: ScoringEntry[] = entries.map((entry) => {
    const kind = kindById.get(entry.challenge_id)!.toUpperCase() as ScoringEntry['challenge'];

    const groupPredictions: GroupMatchPrediction[] = (
      predsByEntry.get(entry.id) ?? []
    ).map((p) => ({
      matchId: String(p.match_id),
      outcome: OUTCOME_MAP[p.outcome],
      ...(p.home_score != null && p.away_score != null
        ? { homeGoals: p.home_score, awayGoals: p.away_score }
        : {}),
    }));

    const redistByGen = new Map(
      (redistByEntry.get(entry.id) ?? []).map((r) => [r.generation, r]),
    );
    const generations = [
      ...new Set((bracketsByEntry.get(entry.id) ?? []).map((b) => b.generation)),
    ].sort((a, b) => a - b);
    const bracket: BracketVersion[] = [];
    for (const gen of generations) {
      const redist = gen === 0 ? null : redistByGen.get(gen);
      if (gen !== 0 && !redist) {
        console.warn(`entry ${entry.id}: bracket gen ${gen} has no redistribution row, skipping`);
        continue;
      }
      const picks: Record<number, Record<string, unknown>> = {};
      for (const b of (bracketsByEntry.get(entry.id) ?? []).filter(
        (b) => b.generation === gen,
      )) {
        picks[b.slot] = {
          advancer: codeById.get(b.winner_team_id),
          ...(b.aet_pens != null ? { aetFlag: b.aet_pens } : {}),
          ...(b.home_score != null && b.away_score != null
            ? { homeGoals: b.home_score, awayGoals: b.away_score }
            : {}),
        };
      }
      bracket.push({
        multiplier: redist ? Number(redist.multiplier) : 1,
        ...(redist ? { redistributedBefore: ROUND_OF_STAGE[redist.stage] } : {}),
        picks: picks as BracketVersion['picks'],
      });
    }

    const answers: Record<string, FunAnswer> = {};
    for (const a of funByEntry.get(entry.id) ?? []) {
      const key = questionKeyById.get(a.question_id);
      if (!key) continue;
      const ranged = rangesByKey.get(key);
      if (ranged) {
        // Ranged numeric (item 23): range_index is the casual pick, the optional
        // numeric_answer the hardcore exact bonus.
        if (a.range_index != null) answers[key] = { rangeIndex: a.range_index, exact: a.numeric_answer };
      } else {
        const value: FunValue | null = a.numeric_answer ?? a.text_answer ?? a.bool_answer;
        if (value != null) answers[key] = value;
      }
    }

    return {
      entryId: entry.id,
      challenge: kind,
      hardcore: entry.hardcore,
      ...(groupPredictions.length > 0 ? { groupPredictions } : {}),
      ...(bracket.length > 0 ? { bracket } : {}),
      ...(Object.keys(answers).length > 0 ? { funAnswers: answers } : {}),
    };
  });

  // --- the one pure call --------------------------------------------------------
  const output = computePoints({
    real: { groupMatches, knockoutMatches },
    funQuestions: funConfig,
    funActuals,
    entries: scoringEntries,
  });

  const rowsByEntry = groupBy(output.rows, (r) => r.entryId);
  const statsByEntry = new Map(output.stats.map((s) => [s.entryId, s]));

  let totalRows = 0;
  for (const entry of entries) {
    const rows = (rowsByEntry.get(entry.id) ?? []).map((r) => ({
      category: r.source,
      ref: { ref: r.ref, base: r.basePoints, multiplier: r.multiplier },
      points: r.points,
      hardcore: r.board === 'HARDCORE',
    }));
    const stats = statsByEntry.get(entry.id);
    const { error } = await supabase.rpc('replace_entry_points', {
      p_entry_id: entry.id,
      p_rows: rows,
      p_stats: {
        correct_qualifiers: stats?.correctQualifiers ?? 0,
        correct_ko_picks: stats?.correctKoPicks ?? 0,
        correct_outcomes: stats?.correctOutcomes ?? 0,
      },
    });
    if (error) throw new Error(`replace_entry_points ${entry.id}: ${error.message}`);
    totalRows += rows.length;
  }

  // Leaderboard rank snapshots are NOT written here: a DB trigger on sync_log
  // (migration 7) calls write_leaderboard_snapshots() when the calling run's
  // log row flips to 'ok' — after this recompute, so ranks are always fresh.

  return { entries: entries.length, rows: totalRows };
}

// ---------------------------------------------------------------------------
// Group-stage completion → open the Playoff challenge
// ---------------------------------------------------------------------------

/**
 * Flips the Playoff challenge open (opens_at = now) the moment all 72 group
 * matches are finished. Idempotent: an already-opened playoff (opens_at in
 * the past) is never touched again. Returns true when this call opened it.
 */
export async function maybeOpenPlayoff(
  supabase: SyncDb,
  groupMatches: ReadonlyArray<{ status: string }>,
): Promise<boolean> {
  const groupsComplete =
    groupMatches.length === 72 && groupMatches.every((m) => m.status === 'finished');
  if (!groupsComplete) return false;

  const { data: playoff, error } = await supabase
    .from('challenges')
    .select('id, opens_at')
    .eq('kind', 'playoff')
    .single();
  if (error) throw new Error(`playoff select: ${error.message}`);
  if (playoff.opens_at == null || new Date(playoff.opens_at) > new Date()) {
    const { error: updErr } = await supabase
      .from('challenges')
      .update({ opens_at: new Date().toISOString() })
      .eq('id', playoff.id);
    if (updErr) throw new Error(`playoff open: ${updErr.message}`);
    return true;
  }
  return false;
}
