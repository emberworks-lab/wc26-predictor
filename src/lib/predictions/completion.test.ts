import { describe, expect, it } from "vitest";

import {
  computeBracketCompletion,
  computeFunCompletion,
  computeGroupCompletion,
} from "./completion";
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

describe("computeGroupCompletion", () => {
  it("excludes matches locked before the user predicted them from the denominator", () => {
    // 4 matches: 2 already kicked off & unpredicted (permanently locked),
    // 2 still in the future and both predicted → reads as 2/2, not 2/4.
    const matches = [
      match(1, "2026-06-11T16:00:00Z"), // kicked off, never predicted
      match(2, "2026-06-11T19:00:00Z"), // kicked off, never predicted
      match(3, "2026-06-20T16:00:00Z"), // future, predicted
      match(4, "2026-06-21T16:00:00Z"), // future, predicted
    ];
    const predicted = new Set([3, 4]);
    const c = computeGroupCompletion(matches, predicted, NOW);
    expect(c).toMatchObject({ total: 4, locked: 2, available: 2, done: 2, complete: true });
  });

  it("counts a prediction made before kickoff as done even once that match locks", () => {
    const matches = [
      match(1, "2026-06-11T16:00:00Z"), // locked but the user did predict it
      match(2, "2026-06-20T16:00:00Z"), // future, predicted
    ];
    const predicted = new Set([1, 2]);
    const c = computeGroupCompletion(matches, predicted, NOW);
    expect(c).toMatchObject({ locked: 0, available: 2, done: 2, complete: true });
  });

  it("is incomplete while a predictable match is still unpicked", () => {
    const matches = [match(1, "2026-06-20T16:00:00Z"), match(2, "2026-06-21T16:00:00Z")];
    const c = computeGroupCompletion(matches, new Set([1]), NOW);
    expect(c).toMatchObject({ available: 2, done: 1, complete: false });
  });
});

describe("computeBracketCompletion", () => {
  it("counts saved winners and names the champion from the final slot (104)", () => {
    const rows = [
      { slot: 73, winnerTeamId: 5 },
      { slot: 103, winnerTeamId: 6 },
      { slot: 104, winnerTeamId: 7 },
    ];
    const names = new Map([
      [5, "Brazil"],
      [6, "Spain"],
      [7, "France"],
    ]);
    const c = computeBracketCompletion(rows, names);
    expect(c).toMatchObject({ total: 32, done: 3, complete: false, championName: "France" });
  });

  it("is complete with all 32 winners and no champion until the final is picked", () => {
    const rows = Array.from({ length: 31 }, (_, i) => ({ slot: 73 + i, winnerTeamId: 1 }));
    const c = computeBracketCompletion(rows, new Map([[1, "X"]]));
    expect(c.done).toBe(31);
    expect(c.complete).toBe(false);
    expect(c.championName).toBeNull();
  });
});

describe("computeFunCompletion", () => {
  it("is complete once every question is answered", () => {
    expect(computeFunCompletion(12, 12)).toMatchObject({ done: 12, total: 12, complete: true });
    expect(computeFunCompletion(10, 12)).toMatchObject({ complete: false });
  });
});
