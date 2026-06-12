# WC26 Predictor — Build Plan & Session Protocol

The project is built across **8 staged Claude Code sessions** to avoid context limits.
Each stage has a self-contained prompt in `prompts/stage-N-*.md`.

## How to run a stage

Start a fresh Claude Code session in this directory and paste:

```
Read SPEC.md, STATE.md and prompts/stage-N-<name>.md, then execute the stage.
You are authorized to commit and push to the feature flow described in the prompt.
```

That sentence IS the commit authorization for that session.

## Session protocol (every stage prompt repeats this)

1. **Start**: read `SPEC.md` → `STATE.md` → your stage prompt. Verify the previous stage's
   "Done means" items actually hold (run the commands). If something is broken, fix it first
   and note it in `STATE.md`.
2. **Work**: follow the stage prompt. Delegate per the orchestration policy inside it.
3. **End**: update `STATE.md` (what shipped, decisions made, deviations from SPEC, exact
   next-step blockers), commit everything, push, confirm CI green. Output a short report.

## Stages

| # | Prompt file | What | Depends on |
|---|---|---|---|
| 0 | (this session) | Access checklist, API research, these files | — |
| 1 | `prompts/stage-1-foundation.md` | Repo, Next.js scaffold, Supabase project, DB schema + RLS, Vercel deploy, CI, i18n + theme skeleton | 0 |
| 2 | `prompts/stage-2-engines.md` | Pure domain engines: tiebreakers, best-thirds, FIFA R32 mapping (495 annex), scoring, redistribution, lock logic — all unit-tested | 1 |
| 3 | `prompts/stage-3-data-sync.md` | API client, seed real WC26 data, Edge Functions sync, pg_cron, standings cache, points recompute pipeline | 1, 2 |
| 4 | `prompts/stage-4-auth-shell.md` | Auth (magic link + Google), profiles, app shell, nav, language switcher, Rules page | 1 |
| 5 | `prompts/stage-5-predictions.md` | Full + Groups prediction flows, hardcore switch, live predicted tables, personal bracket, locking UI | 2, 3, 4 |
| 6 | `prompts/stage-6-leaderboards-live.md` | Leaderboards (global/hardcore/overall), live Tournament tab, profile page | 3, 5 |
| 7 | `prompts/stage-7-playoff-fun-redistribution.md` | Playoff challenge, Fun challenge, redistribution mechanic + UI | 5, 6 |
| 8 | `prompts/stage-8-admin-ship.md` | Admin area, RLS verification tests, E2E smoke, final QA, final report | all |

Stages 1→2→3 are the critical path (data + correctness). Stage 4 can run in parallel with 2/3
(different files) if you want to run two sessions side by side — both touch the same repo, so
use separate branches and merge 4 after 3.

## Repo & infra names

- GitHub repo: `wc26-predictor` (owner per STATE.md → "Decisions").
- Supabase project: `wc26-predictor` (org: Emberworks Lab, free tier).
- Vercel project: `wc26-predictor`.
- Branch model: short-lived `stage/N-<name>` branches → PR → merge to `main`
  (main auto-deploys). Stage 1 may commit directly to `main` to bootstrap.

## Secrets convention

Local secrets live in `.secrets/` (gitignored) and `.env.local` (gitignored):

- `.secrets/vercel_token` — Vercel personal token (user creates).
- `.env.local` — `FOOTBALL_API_KEY`, Supabase keys (filled in stages 1/3).

Production secrets go to Vercel env vars + Supabase Edge Function secrets — never committed.
