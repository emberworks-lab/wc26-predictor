-- Stage 9 item 4: explicit submit gating.
--
-- An entry now participates in the leaderboards only after the user explicitly
-- submits it (`submitted_at is not null`). Autosave stays the draft mechanism;
-- Submit flips this once and "submitted stays submitted" — editing predictions
-- afterwards never clears it.
--
-- The column is user-settable while the challenge is unlocked, guarded by the
-- existing entries_update RLS policy (owner + not banned + not locked). No new
-- grant is needed: `authenticated` already holds table-wide UPDATE on
-- challenge_entries (it's how the hardcore toggle works), and the policy is the
-- trust boundary — a submit after the deadline is refused server-side.

alter table challenge_entries add column submitted_at timestamptz;

-- Grandfather every entry that exists at migration time so the current real
-- users do NOT vanish from the boards the instant this ships.
update challenge_entries set submitted_at = now() where submitted_at is null;

-- ---------------------------------------------------------------------------
-- Leaderboard views: only submitted entries rank.
-- leaderboard_totals gains submitted_at (appended — create-or-replace-safe);
-- leaderboard_entry_rows filters on it, so every downstream ranked/overall
-- view inherits the gate.
-- ---------------------------------------------------------------------------

create or replace view leaderboard_totals with (security_invoker = true) as
select
  ce.challenge_id,
  ce.user_id,
  ce.id as entry_id,
  ce.hardcore,
  ce.created_at,
  coalesce(sum(p.points) filter (where not p.hardcore), 0) as global_points,
  coalesce(sum(p.points) filter (where p.hardcore), 0) as hardcore_points,
  ce.submitted_at
from challenge_entries ce
left join points p on p.entry_id = ce.id
group by ce.id;

create or replace view leaderboard_entry_rows with (security_invoker = true) as
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
left join entry_stats es on es.entry_id = lt.entry_id
where lt.submitted_at is not null;
