-- Stage 7: knockout redistribution (SPEC → "Knockout redistribution").
--
-- redistribute_entry(): the ONE write path for redistributions — atomic,
-- fully validated server-side, callable by the entry owner (authenticated).
-- Creates the redistribution log row and prefills the new bracket generation
-- with the real results of already-played knockout matches (you can't
-- re-predict the past; scoring ignores pre-stage picks anyway and uses real
-- advancers, the prefill keeps the generation self-describing for the UI).
--
-- Also fixes can_edit_bracket's lock boundary for a before-Final
-- redistribution: the engine's final round (F) includes the third-place
-- match (M103), which kicks off BEFORE the final — without the fix slot 103
-- would stay editable after that match started (anti-cheat hole).

-- Stage order index for the redistribution chain (knockout rounds only).
create or replace function public.ko_stage_index(s match_stage)
returns integer
language sql immutable
as $$
  select case s
    when 'r32' then 1
    when 'r16' then 2
    when 'qf' then 3
    when 'sf' then 4
    when 'third_place' then 5
    when 'final' then 5
    else null
  end;
$$;

-- First real kickoff of the ROUND a redistribution stage starts at
-- ('final' = round F = third-place match + final).
create or replace function public.ko_round_start(s match_stage)
returns timestamptz
language sql stable
as $$
  select min(m.kickoff_utc)
  from matches m
  where ko_stage_index(m.stage) = ko_stage_index(s);
$$;

create or replace function public.redistribute_entry(
  p_entry_id uuid,
  p_stage match_stage
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_kind challenge_kind;
  v_hardcore boolean;
  v_generation integer;
  v_multiplier numeric(2, 1);
  v_round_start timestamptz;
  v_max_existing integer;
begin
  -- ownership + ban (auth.uid() of the calling user)
  if not owns_entry(p_entry_id) or is_banned() then
    raise exception 'redistribute: not your entry';
  end if;

  select c.kind, e.hardcore into v_kind, v_hardcore
    from challenge_entries e join challenges c on c.id = e.challenge_id
    where e.id = p_entry_id;
  if v_kind <> 'full' then
    raise exception 'redistribute: only the Full challenge has redistribution';
  end if;

  if p_stage not in ('r32', 'r16', 'qf', 'sf', 'final') then
    raise exception 'redistribute: % is not a redistribution stage', p_stage;
  end if;

  -- group stage must be complete (same condition the sync playoff flip uses)
  if (select count(*) from matches where stage = 'group' and status = 'finished') < 72 then
    raise exception 'redistribute: group stage is not finished yet';
  end if;

  -- the target round must not have started
  v_round_start := ko_round_start(p_stage);
  if v_round_start is null or now() >= v_round_start then
    raise exception 'redistribute: stage % has already started', p_stage;
  end if;

  -- one redistribution per stage, multiplier never increases: every new
  -- redistribution must target a STRICTLY LATER stage than all existing ones
  select max(ko_stage_index(r.stage)) into v_max_existing
    from redistributions r where r.entry_id = p_entry_id;
  if v_max_existing is not null and v_max_existing >= ko_stage_index(p_stage) then
    raise exception 'redistribute: already redistributed at % or later', p_stage;
  end if;

  select coalesce(max(generation), 0) + 1 into v_generation
    from redistributions where entry_id = p_entry_id;

  v_multiplier := case p_stage
    when 'r32' then 0.7
    when 'r16' then 0.6
    when 'qf' then 0.5
    when 'sf' then 0.4
    else 0.3
  end;

  insert into redistributions (entry_id, generation, stage, multiplier)
  values (p_entry_id, v_generation, p_stage, v_multiplier);

  -- Prefill: finished knockout matches of earlier rounds, fixed to the real
  -- result (hardcore rows carry the real 90' score — the integrity trigger
  -- requires one; casual rows store the advancer only).
  insert into bracket_predictions
    (entry_id, generation, slot, home_team_id, away_team_id, winner_team_id,
     home_score, away_score, aet_pens)
  select
    p_entry_id,
    v_generation,
    m.fifa_match_number,
    m.home_team_id,
    m.away_team_id,
    m.winner_team_id,
    case when v_hardcore then m.home_score end,
    case when v_hardcore then m.away_score end,
    null
  from matches m
  where m.stage <> 'group'
    and m.status = 'finished'
    and m.fifa_match_number is not null
    and m.home_team_id is not null
    and m.away_team_id is not null
    and m.winner_team_id is not null
    and ko_stage_index(m.stage) < ko_stage_index(p_stage);

  return v_generation;
end;
$$;

revoke execute on function public.redistribute_entry(uuid, match_stage) from public, anon;
grant execute on function public.redistribute_entry(uuid, match_stage) to authenticated;

-- can_edit_bracket: redistribution generations lock at the start of their
-- ROUND (ko_stage_index-aware), not at min kickoff of the literal stage enum
-- — for 'final' that now includes the earlier third-place match.
create or replace function public.can_edit_bracket(eid uuid, gen integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select owns_entry(eid)
    and not is_banned()
    and case
      when gen = 0 then not entry_challenge_locked(eid)
      else exists (
        select 1
        from redistributions r
        where r.entry_id = eid
          and r.generation = gen
          and now() < ko_round_start(r.stage)
      )
    end;
$$;
