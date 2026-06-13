/**
 * Security & RLS verification suite (run: pnpm tsx scripts/rls-check.ts).
 * Stage 5 prediction-table checks + Stage 8 admin/banned checks.
 *
 * Throwaway users exercise the REAL production project through PostgREST
 * with anon-key + user JWTs, proving the SPEC's locking guarantees hold at
 * the API layer:
 *
 *   match_predictions
 *    1. writing a prediction for a future match succeeds
 *    2. writing a prediction for a kicked-off match is refused (RLS)
 *    3. updating an own future-match prediction succeeds
 *    4. another user cannot read an UNLOCKED prediction (0 rows)
 *    5. another user CAN read a LOCKED prediction (kicked-off match)
 *    6. the owner cannot update a LOCKED prediction (0 rows affected)
 *    7. cross-entry insert (forged entry_id) is refused (RLS)
 *    8. hardcore insert without scores is refused (trigger)
 *    9. hardcore outcome is derived server-side (client lie corrected)
 *   10. casual scores are stripped server-side
 *   bracket_predictions
 *   11. gen-0 insert with winner in the pairing succeeds
 *   12. gen-1 insert without a redistribution row is refused (RLS)
 *   13. winner outside the pairing is refused (trigger)
 *   14. hardcore bracket pick without a score is refused (trigger)
 *   admin surface (Stage 8)
 *   15. non-admin reads 0 sync_log rows
 *   16. non-admin cannot update matches (0 rows affected)
 *   17. non-admin cannot set their own role (column grant, 42501)
 *   18. non-admin cannot update challenges (0 rows affected)
 *   19. non-admin cannot update fun_questions (0 rows affected)
 *   20. an admin CAN read sync_log (is_admin() policy)
 *   21. an admin CAN read another user's unlocked prediction
 *   banned user loses access (Stage 8)
 *   22. banned: new prediction insert refused (RLS)
 *   23. banned: update of an existing prediction affects 0 rows
 *   24. banned: joining another challenge refused (RLS)
 *   25. banned: hidden from leaderboard views (was visible before)
 *
 * Cleans up after itself (admin deleteUser cascades entries → predictions).
 */

import { createClient } from '@supabase/supabase-js';

import type { Database } from '../src/lib/database.types';
import { loadEnvLocal, requireEnv } from './env';

