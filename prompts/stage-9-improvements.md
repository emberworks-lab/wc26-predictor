# Stage 9 — Post-launch improvements (LIVING BACKLOG — not final)

> This document is **continuously appended** as Anton manually tests the live app after each
> stage and reports feedback. Do NOT treat it as a fixed scope. Items get picked up either
> by a dedicated Stage 9 session (after Stage 8) or opportunistically by an earlier stage
> session when explicitly told so in its kickoff prompt.
>
> Format: each item gets a date, source, rough size, and status. Sessions that fix an item
> mark it ✅ with the PR number.

## Backlog

### 1. Pointer cursor missing on clickable elements — `open` · small
*2026-06-13, manual testing after Stage 5.*
Hovering buttons/clickable cards does not show the pointer (finger) cursor.
Likely root cause: Tailwind v4 preflight changed `button` default to `cursor: default`.
Fix candidate: base-layer CSS in `globals.css` (`button:not(:disabled), [role="button"]:not([aria-disabled="true"]) { cursor: pointer; }`)
plus an audit of clickable divs/cards that should be real buttons anyway.

### 2. Tab/page switching feels slow (Tournament ↔ Challenges ↔ etc.) — `open` · medium
*2026-06-13, manual testing after Stage 5.*
Navigation between main sections takes noticeably long.
Investigate: every nav is an RSC roundtrip with fresh DB queries and no visual feedback.
Fix candidates (in order of bang-for-buck): `loading.tsx` skeletons for every top-level
route (instant visual response), `<Link prefetch>` on the tab bar, caching/`revalidate`
for public read-only data (tournament tab, challenge cards), reducing per-page query
fan-out. Measure before/after on a mobile viewport.

### 3. Copy predictions as a template across challenges — `open` · large
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

## Done

(nothing yet)
