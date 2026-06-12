/**
 * Pure domain types for the WC26 prediction engines.
 * No I/O, no Supabase, no React — plain data only.
 * DB row ↔ engine type adapters live outside `src/engine/` (Stage 3/5).
 */

export type GroupId =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';

export const GROUP_IDS: readonly GroupId[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
] as const;

/** Opaque team identifier (e.g. FIFA code). Engines never interpret it. */
export type TeamId = string;

/** Match outcome from the home team's perspective. */
export type MatchOutcome = 'HOME' | 'DRAW' | 'AWAY';

// ---------------------------------------------------------------------------
// Group stage
// ---------------------------------------------------------------------------

/** A finished group match (only finished matches participate in tables). */
export interface PlayedMatch {
  home: TeamId;
  away: TeamId;
  homeGoals: number;
  awayGoals: number;
}

/**
 * Context for the lower group-ranking criteria (FIFA WC26 Regulations,
 * Article 13). Both maps are optional: absent values default to 0 (conduct)
 * or "unknown" (ranking), and the engine falls back to lexicographic TeamId
 * order as a final determinism guard (documented engine-only rule).
 */
export interface TiebreakContext {
  /**
   * Article 13 step 2 criterion f — team conduct score from yellow/red cards
   * (yellow −1, indirect red −3, direct red −4, yellow+direct red −5).
   * Values are ≤ 0; HIGHER is better. Defaults to 0.
   */
  conduct?: Readonly<Record<TeamId, number>>;
  /**
   * Article 13 step 3 criteria g/h — FIFA/Coca-Cola Men's World Ranking
   * position (1 = best). LOWER is better.
   */
  fifaRanking?: Readonly<Record<TeamId, number>>;
}

export interface GroupTableRow {
  team: TeamId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  /** 1-based final position inside the group. */
  position: number;
}

// ---------------------------------------------------------------------------
// Knockout
// ---------------------------------------------------------------------------

export type KnockoutRound = 'R32' | 'R16' | 'QF' | 'SF' | 'F';

export const KO_ROUND_ORDER: readonly KnockoutRound[] = [
  'R32', 'R16', 'QF', 'SF', 'F',
] as const;

/** Official FIFA match numbers: R32 73–88, R16 89–96, QF 97–100, SF 101–102, third place 103, final 104. */
export type MatchNumber = number;

export interface BracketMatch {
  matchNumber: MatchNumber;
  round: KnockoutRound;
  home: TeamId;
  away: TeamId;
}

/** A finished real knockout match. */
export interface RealKnockoutMatch {
  matchNumber: MatchNumber;
  home: TeamId;
  away: TeamId;
  homeGoals90: number;
  awayGoals90: number;
  /** The team that advanced (or won, for matches 103/104). */
  advancer: TeamId;
  decidedBy: 'REG' | 'ET' | 'PEN';
}

/**
 * A user's pick for one knockout match slot.
 * Outcome-only entries set `advancer` (+ optional `aetFlag`).
 * Hardcore entries set a 90-minute score; when that score is a draw they must
 * also set `advancer` (who goes through after ET/pens).
 */
export interface KnockoutPick {
  advancer?: TeamId;
  /** Outcome-only users: "this match is decided after extra time / penalties". */
  aetFlag?: boolean;
  homeGoals?: number;
  awayGoals?: number;
}

/**
 * One version of a user's knockout bracket (Full challenge redistribution).
 * Version 0 is the original bracket (multiplier 1). Each redistribution
 * creates a new version applying from `redistributedBefore` onward.
 */
export interface BracketVersion {
  /** Stage before which the user redistributed; undefined for the original. */
  redistributedBefore?: KnockoutRound;
  /** 1 for the original; 0.7 / 0.6 / 0.5 / 0.4 / 0.3 per SPEC. */
  multiplier: number;
  picks: Readonly<Record<MatchNumber, KnockoutPick>>;
}
