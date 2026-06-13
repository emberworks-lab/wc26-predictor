"use server";

import { isMatchLocked } from "@/engine/locks";
import { entryState, failureCode, type SaveResult } from "@/lib/predictions/entryLock";
import { EDITABLE_MATCH_STATUSES } from "@/lib/predictions/types";
import { createClient } from "@/lib/supabase/server";

/**
 * RLS is the enforcement point (can_edit_match_prediction / can_edit_bracket
 * + the integrity triggers); these actions add the engine/locks check up
 * front for clean error codes, and translate PostgREST failures so the
 * client can roll back its optimistic state.
 *
 * No revalidatePath on purpose: autosave fires on every tap and the client
 * owns the working state — a router refresh per save would fight it.
 *
 * NOTE: "use server" files may only export async functions at runtime —
 * even `export type` re-exports break the server-actions loader. Import
 * SaveResult from @/lib/predictions/entryLock instead.
 */

export async function saveMatchPrediction(input: {
  entryId: string;
  matchId: number;
  outcome?: "home" | "draw" | "away";
  homeScore?: number;
  awayScore?: number;
}): Promise<SaveResult> {
  const { entryId, matchId, outcome, homeScore, awayScore } = input;
  const validScore = (v: number | undefined) =>
    v === undefined || (Number.isInteger(v) && v >= 0 && v <= 99);
  if (
    !entryId ||
    !Number.isInteger(matchId) ||
    !validScore(homeScore) ||
    !validScore(awayScore) ||
    (outcome === undefined && (homeScore === undefined || awayScore === undefined))
  ) {
    return { ok: false, code: "invalid" };
  }

  const supabase = await createClient();

  const [{ data: match }, state] = await Promise.all([
    supabase
      .from("matches")
      .select("id, kickoff_utc, status")
      .eq("id", matchId)
      .maybeSingle(),
    entryState(supabase, entryId),
  ]);
  if (!match || state === null) return { ok: false, code: "invalid" };
  if (
    state.locked ||
    state.submitted ||
    isMatchLocked({ kickoffUtc: match.kickoff_utc }, new Date()) ||
    !(EDITABLE_MATCH_STATUSES as readonly string[]).includes(match.status)
  ) {
    return { ok: false, code: "locked" };
  }

  // Hardcore rows: send scores, the DB trigger derives the outcome.
  // Casual rows: send the outcome, the trigger nulls any scores.
  const { error } = await supabase.from("match_predictions").upsert(
    {
      entry_id: entryId,
      match_id: matchId,
      // outcome is trigger-derived for hardcore, but the column is part of
      // the insert payload type — send the client's view; the trigger wins.
      outcome: outcome ?? (homeScore! > awayScore! ? "home" : homeScore! < awayScore! ? "away" : "draw"),
      home_score: homeScore ?? null,
      away_score: awayScore ?? null,
    },
    { onConflict: "entry_id,match_id" },
  );
  if (error) return { ok: false, code: failureCode(error.code) };
  return { ok: true };
}

export interface BracketRowInput {
  slot: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  winnerTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  aetPens: boolean | null;
}

type DbKoStage = "r32" | "r16" | "qf" | "sf" | "third_place" | "final";

/** Knockout round of a redistribution stage: DB `match_stage` values it spans. */
const ROUND_STAGES: Record<string, DbKoStage[]> = {
  r32: ["r32"],
  r16: ["r16"],
  qf: ["qf"],
  sf: ["sf"],
  // The engine's final round includes the third-place match, played first.
  final: ["third_place", "final"],
};

/**
 * Replaces one bracket generation of the entry with exactly `picks`: slots
 * missing from the snapshot are deleted (downstream picks invalidated by an
 * upstream change), present ones upserted. Not transactional (PostgREST);
 * a mid-way failure is healed by the next autosave snapshot.
 *
 * Generation 0 (the default) is editable until the challenge locks; a
 * redistribution generation (Stage 7) until its stage's round kicks off —
 * both mirrored from the DB's can_edit_bracket, which is the enforcement.
 */
