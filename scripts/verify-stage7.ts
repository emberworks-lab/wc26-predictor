/**
 * Stage 7 verification — runs against a LOCAL Supabase stack ONLY (never
 * prod: real users are live there and this script seeds a fake tournament).
 *
 *   supabase start            # applies all migrations
 *   pnpm verify:stage7        # uses supabase status to find the local stack
 *
 * Simulates a complete group stage + played R32/R16 (the synthetic world of
 * scoring.redistribution.test.ts) and proves, end-to-end through the REAL
 * pipeline (RLS → redistribute_entry RPC → runRecompute → leaderboard_ranked):
 *
 *  1. Playoff auto-open wiring: maybeOpenPlayoff flips opens_at exactly once
 *     when the 72nd group match finishes (dry-run log printed).
 *  2. Playoff RLS: joining before the flip is refused; after the flip the
 *     user joins and saves real-bracket picks; locks at first R32 kickoff.
 *  3. Fun RLS: answers save while open, wrong-shaped answers are refused,
 *     another user can't read them pre-lock but can post-lock, writes after
 *     lock are refused.
 *  4. Redistribution: redistribute_entry creates gen 1 prefilled with real
 *     R32 results (hardcore rows carry scores, casual don't); double
 *     redistribution at the same stage and at an earlier stage are rejected;
 *     gen-1 picks are editable until the R16 round starts and refused after.
 *  5. Recompute → boards: hand-computed totals (mirrors the unit test):
 *     casual Full 501.8 global; hardcore Full 500.8 global + 419 hardcore;
 *     Playoff 113; Fun 23 — all visible in leaderboard_ranked.
 *  6. Recompute idempotency with generations + fun answers present.
 */

import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { KO_GRAPH } from '../src/engine/knockoutSim';
import { buildR32 } from '../src/engine/r32Mapping';
import type { GroupId, MatchNumber, TeamId } from '../src/engine/types';
import { GROUP_IDS } from '../src/engine/types';
import { maybeOpenPlayoff, runRecompute } from '../src/lib/sync/recompute';

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

// --- the synthetic world (mirrors scoring.redistribution.test.ts) ------------

const THIRD_MARGIN: Record<GroupId, number> = {
  A: 10, B: 9, C: 8, D: 7, E: 6, F: 5, G: 4, H: 3, I: 2, J: 1, K: 1, L: 1,
};
const GROUP_FIXTURE: ReadonlyArray<[number, number]> = [
  [1, 2], [3, 4], [1, 3], [4, 2], [4, 1], [2, 3],
];

function realScore(group: GroupId, h: number, a: number): [number, number] {
  if (h === 3 && a === 4) return [THIRD_MARGIN[group], 0];
  if (h === 4 && a === 3) return [0, THIRD_MARGIN[group]];
  return h < a ? [1, 0] : [0, 1];
}

