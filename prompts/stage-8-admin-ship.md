# Stage 8 — Admin area, security verification, final QA, ship report

You are the orchestrator for Stage 8 of WC26 Predictor. Read `SPEC.md` and `STATE.md` first.
Follow the session protocol in `PLAN.md`. Branch: `stage/8-admin-ship` → PR → merge.

## Deliverables

### 1. Admin area (`/admin`, role-gated server-side — RLS + layout guard)
- Set Anton's profile to `admin` via migration/SQL (his auth email is in STATE.md or ask).
- Force sync: buttons to invoke the sync Edge Function modes; show last `sync_log` rows live.
- Result correction: edit a match's score/status manually (writes flagged
  `manually_corrected`, sync must not overwrite a corrected match unless flag cleared) →
  triggers recompute.
- Job logs viewer: `sync_log` table with filters.
- Challenge override: open/close any challenge manually (the override flag from the schema;
  `engine/locks.ts` already respects it — verify).
- User moderation: list users, ban (kills session + hides from leaderboards, predictions
  retained), rename (for offensive display names), delete entry.
- Fun answers: form to enter `correct_answer` per question post-tournament.

### 2. Security & RLS verification suite (`scripts/rls-check.ts`, run in CI nightly or on demand)
Programmatic checks with two real test users (anon key + JWTs):
- A cannot read B's unlocked predictions (each prediction table).
- A cannot write own prediction after lock (kicked-off match; locked challenge).
- A cannot write B's anything, ever. Non-admin cannot touch admin endpoints/tables.
- Banned user loses access.
Run Supabase advisors (`get_advisors` security + performance); fix or explicitly accept every
finding in STATE.md.

### 3. Final QA pass
- Full local run-through of every flow in SPEC's "Quality bar" on the production URL
  (use Claude Preview/browser tools or document manual steps you executed).
- Lighthouse-ish sanity on mobile viewport: pages render under the theme, no horizontal
  overflow, tap targets sane.
- Verify cron jobs ran on schedule in the last 24h (`sync_log` timestamps).
- API quota: current usage vs limit, projected through July 19.
- Kill dead code, fix lint debt, ensure README is accurate (architecture, scoring table,
  local dev guide, runbook: "API died / result wrong / user is a troll → do X in /admin").

### 4. Final report (output to chat AND `docs/SHIP_REPORT.md`)
- Live URL. Admin access how-to. The scoring table. What's stubbed or cut (be honest).
- API quota status. Local dev guide. Known issues. Post-groups TODO list (e.g. verify
  Playoff flip on the real day, enter fun answers after the final).

## Done means

- All RLS checks green against PRODUCTION (read-only checks + test users; clean up test data).
- Admin flows demonstrated (result correction → recompute → leaderboard change, on a branch
  DB or with an immediately-reverted correction).
- CI green, deployed, PR merged, STATE.md updated, ship report delivered.
