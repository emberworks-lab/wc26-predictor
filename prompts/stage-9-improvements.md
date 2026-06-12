# Stage 9 — Post-launch improvements (LIVING BACKLOG — not final)

> This document is **continuously appended** as Anton manually tests the live app after each
> stage and reports feedback. Do NOT treat it as a fixed scope. Items get picked up either
> by a dedicated Stage 9 session (after Stage 8) or opportunistically by an earlier stage
> session when explicitly told so in its kickoff prompt.
>
> Format: each item gets a date, source, rough size, and status. Sessions that fix an item
> mark it ✅ with the PR number.

## Backlog

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
read-only data, query fan-out reduction) stay open for Stage 9 if still felt.
