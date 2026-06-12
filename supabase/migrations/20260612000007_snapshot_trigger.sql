-- Stage 6: wire matchday-boundary snapshots into the recompute pipeline.
--
-- The sync Edge Function recomputes points inline (fixtures mode) or fully
-- (recompute mode) and THEN flips its sync_log row to 'ok'. Firing the
-- snapshot from that update guarantees ranks are computed from fresh points,
-- needs no function redeploy, and survives future function deploys.
-- write_leaderboard_snapshots() itself is idempotent (one snapshot set per
-- completed matchday), so firing on every successful run is safe and catches
-- a matchday boundary at most one sync cycle (15 min) after the last match
-- of the night finishes.

create or replace function public.snapshot_on_sync_ok()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.write_leaderboard_snapshots();
  return new;
end;
$$;

revoke execute on function public.snapshot_on_sync_ok() from public, anon, authenticated;

create trigger sync_log_snapshot
  after update on sync_log
  for each row
  when (new.status = 'ok' and new.kind in ('fixtures', 'recompute'))
  execute function public.snapshot_on_sync_ok();
