/**
 * Stage 6 server-side verification (run: pnpm tsx scripts/verify-stage6.ts).
 *
 * Exercises the production project with throwaway users (cleaned up at the
 * end), proving the stage's "Done means" items:
 *  1. Tiebreaker parity: leaderboard_ranked's ORDER BY equals the engine
 *     comparator (engine/leaderboard.ts compareEntries) on a fixture where
 *     points are equal and each tier of the chain decides one neighbour pair.
 *  2. Snapshots + rank movement: write_leaderboard_snapshots() writes one
 *     snapshot set per matchday, is idempotent, and a points change after a
 *     snapshot produces a rank movement vs the baseline.
 *  3. Hand-computed totals: two seeded entries with predictions on the two
 *     finished matches score exactly the SPEC table values after a real
 *     recompute run (expectations written below, not eyeballed).
 *  4. Recompute idempotency with real entries present (deferred from Stage 3):
 *     two consecutive recompute runs produce identical points rows.
 */

import { createClient } from '@supabase/supabase-js';

import { compareEntries } from '../src/engine/leaderboard';
import type { Database } from '../src/lib/database.types';
import { loadEnvLocal, requireEnv } from './env';

const SNAPSHOT_A = '2026-06-01'; // forced baseline (pre-tournament date, never a real matchday)
const SNAPSHOT_B = '2026-06-02';

/* Hand-computed expectations (SPEC scoring table v1).
 * Finished matches at verification time (group A):
 *   match 1: MEX 2-0 RSA   match 2: home won 2-1
 * T1 (casual):   m1 outcome home (correct, +3), m2 outcome away (wrong, 0)
 *                → global 3, hardcore 0, correct_outcomes 1
 * T2 (hardcore): m1 score 2-0 (outcome +3, exact score +5 HC)
 *                m2 score 3-2 (outcome +3, GD correct non-draw not exact +2 HC)
 *                → global 6, hardcore 7, correct_outcomes 2
 */
const EXPECT_T1 = { global: 3, hardcore: 0, outcomes: 1 };
const EXPECT_T2 = { global: 6, hardcore: 7, outcomes: 2 };

