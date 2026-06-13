/**
 * Fun ranged-scoring verification (Stage 9 item 23 / PR #16) — runs against a
 * LOCAL Supabase stack ONLY (never prod: setting a fun_question's correct
 * answer would score every real fun entry).
 *
 *   supabase start            # applies all migrations (adds fun_questions.ranges
 *                             # + fun_answers.range_index)
 *   pnpm verify:fun-ranges
 *
 * Proves the deployed recompute path (src/lib/sync/recompute.ts — the SAME
 * module esbuild inlines into the deployed sync Edge Function) scores the new
 * ranged Fun questions correctly, end-to-end through the REAL pipeline
 * (DB ranges/range_index round-trip → runRecompute → engine scoreFunQuestion →
 * replace_entry_points → points rows):
 *
 *   - exact bucket           → FULL points (max_pts)
 *   - adjacent bucket        → HALF points (round(max_pts / 2))
 *   - two buckets away       → ZERO points (no row)
 *   - hardcore exact number  → closeness bonus on the HARDCORE board
 *                              round(max(0, funHardcoreExactMax·(1−|exact−actual|/tol)))
 *   - casual entry's stray exact number earns NO hardcore points (gating)
 *
 * Self-cleaning: `supabase db reset` rebuilds the throwaway local stack at the
 * top; nothing persists and prod is never touched (hard localhost guard).
 */

import { execSync } from 'node:child_process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { runRecompute } from '../src/lib/sync/recompute';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

// --- local stack discovery (hard guard: never touch a remote project) --------

function localEnv(): { url: string; anonKey: string; serviceKey: string } {
  const out = execSync('supabase status -o env', { encoding: 'utf8' });
  const get = (name: string): string => {
    const m = out.match(new RegExp(`${name}="([^"]+)"`));
    if (!m) throw new Error(`supabase status: ${name} not found`);
    return m[1];
  };
  const url = get('API_URL');
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    throw new Error(`refusing to run against non-local URL: ${url}`);
  }
  return { url, anonKey: get('ANON_KEY'), serviceKey: get('SERVICE_ROLE_KEY') };
}

// The real total_goals ranges (migration 20260613130000_fun_ranges): five
// contiguous inclusive buckets, null = open-ended. tol = hardcore closeness.
const TG_RANGES = '[[null,239],[240,259],[260,279],[280,299],[300,null]]';
const MAX_PTS = 10;
const TOL = 25;
const ACTUAL = 272; // bucketOf(TG_RANGES, 272) === 2  (260–279)
const ACTUAL_BUCKET = 2;

