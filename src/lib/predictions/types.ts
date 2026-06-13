/**
 * Serializable DTOs crossing the server → client boundary for the prediction
 * flows (Stage 5). Engine adapters live in ./derive.ts; the engine's TeamId
 * convention is the FIFA code (same as the sync recompute pipeline).
 */

import type { GroupId } from "@/engine/types";

export interface TeamDTO {
  id: number;
  /** FIFA code — the engine TeamId. */
  code: string;
  name: string;
  flag: string;
  group: GroupId;
}

/** DB match_status values that still allow predictions (mirrors match_is_locked). */
export const EDITABLE_MATCH_STATUSES = ["scheduled", "timed"] as const;

export interface GroupMatchDTO {
  id: number;
  group: GroupId;
  matchday: number | null;
  kickoffUtc: string;
  status: string;
  homeTeamId: number;
  awayTeamId: number;
  /** Real result — present once finished. */
  homeScore: number | null;
  awayScore: number | null;
}

export type PredictionOutcome = "home" | "draw" | "away";

export interface MatchPredictionDTO {
  matchId: number;
  outcome: PredictionOutcome;
  homeScore: number | null;
  awayScore: number | null;
}

export interface BracketPickDTO {
  slot: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  winnerTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  aetPens: boolean | null;
}

export interface ChallengeDTO {
  id: number;
  kind: "full" | "groups" | "playoff" | "fun";
  opensAt: string | null;
  locksAt: string | null;
  manualOverride: string | null;
}

/**
 * The client's working copy of one group-match prediction. Casual entries
 * carry `outcome`; hardcore entries carry scores (outcome derived). A
 * prediction with outcome but no scores under a hardcore entry predates a
 * casual→hardcore flip and "needs scores".
 */
export interface LocalPrediction {
  outcome?: PredictionOutcome;
  homeScore?: number;
  awayScore?: number;
}

/** The client's working copy of one knockout-slot pick. */
export interface LocalPick {
  winnerTeamId?: number;
  homeScore?: number;
  awayScore?: number;
  aetPens?: boolean;
}

/** A player suggestion for the fun pick questions (shared with admin). */
export interface PlayerSuggestion {
  name: string;
  team: string;
  flag: string;
}
