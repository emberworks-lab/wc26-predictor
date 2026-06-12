# STATE — living handoff between build sessions

> Every session updates this file before finishing. Newest entries on top inside each section.

## Current status

- **Stage 1 COMPLETE.** Next up: Stage 2 (`prompts/stage-2-engines.md`) and/or Stage 4
  (`prompts/stage-4-auth-shell.md`, parallel branch).
- Live URL: **https://wc26-predictor-gilt.vercel.app** (en + uk verified). CI green.

## Decisions

- GitHub owner for the repo: **`emberworks-lab` org**, repo is **PUBLIC** (confirmed by
  user, June 12 2026 — Vercel Hobby cannot deploy private org repos; never commit secrets).
- Supabase project: **`wc26-predictor`**, ref `ejiuelstlbncfaljthfr`, region `eu-central-1`,
  free tier. URL `https://ejiuelstlbncfaljthfr.supabase.co`. NOTE: PantryPal project was
  PAUSED to free the 2-active-free-projects slot (user approved; un-pause after the WC if needed).
- Vercel: user `achontoroh-8067`, team `team_xZTl8i4cPEKsFO60nyTFLzd7` (Hobby), token in
  `.secrets/vercel_token`.
- `src/middleware.ts` is named `src/proxy.ts` (Next.js 16 convention — middleware.ts deprecated).
- Security advisors: remaining WARNs are accepted — boolean helper functions
  (is_admin/owns_entry/match_is_locked/...) must stay executable by anon/authenticated
  because RLS policies evaluate them; they leak no data. Trigger functions are revoked.
- Data API: **football-data.org, free tier** (verified June 12, 2026: World Cup is
  `plan: TIER_ONE` = free). Competition id **2000**, code **`WC`**, base
  `https://api.football-data.org/v4`. Endpoints: `/competitions/WC/matches`,
  `/competitions/WC/standings`, `/competitions/WC/scorers?limit=100` (scorers schema
  includes goals, assists, penalties). Auth header `X-Auth-Token`. Rate limit:
  10 req/min, no daily cap. Key location: `.env.local` → `FOOTBALL_API_KEY` (+ Vercel env
  + Supabase function secret).
  - NOT available on free tier: true in-play live scores (free scores are slightly delayed —
    acceptable at 15-min polling), lineups, substitutions, cards, per-match goal events.
    Cards/lineups features in SPEC live tab: **cut unless upgraded** (€29/mo Deep Data).
  - Fallback for assists if the free scorers endpoint disappoints in practice:
    API-Football free tier (100 req/day), league id 1, season 2026,
    `players/topassists` once a day — registering a second free key costs nothing.
- Scoring table v1 fixed in SPEC.md.
- Stack fixed in SPEC.md (Next.js App Router + TS + Tailwind + next-intl + Supabase + Vitest + pnpm).

## Access / credentials status

| Thing | Status |
|---|---|
| GitHub | ✅ `gh` authed as `achontoroh` (repo, workflow scopes) |
| Supabase | ✅ MCP access to org Emberworks Lab (`kjrrdcebvoepffmaqxgq`) — can create project, run migrations, deploy edge functions |
| Vercel | ✅ token in `.secrets/vercel_token`; project `prj_jPTbl9jkwCv2qVLo3VwIKPcLx8Dg` linked to repo, env vars set (SUPABASE_URL, ANON_KEY, FOOTBALL_API_KEY) |
| Football API | ✅ key in `.env.local` + Vercel env as `FOOTBALL_API_KEY` (verified against /v4/competitions/WC) |
| Supabase service role key | ❌ NOT yet set anywhere — Stage 3 must fetch it (dashboard → project settings → API) and add to Vercel env + Edge Function secrets |
| Google OAuth | ⏳ user is creating an OAuth client (Google Cloud project `wc26-predictor`, Web application, redirect URI `https://ejiuelstlbncfaljthfr.supabase.co/auth/v1/callback`, consent screen published to production). Stage 4: read credentials from `.secrets/google_oauth` (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET lines); if the file is missing, ship magic-link only per the stage prompt |

## Stage log

### Stage 1 — June 12, 2026
- Repo `emberworks-lab/wc26-predictor` (PUBLIC), main branch, CI green (lint/typecheck/test).
- Next.js 15 + TS + Tailwind v4 + next-intl (en/uk, `localePrefix: always`, `src/proxy.ts`).
- Supabase `ejiuelstlbncfaljthfr`: 4 migrations applied (core_schema, functions_triggers,
  rls_policies, security_hardening); RLS on all 15 tables; TS types in src/lib/database.types.ts.
- Vercel project linked, env vars set, production deploy verified:
  https://wc26-predictor-gilt.vercel.app (`wc26-predictor.vercel.app` was taken).
- Landing page + theme tokens + language switcher live in both locales.
- NOT done in Stage 1 (deferred as planned): seed data (Stage 3), auth (Stage 4),
  service-role key in env (Stage 3).

### Stage 0 — June 12, 2026
- Authored SPEC.md, PLAN.md, STATE.md, prompts/stage-1..8.
- football-data.org chosen + key verified; GitHub/Supabase/Vercel access confirmed.

## Known issues / deviations from SPEC

- none yet
