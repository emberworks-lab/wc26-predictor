/**
 * football-data.org response → DB row mappers.
 *
 * Mappers output rows keyed by provider api ids; resolving api ids to DB
 * foreign keys happens at write time (seed script / sync function), so these
 * stay pure and unit-testable against recorded JSON fixtures.
 */

import { flagForTla } from './flags';
import type { ApiMatch, ApiMatchStatus, ApiScorer, ApiStage } from './types';

// DB enum values (matches `match_stage` / `match_status` in the schema).
export type DbMatchStage =
  | 'group'
  | 'r32'
  | 'r16'
  | 'qf'
  | 'sf'
  | 'third_place'
  | 'final';

export type DbMatchStatus =
  | 'scheduled'
  | 'timed'
  | 'in_play'
  | 'paused'
  | 'finished'
  | 'suspended'
  | 'postponed'
  | 'cancelled'
  | 'awarded';

export const STAGE_MAP: Readonly<Record<ApiStage, DbMatchStage>> = {
  GROUP_STAGE: 'group',
  LAST_32: 'r32',
  LAST_16: 'r16',
  QUARTER_FINALS: 'qf',
  SEMI_FINALS: 'sf',
  THIRD_PLACE: 'third_place',
  FINAL: 'final',
};

export const STATUS_MAP: Readonly<Record<ApiMatchStatus, DbMatchStatus>> = {
  SCHEDULED: 'scheduled',
  TIMED: 'timed',
  IN_PLAY: 'in_play',
  PAUSED: 'paused',
  FINISHED: 'finished',
  SUSPENDED: 'suspended',
  POSTPONED: 'postponed',
  CANCELLED: 'cancelled',
  AWARDED: 'awarded',
};

export interface TeamRow {
  api_id: number;
  fifa_code: string;
  name: string;
  flag_emoji: string;
  group_code: string;
}

export interface MatchRow {
  api_id: number;
  stage: DbMatchStage;
  group_code: string | null;
  matchday: number | null;
  kickoff_utc: string;
  status: DbMatchStatus;
  home_team_api_id: number | null;
  away_team_api_id: number | null;
  /** 90-minute score (or final score when the match ended in regular time). */
  home_score: number | null;
  away_score: number | null;
  /** Score after extra time (only set when the match went beyond 90'). */
  home_score_et: number | null;
  away_score_et: number | null;
  home_pens: number | null;
  away_pens: number | null;
  winner_team_api_id: number | null;
}

export interface ScorerRow {
  player_name: string;
  team_api_id: number | null;
  goals: number;
  assists: number | null;
  penalties: number | null;
}

/** "GROUP_A" → "A". */
export function groupCodeOf(group: string | null): string | null {
  if (!group) return null;
  const m = /^GROUP_([A-L])$/.exec(group);
  return m ? m[1] : null;
}

/**
 * Distinct teams with their groups, derived from the group-stage fixtures
 * (every team appears in exactly one group).
 */
export function extractTeams(matches: readonly ApiMatch[]): TeamRow[] {
  const byId = new Map<number, TeamRow>();
  for (const match of matches) {
    if (match.stage !== 'GROUP_STAGE') continue;
    const group = groupCodeOf(match.group);
    if (!group) continue;
    for (const team of [match.homeTeam, match.awayTeam]) {
      if (team.id == null || !team.tla || !team.name) continue;
      byId.set(team.id, {
        api_id: team.id,
        fifa_code: team.tla,
        name: team.name,
        flag_emoji: flagForTla(team.tla),
        group_code: group,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.api_id - b.api_id);
}

/**
 * Maps a provider match to a `matches` row.
 *
 * Score columns follow the schema convention: `home_score`/`away_score` is the
 * 90' result (provider `regularTime` when the match went long, else
 * `fullTime`); `*_score_et` is the after-120' score; `*_pens` the shootout.
 */
export function mapMatch(match: ApiMatch): MatchRow {
  const { score } = match;
  const beyond90 = score.duration !== 'REGULAR';

  const regular = beyond90 && score.regularTime ? score.regularTime : score.fullTime;
  const et = beyond90 ? score.fullTime : { home: null, away: null };
  const pens = score.penalties ?? { home: null, away: null };

  let winnerApiId: number | null = null;
  if (score.winner === 'HOME_TEAM') winnerApiId = match.homeTeam.id;
  else if (score.winner === 'AWAY_TEAM') winnerApiId = match.awayTeam.id;

  return {
    api_id: match.id,
    stage: STAGE_MAP[match.stage],
    group_code: groupCodeOf(match.group),
    matchday: match.matchday,
    kickoff_utc: match.utcDate,
    status: STATUS_MAP[match.status],
    home_team_api_id: match.homeTeam.id,
    away_team_api_id: match.awayTeam.id,
    home_score: regular.home,
    away_score: regular.away,
    home_score_et: et.home,
    away_score_et: et.away,
    home_pens: pens.home,
    away_pens: pens.away,
    winner_team_api_id: winnerApiId,
  };
}

export function mapScorer(scorer: ApiScorer): ScorerRow {
  return {
    player_name: scorer.player.name,
    team_api_id: scorer.team.id,
    goals: scorer.goals ?? 0,
    assists: scorer.assists,
    penalties: scorer.penalties,
  };
}
