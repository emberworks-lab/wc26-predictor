/**
 * Pure derivation layer for the prediction flows: DB-shaped DTOs in, engine
 * results out. Every rule comes from `src/engine/*` — this file only adapts
 * shapes (numeric team ids ↔ FIFA-code TeamIds, DTOs ↔ engine inputs) and
 * mirrors EXACTLY what the scoring recompute will later derive from the same
 * rows (same normalization, same real-result fallback, empty TiebreakContext —
 * the sync pipeline passes none either).
 */

import { rankThirds, type ThirdPlaceEntry, type ThirdsRanking } from "@/engine/bestThirds";
import { computeGroupTable } from "@/engine/groupTable";
import { isMatchLocked, type ChallengeLockState } from "@/engine/locks";
import {
  simulateBracket,
  type SimulatedBracket,
} from "@/engine/knockoutSim";
import { buildR32 } from "@/engine/r32Mapping";
import {
  predictionAsPlayedMatch,
  type GroupMatchDef,
  type GroupMatchPrediction,
} from "@/engine/scoring";
import type {
  BracketMatch,
  GroupId,
  GroupTableRow,
  KnockoutPick,
  MatchNumber,
  PlayedMatch,
  TeamId,
} from "@/engine/types";
import { GROUP_IDS } from "@/engine/types";

import {
  EDITABLE_MATCH_STATUSES,
  type BracketPickDTO,
  type ChallengeDTO,
  type GroupMatchDTO,
  type LocalPick,
  type LocalPrediction,
  type TeamDTO,
} from "./types";

// ---------------------------------------------------------------------------
// Indexes & adapters
// ---------------------------------------------------------------------------

export interface TeamIndex {
  byId: Map<number, TeamDTO>;
  byCode: Map<TeamId, TeamDTO>;
}

export function buildTeamIndex(teams: readonly TeamDTO[]): TeamIndex {
  return {
    byId: new Map(teams.map((t) => [t.id, t])),
    byCode: new Map(teams.map((t) => [t.code, t])),
  };
}

/** DTO → engine GroupMatchDef (id stringified, codes as TeamIds) — the sync convention. */
export function toGroupMatchDef(m: GroupMatchDTO, index: TeamIndex): GroupMatchDef {
  return {
    id: String(m.id),
    group: m.group,
    home: index.byId.get(m.homeTeamId)!.code,
    away: index.byId.get(m.awayTeamId)!.code,
    ...(m.status === "finished" && m.homeScore != null && m.awayScore != null
      ? { homeGoals: m.homeScore, awayGoals: m.awayScore }
      : {}),
  };
}

