-- Stage 6: leaderboard ranked views + matchday-boundary rank snapshots.
--
-- Ranking = SPEC "Leaderboard tiebreakers": points → correct qualifiers →
-- correct knockout picks → correct group outcomes → earlier registration.
-- "Registration" = profiles.created_at (account creation), the same instant
-- for every board a user appears on. Parity with engine/leaderboard.ts
-- compareEntries is proven by scripts/verify-stage6.ts on fixture data.
--
-- Snapshot policy ("matchday boundary"): a matchday is the football night
-- (kickoff_utc - 6h)::date — kickoffs 14:00 UTC through 05:59 UTC next day
-- belong to the same matchday (matches the pg_cron match window). A matchday
-- D is COMPLETE when every match with matchday <= D is settled
-- (finished/awarded/cancelled/postponed — postponed matches reschedule and
-- move to their new matchday; suspended/in-play block). The recompute job
-- calls write_leaderboard_snapshots() after every points rebuild; it writes
-- one snapshot per board per completed matchday, exactly once.

-- ---------------------------------------------------------------------------
-- Per-entry leaderboard row: totals + tiebreaker counters + identity.
-- Extends leaderboard_totals (Stage 3); banned users disappear from boards.
-- ---------------------------------------------------------------------------

create view leaderboard_entry_rows with (security_invoker = true) as
select
  lt.challenge_id,
  lt.user_id,
  lt.entry_id,
  lt.hardcore,
  pr.display_name,
  pr.created_at as registered_at,
  lt.global_points,
  lt.hardcore_points,
  coalesce(es.correct_qualifiers, 0) as correct_qualifiers,
  coalesce(es.correct_ko_picks, 0) as correct_ko_picks,
  coalesce(es.correct_outcomes, 0) as correct_outcomes
from leaderboard_totals lt
join profiles pr on pr.id = lt.user_id and pr.banned_at is null
left join entry_stats es on es.entry_id = lt.entry_id;

-- ---------------------------------------------------------------------------
-- Per-challenge boards. Equal full-tiebreak ties share a rank (matches the
-- engine comparator returning 0).
-- ---------------------------------------------------------------------------

create view leaderboard_ranked with (security_invoker = true) as
select
  'global'::text as board,
  r.challenge_id,
  r.user_id,
  r.entry_id,
  r.hardcore,
  r.display_name,
  r.global_points as points,
  r.correct_qualifiers,
  r.correct_ko_picks,
  r.correct_outcomes,
  r.registered_at,
  rank() over (
    partition by r.challenge_id
    order by
      r.global_points desc,
      r.correct_qualifiers desc,
      r.correct_ko_picks desc,
      r.correct_outcomes desc,
      r.registered_at asc
  ) as rank
from leaderboard_entry_rows r
union all
select
  'hardcore'::text,
  r.challenge_id,
  r.user_id,
  r.entry_id,
  r.hardcore,
  r.display_name,
  r.hardcore_points,
  r.correct_qualifiers,
  r.correct_ko_picks,
  r.correct_outcomes,
  r.registered_at,
  rank() over (
    partition by r.challenge_id
    order by
      r.hardcore_points desc,
      r.correct_qualifiers desc,
      r.correct_ko_picks desc,
      r.correct_outcomes desc,
      r.registered_at asc
  )
from leaderboard_entry_rows r
where r.hardcore;

-- ---------------------------------------------------------------------------
-- Overall boards: one row per user, summed across their challenge entries.
-- Hardcore overall counts users with at least one hardcore entry (non-
-- hardcore entries contribute 0 hardcore points by construction).
-- ---------------------------------------------------------------------------

create view leaderboard_overall_ranked with (security_invoker = true) as
with per_user as (
  select
    r.user_id,
    r.display_name,
    r.registered_at,
    sum(r.global_points) as global_points,
    sum(r.hardcore_points) as hardcore_points,
    sum(r.correct_qualifiers) as correct_qualifiers,
    sum(r.correct_ko_picks) as correct_ko_picks,
    sum(r.correct_outcomes) as correct_outcomes,
    bool_or(r.hardcore) as any_hardcore
  from leaderboard_entry_rows r
  group by r.user_id, r.display_name, r.registered_at
)
select
  'global'::text as board,
  u.user_id,
  u.display_name,
  u.global_points as points,
  u.correct_qualifiers,
  u.correct_ko_picks,
  u.correct_outcomes,
  u.registered_at,
  rank() over (
    order by
      u.global_points desc,
      u.correct_qualifiers desc,
      u.correct_ko_picks desc,
      u.correct_outcomes desc,
      u.registered_at asc
  ) as rank
from per_user u
union all
select
  'hardcore'::text,
  u.user_id,
  u.display_name,
  u.hardcore_points,
  u.correct_qualifiers,
  u.correct_ko_picks,
  u.correct_outcomes,
  u.registered_at,
  rank() over (
    order by
      u.hardcore_points desc,
      u.correct_qualifiers desc,
      u.correct_ko_picks desc,
      u.correct_outcomes desc,
      u.registered_at asc
  )
from per_user u
where u.any_hardcore;

-- ---------------------------------------------------------------------------
-- Snapshots: keyed by completed matchday. challenge_id null = overall board.
-- ---------------------------------------------------------------------------

alter table leaderboard_snapshots add column matchday_date date not null;

create unique index leaderboard_snapshots_unique_idx
  on leaderboard_snapshots (matchday_date, board, challenge_id, user_id)
  nulls not distinct;

create or replace function public.write_leaderboard_snapshots(p_matchday date default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  d date;
  n integer := 0;
  m integer := 0;
begin
  if p_matchday is not null then
    -- Manual/admin override (used by verification and backfills).
    d := p_matchday;
  else
    -- Latest matchday with every match on or before it settled.
    select max(days.md) into d
    from (
      select distinct (kickoff_utc - interval '6 hours')::date as md from matches
    ) days
    where not exists (
      select 1 from matches m2
      where (m2.kickoff_utc - interval '6 hours')::date <= days.md
        and m2.status not in ('finished', 'awarded', 'cancelled', 'postponed')
    );
  end if;

  if d is null then
    return 0;
  end if;
  if exists (select 1 from leaderboard_snapshots where matchday_date = d) then
    return 0; -- already snapshotted: recompute calls this on every run
  end if;

  insert into leaderboard_snapshots (matchday_date, board, challenge_id, user_id, rank, points)
  select d, board, challenge_id, user_id, rank, points
  from leaderboard_ranked;
  get diagnostics n = row_count;

  insert into leaderboard_snapshots (matchday_date, board, challenge_id, user_id, rank, points)
  select d, board, null, user_id, rank, points
  from leaderboard_overall_ranked;
  get diagnostics m = row_count;

  return n + m;
end;
$$;

revoke execute on function public.write_leaderboard_snapshots(date)
  from public, anon, authenticated;