async function main() {
  loadEnvLocal();
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const admin = createClient<Database>(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const password = `Rls-${Math.random().toString(36).slice(2)}!9`;
  const mkUser = async (email: string) => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    return data.user.id;
  };

  const userA = await mkUser('wc26-rls-a@example.com');
  const userB = await mkUser('wc26-rls-b@example.com');
  const results: string[] = [];
  let failed = false;
  const check = (name: string, ok: boolean, extra = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
    if (!ok) failed = true;
  };

  try {
    const signedIn = async (email: string) => {
      const client = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`signIn ${email}: ${error.message}`);
      return client;
    };
    const clientA = await signedIn('wc26-rls-a@example.com');
    const clientB = await signedIn('wc26-rls-b@example.com');

    await clientA.from('profiles').insert({ id: userA, display_name: 'RlsCasual', locale: 'en' });
    await clientB.from('profiles').insert({ id: userB, display_name: 'RlsHardcore', locale: 'en' });

    const { data: challenges } = await clientA.from('challenges').select('id, kind');
    const fullId = challenges!.find((c) => c.kind === 'full')!.id;

    const { data: entryA } = await clientA
      .from('challenge_entries')
      .insert({ user_id: userA, challenge_id: fullId, hardcore: false })
      .select('id')
      .single();
    const { data: entryB } = await clientB
      .from('challenge_entries')
      .insert({ user_id: userB, challenge_id: fullId, hardcore: true })
      .select('id')
      .single();
    if (!entryA || !entryB) throw new Error('joining the Full challenge failed — cannot continue');

    // A kicked-off match and the latest-kickoff (safely future) group match.
    const nowIso = new Date().toISOString();
    const { data: lockedMatch } = await clientA
      .from('matches')
      .select('id, kickoff_utc, home_team_id, away_team_id')
      .eq('stage', 'group')
      .lte('kickoff_utc', nowIso)
      .order('kickoff_utc')
      .limit(1)
      .single();
    const { data: futureMatches } = await clientA
      .from('matches')
      .select('id, kickoff_utc, home_team_id, away_team_id')
      .eq('stage', 'group')
      .gt('kickoff_utc', new Date(Date.now() + 60 * 60 * 1000).toISOString())
      .order('kickoff_utc', { ascending: false })
      .limit(2);
    if (!lockedMatch || !futureMatches || futureMatches.length < 2) {
      throw new Error('fixture matches not found (need 1 kicked-off + 2 future group matches)');
    }
    const [futureM1, futureM2] = futureMatches;

    // 1. future-match prediction OK
    const { error: e1 } = await clientA
      .from('match_predictions')
      .insert({ entry_id: entryA.id, match_id: futureM1.id, outcome: 'home' });
    check('1. write prediction for a future match', !e1, e1?.message);

    // 2. kicked-off match refused
    const { error: e2 } = await clientA
      .from('match_predictions')
      .insert({ entry_id: entryA.id, match_id: lockedMatch.id, outcome: 'home' });
    check(
      '2. write prediction for a kicked-off match refused by RLS',
      e2?.code === '42501',
      e2 ? `code ${e2.code}` : 'insert unexpectedly succeeded',
    );

    // 3. update own future prediction OK
    const { data: u3, error: e3 } = await clientA
      .from('match_predictions')
      .update({ outcome: 'draw' })
      .eq('entry_id', entryA.id)
      .eq('match_id', futureM1.id)
      .select('outcome');
    check('3. update own future-match prediction', !e3 && u3?.[0]?.outcome === 'draw', e3?.message);

    // 4. B cannot read A's unlocked prediction
    const { data: r4 } = await clientB
      .from('match_predictions')
      .select('id')
      .eq('entry_id', entryA.id);
    check('4. other user reads 0 unlocked predictions', (r4 ?? []).length === 0, `${r4?.length} rows`);

    // 5./6. service role seeds a prediction on the kicked-off match for A
    const { error: seedErr } = await admin
      .from('match_predictions')
      .insert({ entry_id: entryA.id, match_id: lockedMatch.id, outcome: 'away' });
    if (seedErr) throw new Error(`service-role seed failed: ${seedErr.message}`);

    const { data: r5 } = await clientB
      .from('match_predictions')
      .select('id, outcome')
      .eq('entry_id', entryA.id)
      .eq('match_id', lockedMatch.id);
    check('5. other user CAN read a locked prediction', (r5 ?? []).length === 1, `${r5?.length} rows`);

    const { data: u6 } = await clientA
      .from('match_predictions')
      .update({ outcome: 'home' })
      .eq('entry_id', entryA.id)
      .eq('match_id', lockedMatch.id)
      .select('id');
    const { data: still } = await admin
      .from('match_predictions')
      .select('outcome')
      .eq('entry_id', entryA.id)
      .eq('match_id', lockedMatch.id)
      .single();
    check(
      '6. owner cannot update a locked prediction',
      (u6 ?? []).length === 0 && still?.outcome === 'away',
      `${u6?.length} rows affected, outcome ${still?.outcome}`,
    );

    // 7. forged entry_id refused
    const { error: e7 } = await clientB
      .from('match_predictions')
      .insert({ entry_id: entryA.id, match_id: futureM2.id, outcome: 'home' });
    check(
      '7. cross-entry insert refused by RLS',
      e7?.code === '42501',
      e7 ? `code ${e7.code}` : 'insert unexpectedly succeeded',
    );

    // 8. hardcore without scores refused by trigger
    const { error: e8 } = await clientB
      .from('match_predictions')
      .insert({ entry_id: entryB.id, match_id: futureM1.id, outcome: 'home' });
    check(
      '8. hardcore prediction without scores refused',
      e8?.code === 'P0001',
      e8 ? `code ${e8.code}` : 'insert unexpectedly succeeded',
    );

    // 9. hardcore outcome derived server-side (client lies: says home, score says away)
    const { data: r9, error: e9 } = await clientB
      .from('match_predictions')
      .insert({
        entry_id: entryB.id,
        match_id: futureM1.id,
        outcome: 'home',
        home_score: 0,
        away_score: 2,
      })
      .select('outcome, home_score, away_score')
      .single();
    check(
      '9. hardcore outcome derived from scores server-side',
      !e9 && r9?.outcome === 'away' && r9.home_score === 0 && r9.away_score === 2,
      e9?.message ?? `stored outcome ${r9?.outcome}`,
    );

    // 10. casual scores stripped server-side
    const { data: r10, error: e10 } = await clientA
      .from('match_predictions')
      .insert({
        entry_id: entryA.id,
        match_id: futureM2.id,
        outcome: 'home',
        home_score: 3,
        away_score: 1,
      })
      .select('outcome, home_score, away_score')
      .single();
    check(
      '10. casual scores stripped server-side',
      !e10 && r10?.outcome === 'home' && r10.home_score === null && r10.away_score === null,
      e10?.message ?? `stored ${r10?.home_score}:${r10?.away_score}`,
    );

    // --- bracket ---------------------------------------------------------------
    const home = lockedMatch.home_team_id!;
    const away = lockedMatch.away_team_id!;
    const { data: thirdTeam } = await clientA
      .from('teams')
      .select('id')
      .not('id', 'in', `(${home},${away})`)
      .limit(1)
      .single();

    // 11. gen-0 with winner in pairing OK
    const { error: e11 } = await clientA.from('bracket_predictions').insert({
      entry_id: entryA.id,
      generation: 0,
      slot: 73,
      home_team_id: home,
      away_team_id: away,
      winner_team_id: home,
    });
    check('11. gen-0 bracket pick accepted', !e11, e11?.message);

    // 12. gen-1 without redistribution refused
    const { error: e12 } = await clientA.from('bracket_predictions').insert({
      entry_id: entryA.id,
      generation: 1,
      slot: 73,
      home_team_id: home,
      away_team_id: away,
      winner_team_id: home,
    });
    check(
      '12. gen-1 bracket pick without redistribution refused',
      e12?.code === '42501',
      e12 ? `code ${e12.code}` : 'insert unexpectedly succeeded',
    );

    // 13. winner outside the pairing refused
    const { error: e13 } = await clientA.from('bracket_predictions').insert({
      entry_id: entryA.id,
      generation: 0,
      slot: 74,
      home_team_id: home,
      away_team_id: away,
      winner_team_id: thirdTeam!.id,
    });
    check(
      '13. winner outside the pairing refused',
      e13?.code === 'P0001',
      e13 ? `code ${e13.code}` : 'insert unexpectedly succeeded',
    );

    // 14. hardcore bracket pick without a score refused
    const { error: e14 } = await clientB.from('bracket_predictions').insert({
      entry_id: entryB.id,
      generation: 0,
      slot: 73,
      home_team_id: home,
      away_team_id: away,
      winner_team_id: home,
    });
    check(
      '14. hardcore bracket pick without a 90-minute score refused',
      e14?.code === 'P0001',
      e14 ? `code ${e14.code}` : 'insert unexpectedly succeeded',
    );

    // --- admin surface (Stage 8) ------------------------------------------------

    // 15. non-admin reads 0 sync_log rows (is_admin() select policy)
    const { data: r15, error: e15 } = await clientA.from('sync_log').select('id').limit(5);
    check('15. non-admin reads 0 sync_log rows', !e15 && (r15 ?? []).length === 0, e15?.message ?? `${r15?.length} rows`);

    // 16. non-admin cannot update matches (no write policy → 0 rows affected)
    const { data: u16, error: e16 } = await clientA
      .from('matches')
      .update({ home_score: 99 })
      .eq('id', lockedMatch.id)
      .select('id');
    check(
      '16. non-admin match update affects 0 rows',
      (e16 == null && (u16 ?? []).length === 0) || e16?.code === '42501',
      e16?.message ?? `${u16?.length} rows affected`,
    );

    // 17. non-admin cannot change their own role (column grant revoked)
    const { error: e17 } = await clientA
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', userA);
    check(
      '17. non-admin cannot set own role',
      e17?.code === '42501',
      e17 ? `code ${e17.code}` : 'update unexpectedly succeeded',
    );

    // 18. non-admin cannot update challenges
    const { data: u18, error: e18 } = await clientA
      .from('challenges')
      .update({ manual_override: 'locked' })
      .eq('id', fullId)
      .select('id');
    check(
      '18. non-admin challenge update affects 0 rows',
      (e18 == null && (u18 ?? []).length === 0) || e18?.code === '42501',
      e18?.message ?? `${u18?.length} rows affected`,
    );

    // 19. non-admin cannot write fun_questions (correct answers)
    const { data: u19, error: e19 } = await clientA
      .from('fun_questions')
      .update({ correct_numeric: 1 })
      .gt('id', 0)
      .select('id');
    check(
      '19. non-admin fun_questions update affects 0 rows',
      (e19 == null && (u19 ?? []).length === 0) || e19?.code === '42501',
      e19?.message ?? `${u19?.length} rows affected`,
    );

    // Promote B to admin (service role) for the positive checks.
    {
      const { error } = await admin.from('profiles').update({ role: 'admin' }).eq('id', userB);
      if (error) throw new Error(`promote B to admin: ${error.message}`);
    }

    // 20. admin reads sync_log rows
    const { data: r20, error: e20 } = await clientB.from('sync_log').select('id').limit(5);
    check('20. admin CAN read sync_log', !e20 && (r20 ?? []).length > 0, e20?.message ?? `${r20?.length} rows`);

    // 21. admin reads another user's UNLOCKED prediction (is_admin in policy)
    const { data: r21 } = await clientB
      .from('match_predictions')
      .select('id')
      .eq('entry_id', entryA.id)
      .eq('match_id', futureM1.id);
    check('21. admin CAN read an unlocked prediction', (r21 ?? []).length === 1, `${r21?.length} rows`);

    // --- banned user loses access (Stage 8) ----------------------------------------

    // Visible on the leaderboard view before the ban (entry exists for A).
    const { data: pre25 } = await clientB
      .from('leaderboard_entry_rows')
      .select('user_id')
      .eq('user_id', userA);
    const visibleBefore = (pre25 ?? []).length >= 1;

    {
      const { error } = await admin
        .from('profiles')
        .update({ banned_at: new Date().toISOString() })
        .eq('id', userA);
      if (error) throw new Error(`ban A: ${error.message}`);
    }

    // 22. banned: new insert refused
    const { data: futureM3 } = await clientA
      .from('matches')
      .select('id')
      .eq('stage', 'group')
      .gt('kickoff_utc', new Date(Date.now() + 60 * 60 * 1000).toISOString())
      .order('kickoff_utc')
      .limit(1)
      .single();
    const { error: e22 } = await clientA
      .from('match_predictions')
      .insert({ entry_id: entryA.id, match_id: futureM3!.id, outcome: 'home' });
    check(
      '22. banned user prediction insert refused',
      e22?.code === '42501',
      e22 ? `code ${e22.code}` : 'insert unexpectedly succeeded',
    );

    // 23. banned: update affects 0 rows
    const { data: u23 } = await clientA
      .from('match_predictions')
      .update({ outcome: 'away' })
      .eq('entry_id', entryA.id)
      .eq('match_id', futureM1.id)
      .select('id');
    check('23. banned user prediction update affects 0 rows', (u23 ?? []).length === 0, `${u23?.length} rows`);

    // 24. banned: joining another challenge refused
    const groupsId = challenges!.find((c) => c.kind === 'groups')!.id;
    const { error: e24 } = await clientA
      .from('challenge_entries')
      .insert({ user_id: userA, challenge_id: groupsId });
    check(
      '24. banned user cannot join a challenge',
      e24?.code === '42501',
      e24 ? `code ${e24.code}` : 'insert unexpectedly succeeded',
    );

    // 25. banned: gone from leaderboard views
    const { data: r25 } = await clientB
      .from('leaderboard_entry_rows')
      .select('user_id')
      .eq('user_id', userA);
    check(
      '25. banned user hidden from leaderboards',
      visibleBefore && (r25 ?? []).length === 0,
      `before ${pre25?.length}, after ${r25?.length}`,
    );
  } finally {
    await admin.auth.admin.deleteUser(userA);
    await admin.auth.admin.deleteUser(userB);
  }

  console.log(results.join('\n'));
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
