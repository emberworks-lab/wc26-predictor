-- Stage 9 item 20: Submit FINALIZES the entry (server-side read-after-submit).
--
-- Iter 1 (item 4) made Submit a leaderboard gate only — predictions stayed
-- editable until the challenge locked. Anton reversed that: once an entry is
-- submitted it is READ-ONLY. Editing re-opens only via Withdraw (which clears
-- submitted_at, deletes nothing), and only while the challenge itself is
-- unlocked; the per-match kickoff lock always applies independently.
--
-- Enforced HERE (server-side), like every other lock: a submitted entry
-- rejects prediction writes the same way a locked challenge does. The SOLE
-- allowed exception is the Full-challenge knockout redistribution — those
-- writes target a redistribution generation (gen > 0) and run through
-- redistribute_entry() (SECURITY DEFINER, bypasses RLS) and can_edit_bracket's
-- gen>0 branch, neither of which consults submitted_at.

create or replace function public.entry_is_submitted(eid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from challenge_entries e
    where e.id = eid and e.submitted_at is not null
  );
$$;

-- group-match predictions: also blocked once the entry is submitted.
create or replace function public.can_edit_match_prediction(eid uuid, mid integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select owns_entry(eid)
    and not is_banned()
    and not entry_is_submitted(eid)
    and not entry_challenge_locked(eid)
    and not match_is_locked(mid);
$$;

-- bracket picks: gen 0 also blocked once submitted; redistribution
-- generations (gen > 0) stay editable — the sole post-submit write path.
create or replace function public.can_edit_bracket(eid uuid, gen integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select owns_entry(eid)
    and not is_banned()
    and case
      when gen = 0 then not entry_is_submitted(eid) and not entry_challenge_locked(eid)
      else exists (
        select 1
        from redistributions r
        where r.entry_id = eid
          and r.generation = gen
          and now() < ko_round_start(r.stage)
      )
    end;
$$;

-- fun answers: the lock checks are inlined in the policies — recreate them
-- with the submitted guard added.
drop policy fun_answers_insert on fun_answers;
drop policy fun_answers_update on fun_answers;
drop policy fun_answers_delete on fun_answers;

create policy fun_answers_insert on fun_answers for insert
  with check (
    owns_entry(entry_id)
    and not is_banned()
    and not entry_is_submitted(entry_id)
    and not entry_challenge_locked(entry_id)
  );
create policy fun_answers_update on fun_answers for update
  using (
    owns_entry(entry_id)
    and not is_banned()
    and not entry_is_submitted(entry_id)
    and not entry_challenge_locked(entry_id)
  )
  with check (
    owns_entry(entry_id)
    and not is_banned()
    and not entry_is_submitted(entry_id)
    and not entry_challenge_locked(entry_id)
  );
create policy fun_answers_delete on fun_answers for delete
  using (
    owns_entry(entry_id)
    and not is_banned()
    and not entry_is_submitted(entry_id)
    and not entry_challenge_locked(entry_id)
  );
