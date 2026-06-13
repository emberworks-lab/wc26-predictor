-- Stage 8: pin search_path on the two migration-8 helpers the security
-- advisor flagged (everything else was hardened in migration 4).
-- ko_stage_index is a pure CASE (no table refs) — pinned for consistency;
-- ko_round_start reads `matches` unqualified, so the pin actually matters.

alter function public.ko_stage_index(match_stage) set search_path = public;
alter function public.ko_round_start(match_stage) set search_path = public;
