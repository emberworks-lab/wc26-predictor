import { describe, expect, it } from "vitest";

import { buildR32 } from "@/engine/r32Mapping";
import type { GroupId, TeamId } from "@/engine/types";
import { GROUP_IDS } from "@/engine/types";

import {
  bracketSnapshot,
  buildTeamIndex,
  deriveBracket,
  deriveGroups,
  isGroupMatchLocked,
  staleSlots,
  toChallengeLockState,
} from "./derive";
import type {
  GroupMatchDTO,
  LocalPick,
  LocalPrediction,
  TeamDTO,
} from "./types";

// ---------------------------------------------------------------------------
// Fixture: 48 teams (ids 1..48, codes g1..g4), 72 matches (ids 1..72).
// Predictions rank every group g1 > g2 > g3 > g4; all thirds end identical
// (3 pts, GD 0... actually -2/+? — what matters: deterministic lexicographic
// fallback ranks A3..H3 as the 8 qualified thirds, mirroring the engine).
// ---------------------------------------------------------------------------

const teams: TeamDTO[] = GROUP_IDS.flatMap((g, gi) =>
  [1, 2, 3, 4].map((n) => ({
    id: gi * 4 + n,
    code: `${g}${n}`,
    name: `Team ${g}${n}`,
    flag: "🏳️",
    group: g,
  })),
);
const index = buildTeamIndex(teams);
const idOf = (code: TeamId): number => index.byCode.get(code)!.id;

const GROUP_FIXTURE: ReadonlyArray<[home: number, away: number]> = [
  [1, 2], [3, 4], [1, 3], [4, 2], [4, 1], [2, 3],
];

function makeMatches(): GroupMatchDTO[] {
  return GROUP_IDS.flatMap((g, gi) =>
    GROUP_FIXTURE.map(([h, a], i) => ({
      id: gi * 6 + i + 1,
      group: g,
      matchday: i < 2 ? 1 : i < 4 ? 2 : 3,
      kickoffUtc: `2026-06-${String(12 + i).padStart(2, "0")}T18:00:00Z`,
      status: "timed",
      homeTeamId: idOf(`${g}${h}`),
      awayTeamId: idOf(`${g}${a}`),
      homeScore: null,
      awayScore: null,
    })),
  );
}

/** Outcomes that rank each group g1 > g2 > g3 > g4. */
function fullPredictions(matches: GroupMatchDTO[]): Map<number, LocalPrediction> {
  const rank = (id: number) => ((id - 1) % 4) + 1;
  return new Map(
    matches.map((m) => [
      m.id,
      { outcome: rank(m.homeTeamId) < rank(m.awayTeamId) ? "home" : "away" } as LocalPrediction,
    ]),
  );
}

describe("deriveGroups", () => {
  const matches = makeMatches();

  it("computes live tables per group and completes with full predictions", () => {
    const derived = deriveGroups(matches, fullPredictions(matches), false, index);
    expect(derived.groups).toHaveLength(12);
    expect(derived.allComplete).toBe(true);
    for (const g of derived.groups) {
      expect(g.table.map((r) => r.team)).toEqual([1, 2, 3, 4].map((n) => `${g.group}${n}`));
      expect(g.complete).toBe(true);
    }
  });

  it("resolves thirds + personal R32 identically to the engine", () => {
    const derived = deriveGroups(matches, fullPredictions(matches), false, index);
    const qualified = derived.thirds!.qualified.map((q) => q.row.team);
    expect(qualified).toEqual(["A3", "B3", "C3", "D3", "E3", "F3", "G3", "H3"]);

    const winners = Object.fromEntries(GROUP_IDS.map((g) => [g, `${g}1`])) as Record<GroupId, TeamId>;
    const runnersUp = Object.fromEntries(GROUP_IDS.map((g) => [g, `${g}2`])) as Record<GroupId, TeamId>;
    const thirds = Object.fromEntries(qualified.map((t) => [t[0], t]));
    expect(derived.r32).toEqual(buildR32({ winners, runnersUp, thirds }));
  });

  it("keeps a group incomplete while an unfinished match has no prediction", () => {
    const preds = fullPredictions(matches);
    preds.delete(1);
    const derived = deriveGroups(matches, preds, false, index);
    expect(derived.byGroup.get("A")!.complete).toBe(false);
    expect(derived.byGroup.get("A")!.settled).toBe(5);
    expect(derived.allComplete).toBe(false);
    expect(derived.r32).toBeUndefined();
  });

  it("falls back to the real result for a finished match without a prediction (late joiner)", () => {
    const withResult = matches.map((m) =>
      m.id === 1 ? { ...m, status: "finished", homeScore: 1, awayScore: 0 } : m,
    );
    const preds = fullPredictions(matches);
    preds.delete(1);
    const derived = deriveGroups(withResult, preds, false, index);
    expect(derived.byGroup.get("A")!.complete).toBe(true);
    expect(derived.allComplete).toBe(true);
    expect(derived.byGroup.get("A")!.table[0].team).toBe("A1");
  });

  it("uses exact scores for hardcore predictions", () => {
    const preds = fullPredictions(matches);
    preds.set(1, { outcome: "home", homeScore: 4, awayScore: 0 });
    const derived = deriveGroups(matches, preds, true, index);
    const a1 = derived.byGroup.get("A")!.table.find((r) => r.team === "A1")!;
    expect(a1.goalsFor).toBe(4 + 1 + 1); // exact 4:0 + synthetic 1:0 twice
  });
});

