# Stage 4 — Auth, profiles, app shell

You are the orchestrator for Stage 4 of WC26 Predictor. Read `SPEC.md` and `STATE.md` first.
Follow the session protocol in `PLAN.md`. Branch: `stage/4-auth-shell` → PR → merge.
Can run in parallel with Stage 2/3 on its own branch (different files); merge after Stage 3.

## Prerequisite (user-provided)

Google OAuth client ID + secret. If STATE.md says they're not provided yet, configure
Supabase Google provider with a placeholder flow DISABLED, ship magic-link only, and record
the exact values + console steps the user must supply (authorized redirect URI:
`https://<project-ref>.supabase.co/auth/v1/callback`). Do not block the stage on it.

## Deliverables

### 1. Auth (Supabase Auth + @supabase/ssr)
- Email magic link + Google OAuth. Server-side session handling (middleware + server
  components pattern), protected route group `(app)`, public group `(marketing)`.
- Sign-in page (both locales), post-login onboarding: pick unique display name
  (case-insensitive unique, server-validated), pick locale, optional hardcore explainer.
- Abuse protection: Supabase built-in rate limits tightened for signup/magic-link;
  display-name profanity is NOT auto-filtered (admin ban covers it — SPEC).
- `profiles` row auto-created on first login (trigger already in schema from Stage 1 —
  verify; create if missing).

### 2. App shell (mobile-first, stadium-night theme per SPEC)
- Bottom tab nav (mobile) / top nav (desktop): Challenges, Tournament (live data),
  Leaderboards, Profile. Header: logo, language switcher (en/uk, persisted), auth state.
- Challenges home: 4 challenge cards with status (open / locked / opens after groups),
  countdown to lock, join button, hardcore toggle at join, "you're in" state.
  Joining = create `challenge_entries` row (hardcore flag). Cards read real
  `challenges` rows.
- Rules page: full scoring table from SPEC.md, deadlines, redistribution explanation —
  in both locales.
- Profile page skeleton: display name, hardcore badges, locale, sign out.
- Every string via next-intl messages (en + uk). No hardcoded text — add a CI grep check
  if cheap.

### 3. Timezone handling
All kickoff displays: user local time via `Intl`, default Europe/Kyiv when unknown.
One shared `<KickoffTime>` component.

## Orchestration

Auth/session plumbing: yourself or one Opus subagent (review its diff).
UI components, locale files, Rules page content: parallel Sonnet subagents with tight specs.

## Done means

- Magic-link login works on the deployed Vercel URL (verify with a real email, e.g. a
  plus-alias; document the manual step if inbox access is needed).
- Google login works OR is cleanly disabled pending user credentials (recorded in STATE.md).
- Display-name uniqueness enforced server-side (test: second signup with same name fails).
- Both locales render the full shell; switcher persists choice across reloads.
- Joining a challenge creates an entry row; RLS verified (user A cannot read user B's entry
  hardcore flag before lock? — entries metadata may be public; predictions must not be).
- CI green, deployed, PR merged, STATE.md updated.
