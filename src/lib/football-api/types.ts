/**
 * football-data.org v4 response types — only the fields we consume.
 * Provider decided in Stage 0 (STATE.md → Decisions): competition `WC` (id 2000),
 * free tier, auth header `X-Auth-Token`, 10 req/min.
 */

export type ApiStage =
  | 'GROUP_STAGE'
  | 'LAST_32'
  | 'LAST_16'
  | 'QUARTER_FINALS'
  | 'SEMI_FINALS'
  | 'THIRD_PLACE'
  | 'FINAL';

export type ApiMatchStatus =
  | 'SCHEDULED'
  | 'TIMED'
  | 'IN_PLAY'
  | 'PAUSED'
  | 'FINISHED'
  | 'SUSPENDED'
  | 'POSTPONED'
  | 'CANCELLED'
  | 'AWARDED';

export type ApiDuration = 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';

export type ApiWinner = 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;

/** Team ref inside a match; all-null for unresolved knockout slots. */
export interface ApiTeamRef {
  id: number | null;
  name: string | null;
  shortName: string | null;
  tla: string | null;
  crest: string | null;
}

export interface ApiScorePair {
  home: number | null;
  away: number | null;
}

export interface ApiScore {
  winner: ApiWinner;
  duration: ApiDuration;
  /** Final score after 90' or 120' (excludes the shootout). */
  fullTime: ApiScorePair;
  halfTime?: ApiScorePair;
  /** Present when the match went beyond 90'. */
  regularTime?: ApiScorePair;
  /** Goals scored during extra time only. */
  extraTime?: ApiScorePair;
  /** Shootout score. */
  penalties?: ApiScorePair;
}

export interface ApiMatch {
  id: number;
  utcDate: string;
  status: ApiMatchStatus;
  matchday: number | null;
  stage: ApiStage;
  /** e.g. "GROUP_A"; null for knockout. */
  group: string | null;
  lastUpdated: string;
  homeTeam: ApiTeamRef;
  awayTeam: ApiTeamRef;
  score: ApiScore;
}

export interface ApiMatchesResponse {
  resultSet: { count: number; played: number };
  matches: ApiMatch[];
}

export interface ApiStandingsTableRow {
  position: number;
  team: ApiTeamRef;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface ApiStandingsResponse {
  standings: Array<{
    stage: string;
    type: string;
    /** e.g. "Group A". */
    group: string | null;
    table: ApiStandingsTableRow[];
  }>;
}

export interface ApiScorer {
  player: { id: number; name: string };
  team: ApiTeamRef;
  playedMatches?: number;
  goals: number | null;
  assists: number | null;
  penalties: number | null;
}

export interface ApiScorersResponse {
  count: number;
  scorers: ApiScorer[];
}