async function main() {
  loadEnvLocal();
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
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

  const recompute = async () => {
    const res = await fetch(`${url}/functions/v1/sync?mode=recompute`, {
      method: 'POST',
      headers: { 'x-sync-secret': syncSecret, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = (await res.json()) as { ok: boolean; detail?: unknown; error?: string };
    if (!body.ok) throw new Error(`recompute failed: ${body.error}`);
    return body.detail as { entries: number; rows: number };
  };

  const pointsChecksum = async () => {
    const { data, error } = await admin
      .from('points')
      .select('entry_id, category, ref, points, hardcore');
    if (error) throw new Error(`points select: ${error.message}`);
    return JSON.stringify(
      (data ?? [])
        .map((r) => [r.entry_id, r.category, JSON.stringify(r.ref), r.points, r.hardcore])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
  };

  // -- create throwaway users sequentially (distinct created_at for tiebreaks)
  const userIds: string[] = [];
  const mkUser = async (i: number) => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `wc26-stage6-t${i}@example.com`,
      password: `Vfy-${Math.random().toString(36).slice(2)}!9`,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser t${i}: ${error.message}`);
    userIds.push(data.user.id);
    const { error: profErr } = await admin
      .from('profiles')
      .insert({ id: data.user.id, display_name: `Stage6 Test ${i}`, locale: 'en' });
    if (profErr) throw new Error(`profile t${i}: ${profErr.message}`);
    await new Promise((r) => setTimeout(r, 25)); // strictly increasing created_at
    return data.user.id;
  };

  try {
    const [t1, t2, t3, t4, t5] = [
      await mkUser(1),
      await mkUser(2),
      await mkUser(3),
      await mkUser(4),
      await mkUser(5),
    ];

    const { data: fullChallenge } = await admin
      .from('challenges')
      .select('id')
      .eq('kind', 'full')
      .single();
    const fullId = fullChallenge!.id;

    const entryIds = new Map<string, string>();
    for (const [uid, hardcore] of [
      [t1, false],
      [t2, true],
      [t3, false],
      [t4, false],
      [t5, false],
    ] as const) {
      const { data, error } = await admin
        .from('challenge_entries')
        .insert({ user_id: uid, challenge_id: fullId, hardcore })
        .select('id')
        .single();
      if (error) throw new Error(`entry ${uid}: ${error.message}`);
      entryIds.set(uid, data.id);
    }

    // ---- 1. tiebreaker parity on synthetic equal-points fixtures ------------
    // All five tie on 30 points; each tier of the chain separates one pair:
    // qualifiers (t4 lowest), then ko picks (t3), then outcomes (t2), then
    // registration time (t1 vs t5 fully tied on counters — earlier wins).
    const fixtures: Array<{
      uid: string;
      stats: { correct_qualifiers: number; correct_ko_picks: number; correct_outcomes: number };
    }> = [
      { uid: t1, stats: { correct_qualifiers: 5, correct_ko_picks: 2, correct_outcomes: 10 } },
      { uid: t5, stats: { correct_qualifiers: 5, correct_ko_picks: 2, correct_outcomes: 10 } },
      { uid: t2, stats: { correct_qualifiers: 5, correct_ko_picks: 2, correct_outcomes: 9 } },
      { uid: t3, stats: { correct_qualifiers: 5, correct_ko_picks: 1, correct_outcomes: 99 } },
      { uid: t4, stats: { correct_qualifiers: 4, correct_ko_picks: 9, correct_outcomes: 99 } },
    ];
    for (const f of fixtures) {
      const { error } = await admin.rpc('replace_entry_points', {
        p_entry_id: entryIds.get(f.uid)!,
        p_rows: [
          { category: 'GROUP_OUTCOME', ref: { ref: 'fixture' }, points: 30, hardcore: false },
        ],
        p_stats: f.stats,
      });
      if (error) throw new Error(`replace_entry_points fixture: ${error.message}`);
    }

    const testUserSet = new Set([t1, t2, t3, t4, t5]);
    const { data: ranked } = await admin
      .from('leaderboard_ranked')
      .select('user_id, points, rank, correct_qualifiers, correct_ko_picks, correct_outcomes, registered_at')
      .eq('challenge_id', fullId)
      .eq('board', 'global')
      .order('rank', { ascending: true });
    const sqlOrder = (ranked ?? []).filter((r) => testUserSet.has(r.user_id!));

    const engineOrder = [...sqlOrder]
      .sort((a, b) =>
        compareEntries(
          {
            points: Number(a.points),
            correctQualifiers: a.correct_qualifiers!,
            correctKoPicks: a.correct_ko_picks!,
            correctOutcomes: a.correct_outcomes!,
            createdAtUtc: a.registered_at!,
          },
          {
            points: Number(b.points),
            correctQualifiers: b.correct_qualifiers!,
            correctKoPicks: b.correct_ko_picks!,
            correctOutcomes: b.correct_outcomes!,
            createdAtUtc: b.registered_at!,
          },
        ),
      )
      .map((r) => r.user_id);

    check(
      'SQL view order equals engine compareEntries on equal-points fixture',
      JSON.stringify(sqlOrder.map((r) => r.user_id)) === JSON.stringify(engineOrder),
      `sql=${sqlOrder.map((r) => r.user_id).join(',')} engine=${engineOrder.join(',')}`,
    );
    check(
      'every tiebreaker tier decided (expected order t1,t5,t2,t3,t4)',
      JSON.stringify(sqlOrder.map((r) => r.user_id)) === JSON.stringify([t1, t5, t2, t3, t4]),
    );
    check(
      'all five fixtures tie on points (the chain, not points, decided)',
      sqlOrder.every((r) => Number(r.points) === 30),
    );

    // ---- 2. snapshots + movement --------------------------------------------
    const { data: snapA, error: snapAErr } = await admin.rpc('write_leaderboard_snapshots', {
      p_matchday: SNAPSHOT_A,
    });
    check('forced snapshot A writes rows', !snapAErr && (snapA ?? 0) > 0, `rows=${snapA} ${snapAErr?.message ?? ''}`);

    const { data: snapADup } = await admin.rpc('write_leaderboard_snapshots', {
      p_matchday: SNAPSHOT_A,
    });
    check('snapshot is idempotent per matchday (duplicate run writes 0)', snapADup === 0);

    const { data: autoSnap } = await admin.rpc('write_leaderboard_snapshots');
    check(
      'auto-mode snapshot skips already-snapshotted completed matchday',
      autoSnap === 0,
      `rows=${autoSnap}`,
    );

    // t4 overtakes everyone → movement vs baseline snapshot must show it
    const { error: boostErr } = await admin.rpc('replace_entry_points', {
      p_entry_id: entryIds.get(t4)!,
      p_rows: [{ category: 'GROUP_OUTCOME', ref: { ref: 'fixture' }, points: 99, hardcore: false }],
      p_stats: { correct_qualifiers: 4, correct_ko_picks: 9, correct_outcomes: 99 },
    });
    if (boostErr) throw new Error(`boost t4: ${boostErr.message}`);

    const { data: rankedAfter } = await admin
      .from('leaderboard_ranked')
      .select('user_id, rank')
      .eq('challenge_id', fullId)
      .eq('board', 'global');
    const { data: baseline } = await admin
      .from('leaderboard_snapshots')
      .select('user_id, rank')
      .eq('matchday_date', SNAPSHOT_A)
      .eq('board', 'global')
      .eq('challenge_id', fullId);
    const liveT4 = Number(rankedAfter!.find((r) => r.user_id === t4)!.rank);
    const baseT4 = Number(baseline!.find((r) => r.user_id === t4)!.rank);
    check(
      'rank movement appears vs baseline snapshot after a points change',
      baseT4 - liveT4 > 0,
      `baseline ${baseT4} → live ${liveT4}`,
    );

    const { data: snapB } = await admin.rpc('write_leaderboard_snapshots', {
      p_matchday: SNAPSHOT_B,
    });
    check('second snapshot run writes a new matchday set', (snapB ?? 0) > 0, `rows=${snapB}`);
    const { data: snapBRows } = await admin
      .from('leaderboard_snapshots')
      .select('user_id, rank')
      .eq('matchday_date', SNAPSHOT_B)
      .eq('board', 'global')
      .eq('challenge_id', fullId);
    check(
      'movement between the two snapshots matches the points change',
      Number(snapBRows!.find((r) => r.user_id === t4)!.rank) < baseT4,
    );

    // ---- 3. hand-computed totals through the REAL recompute pipeline --------
    const { data: finished } = await admin
      .from('matches')
      .select('id, home_score, away_score')
      .eq('status', 'finished')
      .order('id')
      .limit(2);
    if (!finished || finished.length < 2) throw new Error('expected 2 finished matches');
    const [m1, m2] = finished;
    // Guard the hand-computation's premises (results as of June 12).
    if (m1.home_score !== 2 || m1.away_score !== 0 || m2.home_score !== 2 || m2.away_score !== 1) {
      throw new Error(
        `finished results changed (m1 ${m1.home_score}-${m1.away_score}, m2 ${m2.home_score}-${m2.away_score}) — update EXPECT_* above`,
      );
    }

    const { error: predErr } = await admin.from('match_predictions').insert([
      { entry_id: entryIds.get(t1)!, match_id: m1.id, outcome: 'home' },
      { entry_id: entryIds.get(t1)!, match_id: m2.id, outcome: 'away' },
      { entry_id: entryIds.get(t2)!, match_id: m1.id, outcome: 'home', home_score: 2, away_score: 0 },
      { entry_id: entryIds.get(t2)!, match_id: m2.id, outcome: 'home', home_score: 3, away_score: 2 },
    ]);
    if (predErr) throw new Error(`seed predictions: ${predErr.message}`);

    const detail = await recompute();
    check('recompute covers all entries (real + test)', detail.entries >= 6, `entries=${detail.entries}`);

    const { data: totals } = await admin
      .from('leaderboard_totals')
      .select('entry_id, global_points, hardcore_points')
      .in('entry_id', [entryIds.get(t1)!, entryIds.get(t2)!]);
    const { data: stats } = await admin
      .from('entry_stats')
      .select('entry_id, correct_outcomes')
      .in('entry_id', [entryIds.get(t1)!, entryIds.get(t2)!]);
    const tot = (eid: string) => {
      const row = totals!.find((r) => r.entry_id === eid)!;
      return { global: Number(row.global_points), hardcore: Number(row.hardcore_points) };
    };
    const st = (eid: string) => stats!.find((r) => r.entry_id === eid)!;

    check(
      `T1 casual totals are hand-computed ${EXPECT_T1.global}/${EXPECT_T1.hardcore}`,
      tot(entryIds.get(t1)!).global === EXPECT_T1.global &&
        tot(entryIds.get(t1)!).hardcore === EXPECT_T1.hardcore &&
        st(entryIds.get(t1)!).correct_outcomes === EXPECT_T1.outcomes,
      `got ${tot(entryIds.get(t1)!).global}/${tot(entryIds.get(t1)!).hardcore}, outcomes ${st(entryIds.get(t1)!).correct_outcomes}`,
    );
    check(
      `T2 hardcore totals are hand-computed ${EXPECT_T2.global}/${EXPECT_T2.hardcore}`,
      tot(entryIds.get(t2)!).global === EXPECT_T2.global &&
        tot(entryIds.get(t2)!).hardcore === EXPECT_T2.hardcore &&
        st(entryIds.get(t2)!).correct_outcomes === EXPECT_T2.outcomes,
      `got ${tot(entryIds.get(t2)!).global}/${tot(entryIds.get(t2)!).hardcore}, outcomes ${st(entryIds.get(t2)!).correct_outcomes}`,
    );

    // hardcore board contains only hardcore entries
    const { data: hcBoard } = await admin
      .from('leaderboard_ranked')
      .select('user_id')
      .eq('challenge_id', fullId)
      .eq('board', 'hardcore');
    check(
      'hardcore board contains only hardcore entries',
      hcBoard!.some((r) => r.user_id === t2) && !hcBoard!.some((r) => r.user_id === t1),
    );

    // overall board sums across challenges (test users have one entry each,
    // so overall points must equal their per-challenge points)
    const { data: overall } = await admin
      .from('leaderboard_overall_ranked')
      .select('user_id, points')
      .eq('board', 'global');
    check(
      'overall board mirrors per-challenge totals for single-entry users',
      Number(overall!.find((r) => r.user_id === t2)?.points) === EXPECT_T2.global,
    );

    // ---- 4. recompute idempotency with real entries (deferred from Stage 3) -
    const sum1 = await pointsChecksum();
    await recompute();
    const sum2 = await pointsChecksum();
    check('recompute is idempotent with real entries present', sum1 === sum2);
  } finally {
    for (const uid of userIds) {
      await admin.auth.admin.deleteUser(uid);
    }
    await admin
      .from('leaderboard_snapshots')
      .delete()
      .in('matchday_date', [SNAPSHOT_A, SNAPSHOT_B]);
  }

  // cleanup proof: no fixture rows survive
  const { count: leftoverSnaps } = await admin
    .from('leaderboard_snapshots')
    .select('id', { count: 'exact', head: true })
    .in('matchday_date', [SNAPSHOT_A, SNAPSHOT_B]);
  const { count: leftoverProfiles } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .like('display_name', 'Stage6 Test%');
  check('cleanup removed all test users and forced snapshots', leftoverSnaps === 0 && leftoverProfiles === 0);

  console.log(results.join('\n'));
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