function toGroupPrediction(matchId: number, local: LocalPrediction): GroupMatchPrediction {
  return {
    matchId: String(matchId),
    ...(local.outcome
      ? { outcome: local.outcome === "home" ? ("HOME" as const) : local.outcome === "away" ? ("AWAY" as const) : ("DRAW" as const) }
      : {}),
    ...(local.homeScore !== undefined && local.awayScore !== undefined
      ? { homeGoals: local.homeScore, awayGoals: local.awayScore }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

/** Mirrors the DB's match_is_locked(): kicked off OR no longer scheduled/timed. */
export function isGroupMatchLocked(m: GroupMatchDTO, now: Date): boolean {
  if (!(EDITABLE_MATCH_STATUSES as readonly string[]).includes(m.status)) return true;
  return isMatchLocked({ kickoffUtc: m.kickoffUtc }, now);
}

/** Playoff `opens_at` far-future sentinel = "waiting for the group stage". */
const isOpensSentinel = (opensAt: string | null) =>
  opensAt != null && new Date(opensAt).getFullYear() > 2900;

/** ChallengeDTO → engine ChallengeLockState (sentinel- and override-aware). */
export function toChallengeLockState(c: ChallengeDTO): ChallengeLockState {
  return {
    opensAtUtc: isOpensSentinel(c.opensAt) ? new Date(8640000000000000) : c.opensAt,
    locksAtUtc: c.locksAt,
    manualState:
      c.manualOverride === "open" ? "OPEN" : c.manualOverride === "locked" ? "LOCKED" : null,
  };
}

// ---------------------------------------------------------------------------
// Predicted groups → thirds → personal R32
// ---------------------------------------------------------------------------

export interface DerivedGroup {
  group: GroupId;
  matches: GroupMatchDTO[];
  /** Live table over predictions (+ real-result fallback for finished gaps). */
  table: GroupTableRow[];
  /** Matches contributing to the table (prediction or finished real result). */
  settled: number;
  /** All 6 matches settled → table is final for derivation purposes. */
  complete: boolean;
}

export interface DerivedGroups {
  groups: DerivedGroup[];
  byGroup: Map<GroupId, DerivedGroup>;
  allComplete: boolean;
  /** Present once every group is complete. */
  thirds?: ThirdsRanking;
  /** The user's personal R32 — present once thirds resolve. */
  r32?: BracketMatch[];
}

/**
 * The one derivation the whole wizard hangs off: live predicted tables per
 * group, the best-thirds ranking and the personal R32 bracket. Identical
 * inputs produce identical results to the scoring engine's internal
 * `computePredictedGroups` (same helpers, same fallback).
 */
export function deriveGroups(
  matches: readonly GroupMatchDTO[],
  predictions: ReadonlyMap<number, LocalPrediction>,
  hardcore: boolean,
  index: TeamIndex,
): DerivedGroups {
  const groups: DerivedGroup[] = [];
  const byGroup = new Map<GroupId, DerivedGroup>();

  for (const g of GROUP_IDS) {
    const groupMatches = matches
      .filter((m) => m.group === g)
      .sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc) || a.id - b.id);
    if (groupMatches.length === 0) continue;

    const teams = [
      ...new Set(groupMatches.flatMap((m) => [m.homeTeamId, m.awayTeamId])),
    ].map((id) => index.byId.get(id)!.code);

    const played: PlayedMatch[] = [];
    for (const m of groupMatches) {
      const def = toGroupMatchDef(m, index);
      const local = predictions.get(m.id);
      const asPlayed =
        (local && predictionAsPlayedMatch(def, toGroupPrediction(m.id, local), hardcore)) ??
        (def.homeGoals !== undefined && def.awayGoals !== undefined
          ? { home: def.home, away: def.away, homeGoals: def.homeGoals, awayGoals: def.awayGoals }
          : undefined);
      if (asPlayed) played.push(asPlayed);
    }

    const derived: DerivedGroup = {
      group: g,
      matches: groupMatches,
      table: computeGroupTable(played, teams),
      settled: played.length,
      complete: teams.length === 4 && played.length === 6,
    };
    groups.push(derived);
    byGroup.set(g, derived);
  }

  const allComplete = groups.length === 12 && groups.every((g) => g.complete);
  if (!allComplete) return { groups, byGroup, allComplete };

  const thirdEntries: ThirdPlaceEntry[] = groups.map((g) => ({
    group: g.group,
    row: g.table[2],
  }));
  const thirds = rankThirds(thirdEntries);

  const winners = {} as Record<GroupId, TeamId>;
  const runnersUp = {} as Record<GroupId, TeamId>;
  for (const g of groups) {
    winners[g.group] = g.table[0].team;
    runnersUp[g.group] = g.table[1].team;
  }
  const r32 = buildR32({ winners, runnersUp, thirds: thirds.qualifiedByGroup });

  return { groups, byGroup, allComplete, thirds, r32 };
}

// ---------------------------------------------------------------------------
// Knockout bracket
// ---------------------------------------------------------------------------

/** LocalPick map → engine picks (winner id → advancer code). */
export function toEnginePicks(
  picks: ReadonlyMap<number, LocalPick>,
  index: TeamIndex,
): Record<MatchNumber, KnockoutPick> {
  const result: Record<MatchNumber, KnockoutPick> = {};
  for (const [slot, pick] of picks) {
    const advancer =
      pick.winnerTeamId !== undefined ? index.byId.get(pick.winnerTeamId)?.code : undefined;
    result[slot] = {
      ...(advancer !== undefined ? { advancer } : {}),
      ...(pick.aetPens !== undefined ? { aetFlag: pick.aetPens } : {}),
      ...(pick.homeScore !== undefined && pick.awayScore !== undefined
        ? { homeGoals: pick.homeScore, awayGoals: pick.awayScore }
        : {}),
    };
  }
  return result;
}

export function deriveBracket(
  r32: readonly BracketMatch[],
  picks: ReadonlyMap<number, LocalPick>,
  index: TeamIndex,
): SimulatedBracket {
  return simulateBracket(r32, toEnginePicks(picks, index));
}

/**
 * Slots whose stored pick no longer fits the current bracket: the pairing is
 * unresolved (an upstream pick changed/vanished) or the picked winner is no
 * longer one of the two teams. These get a visual warning and are dropped
 * from the next save snapshot. A resolved pairing with an INCOMPLETE pick
 * (hardcore draw still awaiting its advancer) is not stale — never wipe a
 * score mid-entry.
 */
export function staleSlots(
  sim: SimulatedBracket,
  picks: ReadonlyMap<number, LocalPick>,
  index: TeamIndex,
): number[] {
  const stale: number[] = [];
  for (const [slot, pick] of picks) {
    if (pick.winnerTeamId === undefined && pick.homeScore === undefined) continue;
    const m = sim.byNumber.get(slot);
    if (!m || m.home === undefined || m.away === undefined) {
      stale.push(slot);
      continue;
    }
    if (pick.winnerTeamId !== undefined) {
      const code = index.byId.get(pick.winnerTeamId)?.code;
      if (code !== m.home && code !== m.away) stale.push(slot);
    }
  }
  return stale.sort((a, b) => a - b);
}

/**
 * Builds the gen-0 persistence snapshot: one row per slot whose pairing AND
 * pick are fully resolved in the current simulation. Anything else is left
 * out — the server replaces the generation with exactly this set.
 */
export function bracketSnapshot(
  sim: SimulatedBracket,
  picks: ReadonlyMap<number, LocalPick>,
  index: TeamIndex,
): BracketPickDTO[] {
  const rows: BracketPickDTO[] = [];
  for (const m of sim.matches) {
    if (m.home === undefined || m.away === undefined || m.winner === undefined) continue;
    const pick = picks.get(m.matchNumber);
    if (!pick) continue;
    const home = index.byCode.get(m.home)!;
    const away = index.byCode.get(m.away)!;
    const winner = index.byCode.get(m.winner)!;
    rows.push({
      slot: m.matchNumber,
      homeTeamId: home.id,
      awayTeamId: away.id,
      winnerTeamId: winner.id,
      homeScore: pick.homeScore ?? null,
      awayScore: pick.awayScore ?? null,
      aetPens: pick.aetPens ?? null,
    });
  }
  return rows;
}
