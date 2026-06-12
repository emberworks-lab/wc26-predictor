import { describe, expect, it } from 'vitest';

import { compareEntries, type LeaderboardEntry } from './leaderboard';

const entry = (overrides: Partial<LeaderboardEntry>): LeaderboardEntry => ({
  points: 100,
  correctQualifiers: 10,
  correctKoPicks: 5,
  correctOutcomes: 20,
  createdAtUtc: '2026-06-01T00:00:00Z',
  ...overrides,
});

describe('compareEntries — SPEC tiebreaker chain', () => {
  it('orders by points first', () => {
    const a = entry({ points: 101, correctQualifiers: 0 });
    const b = entry({ points: 100, correctQualifiers: 99 });
    expect([b, a].sort(compareEntries)[0]).toBe(a);
  });

  it('1. more correct qualifiers wins on equal points', () => {
    const a = entry({ correctQualifiers: 11, correctKoPicks: 0 });
    const b = entry({ correctQualifiers: 10, correctKoPicks: 99 });
    expect([b, a].sort(compareEntries)[0]).toBe(a);
  });

  it('2. more correct knockout picks wins next', () => {
    const a = entry({ correctKoPicks: 6, correctOutcomes: 0 });
    const b = entry({ correctKoPicks: 5, correctOutcomes: 99 });
    expect([b, a].sort(compareEntries)[0]).toBe(a);
  });

  it('3. more correct group outcomes wins next', () => {
    const a = entry({ correctOutcomes: 21 });
    const b = entry({ correctOutcomes: 20 });
    expect([b, a].sort(compareEntries)[0]).toBe(a);
  });

  it('4. earlier registration wins last', () => {
    const early = entry({ createdAtUtc: '2026-05-01T00:00:00Z' });
    const late = entry({ createdAtUtc: '2026-06-01T00:00:00Z' });
    expect([late, early].sort(compareEntries)[0]).toBe(early);
  });

  it('returns 0 for fully identical entries (stable sort keeps insertion order)', () => {
    expect(compareEntries(entry({}), entry({}))).toBe(0);
  });

  it('sorts a realistic mixed field correctly', () => {
    const a = entry({ points: 90 });
    const b = entry({ points: 120, correctQualifiers: 5 });
    const c = entry({ points: 120, correctQualifiers: 8 });
    const d = entry({ points: 120, correctQualifiers: 8, correctKoPicks: 9 });
    expect([a, b, c, d].sort(compareEntries)).toEqual([d, c, b, a]);
  });
});
