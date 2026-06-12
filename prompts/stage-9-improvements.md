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

### 4. Explicit Submit + completion state; "70/72" reads as a bug — `open` · medium · P0-prelock
*2026-06-13, manual testing after Stage 6; submit requirement confirmed by Anton.*
Anton finished the ENTIRE Full prediction (all groups + whole bracket incl. final and
third-place) and the card still says "70 / 72 picks" with no submit button — he concluded
his final/3rd-place picks didn't save. Almost certainly they DID (autosave on click;
70/72 = 72 group matches minus the 2 group-A matches locked before he joined), but:
- VERIFY first against prod data that his bracket rows (incl. final + third place) exist.
- Counter must not count permanently-locked matches against the user: show "70/70" or
  "70/70 available (2 locked)".
- The challenge card should reflect BOTH parts: group picks AND bracket completion
  ("Bracket: 32/32 ✓ Champion: X").
- **Product requirement (Anton): an explicit Submit button per challenge — only after
  submitting does the entry participate in the leaderboard.** After submit the button
  becomes "Edit predictions" (re-opens editing until the challenge lock; resubmit not
  required after every edit — submitted stays submitted). Autosave behavior stays as the
  draft mechanism underneath.
  Implementation notes: `submitted_at timestamptz` on `challenge_entries` (user-settable
  while unlocked, RLS-guarded); leaderboard views filter `submitted_at is not null`;
  **migration must grandfather all entries existing at migration time (set
  `submitted_at = now()`)** so current real users don't vanish from the boards; Submit is
  allowed even with incomplete picks (warn: "N picks missing — they'll score 0").
  Post-group-stage knockout re-picks (redistribution with falling multiplier) are NOT
  part of this item — that mechanic exists per SPEC and ships in Stage 7.

### 5. Group stepper bubbles overflow on small screens — `open` · small · P0-prelock
*2026-06-13, manual testing after Stage 6.*
The A–L group bubbles strip is a single row; on narrow viewports it grows a horizontal
scrollbar. Make it wrap into multiple rows (flex-wrap) on small screens.

### 6. Knockout round bubbles don't show completion — `open` · small · P0-prelock
*2026-06-13, manual testing after Stage 6.*
In the Full knockout picker (and presumably the Playoff challenge, which reuses it), the
round tabs/bubbles (R32/R16/QF/SF/F) don't turn green/checked when every match of the
round is predicted — unlike the group bubbles. Add the same completed state.

### 7. Leaderboard sub-tab switching is very slow — `open` · medium · P0-prelock
*2026-06-13, manual testing after Stage 6.*
Top-level nav got faster (Stage 6 skeletons+prefetch), but switching BETWEEN leaderboards
(challenge tabs, Global/Hardcore) feels dead slow — "no cache, no prefetch" feeling.
Fix candidates: make board switching client-side over preloaded data (fetch all boards in
one query/payload — N is small), or prefetch sibling tabs + `revalidate` caching for the
ranked views, or both. Measure before/after.

### 3. Copy predictions as a template across challenges — `open` · large · P1
*2026-06-13, feature idea after Stage 5.*
A user who completed the Full Tournament challenge should be able to one-click copy those
predictions into the **Groups** challenge (and later into **Playoff** when it opens) as a
*template*: the target challenge gets prefilled with the Full data, the user can then edit
freely and submit (or submit as-is immediately).
Design notes:
- Copy is a one-time prefill action, NOT a live link — after copying, the entries are
  fully independent.
- Groups: copy the 72 group-match predictions (respecting locked matches — skip those).
- Playoff (only after it opens with the real bracket): copy only where the user's
  predicted R32 pairing matches the real pairing; leave mismatched slots empty.
- Hardcore mismatch between source and target entry: hardcore→casual collapses scores to
  outcomes; casual→hardcore can only prefill outcomes (scores still needed manually).
- Server action with the same lock validation as normal saves; copying must never bypass
  kickoff locks (RLS already guarantees this — keep the action on the user's JWT, not
  service role).

### 8. Drop the landing page — root goes straight to Tournament — `open` · small · P1
*2026-06-13.*
The marketing landing adds no value for a friends app. Redirect `/` (per locale) to the
Tournament tab (public). Logged-out users see the public tabs; auth-gated areas show a
sign-in CTA instead of content. Keep the sign-in page itself.

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

### 11. Rich "view another user's predictions" UI — `open` · medium · P1
*2026-06-13.*
Leaderboard → user → today it's a breakdown table. Wanted: a graphical view of their
predictions (their bracket rendered as a bracket, their group picks vs reality), so
friends can compare. RLS already only exposes locked predictions — purely a UI task
(reuse BracketView read-only mode + wizard read-only mode pointed at another entry).

### 12. Live-match indicator everywhere — `open` · small · P2
*2026-06-13.*
Schedule already has a live indicator; surface "LIVE" consistently anywhere a match
appears (group pages, wizards' locked rows, match details, challenge cards countdown
area if a relevant match is in play).

### 13. Knockout copy: "90-minute score" wording is misleading — `open` · small · P0-prelock (copy only)
*2026-06-13.*
UI says you predict the 90' result; Anton expected "90 + extra time". The MECHANIC stays
as is (predict regulation-time result; on a draw pick who advances — covers ET+pens);
changing scoring semantics mid-tournament after entries exist is forbidden. Fix the COPY
in both locales to explain precisely: "score after 90 minutes; if a draw, also pick who
goes through (extra time / penalties)".

### 14. Better score input UI (hardcore steppers feel clunky) — `open` · medium · P2
*2026-06-13.*
Rework the score picker: bigger tap targets, maybe a quick numeric pad / common-score
chips (1:0, 2:1, …), fewer taps per match. Mobile-first.

### 15. Branding: real logo + drop decorative emojis — `open` · medium · P2
*2026-06-13.*
Add a proper mark (ball/trophy SVG) top-left; replace decorative UI emojis (🏆📊⚔️🎲 on
challenge cards etc.) with consistent SVG icons (e.g. lucide). Team FLAG emojis stay —
they're data, not decoration. Goal: stop looking vibe-coded.

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
