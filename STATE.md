# STATE — living handoff between build sessions

> Every session updates this file before finishing. Newest entries on top inside each section.

## Current status

- **Stage 1 in progress** (this session). Done so far: repo, Next.js scaffold, schema +
  RLS applied to remote Supabase, i18n (en/uk) + stadium-night theme + landing, CI workflow.
  Remaining: Vercel project + env vars + verified deploy.

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
| Vercel | ❌ no CLI, no token — user must create token → `.secrets/vercel_token` |
| Football API | ❌ user registers at https://www.football-data.org/client/register → token to `.env.local` as `FOOTBALL_API_KEY` |
| Google OAuth | ❌ needed in Stage 4 — user creates OAuth client in Google Cloud Console; redirect URI will be `https://<supabase-project-ref>.supabase.co/auth/v1/callback` (exact value known after Stage 1) |

## Stage log

### Stage 0 — <date>
- Authored SPEC.md, PLAN.md, STATE.md, prompts/stage-1..8.
- (fill in: API decision, checklist confirmations)

## Known issues / deviations from SPEC

- none yet
