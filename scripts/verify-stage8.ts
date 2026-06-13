/**
 * Stage 8 admin-flow verification (run: pnpm tsx scripts/verify-stage8.ts).
 *
 * Proves the admin result-correction pipeline END-TO-END against PRODUCTION,
 * self-cleaning, replicating exactly what the /admin server actions do:
 *
 *   correction
 *    1. throwaway user's seeded prediction scores 0 under the real result
 *    2. corrected match (flag set) + recompute → prediction now scores 3
 *    3. the new points show up in leaderboard_ranked
 *    4. standings_cache reflects the corrected score (engine recompute)
 *    5. a REAL fixtures sync does NOT overwrite the corrected match
 *    6. points survive the fixtures sync unchanged
 *    7. flag cleared + fixtures sync → provider result restored
 *    8. recompute → points revert to 0
 *    9. standings_cache restored
 *   challenge override
 *   10. manual_override 'locked' refuses a write the timestamps would allow
 *   11. override cleared → the same write succeeds
 *   fun actuals
 *   12. setting a correct answer + recompute → fun points appear
 *   13. clearing it + recompute → fun points gone
 *   hygiene
 *   14. every sync invocation this run logged status ok in sync_log
 *   15. leaderboard_snapshots row count unchanged (no corrupted snapshot)
 *
 * Safety: the corrected match is a FINISHED match with NO stored predictions
 * (real users joined after it kicked off), so no real user's points are ever
 * touched. The corrected state lives only between steps 2 and 7 (seconds).
 * Aborts upfront if a snapshot boundary could be crossed mid-run.
 */

import { createClient } from '@supabase/supabase-js';

import { refreshStandings } from '../src/lib/sync/standings';
import { loadMatches } from '../src/lib/sync/recompute';
import type { Database } from '../src/lib/database.types';
import { loadEnvLocal, requireEnv } from './env';