export async function saveBracket(input: {
  entryId: string;
  picks: BracketRowInput[];
  generation?: number;
}): Promise<SaveResult> {
  const { entryId, picks, generation = 0 } = input;
  if (
    !entryId ||
    !Array.isArray(picks) ||
    picks.length > 32 ||
    !Number.isInteger(generation) ||
    generation < 0 ||
    generation > 5
  ) {
    return { ok: false, code: "invalid" };
  }
  const slots = new Set<number>();
  for (const p of picks) {
    if (
      !Number.isInteger(p.slot) ||
      p.slot < 73 ||
      p.slot > 104 ||
      slots.has(p.slot) ||
      !Number.isInteger(p.winnerTeamId)
    ) {
      return { ok: false, code: "invalid" };
    }
    slots.add(p.slot);
  }

  const supabase = await createClient();
  const state = await entryState(supabase, entryId);
  if (state === null) return { ok: false, code: "invalid" };
  if (generation === 0) {
    // Gen 0 is frozen once the challenge locks OR the entry is submitted
    // (Stage 9 item 20). Redistribution generations (gen > 0) are the sole
    // post-submit write path and skip the submitted check below.
    if (state.locked || state.submitted) return { ok: false, code: "locked" };
  } else {
    // A redistribution generation: exists for this entry, round not started.
    const { data: redist } = await supabase
      .from("redistributions")
      .select("stage")
      .eq("entry_id", entryId)
      .eq("generation", generation)
      .maybeSingle();
    if (!redist) return { ok: false, code: "invalid" };
    const { data: first } = await supabase
      .from("matches")
      .select("kickoff_utc")
      .in("stage", ROUND_STAGES[redist.stage] ?? [])
      .order("kickoff_utc")
      .limit(1)
      .maybeSingle();
    if (!first || Date.now() >= Date.parse(first.kickoff_utc)) {
      return { ok: false, code: "locked" };
    }
  }

  // Casual→hardcore flip: bracket rows saved while casual have no scores, and
  // the DB trigger rejects scoreless hardcore writes. Those rows stay AS-IS
  // (excluded from the upsert, protected from deletion) until the user scores
  // them progressively; only scored rows are written.
  const writable = state.hardcore
    ? picks.filter((p) => p.homeScore != null && p.awayScore != null)
    : picks;

  const { data: existing, error: readErr } = await supabase
    .from("bracket_predictions")
    .select("slot")
    .eq("entry_id", entryId)
    .eq("generation", generation);
  if (readErr) return { ok: false, code: failureCode(readErr.code) };

  const toDelete = (existing ?? []).map((r) => r.slot).filter((s) => !slots.has(s));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("bracket_predictions")
      .delete()
      .eq("entry_id", entryId)
      .eq("generation", generation)
      .in("slot", toDelete);
    if (error) return { ok: false, code: failureCode(error.code) };
  }

  if (writable.length > 0) {
    const { error } = await supabase.from("bracket_predictions").upsert(
      writable.map((p) => ({
        entry_id: entryId,
        generation,
        slot: p.slot,
        home_team_id: p.homeTeamId,
        away_team_id: p.awayTeamId,
        winner_team_id: p.winnerTeamId,
        home_score: p.homeScore,
        away_score: p.awayScore,
        aet_pens: p.aetPens,
      })),
      { onConflict: "entry_id,generation,slot" },
    );
    if (error) return { ok: false, code: failureCode(error.code) };
  }

  return { ok: true };
}

export type RedistributeResult =
  | { ok: true; generation: number }
  | { ok: false; code: "rejected" | "error" };

export type RedistributionStage = "r32" | "r16" | "qf" | "sf" | "final";

const REDISTRIBUTION_STAGES: readonly RedistributionStage[] = [
  "r32",
  "r16",
  "qf",
  "sf",
  "final",
];

/**
 * Knockout redistribution (SPEC → "Knockout redistribution"). All validation
 * and the atomic insert (log row + real-result prefill of the new bracket
 * generation) live in the DB function `redistribute_entry`, which runs as
 * the calling user — this wrapper only shapes the result.
 */
export async function redistribute(input: {
  entryId: string;
  stage: RedistributionStage;
}): Promise<RedistributeResult> {
  const { entryId, stage } = input;
  if (!entryId || !REDISTRIBUTION_STAGES.includes(stage)) {
    return { ok: false, code: "rejected" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redistribute_entry", {
    p_entry_id: entryId,
    p_stage: stage,
  });
  if (error) {
    // P0001 = a validation raise inside redistribute_entry; 23xxx = the
    // unique (entry, stage) / (entry, generation) guards under concurrency.
    const rejected = error.code === "P0001" || error.code?.startsWith("23");
    return { ok: false, code: rejected ? "rejected" : "error" };
  }
  return { ok: true, generation: data as number };
}
