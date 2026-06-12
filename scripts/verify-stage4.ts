/**
 * Stage 4 server-side verification (run: pnpm tsx scripts/verify-stage4.ts).
 *
 * Exercises the real production project with throwaway users:
 *  1. display-name uniqueness is enforced server-side (citext unique, RLS path)
 *  2. joining an open challenge creates an entry row; locked/unopened ones refuse
 *  3. the Google provider is enabled (authorize endpoint redirects to Google)
 * Cleans up after itself (admin deleteUser cascades profiles/entries).
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

  const password = `Vfy-${Math.random().toString(36).slice(2)}!9`;
  const mkUser = async (email: string) => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    return data.user.id;
  };

  const userA = await mkUser('wc26-verify-a@example.com');
  const userB = await mkUser('wc26-verify-b@example.com');
  const results: string[] = [];
  let failed = false;
  const check = (name: string, ok: boolean, extra = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
    if (!ok) failed = true;
  };

  try {
    const signedIn = async (email: string) => {
      const client = createClient<Database>(url, anonKey, {
        auth: { persistSession: false },
      });
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`signIn ${email}: ${error.message}`);
      return client;
    };

    const clientA = await signedIn('wc26-verify-a@example.com');
    const clientB = await signedIn('wc26-verify-b@example.com');

    // 1. profile creation + case-insensitive uniqueness
    const { error: insA } = await clientA
      .from('profiles')
      .insert({ id: userA, display_name: 'VerifyChamp', locale: 'en' });
    check('user A creates profile', !insA, insA?.message);

    const { error: insB } = await clientB
      .from('profiles')
      .insert({ id: userB, display_name: 'verifychamp', locale: 'uk' });
    check(
      'duplicate name (different case) rejected server-side',
      insB?.code === '23505',
      insB ? `code ${insB.code}` : 'insert unexpectedly succeeded',
    );

    const { error: insB2 } = await clientB
      .from('profiles')
      .insert({ id: userB, display_name: 'VerifyRunnerUp', locale: 'uk' });
    check('user B creates profile with unique name', !insB2, insB2?.message);

    // 2. challenge joining
    const { data: challenges } = await clientA
      .from('challenges')
      .select('id, kind');
    const fullId = challenges!.find((c) => c.kind === 'full')!.id;
    const playoffId = challenges!.find((c) => c.kind === 'playoff')!.id;

    const { data: entry, error: joinErr } = await clientA
      .from('challenge_entries')
      .insert({ user_id: userA, challenge_id: fullId, hardcore: true })
      .select('id, hardcore')
      .single();
    check('joining the open Full challenge creates an entry', !!entry, joinErr?.message);
    check('hardcore flag stored on join', entry?.hardcore === true);

    const { error: playoffErr } = await clientA
      .from('challenge_entries')
      .insert({ user_id: userA, challenge_id: playoffId });
    check(
      'joining the not-yet-open Playoff challenge is refused by RLS',
      playoffErr != null,
      playoffErr ? `code ${playoffErr.code}` : 'insert unexpectedly succeeded',
    );

    const { error: imposterErr } = await clientB
      .from('challenge_entries')
      .insert({ user_id: userA, challenge_id: fullId });
    check(
      "creating an entry for another user is refused by RLS",
      imposterErr != null,
      imposterErr ? `code ${imposterErr.code}` : 'insert unexpectedly succeeded',
    );

    // hardcore toggle while open
    const { data: toggled } = await clientA
      .from('challenge_entries')
      .update({ hardcore: false })
      .eq('id', entry!.id)
      .select('hardcore')
      .single();
    check('hardcore toggle while challenge open', toggled?.hardcore === false);

    // 3. Google provider enabled
    const authorize = await fetch(
      `${url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(
        'https://wc26-predictor-gilt.vercel.app/auth/callback',
      )}`,
      { redirect: 'manual' },
    );
    const location = authorize.headers.get('location') ?? '';
    check(
      'Google provider authorize redirects to accounts.google.com',
      authorize.status === 302 && location.includes('accounts.google.com'),
      `status ${authorize.status}`,
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
