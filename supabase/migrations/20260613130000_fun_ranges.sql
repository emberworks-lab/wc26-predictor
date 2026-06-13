-- Stage 9 item 23: Fun numeric questions become RANGES + a hardcore exact bonus.
--
-- Casual picks one of ~5 buckets (exact bucket = full pts, adjacent = half).
-- Hardcore picks the bucket AND may add an exact number for a closeness bonus
-- on the HARDCORE board — that is what hardcore now MEANS for the Fun challenge.
-- Player picks (Golden Ball/Boot) and yes/no questions are unchanged.
--
-- Ranges derived from the last four World Cups (64 matches each), scaled to
-- WC2026's 104 matches / 48 teams. See the PR / STATE.md for the full
-- derivation table and sources. Bucket form: ordered JSON array of [lo, hi]
-- inclusive integer bounds, null = open-ended on that side; contiguous and
-- total. `tolerance` is reused as the hardcore exact-number closeness window.

alter table fun_questions add column ranges jsonb;
alter table fun_answers add column range_index integer;

-- The 8 numeric questions → ranged. (Q5/Q6 picks, Q8/Q11 yes/no untouched.)
update fun_questions set ranges = '[[null,239],[240,259],[260,279],[280,299],[300,null]]'::jsonb, tolerance = 25 where key = 'total_goals';
update fun_questions set ranges = '[[null,6],[7,10],[11,14],[15,18],[19,null]]'::jsonb,      tolerance = 6  where key = 'total_red_cards';
update fun_questions set ranges = '[[null,3],[4,6],[7,9],[10,12],[13,null]]'::jsonb,         tolerance = 4  where key = 'penalty_shootouts';
update fun_questions set ranges = '[[null,19],[20,26],[27,33],[34,40],[41,null]]'::jsonb,     tolerance = 8  where key = 'penalties_scored';
update fun_questions set ranges = '[[null,5],[6,6],[7,7],[8,8],[9,null]]'::jsonb,             tolerance = 2  where key = 'golden_boot_goals';
update fun_questions set ranges = '[[null,1],[2,2],[3,5],[6,15],[16,null]]'::jsonb,           tolerance = 2  where key = 'fastest_goal_minute';
update fun_questions set ranges = '[[null,3],[4,6],[7,9],[10,13],[14,null]]'::jsonb,          tolerance = 4  where key = 'own_goals';
update fun_questions set ranges = '[[null,5],[6,6],[7,7],[8,8],[9,null]]'::jsonb,             tolerance = 2  where key = 'highest_scoring_match';

-- Grandfather any existing free-number answers into their containing bucket
-- (keep the number as the hardcore exact value). No-op when there are none.
-- Correlated subquery in SET (UPDATE..FROM can't expose the target to LATERAL).
update fun_answers fa
set range_index = (
  select (r.ord - 1)::integer
  from fun_questions q
  cross join lateral jsonb_array_elements(q.ranges) with ordinality as r(bucket, ord)
  where q.id = fa.question_id
    and q.ranges is not null
    and (r.bucket->>0 is null or fa.numeric_answer >= (r.bucket->>0)::numeric)
    and (r.bucket->>1 is null or fa.numeric_answer <= (r.bucket->>1)::numeric)
  order by r.ord
  limit 1
)
where fa.numeric_answer is not null
  and fa.range_index is null
  and exists (
    select 1 from fun_questions q where q.id = fa.question_id and q.ranges is not null
  );

-- Validation: ranged numeric requires a valid range_index (exact number is
-- optional); legacy non-ranged numeric still requires a number.
create or replace function public.enforce_fun_answer()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_kind challenge_kind;
  v_qtype fun_question_type;
  v_ranges jsonb;
begin
  select c.kind into v_kind
    from challenge_entries e join challenges c on c.id = e.challenge_id
    where e.id = new.entry_id;
  select q.qtype, q.ranges into v_qtype, v_ranges from fun_questions q where q.id = new.question_id;

  if v_kind <> 'fun' then
    raise exception 'fun answers belong to the fun challenge only';
  end if;

  if v_qtype = 'numeric' then
    if v_ranges is not null then
      if new.range_index is null
        or new.range_index < 0
        or new.range_index >= jsonb_array_length(v_ranges) then
        raise exception 'ranged answer requires a valid range_index';
      end if;
    elsif new.numeric_answer is null then
      raise exception 'answer does not match question type %', v_qtype;
    end if;
  elsif v_qtype = 'pick' and (new.text_answer is null or length(trim(new.text_answer)) = 0) then
    raise exception 'answer does not match question type %', v_qtype;
  elsif v_qtype = 'yesno' and new.bool_answer is null then
    raise exception 'answer does not match question type %', v_qtype;
  end if;

  return new;
end;
$$;
