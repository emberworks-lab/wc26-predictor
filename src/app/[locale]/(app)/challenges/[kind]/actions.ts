"use server";

import { isChallengeLocked, isMatchLocked } from "@/engine/locks";
import { toChallengeLockState } from "@/lib/predictions/derive";
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
 */

export type SaveResult = { ok: true } | { ok: false; code: "locked" | "invalid" | "error" };

const failureCode = (pgCode: string | undefined): "locked" | "invalid" | "error" =>
  pgCode === "42501" ? "locked" : pgCode === "P0001" || pgCode?.startsWith("23") ? "invalid" : "error";

/** Lock state + hardcore flag behind an entry, via the public rows. */
async function entryState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entryId: string,
): Promise<{ locked: boolean; hardcore: boolean } | null> {
  const { data } = await supabase
    .from("challenge_entries")
    .select("id, hardcore, challenges (id, kind, opens_at, locks_at, manual_override)")
    .eq("id", entryId)
    .maybeSingle();
  const c = data?.challenges;
  if (!c) return null;
  return {
    hardcore: data!.hardcore,
    locked: isChallengeLocked(
      toChallengeLockState({
        id: c.id,
        kind: c.kind,
        opensAt: c.opens_at,
        locksAt: c.locks_at,
        manualOverride: c.manual_override,
      }),
      new Date(),
    ),
  };
}

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

/**
 * Replaces the entry's generation-0 bracket with exactly `picks`: slots
 * missing from the snapshot are deleted (downstream picks invalidated by an
 * upstream change), present ones upserted. Not transactional (PostgREST);
 * a mid-way failure is healed by the next autosave snapshot.
 */
export async function saveBracket(input: {
  entryId: string;
  picks: BracketRowInput[];
}): Promise<SaveResult> {
  const { entryId, picks } = input;
  if (!entryId || !Array.isArray(picks) || picks.length > 32) {
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
  if (state.locked) return { ok: false, code: "locked" };

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
    .eq("generation", 0);
  if (readErr) return { ok: false, code: failureCode(readErr.code) };

  const toDelete = (existing ?? []).map((r) => r.slot).filter((s) => !slots.has(s));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("bracket_predictions")
      .delete()
      .eq("entry_id", entryId)
      .eq("generation", 0)
      .in("slot", toDelete);
    if (error) return { ok: false, code: failureCode(error.code) };
  }

  if (writable.length > 0) {
    const { error } = await supabase.from("bracket_predictions").upsert(
      writable.map((p) => ({
        entry_id: entryId,
        generation: 0,
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
