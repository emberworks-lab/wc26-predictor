/**
 * Idempotent seed of real WC2026 data into Supabase (service role).
 *
 *   pnpm seed
 *
 * Upserts by external api_id: 48 teams (groups A–L), all 104 matches with UTC
 * kickoffs (already-played ones arrive with real scores + finished status),
 * the 4 challenge rows' lock timestamps, and the 12 fun questions from SPEC.
 * Safe to re-run at any time; the sync Edge Function takes over afterwards.
 */

import { createClient } from '@supabase/supabase-js';

import { fullChallengeLockTime } from '../src/engine/locks';
import { FootballApiClient } from '../src/lib/football-api/client';
import { extractTeams, mapMatch } from '../src/lib/football-api/mappers';
import type { Database, Json } from '../src/lib/database.types';
import { loadEnvLocal, requireEnv } from './env';

/**
 * Playoff `opens_at` sentinel: "not open yet". The sync function flips it to
 * the actual completion moment when the last group match finishes (the engine
 * models the same idea with a +infinity opens-at; see engine/locks.ts).
 */
const PLAYOFF_OPENS_SENTINEL = '2999-01-01T00:00:00Z';

/**
 * SPEC.md → Challenges → Fun: the 12 questions, scoring knobs in the DB.
 * Stage 9 item 23: the 8 numeric questions carry `ranges` (ordered [lo,hi]
 * buckets; null = open). `tolerance` is the hardcore exact-number closeness
 * window. Ranges derived from WC 2010–2022 scaled to 104 matches (see STATE).
 */
const FUN_QUESTIONS = [
  { key: 'total_goals', qtype: 'numeric', max_pts: 10, tolerance: 25, ranges: [[null, 239], [240, 259], [260, 279], [280, 299], [300, null]] },
  { key: 'total_red_cards', qtype: 'numeric', max_pts: 10, tolerance: 6, ranges: [[null, 6], [7, 10], [11, 14], [15, 18], [19, null]] },
  { key: 'penalty_shootouts', qtype: 'numeric', max_pts: 10, tolerance: 4, ranges: [[null, 3], [4, 6], [7, 9], [10, 12], [13, null]] },
  { key: 'penalties_scored', qtype: 'numeric', max_pts: 10, tolerance: 8, ranges: [[null, 19], [20, 26], [27, 33], [34, 40], [41, null]] },
  { key: 'golden_ball', qtype: 'pick', max_pts: 15, tolerance: null, ranges: null },
  { key: 'golden_boot', qtype: 'pick', max_pts: 15, tolerance: null, ranges: null },
  { key: 'golden_boot_goals', qtype: 'numeric', max_pts: 10, tolerance: 2, ranges: [[null, 5], [6, 6], [7, 7], [8, 8], [9, null]] },
  { key: 'hat_trick', qtype: 'yesno', max_pts: 5, tolerance: null, ranges: null },
  { key: 'fastest_goal_minute', qtype: 'numeric', max_pts: 10, tolerance: 2, ranges: [[null, 1], [2, 2], [3, 5], [6, 15], [16, null]] },
  { key: 'own_goals', qtype: 'numeric', max_pts: 10, tolerance: 4, ranges: [[null, 3], [4, 6], [7, 9], [10, 13], [14, null]] },
  { key: 'host_reaches_qf', qtype: 'yesno', max_pts: 5, tolerance: null, ranges: null },
  { key: 'highest_scoring_match', qtype: 'numeric', max_pts: 10, tolerance: 2, ranges: [[null, 5], [6, 6], [7, 7], [8, 8], [9, null]] },
] as const;

