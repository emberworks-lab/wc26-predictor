"use client";

import { useMemo } from "react";

import BracketView from "@/components/BracketView";
import {
  FINAL_MATCH,
  THIRD_PLACE_MATCH,
  roundOfMatch,
  type SimulatedBracket,
  type SimulatedMatch,
} from "@/engine/knockoutSim";
import { MATCHES_BY_ROUND } from "@/engine/knockoutSim";
import type { MatchNumber, TeamId } from "@/engine/types";
import { KO_ROUND_ORDER } from "@/engine/types";
import { buildTeamIndex } from "@/lib/predictions/derive";
import type { TeamDTO } from "@/lib/predictions/types";

export interface RealKoMatchDTO {
  slot: number;
  home: string | null;
  away: string | null;
  winner: string | null;
  /** Display result, e.g. "2–1", "1–1 (4–2 pens)". Null until finished. */
  result: string | null;
}

/**
 * The REAL knockout bracket: Stage 5's BracketView in results mode over a
 * bracket assembled from synced matches (fifa_match_number = slot) instead of
 * a simulated one. Slots without a resolved pairing render as TBD.
 */
export default function RealBracket({
  matches,
  teams,
}: {
  matches: RealKoMatchDTO[];
  teams: TeamDTO[];
}) {
  const index = useMemo(() => buildTeamIndex(teams), [teams]);

  const { sim, results } = useMemo(() => {
    const bySlot = new Map(matches.map((m) => [m.slot, m]));
    const byNumber = new Map<MatchNumber, SimulatedMatch>();
    for (const round of KO_ROUND_ORDER) {
      for (const n of MATCHES_BY_ROUND[round]) {
        const real = bySlot.get(n);
        byNumber.set(n, {
          matchNumber: n,
          round: roundOfMatch(n),
          home: (real?.home ?? undefined) as TeamId | undefined,
          away: (real?.away ?? undefined) as TeamId | undefined,
          winner: (real?.winner ?? undefined) as TeamId | undefined,
        });
      }
    }
    const winnersOf = (numbers: readonly MatchNumber[]) =>
      numbers
        .map((n) => byNumber.get(n)?.winner)
        .filter((t): t is TeamId => t !== undefined);
    const sim: SimulatedBracket = {
      matches: [...byNumber.values()].sort((a, b) => a.matchNumber - b.matchNumber),
      byNumber,
      reaching: {
        R16: winnersOf(MATCHES_BY_ROUND.R32),
        QF: winnersOf(MATCHES_BY_ROUND.R16),
        SF: winnersOf(MATCHES_BY_ROUND.QF),
        F: winnersOf(MATCHES_BY_ROUND.SF),
      },
      champion: byNumber.get(FINAL_MATCH)?.winner,
      thirdPlaceWinner: byNumber.get(THIRD_PLACE_MATCH)?.winner,
    };
    const results = new Map(
      matches.filter((m) => m.result != null).map((m) => [m.slot, m.result!]),
    );
    return { sim, results };
  }, [matches]);

  return (
    <BracketView
      sim={sim}
      bracket={new Map()}
      stale={[]}
      hardcore={false}
      readOnly
      saveStatus="idle"
      index={index}
      onCommit={() => {}}
      mode="results"
      results={results}
    />
  );
}
