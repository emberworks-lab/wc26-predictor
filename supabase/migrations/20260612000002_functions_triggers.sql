-- WC26 Predictor — lock/permission helper functions + integrity triggers.
-- All locking is enforced HERE (server-side), per SPEC "Deadlines & locking".

-- helpers -----------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and banned_at is null
  );
$$;

create or replace function public.is_banned()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select banned_at is not null from profiles where id = auth.uid()),
    false
  );
$$;

-- a challenge is "locked for writes" when: admin forced it locked, OR its lock
-- time passed, OR it has not opened yet (playoff before group stage ends)
create or replace function public.challenge_is_locked(cid integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when c.manual_override = 'locked' then true
    when c.manual_override = 'open' then false
    when c.locks_at is not null and now() >= c.locks_at then true
    when c.opens_at is not null and now() < c.opens_at then true
    when c.locks_at is null and c.opens_at is null then true -- not configured yet
    else false
  end
  from challenges c
  where c.id = cid;
$$;

create or replace function public.match_is_locked(mid integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select now() >= m.kickoff_utc or m.status not in ('scheduled', 'timed')
  from matches m
  where m.id = mid;
$$;

create or replace function public.owns_entry(eid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from challenge_entries e where e.id = eid and e.user_id = auth.uid()
  );
$$;

create or replace function public.entry_challenge_locked(eid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select challenge_is_locked(e.challenge_id)
  from challenge_entries e
  where e.id = eid;
$$;

create or replace function public.can_edit_match_prediction(eid uuid, mid integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select owns_entry(eid)
    and not is_banned()
    and not entry_challenge_locked(eid)
    and not match_is_locked(mid);
$$;

-- bracket picks: generation 0 editable until the challenge locks; a
-- redistribution generation is editable until its stage's first real kickoff
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
          and now() < (
            select min(m.kickoff_utc) from matches m where m.stage = r.stage
          )
      )
    end;
$$;

-- integrity triggers ---------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger matches_touch before update on matches
  for each row execute function touch_updated_at();
create trigger match_predictions_touch before update on match_predictions
  for each row execute function touch_updated_at();
create trigger bracket_predictions_touch before update on bracket_predictions
  for each row execute function touch_updated_at();
create trigger fun_answers_touch before update on fun_answers
  for each row execute function touch_updated_at();

-- match_predictions: group matches only, full/groups challenges only;
-- hardcore entries store scores (outcome derived here — never trust the client),
-- casual entries store outcome only
create or replace function public.enforce_match_prediction()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_stage match_stage;
  v_kind challenge_kind;
  v_hardcore boolean;
begin
  select m.stage into v_stage from matches m where m.id = new.match_id;
  select c.kind, e.hardcore into v_kind, v_hardcore
    from challenge_entries e join challenges c on c.id = e.challenge_id
    where e.id = new.entry_id;

  if v_stage <> 'group' then
    raise exception 'match predictions are for group-stage matches only';
  end if;
  if v_kind not in ('full', 'groups') then
    raise exception 'match predictions belong to full/groups challenges only';
  end if;

  if v_hardcore then
    if new.home_score is null or new.away_score is null then
      raise exception 'hardcore prediction requires an exact score';
    end if;
    new.outcome := case
      when new.home_score > new.away_score then 'home'::prediction_outcome
      when new.home_score < new.away_score then 'away'::prediction_outcome
      else 'draw'::prediction_outcome
    end;
  else
    new.home_score := null;
    new.away_score := null;
  end if;

  return new;
end;
$$;

create trigger match_predictions_enforce
  before insert or update on match_predictions
  for each row execute function enforce_match_prediction();

-- bracket_predictions: knockout slots only, full/playoff challenges only;
-- hardcore needs a score; on a predicted 90' draw the winner IS the pens pick
create or replace function public.enforce_bracket_prediction()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_kind challenge_kind;
  v_hardcore boolean;
begin
  select c.kind, e.hardcore into v_kind, v_hardcore
    from challenge_entries e join challenges c on c.id = e.challenge_id
    where e.id = new.entry_id;

  if v_kind not in ('full', 'playoff') then
    raise exception 'bracket predictions belong to full/playoff challenges only';
  end if;
  if new.slot not between 73 and 104 then
    raise exception 'slot must be a knockout FIFA match number (73-104)';
  end if;
  if v_kind = 'playoff' and new.generation <> 0 then
    raise exception 'playoff challenge has no redistribution generations';
  end if;

  if v_hardcore then
    if new.home_score is null or new.away_score is null then
      raise exception 'hardcore bracket pick requires a 90-minute score';
    end if;
    if new.home_score <> new.away_score then
      -- winner must match the score
      if (new.home_score > new.away_score and new.winner_team_id <> new.home_team_id)
        or (new.home_score < new.away_score and new.winner_team_id <> new.away_team_id) then
        raise exception 'winner contradicts the predicted score';
      end if;
    end if;
    -- on a draw, winner_team_id is the penalties/ET advance pick (must be set; it is NOT NULL)
  end if;

  if new.winner_team_id <> new.home_team_id and new.winner_team_id <> new.away_team_id then
    raise exception 'winner must be one of the two predicted teams in the slot';
  end if;

  return new;
end;
$$;

create trigger bracket_predictions_enforce
  before insert or update on bracket_predictions
  for each row execute function enforce_bracket_prediction();

-- fun_answers: fun challenge only; answer shape must match the question type
create or replace function public.enforce_fun_answer()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_kind challenge_kind;
  v_qtype fun_question_type;
begin
  select c.kind into v_kind
    from challenge_entries e join challenges c on c.id = e.challenge_id
    where e.id = new.entry_id;
  select q.qtype into v_qtype from fun_questions q where q.id = new.question_id;

  if v_kind <> 'fun' then
    raise exception 'fun answers belong to the fun challenge only';
  end if;
  if v_qtype = 'numeric' and new.numeric_answer is null
    or v_qtype = 'pick' and (new.text_answer is null or length(trim(new.text_answer)) = 0)
    or v_qtype = 'yesno' and new.bool_answer is null then
    raise exception 'answer does not match question type %', v_qtype;
  end if;

  return new;
end;
$$;

create trigger fun_answers_enforce
  before insert or update on fun_answers
  for each row execute function enforce_fun_answer();
