-- Stage 3: sync infrastructure — entry stats, atomic points replacement,
-- leaderboard totals view, pg_cron schedules invoking the sync Edge Function.

-- ---------------------------------------------------------------------------
-- entry_stats: pre-aggregated tiebreaker counters (SPEC → leaderboard
-- tiebreakers), rewritten by every points recompute.
-- ---------------------------------------------------------------------------

create table entry_stats (
  entry_id uuid primary key references challenge_entries (id) on delete cascade,
  correct_qualifiers integer not null default 0,
  correct_ko_picks integer not null default 0,
  correct_outcomes integer not null default 0,
  computed_at timestamptz not null default now()
);

alter table entry_stats enable row level security;
create policy entry_stats_select on entry_stats for select using (true);

-- ---------------------------------------------------------------------------
-- Atomic per-entry points replacement (SPEC recompute rule: idempotent,
-- delete+insert — never incremental). Service-role only.
-- ---------------------------------------------------------------------------

create or replace function public.replace_entry_points(
  p_entry_id uuid,
  p_rows jsonb,
  p_stats jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from points where entry_id = p_entry_id;

  insert into points (entry_id, category, ref, points, hardcore)
  select
    p_entry_id,
    r ->> 'category',
    r -> 'ref',
    (r ->> 'points')::numeric,
    (r ->> 'hardcore')::boolean
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;

  insert into entry_stats (entry_id, correct_qualifiers, correct_ko_picks, correct_outcomes, computed_at)
  values (
    p_entry_id,
    coalesce((p_stats ->> 'correct_qualifiers')::integer, 0),
    coalesce((p_stats ->> 'correct_ko_picks')::integer, 0),
    coalesce((p_stats ->> 'correct_outcomes')::integer, 0),
    now()
  )
  on conflict (entry_id) do update set
    correct_qualifiers = excluded.correct_qualifiers,
    correct_ko_picks = excluded.correct_ko_picks,
    correct_outcomes = excluded.correct_outcomes,
    computed_at = excluded.computed_at;
end;
$$;

revoke execute on function public.replace_entry_points(uuid, jsonb, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Leaderboard totals (plain view — recomputes on read; points has RLS
-- select-all so security_invoker is safe).
-- ---------------------------------------------------------------------------

create view leaderboard_totals with (security_invoker = true) as
select
  ce.challenge_id,
  ce.user_id,
  ce.id as entry_id,
  ce.hardcore,
  ce.created_at,
  coalesce(sum(p.points) filter (where not p.hardcore), 0) as global_points,
  coalesce(sum(p.points) filter (where p.hardcore), 0) as hardcore_points
from challenge_entries ce
left join points p on p.entry_id = ce.id
group by ce.id;

-- ---------------------------------------------------------------------------
-- Cron → Edge Function plumbing. The shared secret lives in Vault under
-- 'sync_secret' (inserted out-of-band, never in a committed migration).
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_sync(p_mode text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'sync_secret';

  if v_secret is null then
    raise warning 'invoke_sync: sync_secret missing from vault, skipping';
    return;
  end if;

  perform net.http_post(
    url := 'https://ejiuelstlbncfaljthfr.supabase.co/functions/v1/sync?mode=' || p_mode,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke execute on function public.invoke_sync(text) from public, anon, authenticated;

-- Match window (generous): 14:00–06:00 UTC covers all kickoff-to-final-whistle
-- spans across US/MEX/CAN venues, June 11 – July 19 (+1 day slack).
-- Worst case API budget: 16h × 4 + 8 hourly + 4 stats ≈ 76 calls/day vs a
-- 10 req/min provider limit with no daily cap — comfortably inside.

select cron.schedule(
  'wc26_sync_fixtures_fast',
  '*/15 * * * *',
  $$
    select public.invoke_sync('fixtures')
    where now() between '2026-06-11+00' and '2026-07-21+00'
      and (extract(hour from now() at time zone 'utc') >= 14
           or extract(hour from now() at time zone 'utc') < 6)
  $$
);

select cron.schedule(
  'wc26_sync_fixtures_hourly',
  '5 * * * *',
  $$
    select public.invoke_sync('fixtures')
    where not (
      now() between '2026-06-11+00' and '2026-07-21+00'
      and (extract(hour from now() at time zone 'utc') >= 14
           or extract(hour from now() at time zone 'utc') < 6)
    )
  $$
);

select cron.schedule(
  'wc26_sync_stats',
  '7 2,8,14,20 * * *',
  $$ select public.invoke_sync('stats') $$
);
