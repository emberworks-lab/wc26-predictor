import { describe, expect, it } from 'vitest';

import matchesSample from './fixtures/matches.sample.json';
import scorersSample from './fixtures/scorers.sample.json';
import { extractTeams, groupCodeOf, mapMatch, mapScorer } from './mappers';
import type { ApiMatch, ApiMatchesResponse, ApiScorersResponse } from './types';

const matches = (matchesSample as ApiMatchesResponse).matches;
const byId = (id: number) => matches.find((m) => m.id === id)!;

// Recorded fixture contents (see fixtures/matches.sample.json):
// 537327 — finished group match, Mexico 2-0 South Africa (the real opener)
// 537328 — timed group match, South Korea vs Czechia
// plus one unresolved LAST_32 match and the FINAL.

describe('groupCodeOf', () => {
  it('extracts the letter from GROUP_X', () => {
    expect(groupCodeOf('GROUP_A')).toBe('A');
    expect(groupCodeOf('GROUP_L')).toBe('L');
  });

  it('returns null for knockout / malformed groups', () => {
    expect(groupCodeOf(null)).toBeNull();
    expect(groupCodeOf('GROUP_M')).toBeNull();
    expect(groupCodeOf('Group A')).toBeNull();
  });
});

describe('mapMatch — recorded fixtures', () => {
  it('maps a finished group match with scores and winner', () => {
    const row = mapMatch(byId(537327));
    expect(row).toMatchObject({
      api_id: 537327,
      stage: 'group',
      group_code: 'A',
      matchday: 1,
      kickoff_utc: '2026-06-11T19:00:00Z',
      status: 'finished',
      home_team_api_id: 769,
      away_team_api_id: 774,
      home_score: 2,
      away_score: 0,
      home_score_et: null,
      away_score_et: null,
      home_pens: null,
      away_pens: null,
      winner_team_api_id: 769,
    });
  });

  it('maps a timed (not yet played) match with null scores', () => {
    const row = mapMatch(byId(537328));
    expect(row.status).toBe('timed');
    expect(row.home_score).toBeNull();
    expect(row.away_score).toBeNull();
    expect(row.winner_team_api_id).toBeNull();
  });

  it('maps an unresolved knockout match (null teams, r32 stage)', () => {
    const r32 = matches.find((m) => m.stage === 'LAST_32')!;
    const row = mapMatch(r32);
    expect(row.stage).toBe('r32');
    expect(row.group_code).toBeNull();
    expect(row.home_team_api_id).toBeNull();
    expect(row.away_team_api_id).toBeNull();
  });

  it('maps the final to the final stage', () => {
    const final = matches.find((m) => m.stage === 'FINAL')!;
    expect(mapMatch(final).stage).toBe('final');
  });
});

describe('mapMatch — extra time and penalties', () => {
  // Synthetic, but shaped exactly like the provider's documented v4 payload
  // for a shootout (e.g. the WC2022 final): fullTime = after 120',
  // regularTime = 90' score, penalties = shootout.
  const shootout: ApiMatch = {
    id: 999001,
    utcDate: '2026-07-19T19:00:00Z',
    status: 'FINISHED',
    matchday: null,
    stage: 'FINAL',
    group: null,
    lastUpdated: '2026-07-19T22:00:00Z',
    homeTeam: { id: 762, name: 'Argentina', shortName: 'Argentina', tla: 'ARG', crest: null },
    awayTeam: { id: 773, name: 'France', shortName: 'France', tla: 'FRA', crest: null },
    score: {
      winner: 'HOME_TEAM',
      duration: 'PENALTY_SHOOTOUT',
      fullTime: { home: 3, away: 3 },
      halfTime: { home: 2, away: 0 },
      regularTime: { home: 2, away: 2 },
      extraTime: { home: 1, away: 1 },
      penalties: { home: 4, away: 2 },
    },
  };

  it('splits 90-minute, after-ET and shootout scores into their columns', () => {
    const row = mapMatch(shootout);
    expect(row.home_score).toBe(2);
    expect(row.away_score).toBe(2);
    expect(row.home_score_et).toBe(3);
    expect(row.away_score_et).toBe(3);
    expect(row.home_pens).toBe(4);
    expect(row.away_pens).toBe(2);
    expect(row.winner_team_api_id).toBe(762);
  });

  it('treats an extra-time win (no shootout) the same way, without pens', () => {
    const et: ApiMatch = {
      ...shootout,
      score: {
        winner: 'AWAY_TEAM',
        duration: 'EXTRA_TIME',
        fullTime: { home: 1, away: 2 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 0, away: 1 },
      },
    };
    const row = mapMatch(et);
    expect(row.home_score).toBe(1);
    expect(row.away_score).toBe(1);
    expect(row.home_score_et).toBe(1);
    expect(row.away_score_et).toBe(2);
    expect(row.home_pens).toBeNull();
    expect(row.winner_team_api_id).toBe(773);
  });
});

describe('extractTeams', () => {
  it('derives teams with groups from group fixtures, skipping knockout', () => {
    const teams = extractTeams(matches);
    // The sample holds 2 group matches in Group A → 4 distinct teams.
    expect(teams).toHaveLength(4);
    const mexico = teams.find((t) => t.fifa_code === 'MEX')!;
    expect(mexico).toMatchObject({
      api_id: 769,
      name: 'Mexico',
      group_code: 'A',
      flag_emoji: '🇲🇽',
    });
  });

  it('falls back to the white flag for unknown TLAs', () => {
    const weird: ApiMatch = {
      ...byId(537327),
      homeTeam: { id: 1, name: 'Atlantis', shortName: 'ATL', tla: 'ATL', crest: null },
    };
    const teams = extractTeams([weird]);
    expect(teams.find((t) => t.fifa_code === 'ATL')!.flag_emoji).toBe('🏳️');
  });
});

describe('mapScorer — recorded fixture', () => {
  it('maps player, team api id and counters', () => {
    const rows = (scorersSample as ApiScorersResponse).scorers.map(mapScorer);
    expect(rows[0]).toEqual({
      player_name: 'Julián Quiñones',
      team_api_id: 769,
      goals: 1,
      assists: null,
      penalties: null,
    });
    expect(rows).toHaveLength(2);
  });
});
