-- Address security advisor findings.

-- citext out of public schema
alter extension citext set schema extensions;

-- fixed search_path for the touch trigger
alter function public.touch_updated_at() set search_path = public;

-- trigger functions are never called directly — remove RPC exposure
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_match_prediction() from public, anon, authenticated;
revoke execute on function public.enforce_bracket_prediction() from public, anon, authenticated;
revoke execute on function public.enforce_fun_answer() from public, anon, authenticated;

-- NOTE: the boolean helper functions (is_admin, owns_entry, match_is_locked,
-- challenge_is_locked, entry_challenge_locked, can_edit_*) must stay executable by
-- anon/authenticated because RLS policies evaluate them as the querying role.
-- They leak no data (booleans about the caller's own state / public timing facts).
