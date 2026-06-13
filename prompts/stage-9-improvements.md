# Stage 9 — Post-launch improvements (LIVING BACKLOG — not final)

> This document is **continuously appended** as Anton manually tests the live app after each
> stage and reports feedback. Do NOT treat it as a fixed scope. Items get picked up by
> iterative Stage 9 sessions (the stage can run many times) or opportunistically by an
> earlier stage session when explicitly told so in its kickoff prompt.
>
> Format: each item gets a date, source, rough size, priority, and status. Sessions that
> fix an item move it to Done with the PR number.
>
> Priorities: `P0-prelock` = user-facing during the prediction window, fix before the
> main lock (2026-06-18 02:00 UTC) · `P1` = high value after lock · `P2` = nice-to-have ·
> `research` = investigate feasibility first, then re-triage.

## Backlog

### 9. Match details view — `open` · medium · research
*2026-06-13.*
Click a match (Tournament tab; maybe also in wizards) → detail view: what CAN we show?
football-data.org free tier: score, status, kickoff, matchday, referees(?), head2head(?)
— lineups/events/stats are paid (Deep Data €29/mo). Session must research what the free
match resource + `/matches/{id}/head2head` actually return for WC26, build the view from
what's real, and list what an upgrade would unlock. Possibly show *our users'* aggregate
predictions for upcoming matches (e.g. "73% of predictors picked France") — that data we
own (only for locked matches, mind RLS).

### 10. Collapsible matchday sections + clickable groups — `open` · medium · P2
*2026-06-13.*
Tournament tab: collapse/expand matchday/date sections in the schedule; make group tables
clickable → a group page with its matches, table, and whatever info we have.

### 12. Live-match indicator everywhere — `open` · small · P2
*2026-06-13.*
Schedule already has a live indicator; surface "LIVE" consistently anywhere a match
appears (group pages, wizards' locked rows, match details, challenge cards countdown
area if a relevant match is in play).

### 14. Better score input UI (hardcore steppers feel clunky) — `open` · medium · P2
*2026-06-13.*
Rework the score picker: bigger tap targets, maybe a quick numeric pad / common-score
chips (1:0, 2:1, …), fewer taps per match. Mobile-first.

### 16. External odds / model predictions on matches — `open` · large · research
*2026-06-13.*
Pull win-probability / odds for upcoming matches from external sources (Polymarket, odds
APIs, FiveThirtyEight-style models) where available and show them on match rows/details.
Research: which sources have a usable free API for WC26, licensing/ToS, and how to cache.
Show only where data exists; degrade silently otherwise.

