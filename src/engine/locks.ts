/**
 * Deadline / lock logic (SPEC.md → "Deadlines & locking").
 *
 * Pure over an injected `now`. The server (RLS + API validation) is the
 * enforcement point; this module is the single source of truth for the rules:
 *
 *  - Full / Groups / Fun lock at kickoff of the LAST matchday-1 group match.
 *  - Any match that has kicked off is locked for everyone, immediately.
 *  - Playoff opens when the group stage completes, locks at first R32 kickoff.
 *  - Knockout picks inside Full follow the Full challenge lock.
 *  - Admin manual override ('OPEN' / 'LOCKED') wins over the time rules.
 *
 * Boundary convention: a thing locks AT its timestamp — `now >= t` is locked.
 */

export type ManualLockState = 'OPEN' | 'LOCKED' | null | undefined;

export interface LockableMatch {
  kickoffUtc: Date | string;
}

export interface ChallengeLockState {
  /** Editing locks at this instant (e.g. last matchday-1 kickoff). */
  locksAtUtc?: Date | string | null;
  /** Editing opens at this instant (Playoff); absent = open from the start. */
  opensAtUtc?: Date | string | null;
  /** Admin override; wins over both timestamps. */
  manualState?: ManualLockState;
}

const toMs = (d: Date | string): number => (d instanceof Date ? d.getTime() : Date.parse(d));

/** A match is locked from its kickoff onward (kickoff instant inclusive). */
export function isMatchLocked(match: LockableMatch, now: Date): boolean {
  return now.getTime() >= toMs(match.kickoffUtc);
}

export function isChallengeOpen(challenge: ChallengeLockState, now: Date): boolean {
  if (challenge.manualState === 'OPEN') return true;
  if (challenge.manualState === 'LOCKED') return false;
  const t = now.getTime();
  if (challenge.opensAtUtc != null && t < toMs(challenge.opensAtUtc)) return false;
  if (challenge.locksAtUtc != null && t >= toMs(challenge.locksAtUtc)) return false;
  return true;
}

export function isChallengeLocked(challenge: ChallengeLockState, now: Date): boolean {
  return !isChallengeOpen(challenge, now);
}

/**
 * Full/Groups/Fun lock time = kickoff of the LAST first-round (matchday 1)
 * group match. Throws if no matchday-1 matches are supplied.
 */
export function fullChallengeLockTime(
  matches: ReadonlyArray<{ kickoffUtc: Date | string; matchday: number }>,
): Date {
  const md1 = matches.filter((m) => m.matchday === 1);
  if (md1.length === 0) {
    throw new Error('fullChallengeLockTime: no matchday-1 matches supplied');
  }
  return new Date(Math.max(...md1.map((m) => toMs(m.kickoffUtc))));
}

/**
 * Playoff window: opens when the group stage is complete (the moment the
 * last group result is in — an event, supplied as a timestamp or null while
 * unknown), locks at the first R32 kickoff.
 */
export function playoffLockState(args: {
  groupStageCompletedAtUtc: Date | string | null;
  firstR32KickoffUtc: Date | string | null;
  manualState?: ManualLockState;
}): ChallengeLockState {
  return {
    // While the group stage is unfinished the challenge is not yet open: a
    // null completion time maps to an opens-at of +infinity.
    opensAtUtc:
      args.groupStageCompletedAtUtc ?? new Date(8640000000000000 /* max valid Date */),
    locksAtUtc: args.firstR32KickoffUtc,
    manualState: args.manualState,
  };
}

export type EditDenialReason = 'CHALLENGE_NOT_OPEN' | 'CHALLENGE_LOCKED' | 'MATCH_LOCKED';

export interface CanEditArgs {
  challenge: ChallengeLockState;
  /** The match the prediction targets, when match-level locking applies. */
  match?: LockableMatch;
}

/**
 * A prediction is editable while its challenge is open AND its target match
 * (if any) has not kicked off. Late joiners simply find kicked-off matches
 * locked (they score 0 on those).
 */
export function canEditPrediction(
  args: CanEditArgs,
  now: Date,
): { allowed: boolean; reason?: EditDenialReason } {
  const t = now.getTime();
  if (args.challenge.manualState === 'LOCKED') {
    return { allowed: false, reason: 'CHALLENGE_LOCKED' };
  }
  if (args.challenge.manualState !== 'OPEN') {
    if (args.challenge.opensAtUtc != null && t < toMs(args.challenge.opensAtUtc)) {
      return { allowed: false, reason: 'CHALLENGE_NOT_OPEN' };
    }
    if (args.challenge.locksAtUtc != null && t >= toMs(args.challenge.locksAtUtc)) {
      return { allowed: false, reason: 'CHALLENGE_LOCKED' };
    }
  }
  // Match kickoff locks for everyone — even under a manual 'OPEN' override
  // (anti-cheat: a started match is never editable).
  if (args.match && isMatchLocked(args.match, now)) {
    return { allowed: false, reason: 'MATCH_LOCKED' };
  }
  return { allowed: true };
}
