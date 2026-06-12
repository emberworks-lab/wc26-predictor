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

import { createClient } from 'npm:@supabase/supabase-js@2';

import { computeGroupTable } from '@/engine/groupTable';
import type { GroupId, PlayedMatch } from '@/engine/types';
import { GROUP_IDS } from '@/engine/types';
import { FootballApiClient } from '@/lib/football-api/client';
import { extractTeams, mapMatch } from '@/lib/football-api/mappers';
import { mapScorer } from '@/lib/football-api/mappers';
import {
  resolveKnockoutSlots,
  type GroupResultInput,
  type KoSlotMatch,
} from '@/lib/sync/knockoutSlots';
import {
  loadMatches,
  loadTeams,
  maybeOpenPlayoff,
  runRecompute,
  type DbMatch,
  type SyncDb,
} from '@/lib/sync/recompute';

type Supabase = SyncDb;

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
  const playoffOpened = await maybeOpenPlayoff(
    supabase,
    fresh.filter((m) => m.stage === 'group'),
  );

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
