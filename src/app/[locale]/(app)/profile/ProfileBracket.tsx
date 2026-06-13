"use client";

import { useMemo } from "react";

import BracketView from "@/components/BracketView";
import {
  buildTeamIndex,
  deriveBracket,
  deriveGroups,
} from "@/lib/predictions/derive";
import type {
  BracketPickDTO,
  GroupMatchDTO,
  LocalPick,
  LocalPrediction,
  MatchPredictionDTO,
  TeamDTO,
} from "@/lib/predictions/types";

/**
 * Read-only graphical bracket of a user's predictions (Stage 9 item 11):
 * reuses BracketView in "results" mode (no pick affordances, no progress copy)
 * fed by deriving their predicted Round-of-32 from their group picks. RLS scopes
 * the data — on your own profile it's complete; for another user it only fills
 * in once their predictions unlock (their hidden picks derive to nothing, so the
 * bracket simply shows "finish the groups first" until the lock). Pure
 * client-side derivation through the same helpers the wizard uses.
 */
export default function ProfileBracket({
  teams,
  matches,
  predictions,
  bracketPicks,
  hardcore,
}: {
  teams: TeamDTO[];
  matches: GroupMatchDTO[];
  predictions: MatchPredictionDTO[];
  bracketPicks: BracketPickDTO[];
  hardcore: boolean;
}) {
  const index = useMemo(() => buildTeamIndex(teams), [teams]);

  const preds = useMemo(
    () =>
      new Map<number, LocalPrediction>(
        predictions.map((p) => [
          p.matchId,
          {
            outcome: p.outcome,
            ...(p.homeScore != null && p.awayScore != null
              ? { homeScore: p.homeScore, awayScore: p.awayScore }
              : {}),
          },
        ]),
      ),
    [predictions],
  );

  const picks = useMemo(
    () =>
      new Map<number, LocalPick>(
        bracketPicks.map((b) => [
          b.slot,
          {
            winnerTeamId: b.winnerTeamId,
            ...(b.homeScore != null && b.awayScore != null
              ? { homeScore: b.homeScore, awayScore: b.awayScore }
              : {}),
            ...(b.aetPens != null ? { aetPens: b.aetPens } : {}),
          },
        ]),
      ),
    [bracketPicks],
  );

  const derived = useMemo(
    () => deriveGroups(matches, preds, hardcore, index),
    [matches, preds, hardcore, index],
  );
  const sim = useMemo(
    () => (derived.r32 ? deriveBracket(derived.r32, picks, index) : undefined),
    [derived.r32, picks, index],
  );

  return (
    <BracketView
      sim={sim}
      bracket={picks}
      stale={[]}
      hardcore={hardcore}
      readOnly
      mode="results"
      saveStatus="idle"
      index={index}
      onCommit={() => {}}
    />
  );
}
