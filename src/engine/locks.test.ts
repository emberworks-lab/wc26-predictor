import { describe, expect, it } from 'vitest';

import {
  canEditPrediction,
  fullChallengeLockTime,
  isChallengeLocked,
  isChallengeOpen,
  isMatchLocked,
  playoffLockState,
} from './locks';

const T = (iso: string): Date => new Date(iso);

describe('isMatchLocked', () => {
  const match = { kickoffUtc: '2026-06-13T18:00:00Z' };

  it('is unlocked strictly before kickoff', () => {
    expect(isMatchLocked(match, T('2026-06-13T17:59:59.999Z'))).toBe(false);
  });
  it('locks exactly AT kickoff (boundary, inclusive)', () => {
    expect(isMatchLocked(match, T('2026-06-13T18:00:00Z'))).toBe(true);
  });
  it('stays locked after kickoff', () => {
    expect(isMatchLocked(match, T('2026-07-01T00:00:00Z'))).toBe(true);
  });
  it('accepts Date objects for kickoff', () => {
    expect(isMatchLocked({ kickoffUtc: T('2026-06-13T18:00:00Z') }, T('2026-06-13T18:00:00Z'))).toBe(true);
  });
});

describe('fullChallengeLockTime', () => {
  it('returns the kickoff of the LAST matchday-1 group match', () => {
    const lock = fullChallengeLockTime([
      { kickoffUtc: '2026-06-11T19:00:00Z', matchday: 1 },
      { kickoffUtc: '2026-06-13T02:00:00Z', matchday: 1 }, // last of matchday 1
      { kickoffUtc: '2026-06-12T22:00:00Z', matchday: 1 },
      { kickoffUtc: '2026-06-18T22:00:00Z', matchday: 2 }, // ignored
      { kickoffUtc: '2026-06-24T22:00:00Z', matchday: 3 }, // ignored
    ]);
    expect(lock.toISOString()).toBe('2026-06-13T02:00:00.000Z');
  });

  it('throws when no matchday-1 matches are present', () => {
    expect(() => fullChallengeLockTime([{ kickoffUtc: '2026-06-18T22:00:00Z', matchday: 2 }]))
      .toThrow(/matchday-1/);
  });
});

describe('isChallengeOpen / isChallengeLocked', () => {
  const challenge = { locksAtUtc: '2026-06-13T02:00:00Z' };

  it('open before the lock instant, locked from it onward', () => {
    expect(isChallengeOpen(challenge, T('2026-06-13T01:59:59Z'))).toBe(true);
    expect(isChallengeLocked(challenge, T('2026-06-13T02:00:00Z'))).toBe(true);
  });

  it('respects opensAt for challenges that open later (Playoff)', () => {
    const playoff = {
      opensAtUtc: '2026-06-27T22:00:00Z',
      locksAtUtc: '2026-06-28T18:00:00Z',
    };
    expect(isChallengeOpen(playoff, T('2026-06-20T00:00:00Z'))).toBe(false);
    expect(isChallengeOpen(playoff, T('2026-06-27T22:00:00Z'))).toBe(true);
    expect(isChallengeOpen(playoff, T('2026-06-28T18:00:00Z'))).toBe(false);
  });

  it('manual admin override wins over the timestamps in both directions', () => {
    expect(isChallengeOpen({ ...challenge, manualState: 'OPEN' }, T('2026-07-01T00:00:00Z'))).toBe(true);
    expect(isChallengeOpen({ ...challenge, manualState: 'LOCKED' }, T('2026-06-01T00:00:00Z'))).toBe(false);
  });
});

describe('playoffLockState', () => {
  it('is closed while the group stage is unfinished', () => {
    const state = playoffLockState({
      groupStageCompletedAtUtc: null,
      firstR32KickoffUtc: '2026-06-28T18:00:00Z',
    });
    expect(isChallengeOpen(state, T('2026-06-27T00:00:00Z'))).toBe(false);
  });

  it('opens at group-stage completion, locks at first R32 kickoff', () => {
    const state = playoffLockState({
      groupStageCompletedAtUtc: '2026-06-27T23:30:00Z',
      firstR32KickoffUtc: '2026-06-28T18:00:00Z',
    });
    expect(isChallengeOpen(state, T('2026-06-27T23:29:00Z'))).toBe(false);
    expect(isChallengeOpen(state, T('2026-06-27T23:30:00Z'))).toBe(true);
    expect(isChallengeOpen(state, T('2026-06-28T17:59:59Z'))).toBe(true);
    expect(isChallengeOpen(state, T('2026-06-28T18:00:00Z'))).toBe(false);
  });
});

describe('canEditPrediction', () => {
  const challenge = { locksAtUtc: '2026-06-13T02:00:00Z' };
  const match = { kickoffUtc: '2026-06-12T22:00:00Z' };

  it('allows editing while the challenge is open and the match has not kicked off', () => {
    expect(canEditPrediction({ challenge, match }, T('2026-06-12T12:00:00Z'))).toEqual({
      allowed: true,
    });
  });

  it('blocks a kicked-off match even though the challenge is still open (late joiner)', () => {
    expect(canEditPrediction({ challenge, match }, T('2026-06-12T22:00:00Z'))).toEqual({
      allowed: false,
      reason: 'MATCH_LOCKED',
    });
  });

  it('blocks everything once the challenge locks', () => {
    expect(
      canEditPrediction(
        { challenge, match: { kickoffUtc: '2026-06-20T00:00:00Z' } },
        T('2026-06-13T02:00:00Z'),
      ),
    ).toEqual({ allowed: false, reason: 'CHALLENGE_LOCKED' });
  });

  it('reports CHALLENGE_NOT_OPEN before a Playoff opens', () => {
    const playoff = playoffLockState({
      groupStageCompletedAtUtc: null,
      firstR32KickoffUtc: null,
    });
    expect(canEditPrediction({ challenge: playoff }, T('2026-06-20T00:00:00Z'))).toEqual({
      allowed: false,
      reason: 'CHALLENGE_NOT_OPEN',
    });
  });

  it('works without a target match (challenge-level edits, e.g. fun answers)', () => {
    expect(canEditPrediction({ challenge }, T('2026-06-12T12:00:00Z'))).toEqual({
      allowed: true,
    });
  });

  it('manual OPEN override unlocks the challenge but never a kicked-off match', () => {
    const overridden = { ...challenge, manualState: 'OPEN' as const };
    expect(canEditPrediction({ challenge: overridden }, T('2026-07-01T00:00:00Z'))).toEqual({
      allowed: true,
    });
    expect(
      canEditPrediction({ challenge: overridden, match }, T('2026-07-01T00:00:00Z')),
    ).toEqual({ allowed: false, reason: 'MATCH_LOCKED' });
  });

  it('manual LOCKED override blocks even before the deadline', () => {
    expect(
      canEditPrediction(
        { challenge: { ...challenge, manualState: 'LOCKED' as const } },
        T('2026-06-01T00:00:00Z'),
      ),
    ).toEqual({ allowed: false, reason: 'CHALLENGE_LOCKED' });
  });
});