describe("locks", () => {
  const base = makeMatches()[0];

  it("locks at kickoff and for any non-editable status", () => {
    const now = new Date("2026-06-12T18:00:00Z");
    expect(isGroupMatchLocked({ ...base, kickoffUtc: "2026-06-12T18:00:00Z" }, now)).toBe(true);
    expect(isGroupMatchLocked({ ...base, kickoffUtc: "2026-06-12T18:00:01Z" }, now)).toBe(false);
    expect(
      isGroupMatchLocked({ ...base, kickoffUtc: "2026-06-12T18:00:01Z", status: "in_play" }, now),
    ).toBe(true);
  });

  it("maps the playoff sentinel to a far-future opensAt", () => {
    const state = toChallengeLockState({
      id: 3,
      kind: "playoff",
      opensAt: "2999-01-01T00:00:00Z",
      locksAt: "2026-06-28T19:00:00Z",
      manualOverride: null,
    });
    expect(new Date(state.opensAtUtc as Date).getFullYear()).toBeGreaterThan(2900);
  });
});

describe("bracket derivation", () => {
  const matches = makeMatches();
  const derived = deriveGroups(matches, fullPredictions(matches), false, index);

  /** Picks the home side of every resolved match, walking rounds in order. */
  function homePicks(): Map<number, LocalPick> {
    const picks = new Map<number, LocalPick>();
    for (let i = 0; i < 32; i += 1) {
      const sim = deriveBracket(derived.r32!, picks, index);
      for (const m of sim.matches) {
        if (m.home !== undefined && m.away !== undefined && !picks.has(m.matchNumber)) {
          picks.set(m.matchNumber, { winnerTeamId: idOf(m.home) });
        }
      }
    }
    return picks;
  }

  it("walks picks to a champion and third-place winner", () => {
    const picks = homePicks();
    const sim = deriveBracket(derived.r32!, picks, index);
    expect(picks.size).toBe(32);
    expect(sim.champion).toBeDefined();
    expect(sim.thirdPlaceWinner).toBeDefined();
    expect(staleSlots(sim, picks, index)).toEqual([]);
  });

  it("does not flag a hardcore draw awaiting its advancer as stale", () => {
    const picks = new Map<number, LocalPick>([[73, { homeScore: 1, awayScore: 1 }]]);
    const sim = deriveBracket(derived.r32!, picks, index);
    expect(sim.byNumber.get(73)!.winner).toBeUndefined();
    expect(staleSlots(sim, picks, index)).toEqual([]);
  });

  it("flags downstream picks as stale when an upstream pick eliminates their team", () => {
    const picks = homePicks();
    const sim0 = deriveBracket(derived.r32!, picks, index);
    const m73 = sim0.byNumber.get(73)!;
    // Flip M73 to the away side: every downstream slot that picked the old
    // winner can no longer resolve.
    picks.set(73, { winnerTeamId: idOf(m73.away!) });
    const sim = deriveBracket(derived.r32!, picks, index);
    const stale = staleSlots(sim, picks, index);
    expect(stale.length).toBeGreaterThan(0);
    expect(stale).toContain(90); // M90 feeds from W73 — its picked team lost
    expect(sim.byNumber.get(90)!.winner).toBeUndefined();
  });

  it("snapshots only fully resolved slots with mapped numeric ids", () => {
    const picks = homePicks();
    const sim = deriveBracket(derived.r32!, picks, index);
    const rows = bracketSnapshot(sim, picks, index);
    expect(rows).toHaveLength(32);
    for (const row of rows) {
      expect(row.winnerTeamId).toBe(row.homeTeamId); // we always picked home
      expect(row.slot).toBeGreaterThanOrEqual(73);
      expect(row.slot).toBeLessThanOrEqual(104);
    }

    // Drop resolution of one branch → its rows disappear from the snapshot.
    picks.delete(73);
    const sim2 = deriveBracket(derived.r32!, picks, index);
    const rows2 = bracketSnapshot(sim2, picks, index);
    expect(rows2.length).toBeLessThan(32);
    expect(rows2.some((r) => r.slot === 73)).toBe(false);
  });
});
