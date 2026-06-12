# Stage 1 — Foundation: repo, scaffold, database, deploy pipeline

You are the orchestrator for Stage 1 of WC26 Predictor. Read `SPEC.md` and `STATE.md` first.
Follow the session protocol in `PLAN.md` (verify prereqs → work → update STATE.md → commit → report).

## Prerequisites (verify, fail loudly if missing)

- `gh auth status` works.
- Supabase MCP reachable (org Emberworks Lab).
- `.secrets/vercel_token` exists (Vercel personal token).
- STATE.md → Decisions has the GitHub owner and the chosen football API recorded.

## Deliverables

### 1. GitHub repo
- Create `wc26-predictor` (private) under the owner from STATE.md via `gh repo create`.
- `git init` this directory, initial commit on `main`, push.
- `.gitignore`: node, `.env*`, `.secrets/`, `.vercel`.

### 2. Next.js scaffold
- `pnpm create next-app` — App Router, TypeScript, Tailwind, ESLint, `src/` dir, no Turbopack surprises.
- Add: `next-intl` (locales `en` default + `uk`, middleware-based routing `/{locale}/...`,
  messages in `src/messages/{en,uk}.json`, browser-locale auto-detect, cookie persistence).
- Add Vitest + a sample test. Scripts: `dev`, `build`, `lint`, `typecheck` (`tsc --noEmit`), `test`.
- Theme skeleton: Tailwind config with the "stadium night" palette — near-black navy
  background (`#0a0f1e`-ish), elevated surfaces, gold accent (`#d4af37`-ish), high-contrast
  text. Define as CSS variables/Tailwind tokens; mobile-first defaults. One placeholder
  landing page using the theme, with working language switcher.

### 3. Supabase project + schema
- Create Supabase project `wc26-predictor` in org Emberworks Lab (free tier; confirm cost $0).
- Design and apply migrations (named, meaningful) for the core schema. You own this design —
  think it through against ALL of SPEC.md before writing SQL. Required entities at minimum:
  - `profiles` (id = auth.users id, unique citext display_name, role user/admin, locale, created_at, banned_at)
  - `teams` (fifa code, name keys for i18n, flag emoji, group)
  - `tournament_groups` (A–L)
  - `matches` (external_api_id, stage enum: group|r32|r16|qf|sf|third_place|final, group, kickoff_utc, status, home/away team refs — **nullable** for knockout TBD slots, scores: 90', ET, pens, matchday, r32_slot_code)
  - `challenges` (kind enum: full|groups|playoff|fun, lock strategy fields, opens_at, locks_at, status + manual override flag)
  - `challenge_entries` (user × challenge, hardcore bool, joined_at; redistribution log: array/rows of {stage, at, multiplier})
  - `match_predictions` (entry, match — for group matches: outcome or exact score; constraint: hardcore entries store scores, casual store outcomes)
  - `bracket_predictions` (entry, slot/round-based knockout picks: predicted home/away team, winner, score, aet_pens flag, penalties advance pick; versioned by redistribution generation)
  - `fun_questions` (key, type numeric|pick|yesno, max_pts, tolerance, correct_answer nullable) + `fun_answers`
  - `standings_cache`, `scorers_cache` (live tab data)
  - `points` (recomputed rows: entry, category, match/round ref, points, hardcore bool) + leaderboard materialized views or views
  - `sync_log` (job runs: kind, started, finished, status, detail jsonb)
- **RLS on everything.** Critical policies per SPEC "Deadlines & locking": predictions
  readable by owner always; readable by others only when the relevant match/challenge is
  locked; writable by owner only while unlocked (check against `matches.kickoff_utc` /
  `challenges.locks_at` IN SQL, e.g. security-definer functions). Admin role bypass via
  JWT claim or profiles lookup. Cache/standings/teams/matches: public read, service write.
- Generate TypeScript types from the schema into `src/lib/database.types.ts`.
- `supabase/` dir in repo with config + migrations so the project is reproducible; also keep
  migrations applied to the remote via MCP `apply_migration`.

### 4. Vercel project + CI
- Use the Vercel REST API with the token from `.secrets/vercel_token`: create project
  `wc26-predictor`, link the GitHub repo (auto-deploy main), set env vars
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `FOOTBALL_API_KEY`). If repo linking via API hits a permissions wall (GitHub App not
  installed), STOP and tell the user exactly which Vercel UI button to click, then continue.
- GitHub Actions workflow: lint + typecheck + test on PR and on push to main.
- Verify: push triggers a Vercel deployment; the deployed URL renders the landing page in
  both locales. Record the URL in STATE.md.

### 5. README skeleton
Architecture overview (one diagram is fine as ASCII/mermaid), stack, local dev steps,
links: Vercel project, Supabase project, scoring table copied from SPEC.md.

## Orchestration

- Schema + RLS design: do it yourself (orchestrator-level, correctness-critical).
- Scaffold config plumbing, i18n wiring, theme tokens, README: Sonnet subagents in parallel
  where files don't overlap.

## Done means

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green locally.
- CI green on GitHub. Vercel production deployment live (record URL).
- All migrations applied to remote Supabase; `list_tables` shows the schema; RLS enabled on
  every user-data table (verify via Supabase advisors — zero RLS-disabled warnings).
- STATE.md updated (URL, project ref, decisions, deviations). Everything committed + pushed.
