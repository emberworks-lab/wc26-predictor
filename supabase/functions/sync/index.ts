/**
 * WC26 sync + recompute Edge Function (service role).
 *
 * Modes (query param `mode`):
 *  - fixtures  — pull fixtures/results from football-data.org, upsert matches,
 *                resolve knockout FIFA match numbers, refresh standings cache,
 *                flip the Playoff challenge open when the group stage
 *                completes, and recompute points when anything finished.
 *  - stats     — refresh scorers cache (1 API call) + standings cache (0).
 *  - recompute — full idempotent points recompute for every entry.
 *
 * Auth: `x-sync-secret` header must equal the SYNC_SECRET function secret
 * (deployed with verify_jwt=false so pg_cron/pg_net can call it directly).
 * Every run writes a sync_log row.
 *
 * NOTE: this file is bundled with esbuild before deploy (`pnpm deploy:sync`)
 * because the pure engine modules under src/ use extensionless imports.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { computeGroupTable } from '@/engine/groupTable';
import { computePoints } from '@/engine/scoring';
import type {
  BracketVersion,
  GroupId,
  KnockoutRound,
  MatchOutcome,
  PlayedMatch,
  RealKnockoutMatch,
} from '@/engine/types';
import { GROUP_IDS } from '@/engine/types';
import type {
  FunQuestionConfig,
  FunValue,
  GroupMatchDef,
  GroupMatchPrediction,
  ScoringEntry,
} from '@/engine/scoring';
import { FootballApiClient } from '@/lib/football-api/client';
import { extractTeams, mapMatch } from '@/lib/football-api/mappers';
import { mapScorer } from '@/lib/football-api/mappers';
import {
  resolveKnockoutSlots,
  type GroupResultInput,
  type KoSlotMatch,
} from '@/lib/sync/knockoutSlots';

type Supabase = SupabaseClient;

interface DbTeam {
  id: number;
  api_id: number;
  fifa_code: string;
}

interface DbMatch {
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

function need<T>(data: T | null, error: { message: string } | null, what: string): T {
  if (error) throw new Error(`${what}: ${error.message}`);
  if (data == null) throw new Error(`${what}: no data`);
  return data;
}

async function loadTeams(supabase: Supabase) {
  const { data, error } = await supabase.from('teams').select('id, api_id, fifa_code');
  const teams = need(data, error, 'teams select') as DbTeam[];
  return {
    teams,
    idByApiId: new Map(teams.map((t) => [t.api_id, t.id])),
    codeById: new Map(teams.map((t) => [t.id, t.fifa_code])),
    idByCode: new Map(teams.map((t) => [t.fifa_code, t.id])),
  };
}

async function loadMatches(supabase: Supabase): Promise<DbMatch[]> {
  const { data, error } = await supabase.from('matches').select('*');
  return need(data, error, 'matches select') as DbMatch[];
}

// ---------------------------------------------------------------------------
// Standings cache (engine-computed — Article 13 tiebreakers, not the API's)
// ---------------------------------------------------------------------------

async function refreshStandings(supabase: Supabase, matches: DbMatch[]) {
  const { codeById, idByCode } = await loadTeams(supabase);
  const rows: Array<Record<string, unknown>> = [];

  for (const group of GROUP_IDS) {
    const inGroup = matches.filter(
      (m) => m.stage === 'group' && m.group_code === group,
    );
    const teamCodes = [
      ...new Set(
        inGroup
          .flatMap((m) => [m.home_team_id, m.away_team_id])
          .filter((id): id is number => id != null)
          .map((id) => codeById.get(id)!),
      ),
    ];
    if (teamCodes.length === 0) continue;
    const played: PlayedMatch[] = inGroup
      .filter((m) => m.status === 'finished')
      .map((m) => ({
        home: codeById.get(m.home_team_id!)!,
        away: codeById.get(m.away_team_id!)!,
        homeGoals: m.home_score!,
        awayGoals: m.away_score!,
      }));
    for (const row of computeGroupTable(played, teamCodes)) {
      rows.push({
        group_code: group,
        team_id: idByCode.get(row.team)!,
        position: row.position,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        goals_for: row.goalsFor,
        goals_against: row.goalsAgainst,
        goal_difference: row.goalDiff,
        points: row.points,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('standings_cache')
      .upsert(rows, { onConflict: 'group_code,team_id' });
    if (error) throw new Error(`standings upsert: ${error.message}`);
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// mode=fixtures
// ---------------------------------------------------------------------------

const MATCH_FIELDS = [
  'stage',
  'group_code',
  'matchday',
  'kickoff_utc',
  'status',
  'home_team_id',
  'away_team_id',
  'home_score',
  'away_score',
  'home_score_et',
  'away_score_et',
  'home_pens',
  'away_pens',
  'winner_team_id',
] as const;

async function syncFixtures(supabase: Supabase, api: FootballApiClient) {
  const { matches: apiMatches } = await api.getMatches();

  // Late team replacements would show up as unknown api ids — keep teams fresh.
  const newTeams = extractTeams(apiMatches);
  {
    const { error } = await supabase
      .from('teams')
      .upsert(newTeams, { onConflict: 'api_id' });
    if (error) throw new Error(`teams upsert: ${error.message}`);
  }

  const { idByApiId, codeById } = await loadTeams(supabase);
  const dbMatches = await loadMatches(supabase);
  const byApiId = new Map(dbMatches.map((m) => [m.api_id, m]));

  let changed = 0;
  const newlyFinished: number[] = [];

  for (const apiMatch of apiMatches) {
    const mapped = mapMatch(apiMatch);
    const resolveTeam = (apiId: number | null) =>
      apiId == null ? null : (idByApiId.get(apiId) ?? null);
    const next = {
      stage: mapped.stage,
      group_code: mapped.group_code,
      matchday: mapped.matchday,
      kickoff_utc: mapped.kickoff_utc,
      status: mapped.status,
      home_team_id: resolveTeam(mapped.home_team_api_id),
      away_team_id: resolveTeam(mapped.away_team_api_id),
      home_score: mapped.home_score,
      away_score: mapped.away_score,
      home_score_et: mapped.home_score_et,
      away_score_et: mapped.away_score_et,
      home_pens: mapped.home_pens,
      away_pens: mapped.away_pens,
      winner_team_id: resolveTeam(mapped.winner_team_api_id),
    };

    const existing = byApiId.get(mapped.api_id);
    if (!existing) {
      const { error } = await supabase
        .from('matches')
        .insert({ api_id: mapped.api_id, ...next });
      if (error) throw new Error(`match insert ${mapped.api_id}: ${error.message}`);
      changed += 1;
      if (next.status === 'finished') newlyFinished.push(mapped.api_id);
      continue;
    }

    // Admin corrections win over the feed until the admin clears the flag.
    if (existing.manually_corrected) continue;

    const normalizeKickoff = (v: string) => new Date(v).toISOString();
    // The provider's list endpoint flaps between SCHEDULED and TIMED for
    // not-yet-started matches; both mean the same to us — don't churn rows.
    const preStart = (s: string) => s === 'scheduled' || s === 'timed';
    const dirty = MATCH_FIELDS.some((f) => {
      if (f === 'kickoff_utc') {
        return (
          normalizeKickoff(existing.kickoff_utc) !== normalizeKickoff(next.kickoff_utc)
        );
      }
      if (f === 'status' && preStart(existing.status) && preStart(next.status)) {
        return false;
      }
      return existing[f] !== next[f];
    });
    if (!dirty) continue;

    const { error } = await supabase
      .from('matches')
      .update(next)
      .eq('api_id', mapped.api_id);
    if (error) throw new Error(`match update ${mapped.api_id}: ${error.message}`);
    changed += 1;
    if (existing.status !== 'finished' && next.status === 'finished') {
      newlyFinished.push(mapped.api_id);
    }
    Object.assign(existing, next);
  }

  // --- knockout FIFA match-number resolution --------------------------------
  const fresh = [...byApiId.values()];
  const groupResults: GroupResultInput[] = fresh
    .filter((m) => m.stage === 'group')
    .map((m) => ({
      group: m.group_code as GroupId,
      home: codeById.get(m.home_team_id!)!,
      away: codeById.get(m.away_team_id!)!,
      homeGoals: m.status === 'finished' ? m.home_score : null,
      awayGoals: m.status === 'finished' ? m.away_score : null,
    }));
  const koMatches: KoSlotMatch[] = fresh
    .filter((m) => m.stage !== 'group')
    .map((m) => ({
      apiId: m.api_id,
      stage: m.stage as KoSlotMatch['stage'],
      homeCode: m.home_team_id != null ? (codeById.get(m.home_team_id) ?? null) : null,
      awayCode: m.away_team_id != null ? (codeById.get(m.away_team_id) ?? null) : null,
      fifaMatchNumber: m.fifa_match_number,
      finished: m.status === 'finished',
      winnerCode:
        m.winner_team_id != null ? (codeById.get(m.winner_team_id) ?? null) : null,
    }));

  const assignments = resolveKnockoutSlots(groupResults, koMatches);
  for (const a of assignments) {
    const { error } = await supabase
      .from('matches')
      .update({ fifa_match_number: a.fifaMatchNumber })
      .eq('api_id', a.apiId);
    if (error) throw new Error(`slot assign ${a.apiId}: ${error.message}`);
  }

  // --- standings cache --------------------------------------------------------
  const standingsRows = await refreshStandings(supabase, fresh);

  // --- group-stage completion → open the Playoff challenge ---------------------
  const groupsComplete =
    groupResults.length === 72 &&
    groupResults.every((m) => m.homeGoals != null && m.awayGoals != null);
  let playoffOpened = false;
  if (groupsComplete) {
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
      playoffOpened = true;
    }
  }

  // --- points recompute on any result/bracket change ----------------------------
  let recompute: { entries: number; rows: number } | null = null;
  if (newlyFinished.length > 0 || assignments.length > 0 || playoffOpened) {
    recompute = await runRecompute(supabase);
  }

  return {
    changed,
    newly_finished: newlyFinished.length,
    slots_assigned: assignments.length,
    standings_rows: standingsRows,
    playoff_opened: playoffOpened,
    recompute,
    api_calls: api.callsMade,
  };
}

// ---------------------------------------------------------------------------
// mode=stats
// ---------------------------------------------------------------------------

async function syncStats(supabase: Supabase, api: FootballApiClient) {
  const { idByApiId } = await loadTeams(supabase);
  const { scorers } = await api.getScorers(100);

  const rows = scorers.map((s) => {
    const mapped = mapScorer(s);
    return {
      player_name: mapped.player_name,
      team_id:
        mapped.team_api_id != null ? (idByApiId.get(mapped.team_api_id) ?? null) : null,
      goals: mapped.goals,
      assists: mapped.assists,
      penalties: mapped.penalties,
      updated_at: new Date().toISOString(),
    };
  });
  if (rows.length > 0) {
    const { error } = await supabase
      .from('scorers_cache')
      .upsert(rows, { onConflict: 'player_name,team_id' });
    if (error) throw new Error(`scorers upsert: ${error.message}`);
  }

  const standingsRows = await refreshStandings(supabase, await loadMatches(supabase));
  return { scorers: rows.length, standings_rows: standingsRows, api_calls: api.callsMade };
}

// ---------------------------------------------------------------------------
// mode=recompute — (all results, all predictions, redistribution log) → points
// ---------------------------------------------------------------------------

async function runRecompute(supabase: Supabase) {
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
    correct_numeric: number | null;
    correct_text: string | null;
    correct_bool: boolean | null;
  }>('fun_questions', '*');
  const funAnswers = await sel<{
    entry_id: string;
    question_id: number;
    numeric_answer: number | null;
    text_answer: string | null;
    bool_answer: boolean | null;
  }>('fun_answers', 'entry_id, question_id, numeric_answer, text_answer, bool_answer');

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
  const funConfig: FunQuestionConfig[] = funQuestions.map((q) => ({
    id: q.key,
    type: q.qtype.toUpperCase() as FunQuestionConfig['type'],
    maxPts: q.max_pts,
    tolerance: q.tolerance ?? undefined,
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

    const answers: Record<string, FunValue> = {};
    for (const a of funByEntry.get(entry.id) ?? []) {
      const key = questionKeyById.get(a.question_id);
      if (!key) continue;
      const value = a.numeric_answer ?? a.text_answer ?? a.bool_answer;
      if (value != null) answers[key] = value;
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
  // (migration 7) calls write_leaderboard_snapshots() when this run's log row
  // flips to 'ok' — after the recompute above, so ranks are always fresh.

  return { entries: entries.length, rows: totalRows };
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
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
// HTTP entrypoint
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('SYNC_SECRET');
  if (!secret || req.headers.get('x-sync-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const mode = new URL(req.url).searchParams.get('mode') ?? 'fixtures';
  if (!['fixtures', 'stats', 'recompute'].includes(mode)) {
    return new Response(JSON.stringify({ error: `unknown mode ${mode}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: logRow, error: logErr } = await supabase
    .from('sync_log')
    .insert({ kind: mode, status: 'running' })
    .select('id')
    .single();
  if (logErr) {
    return new Response(JSON.stringify({ error: `sync_log: ${logErr.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const finishLog = async (status: 'ok' | 'error', detail: unknown) => {
    await supabase
      .from('sync_log')
      .update({ status, detail, finished_at: new Date().toISOString() })
      .eq('id', logRow.id);
  };

  try {
    const api = new FootballApiClient({ apiKey: Deno.env.get('FOOTBALL_API_KEY')! });
    const detail =
      mode === 'fixtures'
        ? await syncFixtures(supabase, api)
        : mode === 'stats'
          ? await syncStats(supabase, api)
          : await runRecompute(supabase);
    await finishLog('ok', detail);
    return new Response(JSON.stringify({ ok: true, mode, detail }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishLog('error', { error: message });
    return new Response(JSON.stringify({ ok: false, mode, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