### 17. Per-match side predictions for bonus leaderboard points — `open` · large · research + product decision
*2026-06-13.*
Idea: outside the 4 challenges, let users predict individual upcoming matches for small
extra points feeding a (new?) board. Open product questions Anton hasn't decided:
which matches qualify (today's? all upcoming? only ones with odds?), per-match lock =
kickoff (mechanism exists), where points land (separate "daily" board vs overall),
point values. Needs a product proposal FIRST (options + recommendation to Anton),
then implementation. Schema impact: likely a new prediction kind outside challenges.

### 18. Compare with / start from famous predictions — `open` · large · research
*2026-06-13.*
Surface well-known public bracket predictions (experts, supercomputer models, EA FC26
sim) inside challenges: (a) compare your picks against them, (b) optionally use one as a
starting template (same prefill mechanics as item 3) and submit as your own. Research:
which such predictions exist for WC26 in machine-readable/transcribable form; copyright
caution — facts (who advances) are fine, verbatim articles are not.

## Done

### 21. Join drops the user straight INTO the prediction flow — ✅ PR #15 (Stage 9 iter 3)
*Fixed 2026-06-13.* `joinChallenge` now redirects to `/challenges/<kind>` after the
insert (carries `kind` + `getLocale()`), instead of leaving the user on the cards page.
Verified E2E: submitting the Groups join form lands on `/en/challenges/groups`.

### 19. Submit button at the END of the flow (not only the card) — ✅ PR #15 (Stage 9 iter 3)
*Fixed 2026-06-13.* Shared `EntrySubmitControls` renders the Submit/Withdraw CTA both on
the challenge card AND at the end of every flow (Full/Groups/Fun/Playoff). Verified on the
deployed URL: "Ready to submit?" + "Submit predictions" render at the bottom of the flow.

### 20. Submit FINALIZES the entry (read-only; Withdraw, no erase) — ✅ PR #15 (Stage 9 iter 3)
*Fixed 2026-06-13.* Reverses iter-1's edit-after-submit. Migration
`20260613120000_submit_locks_predictions` adds `entry_is_submitted()` into
`can_edit_match_prediction` / `can_edit_bracket` (gen 0) + the `fun_answers` policies, so a
submitted entry rejects prediction writes server-side; redistribution (gen>0) is the sole
allowed exception. `withdrawEntry` clears `submitted_at` only (no prediction deleted),
re-opening edits for not-yet-kicked-off matches while the challenge is unlocked. Verified:
`verify:rls` 22–25 (submit→read-only, withdraw→re-open, kickoff stays locked); deployed-URL
SSR (submitted banner + Withdraw, then Submit returns after withdraw).

### 22. Bubble strip: balanced wrap, no scrollbar — ✅ PR #15 (Stage 9 iter 3)
*Fixed 2026-06-13.* Group chips → `grid grid-cols-6 sm:grid-cols-12` (balanced 6+6 on
mobile, single row from `sm`); thirds/bracket on their own row; KO round tabs →
`grid grid-cols-5`. No scrollbar at any width, no fill-then-orphan. Verified on mobile (375px)
screenshot: A–L in two even rows of 6.

### 24. Tabs reorder (Tournament first) + ICONLESS — ✅ PR #15 (Stage 9 iter 3)
*Fixed 2026-06-13.* Tournament tab moved first; every decorative lucide icon removed (nav,
cards, logo mark, champion/third, hardcore Flame, copy, leaderboards, tournament, admin gear
→ text), text wordmark top-left, `lucide-react` dependency dropped. Team flag emojis kept
(data). Verified on the deployed URL (en + uk) + mobile screenshot.

### 23. Fun challenge ranges + hardcore exact-number bonus — ✅ PR #16 (Stage 9 iter 3)
*Fixed 2026-06-13.* The 8 numeric Fun questions became ~5-bucket ranges (exact bucket full,
adjacent half); hardcore adds an optional exact number for a closeness bonus on the HARDCORE
board — giving Fun hardcore a purpose. Ranges derived from WC 2010–2022 scaled to 104
matches/48 teams (table in STATE). Migration `20260613130000_fun_ranges` adds
`fun_questions.ranges` + `fun_answers.range_index`; player picks + yes/no unchanged; existing
free-number answers grandfathered into their bucket (no-op — 0 live fun answers).

### 3. Copy predictions as a template across challenges — ✅ PR #12 (Stage 9 iter 2)
*Fixed 2026-06-13.* Pure planners `src/lib/predictions/copy.ts` (`planGroupCopy` +
`planPlayoffCopy`, 7 unit tests) + a `copyPredictions` server action on the **user's JWT**
(RLS enforces ownership + kickoff locks; never service role). **Full → Groups** copies the
72 group predictions — hardcore→casual collapses scores to outcomes, casual→hardcore skips
scoreless rows, locked/kicked-off matches skipped. **Full → Playoff** copies R32 picks only
where the predicted pairing matches reality (score re-oriented to the real home/away order);
wired but UI-gated on the Playoff challenge opening (post-groups, untestable until then).
`CopyFromFull` button on the target challenge card (confirm + "copied N / skipped …" toast).
A copied entry stays a **draft** until submitted (iter-1 gate intact). Verified: RLS
write-path proven on a throwaway user (Full→Groups lands 68 rows; a finished match write
refused 42501), copy button renders on the Groups card en + uk.

### 8. Drop the landing page — root goes straight to Tournament — ✅ PR #12 (Stage 9 iter 2)
*Fixed 2026-06-13.* `/[locale]` redirects to the public Tournament tab;
`HeroSection`/`ChallengesSection` removed; sign-in kept. Verified live: `/en` → `/en/tournament`.

### 11. Rich "view another user's predictions" UI — ✅ PR #12 (Stage 9 iter 2)
*Fixed 2026-06-13.* Read-only graphical **predicted bracket** on the profile
(`ProfileBracket` reuses `BracketView` results mode), under a "Predicted bracket" disclosure
for Full entries. RLS-scoped: complete on your own profile (verified — renders the derived
R32 with match cards), fills in for others once their picks unlock (no pre-lock value by
design, as noted).

### 15. Branding: real logo + drop decorative emojis — ✅ PR #12 (Stage 9 iter 2)
*Fixed 2026-06-13.* Real SVG football mark (`Brand`) + wordmark in the header; lucide icons
replace the decorative emojis (challenge cards 🏆📊⚔️🎲 → Trophy/LayoutGrid/Swords/Dices;
tab bar → Target/Goal/Medal/CircleUser; admin gear → Settings; hardcore 🔥 → Flame;
champion/third 🏆🥉 → Trophy/Medal; tournament 🗓️ → CalendarDays; board labels). 🔥 stripped
from message strings. **Team flag emojis stay** (data). Verified live (mobile, public
Tournament): logo + tab icons render, flags intact.

### 4. Explicit Submit + completion state; "70/72" reads as a bug — ✅ PR #11 (Stage 9 iter 1)
*Fixed 2026-06-13.* Root cause of the "70/72" confusion: the counter denominator
included the 2 (now 4) group matches that kicked off before the user joined — permanently
unpredictable, so it can never reach 72. **Fix:** new `submitted_at timestamptz` on
`challenge_entries` (migration `20260613000000_submit_gating`, user-settable while unlocked
via the existing entries_update RLS, **all existing entries grandfathered to `now()`**);
`leaderboard_totals`/`leaderboard_entry_rows` filter `submitted_at is not null` so only
submitted entries rank. Challenge cards now show honest completion — "Groups 68/68 ✓
(4 locked before you joined)", "Bracket N/32 · Champion: X", "Answered N/12" — plus an
explicit **Submit** button (warns "N picks missing — they'll score 0"; allowed anyway)
that becomes **Edit predictions** + a "Submitted" badge after submitting; submitted stays
submitted across edits. Pure helper `src/lib/predictions/completion.ts` (unit-tested).
Verified on prod: migration grandfathered 3/3 entries (still on boards); 25/25 RLS checks
pass incl. submit-gated board visibility; UI confirmed via throwaway user — card showed
"68/68 ✓ (4 locked)", Submit → SUBMITTED + Edit predictions, DB gate flipped the user onto
the board only after submit (throwaway user cleaned up).

### 5. Group stepper bubbles overflow on small screens — ✅ PR #11 (Stage 9 iter 1)
*Fixed 2026-06-13.* The A–L strip used `overflow-x-auto` (horizontal scrollbar on narrow
screens). Changed `PredictionFlow` nav to `flex flex-wrap` (chips already `shrink-0`), so
it wraps to multiple rows. Verified visually — bubbles wrap and keep their ✓ completion.

### 6. Knockout round bubbles don't show completion — ✅ PR #11 (Stage 9 iter 1)
*Fixed 2026-06-13.* `BracketView` round tabs (R32/R16/QF/SF/F) now compute completion
(`every match in the round has a winner`) and render green + " ✓" exactly like the group
bubbles. Shared by Full + Playoff (both use `BracketView`). Round tab row also `flex-wrap`.

### 7. Leaderboard sub-tab switching is very slow — ✅ PR #11 (Stage 9 iter 1)
*Fixed 2026-06-13.* Each board switch was a full server navigation with ~4 sequential
queries per board. **Fix:** new `fetchAllBoards()` loads every board (overall + 4
challenges × global/hardcore) in ~5 queries total (shared movement baseline, one
`leaderboard_ranked` + one `leaderboard_overall_ranked` sweep); the page hands the whole
payload to a client `LeaderboardsBrowser` that switches tab/board purely in state (no
navigation, no refetch) and syncs the URL via `history.replaceState`. SSR + deep-linking
verified (`?c=full&b=global` renders the right board with movement badges and the
"your position" card). Interactivity follows the same useState/onClick pattern as the live
PredictionFlow; final confirmation on the deployed URL post-merge.

### 13. Knockout copy: "90-minute score" wording is misleading — ✅ PR #11 (Stage 9 iter 1)
*Fixed 2026-06-13.* Mechanic unchanged (predict regulation-time result; on a draw pick who
advances — covers ET/pens). Reworded `Predict.bracket.scoreHint`/`pickHint` in both
locales to be precise: "Predict the score after 90 minutes (regulation time). If it's a
draw, also pick who goes through on extra time / penalties." Covers Full + Playoff.

### 1. Pointer cursor missing on clickable elements — ✅ Stage 6 PR
*2026-06-13, manual testing after Stage 5. Fixed 2026-06-12 (Stage 6 session).*
Root cause confirmed: Tailwind v4 preflight sets `button { cursor: default }`. Fixed with
the proposed base-layer rule in `globals.css`
(`button:not(:disabled), [role="button"]:not([aria-disabled="true"]) { cursor: pointer; }`);
verified computed `cursor: pointer` in the browser.

### 2. Tab/page switching feels slow — ✅ Stage 6 PR (skeletons + prefetch)
*2026-06-13, manual testing after Stage 5. Fixed 2026-06-12 (Stage 6 session).*
Shipped the two top bang-for-buck candidates: `loading.tsx` skeletons (shared
`<Skeleton>`) for every top-level route (challenges, challenges/[kind], tournament,
leaderboards, profile, profile/[userId]) → instant visual response on nav; explicit
`prefetch` on the tab-bar links. Remaining candidates (revalidate caching for public
read-only data, query fan-out reduction) folded into item 7.