const winners = Object.fromEntries(GROUP_IDS.map((g) => [g, `${g}1`])) as Record<GroupId, TeamId>;
const runnersUp = Object.fromEntries(GROUP_IDS.map((g) => [g, `${g}2`])) as Record<GroupId, TeamId>;
const qualifiedThirds = Object.fromEntries(
  (['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as GroupId[]).map((g) => [g, `${g}3`]),
);

/** Pairings of the full real bracket (home side always advances). */
function realPairings(): { home: Map<MatchNumber, TeamId>; away: Map<MatchNumber, TeamId> } {
  const home = new Map<MatchNumber, TeamId>();
  const away = new Map<MatchNumber, TeamId>();
  for (const m of buildR32({ winners, runnersUp, thirds: qualifiedThirds })) {
    home.set(m.matchNumber, m.home);
    away.set(m.matchNumber, m.away);
  }
  for (const node of KO_GRAPH) {
    const pick = (f: { match: MatchNumber; take: 'winner' | 'loser' }): TeamId =>
      f.take === 'winner' ? home.get(f.match)! : away.get(f.match)!;
    home.set(node.matchNumber, pick(node.homeFrom));
    away.set(node.matchNumber, pick(node.awayFrom));
  }
  return { home, away };
}

const CORRECT_R32 = new Set<number>([73, 74, 75, 76, 77, 78, 79, 80]);

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

async function main() {
  const { url, anonKey, serviceKey } = localEnv();
  const admin: Db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const results: string[] = [];
  let failed = false;
  const check = (name: string, ok: boolean, extra = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
    if (!ok) failed = true;
  };

  // --- fresh local state: re-apply all migrations (also clears auth.users) ----
  console.log('[reset] supabase db reset (local stack)…');
  execSync('supabase db reset', { stdio: 'inherit' });

  // --- seed teams ------------------------------------------------------------
  const teamRows = GROUP_IDS.flatMap((g, gi) =>
    [1, 2, 3, 4].map((n) => ({
      api_id: gi * 4 + n,
      fifa_code: `${g}${n}`,
      name: `Team ${g}${n}`,
      group_code: g,
    })),
  );
  {
    const { error } = await admin.from('teams').insert(teamRows);
    if (error) throw new Error(`teams seed: ${error.message}`);
  }
  const { data: teamData } = await admin.from('teams').select('id, fifa_code');
  const idByCode = new Map<string, number>((teamData ?? []).map((t) => [t.fifa_code, t.id]));
  const tid = (code: TeamId): number => {
    const id = idByCode.get(code);
    if (id === undefined) throw new Error(`unknown team ${code}`);
    return id;
  };

  // --- seed matches ------------------------------------------------------------
  // Groups: finished days ago. R32: kickoff +1h, R16: +2h (both later
  // travelled into the past and finished). QF/SF/F: far future.
  let apiId = 1000;
  const groupRows = GROUP_IDS.flatMap((g) =>
    GROUP_FIXTURE.map(([h, a], i) => {
      const [hs, as] = realScore(g, h, a);
      return {
        api_id: (apiId += 1),
        stage: 'group',
        group_code: g,
        matchday: i < 2 ? 1 : i < 4 ? 2 : 3,
        kickoff_utc: hours(-120 + i),
        status: 'finished',
        home_team_id: tid(`${g}${h}`),
        away_team_id: tid(`${g}${a}`),
        home_score: hs,
        away_score: as,
        winner_team_id: hs > as ? tid(`${g}${h}`) : hs < as ? tid(`${g}${a}`) : null,
      };
    }),
  );
  const pair = realPairings();
  const koStage = (n: number) =>
    n <= 88 ? 'r32' : n <= 96 ? 'r16' : n <= 100 ? 'qf' : n <= 102 ? 'sf' : n === 103 ? 'third_place' : 'final';
  const koKickoff = (n: number) =>
    n <= 88 ? hours(1) : n <= 96 ? hours(2) : hours(240 + (n - 97) * 24);
  const koRows = Array.from({ length: 32 }, (_, i) => {
    const n = 73 + i;
    return {
      api_id: (apiId += 1),
      stage: koStage(n),
      fifa_match_number: n,
      kickoff_utc: koKickoff(n),
      status: 'scheduled',
      home_team_id: tid(pair.home.get(n)!),
      away_team_id: tid(pair.away.get(n)!),
    };
  });
  {
    const { error } = await admin.from('matches').insert([...groupRows, ...koRows]);
    if (error) throw new Error(`matches seed: ${error.message}`);
  }

  // --- challenges: full/groups locked in the past; fun open; playoff sentinel --
  const ids = new Map<string, number>();
  {
    const { data, error } = await admin.from('challenges').select('id, kind');
    if (error) throw new Error(`challenges: ${error.message}`);
    for (const c of data ?? []) ids.set(c.kind, c.id);
  }
  const setChallenge = async (kind: string, patch: Record<string, unknown>) => {
    const { error } = await admin.from('challenges').update(patch).eq('kind', kind);
    if (error) throw new Error(`challenge ${kind}: ${error.message}`);
  };
  await setChallenge('full', { opens_at: null, locks_at: hours(-72), manual_override: null });
  await setChallenge('groups', { opens_at: null, locks_at: hours(-72), manual_override: null });
  await setChallenge('fun', { opens_at: null, locks_at: hours(24), manual_override: null });
  await setChallenge('playoff', { opens_at: '2999-01-01T00:00:00Z', locks_at: hours(1), manual_override: null });

  // --- fun questions (the three exercised; SPEC scoring knobs) -----------------
  {
    const { error } = await admin.from('fun_questions').insert([
      { key: 'total_goals', qtype: 'numeric', max_pts: 10, tolerance: 30, sort_order: 1 },
      { key: 'golden_boot', qtype: 'pick', max_pts: 15, sort_order: 2 },
      { key: 'hat_trick', qtype: 'yesno', max_pts: 5, sort_order: 3 },
    ]);
    if (error) throw new Error(`fun_questions seed: ${error.message}`);
  }
  const { data: funQ } = await admin.from('fun_questions').select('id, key');
  const qid = (key: string) => funQ!.find((q) => q.key === key)!.id;

  // --- users -------------------------------------------------------------------
  const password = 'Stage7-Verify!9';
  const mkUser = async (i: number) => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `wc26-stage7-t${i}@example.com`,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser t${i}: ${error.message}`);
    const { error: pErr } = await admin
      .from('profiles')
      .insert({ id: data.user.id, display_name: `Stage7 T${i}`, locale: 'en' });
    if (pErr) throw new Error(`profile t${i}: ${pErr.message}`);
    const client: Db = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: sErr } = await client.auth.signInWithPassword({
      email: `wc26-stage7-t${i}@example.com`,
      password,
    });
    if (sErr) throw new Error(`signIn t${i}: ${sErr.message}`);
    return { id: data.user.id, client };
  };
  const [casual, hardcore, playoffUser, funUser] = [
    await mkUser(1),
    await mkUser(2),
    await mkUser(3),
    await mkUser(4),
  ];

  // --- entries (full = locked → seeded via service role; fun via the user) -----
  const mkEntry = async (userId: string, kind: string, hc: boolean): Promise<string> => {
    const { data, error } = await admin
      .from('challenge_entries')
      .insert({ user_id: userId, challenge_id: ids.get(kind)!, hardcore: hc, submitted_at: new Date().toISOString() })
      .select('id')
      .single();
    if (error) throw new Error(`entry ${kind}: ${error.message}`);
    return data.id;
  };
  const casualEntry = await mkEntry(casual.id, 'full', false);
  const hardcoreEntry = await mkEntry(hardcore.id, 'full', true);

  // fun: user joins themselves (challenge open → RLS allows)
  const { data: funEntryRow, error: funJoinErr } = await funUser.client
    .from('challenge_entries')
    .insert({ user_id: funUser.id, challenge_id: ids.get('fun')!, hardcore: false, submitted_at: new Date().toISOString() })
    .select('id')
    .single();
  check('fun: user joins the open challenge', !funJoinErr, funJoinErr?.message);
  const funEntry = funEntryRow!.id;

  // --- 1. playoff: join BEFORE the flip is refused ------------------------------
  {
    const { error } = await playoffUser.client
      .from('challenge_entries')
      .insert({ user_id: playoffUser.id, challenge_id: ids.get('playoff')!, hardcore: false });
    check('playoff: join before group stage completes is refused (42501)', error?.code === '42501');
  }

  // --- 2. playoff auto-open (dry-run of the sync wiring) ------------------------
  {
    const { data: groupMatches } = await admin.from('matches').select('status').eq('stage', 'group');
    const before = await admin.from('challenges').select('opens_at').eq('kind', 'playoff').single();
    const opened = await maybeOpenPlayoff(admin, groupMatches ?? []);
    const after = await admin.from('challenges').select('opens_at').eq('kind', 'playoff').single();
    const openedAt = after.data?.opens_at;
    check(
      'playoff flip: opens when all 72 group matches are finished',
      opened === true && openedAt != null && new Date(openedAt) <= new Date(),
    );
    const again = await maybeOpenPlayoff(admin, groupMatches ?? []);
    const after2 = await admin.from('challenges').select('opens_at').eq('kind', 'playoff').single();
    check('playoff flip: idempotent (second run is a no-op)', again === false && after2.data?.opens_at === openedAt);
    console.log(
      `[dry-run] maybeOpenPlayoff: before=${before.data?.opens_at} → opened=${opened} at ${openedAt}; re-run opened=${again}`,
    );
  }

  // --- 3. playoff join + picks via RLS ------------------------------------------
  const { data: poEntryRow, error: poJoinErr } = await playoffUser.client
    .from('challenge_entries')
    .insert({ user_id: playoffUser.id, challenge_id: ids.get('playoff')!, hardcore: false, submitted_at: new Date().toISOString() })
    .select('id')
    .single();
  check('playoff: join after the flip succeeds', !poJoinErr, poJoinErr?.message);
  const playoffEntry = poEntryRow!.id;
  {
    // Perfect picks across the whole real bracket (home side advances).
    const rows = Array.from({ length: 32 }, (_, i) => {
      const n = 73 + i;
      return {
        entry_id: playoffEntry,
        generation: 0,
        slot: n,
        home_team_id: tid(pair.home.get(n)!),
        away_team_id: tid(pair.away.get(n)!),
        winner_team_id: tid(pair.home.get(n)!),
        aet_pens: n === 73 ? true : null,
      };
    });
    const { error } = await playoffUser.client.from('bracket_predictions').insert(rows);
    check('playoff: bracket picks save while open', !error, error?.message);
  }

  // --- 4. fun answers via RLS ----------------------------------------------------
  {
    const save = async (question: string, patch: Record<string, unknown>) =>
      funUser.client.from('fun_answers').insert({ entry_id: funEntry, question_id: qid(question), ...patch });
    const a = await save('total_goals', { numeric_answer: 150 });
    const b = await save('golden_boot', { text_answer: 'Kylian Mbappé' });
    const c = await save('hat_trick', { bool_answer: true });
    check('fun: three answers save while open', !a.error && !b.error && !c.error, a.error?.message ?? b.error?.message ?? c.error?.message);

    const wrong = await funUser.client
      .from('fun_answers')
      .insert({ entry_id: funEntry, question_id: qid('total_goals'), text_answer: 'oops' });
    check('fun: wrong-shaped answer refused by trigger', wrong.error?.code === 'P0001', wrong.error?.code);

    const { data: foreign } = await casual.client
      .from('fun_answers')
      .select('id')
      .eq('entry_id', funEntry);
    check('fun: another user cannot read answers before lock', (foreign ?? []).length === 0);
  }

  // --- 5. full gen-0 predictions + wrecked brackets (seeded as pre-lock state) ---
  {
    const groupPreds = (hc: boolean) =>
      groupRows.map((m) => ({
        entry_id: hc ? hardcoreEntry : casualEntry,
        match_id: 0, // patched below
        api_id: m.api_id,
        outcome: m.home_score! > m.away_score! ? 'home' : m.home_score! < m.away_score! ? 'away' : 'draw',
        home_score: hc ? m.home_score : null,
        away_score: hc ? m.away_score : null,
      }));
    const { data: dbMatches } = await admin.from('matches').select('id, api_id').eq('stage', 'group');
    const matchIdByApi = new Map((dbMatches ?? []).map((m) => [m.api_id, m.id]));
    for (const hc of [false, true]) {
      const rows = groupPreds(hc).map(({ api_id, ...r }) => ({ ...r, match_id: matchIdByApi.get(api_id)! }));
      const { error } = await admin.from('match_predictions').insert(rows);
      if (error) throw new Error(`group preds: ${error.message}`);
    }

    // Wrecked gen 0: correct (home) for 73–80, away for 81–88, then the away
    // side of the OWN bracket upward (mirrors the unit test).
    const wrecked = (hc: boolean) => {
      const myW = new Map<number, TeamId>();
      const myL = new Map<number, TeamId>();
      const rows: Array<Record<string, unknown>> = [];
      const pick = (n: number, h: TeamId, a: TeamId) => {
        const homeWins = n <= 88 ? CORRECT_R32.has(n) : false;
        myW.set(n, homeWins ? h : a);
        myL.set(n, homeWins ? a : h);
        rows.push({
          entry_id: hc ? hardcoreEntry : casualEntry,
          generation: 0,
          slot: n,
          home_team_id: tid(h),
          away_team_id: tid(a),
          winner_team_id: tid(homeWins ? h : a),
          home_score: hc ? (homeWins ? 1 : 0) : null,
          away_score: hc ? (homeWins ? 0 : 1) : null,
          aet_pens: !hc && n === 73 ? true : null,
        });
      };
      for (let n = 73; n <= 88; n += 1) pick(n, pair.home.get(n)!, pair.away.get(n)!);
      for (const node of KO_GRAPH) {
        const feed = (f: { match: MatchNumber; take: 'winner' | 'loser' }): TeamId =>
          f.take === 'winner' ? myW.get(f.match)! : myL.get(f.match)!;
        pick(node.matchNumber, feed(node.homeFrom), feed(node.awayFrom));
      }
      return rows;
    };
    for (const hc of [false, true]) {
      const { error } = await admin.from('bracket_predictions').insert(wrecked(hc));
      if (error) throw new Error(`gen-0 bracket (hc=${hc}): ${error.message}`);
    }
  }

  // --- 6. finish R32 (locks playoff, enables redistribution prefill) -------------
  {
    for (let n = 73; n <= 88; n += 1) {
      const isPens = n === 73;
      const { error } = await admin
        .from('matches')
        .update({
          kickoff_utc: hours(-2),
          status: 'finished',
          home_score: 1,
          away_score: isPens ? 1 : 0,
          ...(isPens ? { home_pens: 4, away_pens: 2 } : {}),
          winner_team_id: tid(pair.home.get(n)!),
        })
        .eq('fifa_match_number', n);
      if (error) throw new Error(`finish M${n}: ${error.message}`);
    }
    await setChallenge('playoff', { locks_at: hours(-2) });
    const { error } = await playoffUser.client
      .from('bracket_predictions')
      .update({ winner_team_id: tid(pair.away.get(73)!) })
      .eq('entry_id', playoffEntry)
      .eq('slot', 73);
    // RLS makes a locked UPDATE a silent no-op (0 rows); verify nothing changed.
    void error;
    const { data: m73 } = await admin
      .from('bracket_predictions')
      .select('winner_team_id')
      .eq('entry_id', playoffEntry)
      .eq('slot', 73)
      .single();
    check('playoff: picks immutable after first R32 kickoff', m73?.winner_team_id === tid(pair.home.get(73)!));
  }

  // --- 7. redistribute before R16 -------------------------------------------------
  for (const [label, user, entry] of [
    ['casual', casual, casualEntry],
    ['hardcore', hardcore, hardcoreEntry],
  ] as const) {
    const { data, error } = await user.client.rpc('redistribute_entry', {
      p_entry_id: entry,
      p_stage: 'r16',
    });
    check(`redistribute(${label}): creates generation 1`, !error && data === 1, error?.message);

    const { data: prefill } = await admin
      .from('bracket_predictions')
      .select('slot, winner_team_id, home_score')
      .eq('entry_id', entry)
      .eq('generation', 1);
    const allReal = (prefill ?? []).every(
      (r) => r.winner_team_id === tid(pair.home.get(r.slot)!),
    );
    const scores = (prefill ?? []).filter((r) => r.home_score != null).length;
    check(
      `redistribute(${label}): gen 1 prefilled with the 16 real R32 results`,
      (prefill ?? []).length === 16 && allReal && scores === (label === 'hardcore' ? 16 : 0),
      `rows=${prefill?.length} scored=${scores}`,
    );
  }
  {
    const dup = await casual.client.rpc('redistribute_entry', { p_entry_id: casualEntry, p_stage: 'r16' });
    check('redistribute: same stage again is rejected', dup.error != null && dup.error.code === 'P0001', dup.error?.code);
    const earlier = await casual.client.rpc('redistribute_entry', { p_entry_id: casualEntry, p_stage: 'r32' });
    check('redistribute: earlier/started stage is rejected', earlier.error != null && earlier.error.code === 'P0001', earlier.error?.code);
    const foreign = await playoffUser.client.rpc('redistribute_entry', { p_entry_id: casualEntry, p_stage: 'qf' });
    check('redistribute: someone else\'s entry is rejected', foreign.error != null, foreign.error?.code);
  }

  // --- 8. gen-1 future picks while R16 hasn't started ------------------------------
  for (const [label, user, entry, hc] of [
    ['casual', casual, casualEntry, false],
    ['hardcore', hardcore, hardcoreEntry, true],
  ] as const) {
    const rows = Array.from({ length: 16 }, (_, i) => {
      const n = 89 + i;
      return {
        entry_id: entry,
        generation: 1,
        slot: n,
        home_team_id: tid(pair.home.get(n)!),
        away_team_id: tid(pair.away.get(n)!),
        winner_team_id: tid(pair.home.get(n)!),
        home_score: hc ? 1 : null,
        away_score: hc ? 0 : null,
      };
    });
    const { error } = await user.client.from('bracket_predictions').insert(rows);
    check(`gen-1 picks (${label}): editable before the R16 round starts`, !error, error?.message);
  }

  // --- 9. finish R16; gen-1 becomes immutable --------------------------------------
  {
    for (let n = 89; n <= 96; n += 1) {
      const { error } = await admin
        .from('matches')
        .update({
          kickoff_utc: hours(-1),
          status: 'finished',
          home_score: 1,
          away_score: 0,
          winner_team_id: tid(pair.home.get(n)!),
        })
        .eq('fifa_match_number', n);
      if (error) throw new Error(`finish M${n}: ${error.message}`);
    }
    await casual.client
      .from('bracket_predictions')
      .update({ winner_team_id: tid(pair.away.get(89)!) })
      .eq('entry_id', casualEntry)
      .eq('generation', 1)
      .eq('slot', 89);
    const { data: m89 } = await admin
      .from('bracket_predictions')
      .select('winner_team_id')
      .eq('entry_id', casualEntry)
      .eq('generation', 1)
      .eq('slot', 89)
      .single();
    check('gen-1 picks: immutable once the R16 round started', m89?.winner_team_id === tid(pair.home.get(89)!));
  }

  // --- 10. fun: lock passes; visibility flips; writes refused -----------------------
  {
    await setChallenge('fun', { locks_at: hours(-0.01) });
    const upd = await funUser.client
      .from('fun_answers')
      .update({ numeric_answer: 999 })
      .eq('entry_id', funEntry)
      .eq('question_id', qid('total_goals'));
    void upd;
    const { data: lockedVal } = await admin
      .from('fun_answers')
      .select('numeric_answer')
      .eq('entry_id', funEntry)
      .eq('question_id', qid('total_goals'))
      .single();
    check('fun: answer immutable after lock', Number(lockedVal?.numeric_answer) === 150);

    const { data: visible } = await casual.client.from('fun_answers').select('id').eq('entry_id', funEntry);
    check('fun: answers visible to others after lock', (visible ?? []).length === 3);

    // admin enters the actuals (Stage 8 surfaces a UI for this)
    const { error } = await admin.from('fun_questions').update({ correct_numeric: 172 }).eq('key', 'total_goals');
    const { error: e2 } = await admin.from('fun_questions').update({ correct_text: 'Kylian Mbappé' }).eq('key', 'golden_boot');
    const { error: e3 } = await admin.from('fun_questions').update({ correct_bool: true }).eq('key', 'hat_trick');
    if (error || e2 || e3) throw new Error('fun actuals');
  }

  // --- 11. recompute → hand-computed totals in leaderboard_ranked -------------------
  /* Expectations (derivation in scoring.redistribution.test.ts and §header):
   *   casual Full:    groups 440 + R16-reach 32 + AET 1 + QF-reach 28.8 = 501.8
   *   hardcore Full:  global 440 + 32 + 28.8 = 500.8 · hardcore 360 + 35 + 24 = 419
   *   playoff:        R16-reach 64 + QF-reach 48 + AET 1 = 113
   *   fun:            closeness round(10·(1−22/30)) = 3 + pick 15 + yes/no 5 = 23
   */
  const detail = await runRecompute(admin);
  console.log(`[recompute] entries=${detail.entries} rows=${detail.rows}`);

  const board = async (kind: string, b: string) => {
    const { data, error } = await admin
      .from('leaderboard_ranked')
      .select('user_id, points, rank')
      .eq('challenge_id', ids.get(kind)!)
      .eq('board', b);
    if (error) throw new Error(`leaderboard ${kind}/${b}: ${error.message}`);
    return new Map((data ?? []).map((r) => [r.user_id, Number(r.points)]));
  };

  const fullGlobal = await board('full', 'global');
  check('boards: casual Full global = 501.8', fullGlobal.get(casual.id) === 501.8, String(fullGlobal.get(casual.id)));
  check('boards: hardcore Full global = 500.8', fullGlobal.get(hardcore.id) === 500.8, String(fullGlobal.get(hardcore.id)));
  const fullHc = await board('full', 'hardcore');
  check('boards: hardcore Full hardcore board = 419', fullHc.get(hardcore.id) === 419, String(fullHc.get(hardcore.id)));
  check('boards: casual entry absent from the hardcore board', !fullHc.has(casual.id));
  const po = await board('playoff', 'global');
  check('boards: playoff = 113', po.get(playoffUser.id) === 113, String(po.get(playoffUser.id)));
  const fun = await board('fun', 'global');
  check('boards: fun = 23 (closeness 3 + pick 15 + yes/no 5)', fun.get(funUser.id) === 23, String(fun.get(funUser.id)));

  // multiplied rows carry the multiplier in their ref payload
  {
    const { data } = await admin
      .from('points')
      .select('ref, points')
      .eq('entry_id', casualEntry)
      .eq('category', 'KO_REACH');
    const qfRows = (data ?? []).filter((r) => (r.ref as { ref: string }).ref.endsWith(':QF'));
    check(
      'points rows: QF-reach rows carry multiplier 0.6 and 3.6 points each',
      qfRows.length === 8 &&
        qfRows.every((r) => (r.ref as { multiplier: number }).multiplier === 0.6 && Number(r.points) === 3.6),
    );
  }

  // --- 12. recompute idempotency ----------------------------------------------------
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
    check('recompute: idempotent with generations + fun answers present', (await checksum()) === first);
  }

  console.log('\n' + results.join('\n'));
  if (failed) {
    process.exitCode = 1;
    console.error('\nSTAGE 7 VERIFICATION FAILED');
  } else {
    console.log('\nALL STAGE 7 CHECKS PASS');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