async function main() {
  loadEnvLocal();
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const syncSecret = requireEnv('SYNC_SECRET');
  const admin = createClient<Database>(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const results: string[] = [];
  let failed = false;
  const check = (name: string, ok: boolean, extra = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
    if (!ok) failed = true;
  };

  const invokeSync = async (mode: 'fixtures' | 'recompute') => {
    const res = await fetch(`${url}/functions/v1/sync?mode=${mode}`, {
      method: 'POST',
      headers: { 'x-sync-secret': syncSecret, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = (await res.json()) as { ok: boolean };
    if (!res.ok || !body.ok) throw new Error(`sync ${mode} failed: ${JSON.stringify(body)}`);
    return body;
  };

  // --- safety guard: no snapshot boundary mid-run -------------------------------
  const { count: unsettledToday } = await admin
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .lte('kickoff_utc', new Date(Date.now() + 14 * 3600_000).toISOString())
    .not('status', 'in', '(finished,awarded,cancelled,postponed)');
  if ((unsettledToday ?? 0) === 0) {
    throw new Error(
      'abort: every match through today is settled — a recompute could write a ' +
        'matchday snapshot from test-corrupted points. Re-run while a matchday is open.',
    );
  }

  // --- pick the target: a finished match nobody has predicted --------------------
  const { data: finished } = await admin
    .from('matches')
    .select('id, stage, group_code, status, home_team_id, away_team_id, home_score, away_score, winner_team_id, manually_corrected')
    .eq('status', 'finished')
    .eq('stage', 'group')
    .order('kickoff_utc');
  let target: NonNullable<typeof finished>[number] | undefined;
  for (const m of finished ?? []) {
    const { count } = await admin
      .from('match_predictions')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', m.id);
    if ((count ?? 0) === 0) {
      target = m;
      break;
    }
  }
  if (!target) throw new Error('no prediction-free finished match available');
  if (target.manually_corrected) throw new Error('target already corrected — refusing');
  const original = { home: target.home_score!, away: target.away_score! };
  if (original.home === original.away) throw new Error('need a non-draw target match');
  console.log(
    `target match id=${target.id} group ${target.group_code} (${original.home}–${original.away}), 0 predictions`,
  );

  const { count: snapsBefore } = await admin
    .from('leaderboard_snapshots')
    .select('id', { count: 'exact', head: true });
  const { data: maxLogBefore } = await admin
    .from('sync_log')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .single();

  const { data: challengeRows } = await admin.from('challenges').select('id, kind');
  const fullId = challengeRows!.find((c) => c.kind === 'full')!.id;
  const funId = challengeRows!.find((c) => c.kind === 'fun')!.id;
  const { data: numericQ } = await admin
    .from('fun_questions')
    .select('id, key, max_pts, correct_numeric')
    .eq('qtype', 'numeric')
    .order('sort_order')
    .limit(1)
    .single();
  if (numericQ!.correct_numeric !== null) {
    throw new Error('numeric fun question already has a real actual — refusing to touch it');
  }

  // --- throwaway user with a 'draw' prediction on the target ---------------------
  const password = `S8-${Math.random().toString(36).slice(2)}!9`;
  const email = 'wc26-stage8-c@example.com';
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) throw new Error(`createUser: ${createErr.message}`);
  const userC = created.user.id;

  try {
    const clientC = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
    {
      const { error } = await clientC.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`signIn: ${error.message}`);
    }
    await clientC.from('profiles').insert({ id: userC, display_name: 'Stage8Probe', locale: 'en' });

    const { data: entryC, error: entryErr } = await clientC
      .from('challenge_entries')
      .insert({ user_id: userC, challenge_id: fullId, hardcore: false, submitted_at: new Date().toISOString() })
      .select('id')
      .single();
    if (entryErr || !entryC) throw new Error(`join full: ${entryErr?.message}`);

    // Locked match → seeded by the service role (same as rls-check step 5).
    {
      const { error } = await admin
        .from('match_predictions')
        .insert({ entry_id: entryC.id, match_id: target.id, outcome: 'draw' });
      if (error) throw new Error(`seed prediction: ${error.message}`);
    }

    const pointsOf = async () => {
      const { data } = await admin
        .from('points')
        .select('category, points')
        .eq('entry_id', entryC.id);
      return (data ?? []).map((r) => `${r.category}:${r.points}`).sort().join(',');
    };

    // 1. baseline recompute: 'draw' vs real non-draw result → 0 points
    await invokeSync('recompute');
    check('1. seeded wrong prediction scores 0', (await pointsOf()) === '', await pointsOf());

    // 2. ADMIN CORRECTION (replicates the correctMatch server action exactly):
    //    flip the result to a draw, flag the row, refresh standings, recompute
    //    through the deployed function.
    const korTeam = target.home_team_id!;
    const standingsPoints = async (teamId: number) => {
      const { data } = await admin
        .from('standings_cache')
        .select('points')
        .eq('group_code', target!.group_code!)
        .eq('team_id', teamId)
        .single();
      return data?.points;
    };
    const homePtsBefore = await standingsPoints(korTeam);

    {
      const { error } = await admin
        .from('matches')
        .update({
          home_score: original.away,
          away_score: original.away, // a draw at the away side's real score
          manually_corrected: true,
        })
        .eq('id', target.id);
      if (error) throw new Error(`correction update: ${error.message}`);
    }
    await refreshStandings(admin, await loadMatches(admin));
    await invokeSync('recompute');
    check(
      '2. corrected result + recompute → outcome points',
      (await pointsOf()) === 'GROUP_OUTCOME:3',
      await pointsOf(),
    );

    // 3. visible on the ranked leaderboard
    const { data: lbRow } = await admin
      .from('leaderboard_ranked')
      .select('points')
      .eq('challenge_id', fullId)
      .eq('board', 'global')
      .eq('user_id', userC)
      .single();
    check('3. leaderboard_ranked shows the corrected points', Number(lbRow?.points) === 3, `points ${lbRow?.points}`);

    // 4. standings reflect the corrected score (win → draw = -2 table points)
    const homePtsCorrected = await standingsPoints(korTeam);
    check(
      '4. standings_cache recomputed from the corrected score',
      homePtsBefore != null && homePtsCorrected === homePtsBefore - 2,
      `before ${homePtsBefore}, corrected ${homePtsCorrected}`,
    );

    // 5./6. a REAL fixtures sync must not overwrite the corrected match
    await invokeSync('fixtures');
    const { data: afterSync } = await admin
      .from('matches')
      .select('home_score, away_score, manually_corrected')
      .eq('id', target.id)
      .single();
    check(
      '5. fixtures sync does NOT overwrite the corrected match',
      afterSync?.manually_corrected === true &&
        afterSync.home_score === original.away &&
        afterSync.away_score === original.away,
      JSON.stringify(afterSync),
    );
    check('6. points survive the fixtures sync', (await pointsOf()) === 'GROUP_OUTCOME:3', await pointsOf());

    // 7./8./9. clear the flag (replicates clearCorrection): fixtures restores
    //    the provider result, recompute reverts the points, standings restored.
    {
      const { error } = await admin
        .from('matches')
        .update({ manually_corrected: false })
        .eq('id', target.id);
      if (error) throw new Error(`clear flag: ${error.message}`);
    }
    await invokeSync('fixtures');
    const { data: restored } = await admin
      .from('matches')
      .select('home_score, away_score, manually_corrected')
      .eq('id', target.id)
      .single();
    check(
      '7. flag cleared → fixtures sync restores the provider result',
      restored?.manually_corrected === false &&
        restored.home_score === original.home &&
        restored.away_score === original.away,
      JSON.stringify(restored),
    );
    await refreshStandings(admin, await loadMatches(admin));
    await invokeSync('recompute');
    check('8. recompute reverts the points', (await pointsOf()) === '', await pointsOf());
    const homePtsRestored = await standingsPoints(korTeam);
    check('9. standings_cache restored', homePtsRestored === homePtsBefore, `restored ${homePtsRestored}`);

    // 10./11. challenge override beats the timestamps (RLS path)
    const { data: futureMatch } = await clientC
      .from('matches')
      .select('id')
      .eq('stage', 'group')
      .gt('kickoff_utc', new Date(Date.now() + 3600_000).toISOString())
      .order('kickoff_utc', { ascending: false })
      .limit(1)
      .single();
    {
      const { error } = await admin
        .from('challenges')
        .update({ manual_override: 'locked' })
        .eq('id', fullId);
      if (error) throw new Error(`override locked: ${error.message}`);
    }
    const { error: e10 } = await clientC
      .from('match_predictions')
      .insert({ entry_id: entryC.id, match_id: futureMatch!.id, outcome: 'home' });
    check(
      '10. manual_override locked refuses an otherwise-open write',
      e10?.code === '42501',
      e10 ? `code ${e10.code}` : 'insert unexpectedly succeeded',
    );
    {
      const { error } = await admin
        .from('challenges')
        .update({ manual_override: null })
        .eq('id', fullId);
      if (error) throw new Error(`override reset: ${error.message}`);
    }
    const { error: e11 } = await clientC
      .from('match_predictions')
      .insert({ entry_id: entryC.id, match_id: futureMatch!.id, outcome: 'home' });
    check('11. override cleared → the write succeeds', !e11, e11?.message);

    // 12./13. fun actuals drive scoring (replicates saveFunCorrectAnswer)
    const { data: funEntry, error: funErr } = await clientC
      .from('challenge_entries')
      .insert({ user_id: userC, challenge_id: funId, hardcore: false, submitted_at: new Date().toISOString() })
      .select('id')
      .single();
    if (funErr || !funEntry) throw new Error(`join fun: ${funErr?.message}`);
    {
      const { error } = await clientC
        .from('fun_answers')
        .insert({ entry_id: funEntry.id, question_id: numericQ!.id, numeric_answer: 123 });
      if (error) throw new Error(`fun answer: ${error.message}`);
    }
    {
      const { error } = await admin
        .from('fun_questions')
        .update({ correct_numeric: 123 })
        .eq('id', numericQ!.id);
      if (error) throw new Error(`set fun actual: ${error.message}`);
    }
    await invokeSync('recompute');
    const { data: funPts } = await admin
      .from('points')
      .select('category, points')
      .eq('entry_id', funEntry.id);
    check(
      '12. fun actual set + recompute → exact-guess max points',
      funPts?.length === 1 &&
        funPts[0].category === 'FUN' &&
        Number(funPts[0].points) === numericQ!.max_pts,
      JSON.stringify(funPts),
    );
    {
      const { error } = await admin
        .from('fun_questions')
        .update({ correct_numeric: null })
        .eq('id', numericQ!.id);
      if (error) throw new Error(`clear fun actual: ${error.message}`);
    }
    await invokeSync('recompute');
    const { data: funPtsAfter } = await admin
      .from('points')
      .select('id')
      .eq('entry_id', funEntry.id);
    check('13. fun actual cleared + recompute → points gone', (funPtsAfter ?? []).length === 0, `${funPtsAfter?.length} rows`);

    // 14. every sync run this script triggered logged ok
    const { data: newLogs } = await admin
      .from('sync_log')
      .select('id, kind, status')
      .gt('id', maxLogBefore!.id)
      .order('id');
    const badLogs = (newLogs ?? []).filter((l) => l.status === 'error');
    check(
      '14. all sync invocations logged ok',
      (newLogs ?? []).length >= 7 && badLogs.length === 0,
      `${newLogs?.length} runs, ${badLogs.length} errors`,
    );

    // 15. no snapshot written from test state
    const { count: snapsAfter } = await admin
      .from('leaderboard_snapshots')
      .select('id', { count: 'exact', head: true });
    check('15. leaderboard_snapshots untouched', snapsAfter === snapsBefore, `before ${snapsBefore}, after ${snapsAfter}`);
  } finally {
    // Cleanup: drop the throwaway user (cascades entries → predictions →
    // points), make sure everything this run touched is back to truth.
    await admin.auth.admin.deleteUser(userC);
    await admin
      .from('matches')
      .update({ home_score: original.home, away_score: original.away, manually_corrected: false })
      .eq('id', target.id);
    await admin.from('challenges').update({ manual_override: null }).eq('id', fullId);
    await admin.from('fun_questions').update({ correct_numeric: null }).eq('id', numericQ!.id);
    await refreshStandings(admin, await loadMatches(admin));
    await invokeSync('recompute');
  }

  console.log(results.join('\n'));
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
