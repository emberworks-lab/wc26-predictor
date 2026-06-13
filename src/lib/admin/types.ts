/**
 * Shared types for admin server actions ("use server" files may export only
 * async functions — same constraint that put SaveResult in entryLock.ts).
 */

export type AdminResult =
  | { ok: true; detail?: string }
  | { ok: false; message: string };

export type SyncMode = "fixtures" | "stats" | "recompute";

export interface MatchCorrection {
  homeScore: number;
  awayScore: number;
  status: "finished" | "awarded" | "in_play" | "postponed" | "cancelled";
  /** Knockout only: id of the advancing team (must be one of the pairing). */
  winnerTeamId?: number | null;
  homeScoreEt?: number | null;
  awayScoreEt?: number | null;
  homePens?: number | null;
  awayPens?: number | null;
}
