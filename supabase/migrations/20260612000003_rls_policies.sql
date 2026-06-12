-- WC26 Predictor — Row Level Security.
-- Core guarantees (SPEC "Deadlines & locking"):
--   * a user can never read another user's predictions before the match/challenge locks
--   * a user can never write a locked prediction
--   * tournament data / caches / points are public read, service-role write only
-- Admin mutations happen through service-role server actions (app checks is_admin()),
-- so no broad admin-write policies are needed here.

alter table profiles enable row level security;
alter table teams enable row level security;
alter table matches enable row level security;
alter table challenges enable row level security;
alter table challenge_entries enable row level security;
alter table redistributions enable row level security;
alter table match_predictions enable row level security;
alter table bracket_predictions enable row level security;
alter table fun_questions enable row level security;
alter table fun_answers enable row level security;
alter table standings_cache enable row level security;
alter table scorers_cache enable row level security;
alter table points enable row level security;
alter table leaderboard_snapshots enable row level security;
alter table sync_log enable row level security;

-- profiles: public read (leaderboards need names); self-managed rows.
-- Column grants stop users from touching role/banned_at.
create policy profiles_select on profiles for select using (true);
create policy profiles_insert on profiles for insert
  with check (id = auth.uid() and role = 'user' and banned_at is null);
create policy profiles_update on profiles for update
  using (id = auth.uid() and banned_at is null)
  with check (id = auth.uid());

revoke update on profiles from authenticated, anon;
grant update (display_name, locale) on profiles to authenticated;

-- read-only public data (service role bypasses RLS for writes)
create policy teams_select on teams for select using (true);
create policy matches_select on matches for select using (true);
create policy challenges_select on challenges for select using (true);
create policy fun_questions_select on fun_questions for select using (true);
create policy standings_select on standings_cache for select using (true);
create policy scorers_select on scorers_cache for select using (true);
create policy points_select on points for select using (true);
create policy snapshots_select on leaderboard_snapshots for select using (true);

-- challenge entries: membership + hardcore flag are public (shown on boards);
-- join/toggle/leave only while the challenge is open
create policy entries_select on challenge_entries for select using (true);
create policy entries_insert on challenge_entries for insert
  with check (
    user_id = auth.uid()
    and not is_banned()
    and not challenge_is_locked(challenge_id)
  );
create policy entries_update on challenge_entries for update
  using (user_id = auth.uid() and not is_banned() and not challenge_is_locked(challenge_id))
  with check (user_id = auth.uid());
create policy entries_delete on challenge_entries for delete
  using (user_id = auth.uid() and not is_banned() and not challenge_is_locked(challenge_id));

-- redistributions: written only by the redistribute server action (service role);
-- public read is fine — they can only exist after the group stage (locked) anyway
create policy redistributions_select on redistributions for select using (true);

-- group-match predictions: owner always reads own; others only once the MATCH locked
create policy match_predictions_select on match_predictions for select
  using (owns_entry(entry_id) or match_is_locked(match_id) or is_admin());
create policy match_predictions_insert on match_predictions for insert
  with check (can_edit_match_prediction(entry_id, match_id));
create policy match_predictions_update on match_predictions for update
  using (can_edit_match_prediction(entry_id, match_id))
  with check (can_edit_match_prediction(entry_id, match_id));
create policy match_predictions_delete on match_predictions for delete
  using (can_edit_match_prediction(entry_id, match_id));

-- bracket picks: owner always reads own; others only once the CHALLENGE locked
create policy bracket_predictions_select on bracket_predictions for select
  using (owns_entry(entry_id) or entry_challenge_locked(entry_id) or is_admin());
create policy bracket_predictions_insert on bracket_predictions for insert
  with check (can_edit_bracket(entry_id, generation));
create policy bracket_predictions_update on bracket_predictions for update
  using (can_edit_bracket(entry_id, generation))
  with check (can_edit_bracket(entry_id, generation));
create policy bracket_predictions_delete on bracket_predictions for delete
  using (can_edit_bracket(entry_id, generation));

-- fun answers: owner always reads own; others only once the fun challenge locked
create policy fun_answers_select on fun_answers for select
  using (owns_entry(entry_id) or entry_challenge_locked(entry_id) or is_admin());
create policy fun_answers_insert on fun_answers for insert
  with check (owns_entry(entry_id) and not is_banned() and not entry_challenge_locked(entry_id));
create policy fun_answers_update on fun_answers for update
  using (owns_entry(entry_id) and not is_banned() and not entry_challenge_locked(entry_id))
  with check (owns_entry(entry_id) and not is_banned() and not entry_challenge_locked(entry_id));
create policy fun_answers_delete on fun_answers for delete
  using (owns_entry(entry_id) and not is_banned() and not entry_challenge_locked(entry_id));

-- sync log: admins only
create policy sync_log_select on sync_log for select using (is_admin());
