import { describe, expect, it } from "vitest";

import {
  planGroupCopy,
  planPlayoffCopy,
  type PredictedBracketSlot,
  type RealBracketSlot,
  type SourceGroupPrediction,
} from "./copy";
import type { GroupMatchDTO } from "./types";

const NOW = new Date("2026-06-13T12:00:00Z");

function match(id: number, kickoff: string, status = "timed"): GroupMatchDTO {
  return {
    id,
    group: "A",
    matchday: 1,
    kickoffUtc: kickoff,
    status,
    homeTeamId: id * 10,
    awayTeamId: id * 10 + 1,
    homeScore: null,
    awayScore: null,
  };
}

const FUTURE = "2026-06-20T16:00:00Z";
const PAST = "2026-06-11T16:00:00Z";

describe("planGroupCopy", () => {
  const matches = [match(1, FUTURE), match(2, FUTURE), match(3, PAST)];

  it("collapses a hardcore source to outcomes for a casual target", () => {
    const source: SourceGroupPrediction[] = [
      { matchId: 1, outcome: "home", homeScore: 2, awayScore: 0 },
      { matchId: 2, outcome: "draw", homeScore: 1, awayScore: 1 },
    ];
    const plan = planGroupCopy(source, false, matches, NOW);
    expect(plan.rows).toEqual([
      { matchId: 1, outcome: "home" },
      { matchId: 2, outcome: "draw" },
    ]);
    expect(plan.skippedNeedsScore).toBe(0);
  });

  it("copies scores when both source and target are hardcore", () => {
    const source: SourceGroupPrediction[] = [
      { matchId: 1, outcome: "home", homeScore: 3, awayScore: 1 },
    ];
    const plan = planGroupCopy(source, true, matches, NOW);
    expect(plan.rows).toEqual([{ matchId: 1, outcome: "home", homeScore: 3, awayScore: 1 }]);
  });

  it("cannot fill a hardcore target from a casual (scoreless) source", () => {
    const source: SourceGroupPrediction[] = [
      { matchId: 1, outcome: "away", homeScore: null, awayScore: null },
      { matchId: 2, outcome: "home", homeScore: null, awayScore: null },
    ];
    const plan = planGroupCopy(source, true, matches, NOW);
    expect(plan.rows).toHaveLength(0);
    expect(plan.skippedNeedsScore).toBe(2);
  });

  it("skips matches that already kicked off in the target", () => {
    const source: SourceGroupPrediction[] = [
      { matchId: 1, outcome: "home", homeScore: null, awayScore: null },
      { matchId: 3, outcome: "away", homeScore: null, awayScore: null }, // match 3 is in the past
    ];
    const plan = planGroupCopy(source, false, matches, NOW);
    expect(plan.rows).toEqual([{ matchId: 1, outcome: "home" }]);
    expect(plan.skippedLocked).toBe(1);
  });
});

describe("planPlayoffCopy", () => {
  // Slot 73: predicted pairing (10 vs 20) matches reality.
  // Slot 74: predicted pairing (30 vs 40) but reality is (30 vs 99) → mismatch.
  const real: RealBracketSlot[] = [
    { slot: 73, homeTeamId: 10, awayTeamId: 20, locked: false },
    { slot: 74, homeTeamId: 30, awayTeamId: 99, locked: false },
  ];

  it("copies only slots whose predicted pairing matches the real one", () => {
    const predicted: PredictedBracketSlot[] = [
      {
        slot: 73,
        homeTeamId: 10,
        awayTeamId: 20,
        winnerTeamId: 10,
        homeScore: null,
        awayScore: null,
        aetPens: null,
      },
      {
        slot: 74,
        homeTeamId: 30,
        awayTeamId: 40,
        winnerTeamId: 30,
        homeScore: null,
        awayScore: null,
        aetPens: null,
      },
    ];
    const plan = planPlayoffCopy(predicted, real, false);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ slot: 73, winnerTeamId: 10 });
    expect(plan.skippedMismatch).toBe(1);
  });

  it("re-orients the score when predicted home/away is flipped vs reality", () => {
    // Predicted 20(home) 1 : 2 10(away); winner 10. Reality is 10 home, 20 away.
    const predicted: PredictedBracketSlot[] = [
      {
        slot: 73,
        homeTeamId: 20,
        awayTeamId: 10,
        winnerTeamId: 10,
        homeScore: 1,
        awayScore: 2,
        aetPens: null,
      },
    ];
    const plan = planPlayoffCopy(predicted, real, true);
    expect(plan.rows[0]).toEqual({
      slot: 73,
      homeTeamId: 10,
      awayTeamId: 20,
      winnerTeamId: 10,
      homeScore: 2, // 10 scored 2
      awayScore: 1, // 20 scored 1
      aetPens: null,
    });
  });

  it("cannot fill a hardcore playoff target from a scoreless Full pick", () => {
    const predicted: PredictedBracketSlot[] = [
      {
        slot: 73,
        homeTeamId: 10,
        awayTeamId: 20,
        winnerTeamId: 10,
        homeScore: null,
        awayScore: null,
        aetPens: null,
      },
    ];
    const plan = planPlayoffCopy(predicted, real, true);
    expect(plan.rows).toHaveLength(0);
    expect(plan.skippedNeedsScore).toBe(1);
  });
});