async function main() {
  const { url, serviceKey } = localEnv();
  const admin: Db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const results: string[] = [];
  let failed = false;
  const check = (name: string, ok: boolean, extra = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
    if (!ok) failed = true;
  };

  console.log('[reset] supabase db reset (local stack)…');
  execSync('supabase db reset', { stdio: 'inherit' });

  // --- the fun challenge (open) ----------------------------------------------
  const { data: chRows, error: chErr } = await admin
    .from('challenges')
    .select('id, kind')
    .eq('kind', 'fun')
    .single();
  if (chErr) throw new Error(`fun challenge: ${chErr.message}`);
  const funChallengeId = chRows.id as number;
  await admin
    .from('challenges')
    .update({ opens_at: null, locks_at: new Date(Date.now() + 24 * 3_600_000).toISOString(), manual_override: null })
    .eq('id', funChallengeId);

  // --- four ranged numeric questions, all with actual in bucket 2 -------------
  // Distinct keys so one entry can answer several with different range picks.
  const QUESTIONS = [
    { key: 'tg_full', sort_order: 1 }, // casual rangeIndex 2 → full
    { key: 'tg_half', sort_order: 2 }, // casual rangeIndex 1 → half
    { key: 'tg_zero', sort_order: 3 }, // casual rangeIndex 4 → zero
    { key: 'tg_exig', sort_order: 4 }, // casual rangeIndex 2 + stray exact → no hardcore
  ];
  {
    const { error } = await admin.from('fun_questions').insert(
      QUESTIONS.map((q) => ({
        key: q.key,
        qtype: 'numeric',
        max_pts: MAX_PTS,
        tolerance: TOL,
        ranges: JSON.parse(TG_RANGES),
        correct_numeric: ACTUAL,
        sort_order: q.sort_order,
      })),
    );
    if (error) throw new Error(`fun_questions seed: ${error.message}`);
  }
  const { data: funQ } = await admin.from('fun_questions').select('id, key');
  const qid = (key: string) => funQ!.find((q) => q.key === key)!.id as number;

  // sanity: the actual lands in the bucket the assertions assume
  check(
    `setup: actual ${ACTUAL} resolves to bucket index ${ACTUAL_BUCKET}`,
    ACTUAL >= 260 && ACTUAL <= 279,
  );

  // --- two throwaway users / fun entries -------------------------------------
  const mkUser = async (label: string): Promise<string> => {
    const email = `wc26-funrange-${label}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'FunRange-Verify!9',
      email_confirm: true,
    });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    const { error: pErr } = await admin
      .from('profiles')
      .insert({ id: data.user.id, display_name: `FunRange ${label}`, locale: 'en' });
    if (pErr) throw new Error(`profile ${label}: ${pErr.message}`);
    return data.user.id;
  };
  const casualUser = await mkUser('casual');
  const hardcoreUser = await mkUser('hardcore');

  const mkEntry = async (userId: string, hc: boolean): Promise<string> => {
    const { data, error } = await admin
      .from('challenge_entries')
      .insert({
        user_id: userId,
        challenge_id: funChallengeId,
        hardcore: hc,
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(`entry hc=${hc}: ${error.message}`);
    return data.id as string;
  };
  const casualEntry = await mkEntry(casualUser, false);
  const hardcoreEntry = await mkEntry(hardcoreUser, true);

  // --- answers ----------------------------------------------------------------
  const answer = async (
    entry: string,
    key: string,
    range_index: number,
    numeric_answer: number | null,
  ) => {
    const { error } = await admin
      .from('fun_answers')
      .insert({ entry_id: entry, question_id: qid(key), range_index, numeric_answer });
    if (error) throw new Error(`answer ${key}: ${error.message}`);
  };

  // Casual: range pick only (plus one stray exact that must NOT score hardcore).
  await answer(casualEntry, 'tg_full', 2, null); // exact bucket → full 10
  await answer(casualEntry, 'tg_half', 1, null); // adjacent      → half 5
  await answer(casualEntry, 'tg_zero', 4, null); // two away      → 0
  await answer(casualEntry, 'tg_exig', 2, 272); //  exact bucket + stray exact → 10 global, 0 hardcore

  // Hardcore: range pick + exact number → closeness bonus on the hardcore board.
  await answer(hardcoreEntry, 'tg_full', 2, 272); // exact bucket + exact==actual → 10 global, 5 hardcore
  await answer(hardcoreEntry, 'tg_half', 1, 260); // adjacent + exact off by 12   → 5 global, 3 hardcore

  // --- recompute through the REAL deployed pipeline ---------------------------
  const detail = await runRecompute(admin);
  console.log(`[recompute] entries=${detail.entries} rows=${detail.rows}`);

  // --- read FUN points rows ---------------------------------------------------
  const funPoints = async (entry: string) => {
    const { data, error } = await admin
      .from('points')
      .select('ref, points, hardcore')
      .eq('entry_id', entry)
      .eq('category', 'FUN');
    if (error) throw new Error(`points ${entry}: ${error.message}`);
    const map = new Map<string, { points: number; hardcore: boolean }>();
    for (const r of data ?? []) {
      const key = (r.ref as { ref: string }).ref;
      map.set(`${key}|${r.hardcore ? 'hc' : 'g'}`, { points: Number(r.points), hardcore: r.hardcore });
    }
    return map;
  };

  const c = await funPoints(casualEntry);
  const h = await funPoints(hardcoreEntry);

  // exact bucket = full
  check('casual: exact bucket → full points (10) on global', c.get('tg_full|g')?.points === MAX_PTS, String(c.get('tg_full|g')?.points));
  // adjacent bucket = half
  check('casual: adjacent bucket → half points (5) on global', c.get('tg_half|g')?.points === Math.round(MAX_PTS / 2), String(c.get('tg_half|g')?.points));
  // two away = zero (no row emitted)
  check('casual: two buckets away → no points row (0)', !c.has('tg_zero|g'), JSON.stringify([...c.keys()]));
  // casual stray exact → global full, NO hardcore row
  check('casual: stray exact number → full global, NO hardcore points (gated)', c.get('tg_exig|g')?.points === MAX_PTS && !c.has('tg_exig|hc'));

  // hardcore exact number = closeness bonus on the hardcore board
  check('hardcore: exact bucket → full global (10)', h.get('tg_full|g')?.points === MAX_PTS, String(h.get('tg_full|g')?.points));
  check('hardcore: exact == actual → full closeness bonus (5) on hardcore board', h.get('tg_full|hc')?.points === 5, String(h.get('tg_full|hc')?.points));
  check('hardcore: adjacent bucket → half global (5)', h.get('tg_half|g')?.points === Math.round(MAX_PTS / 2), String(h.get('tg_half|g')?.points));
  // |260 - 272| = 12, tol 25 → round(5·(1 − 12/25)) = round(2.6) = 3
  const expectedClose = Math.round(Math.max(0, 5 * (1 - Math.abs(260 - ACTUAL) / TOL)));
  check(`hardcore: exact off by 12 → closeness ${expectedClose} on hardcore board`, h.get('tg_half|hc')?.points === expectedClose, String(h.get('tg_half|hc')?.points));

  // --- idempotency of the ranged path -----------------------------------------
  {
    const checksum = async () => {
      const { data } = await admin.from('points').select('entry_id, category, ref, points, hardcore');
      return JSON.stringify(
        (data ?? [])
          .map((r) => [r.entry_id, r.category, JSON.stringify(r.ref), r.points, r.hardcore])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      );
    };
    const first = await checksum();
    await runRecompute(admin);
    check('recompute: ranged fun scoring is idempotent', (await checksum()) === first);
  }

  console.log('\n' + results.join('\n'));
  if (failed) {
    process.exitCode = 1;
    console.error('\nFUN-RANGES VERIFICATION FAILED');
  } else {
    console.log('\nALL FUN-RANGES CHECKS PASS');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