async function main() {
  loadEnvLocal();
  const supabase = createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );
  const api = new FootballApiClient({ apiKey: requireEnv('FOOTBALL_API_KEY') });

  console.log('Fetching WC fixtures from football-data.org…');
  const { matches } = await api.getMatches();
  console.log(`  ${matches.length} matches received (API calls: ${api.callsMade})`);

  // --- teams ----------------------------------------------------------------
  const teams = extractTeams(matches);
  if (teams.length !== 48) throw new Error(`Expected 48 teams, got ${teams.length}`);
  {
    const { error } = await supabase
      .from('teams')
      .upsert(teams, { onConflict: 'api_id' });
    if (error) throw new Error(`teams upsert: ${error.message}`);
  }

  const { data: teamRows, error: teamErr } = await supabase
    .from('teams')
    .select('id, api_id');
  if (teamErr) throw new Error(`teams select: ${teamErr.message}`);
  const teamIdByApiId = new Map(teamRows.map((t) => [t.api_id, t.id]));

  // --- matches ---------------------------------------------------------------
  const matchRows = matches.map((m) => {
    const row = mapMatch(m);
    const resolve = (apiId: number | null) =>
      apiId == null ? null : (teamIdByApiId.get(apiId) ?? null);
    return {
      api_id: row.api_id,
      stage: row.stage,
      group_code: row.group_code,
      matchday: row.matchday,
      kickoff_utc: row.kickoff_utc,
      status: row.status,
      home_team_id: resolve(row.home_team_api_id),
      away_team_id: resolve(row.away_team_api_id),
      home_score: row.home_score,
      away_score: row.away_score,
      home_score_et: row.home_score_et,
      away_score_et: row.away_score_et,
      home_pens: row.home_pens,
      away_pens: row.away_pens,
      winner_team_id: resolve(row.winner_team_api_id),
    };
  });
  {
    const { error } = await supabase
      .from('matches')
      .upsert(matchRows, { onConflict: 'api_id' });
    if (error) throw new Error(`matches upsert: ${error.message}`);
  }

  // --- challenge lock timestamps ----------------------------------------------
  const groupMatches = matches.filter((m) => m.stage === 'GROUP_STAGE');
  const md1Lock = fullChallengeLockTime(
    groupMatches
      .filter((m) => m.matchday === 1)
      .map((m) => ({ kickoffUtc: m.utcDate, matchday: m.matchday! })),
  ).toISOString();

  const firstR32Kickoff = matches
    .filter((m) => m.stage === 'LAST_32')
    .map((m) => m.utcDate)
    .sort()[0];

  for (const kind of ['full', 'groups', 'fun'] as const) {
    const { error } = await supabase
      .from('challenges')
      .update({ locks_at: md1Lock })
      .eq('kind', kind);
    if (error) throw new Error(`challenge ${kind} update: ${error.message}`);
  }
  {
    // opens_at sentinel only on first seed — never claw back a playoff the
    // sync function has already opened.
    const { data: playoff, error: selErr } = await supabase
      .from('challenges')
      .select('opens_at')
      .eq('kind', 'playoff')
      .single();
    if (selErr) throw new Error(`playoff select: ${selErr.message}`);
    const { error } = await supabase
      .from('challenges')
      .update({
        locks_at: firstR32Kickoff,
        ...(playoff.opens_at == null ? { opens_at: PLAYOFF_OPENS_SENTINEL } : {}),
      })
      .eq('kind', 'playoff');
    if (error) throw new Error(`challenge playoff update: ${error.message}`);
  }

  // --- fun questions ------------------------------------------------------------
  {
    const rows = FUN_QUESTIONS.map((q, i) => ({
      ...q,
      // readonly [lo,hi] tuples → mutable jsonb payload
      ranges: q.ranges as unknown as Json,
      sort_order: i + 1,
    }));
    const { error } = await supabase
      .from('fun_questions')
      .upsert(rows, { onConflict: 'key' });
    if (error) throw new Error(`fun_questions upsert: ${error.message}`);
  }

  // --- verification ----------------------------------------------------------------
  const count = async (table: 'teams' | 'matches' | 'fun_questions') => {
    const { count: n, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) throw new Error(`${table} count: ${error.message}`);
    return n;
  };
  const { data: groups } = await supabase.from('teams').select('group_code');
  const distinctGroups = new Set((groups ?? []).map((g) => g.group_code)).size;
  const { data: finished } = await supabase
    .from('matches')
    .select('api_id, home_score, away_score, status')
    .eq('status', 'finished');

  console.log('Seed verification:');
  console.log(`  teams: ${await count('teams')} (expect 48)`);
  console.log(`  groups: ${distinctGroups} (expect 12)`);
  console.log(`  matches: ${await count('matches')} (expect 104)`);
  console.log(`  fun questions: ${await count('fun_questions')} (expect 12)`);
  console.log(`  finished matches w/ scores: ${JSON.stringify(finished)}`);
  console.log(`  full/groups/fun lock at: ${md1Lock}`);
  console.log(`  playoff locks at: ${firstR32Kickoff}`);
  console.log(`  API calls used: ${api.callsMade}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
