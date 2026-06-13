"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { isChallengeLocked, isMatchLocked } from "@/engine/locks";
import {
  planGroupCopy,
  planPlayoffCopy,
  type CopyResult,
  type PredictedBracketSlot,
  type RealBracketSlot,
  type SourceGroupPrediction,
} from "@/lib/predictions/copy";
import { toChallengeLockState } from "@/lib/predictions/derive";
import { EDITABLE_MATCH_STATUSES, type GroupMatchDTO } from "@/lib/predictions/types";
import { createClient } from "@/lib/supabase/server";

/**
 * Join / toggle rely on RLS for the real enforcement: entries_insert and
 * entries_update both require `user_id = auth.uid()`, not banned, and the
 * challenge not locked (server-side lock check via challenge_is_locked).
 */
export async function joinChallenge(formData: FormData) {
  const challengeId = Number(formData.get("challengeId"));
  const kind = String(formData.get("kind") ?? "");
  const hardcore = formData.get("hardcore") === "on";
  if (!Number.isInteger(challengeId)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.from("challenge_entries").insert({
    user_id: user.id,
    challenge_id: challengeId,
    hardcore,
  });
  revalidatePath("/[locale]/challenges", "page");

  // Stage 9 item 21: drop the user straight INTO that challenge's prediction
  // flow instead of leaving them on the cards page. Each kind has its own
  // route; the flow's own page guards re-check the entry exists (no-op if the
  // insert was refused, which only happens once the challenge is locked — and
  // the Join button only renders while it's open).
  if (!error && (kind === "full" || kind === "groups" || kind === "playoff" || kind === "fun")) {
    redirect({ href: `/challenges/${kind}`, locale: await getLocale() });
  }
}

export async function setHardcore(formData: FormData) {
  const entryId = String(formData.get("entryId") ?? "");
  const hardcore = formData.get("hardcore") === "true";
  if (!entryId) return;

  const supabase = await createClient();
  await supabase
    .from("challenge_entries")
    .update({ hardcore })
    .eq("id", entryId);
  revalidatePath("/[locale]/challenges", "page");
}

/**
 * Submit an entry → it joins the leaderboards AND becomes read-only
 * (Stage 9 items 4 + 20). RLS does the real enforcement: entries_update
 * requires `user_id = auth.uid()` and the challenge not locked, so a submit
 * after the deadline is refused; and once `submitted_at` is set, the
 * prediction-write policies (can_edit_*) reject further edits. Submitting is
 * allowed with incomplete picks (missing ones simply score 0).
 */
export async function submitEntry(entryId: string) {
  if (!entryId) return;

  const supabase = await createClient();
  await supabase
    .from("challenge_entries")
    .update({ submitted_at: new Date().toISOString() })
    .eq("id", entryId);
  revalidatePath("/[locale]/challenges", "page");
  revalidatePath("/[locale]/challenges/[kind]", "page");
}

/**
 * Withdraw an entry (Stage 9 item 20, decision A — no erase). Clears
 * `submitted_at` ONLY: no prediction is deleted. The entry drops off the
 * leaderboards and editing re-opens for not-yet-kicked-off matches (the
 * per-match kickoff lock is independent and always applies; already-played
 * correct picks are preserved and resume scoring on re-submit). The existing
 * entries_update RLS policy (owner + not banned + challenge not locked) gates
 * this, so withdraw is only possible while the challenge itself is unlocked.
 */
export async function withdrawEntry(entryId: string) {
  if (!entryId) return;

  const supabase = await createClient();
  await supabase
    .from("challenge_entries")
    .update({ submitted_at: null })
    .eq("id", entryId);
  revalidatePath("/[locale]/challenges", "page");
  revalidatePath("/[locale]/challenges/[kind]", "page");
}

type EntryWithChallenge = {
  id: string;
  user_id: string;
  hardcore: boolean;
  challenges: {
    id: number;
    kind: "full" | "groups" | "playoff" | "fun";
    opens_at: string | null;
    locks_at: string | null;
    manual_override: string | null;
  } | null;
};

/**
 * Copy predictions as a template across the user's own challenge entries
 * (Stage 9 item 3): a one-time prefill, not a live link. Full → Groups copies
 * the 72 group-match predictions; Full → Playoff (once it opens) copies R32
 * picks where the predicted pairing matches reality. Runs on the USER's JWT so
 * RLS enforces ownership and kickoff locks — the planners in
 * `@/lib/predictions/copy` only decide WHAT to write; the same lock validation
 * as a normal save still applies (a copy can never write a locked match).
 */
export async function copyPredictions(input: {
  sourceEntryId: string;
  targetEntryId: string;
}): Promise<CopyResult> {
  const { sourceEntryId, targetEntryId } = input;
  if (!sourceEntryId || !targetEntryId || sourceEntryId === targetEntryId) {
    return { ok: false, code: "invalid" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "invalid" };

  const { data: entries } = await supabase
    .from("challenge_entries")
    .select("id, user_id, hardcore, challenges (id, kind, opens_at, locks_at, manual_override)")
    .in("id", [sourceEntryId, targetEntryId]);

  const rows = (entries ?? []) as EntryWithChallenge[];
  const source = rows.find((e) => e.id === sourceEntryId);
  const target = rows.find((e) => e.id === targetEntryId);
  // Both must exist, both must be the caller's, both must have a challenge.
  if (
    !source?.challenges ||
    !target?.challenges ||
    source.user_id !== user.id ||
    target.user_id !== user.id
  ) {
    return { ok: false, code: "invalid" };
  }

  // The same lock validation as a normal save: never write a locked target.
  const now = new Date();
  if (
    isChallengeLocked(
      toChallengeLockState({
        id: target.challenges.id,
        kind: target.challenges.kind,
        opensAt: target.challenges.opens_at,
        locksAt: target.challenges.locks_at,
        manualOverride: target.challenges.manual_override,
      }),
      now,
    )
  ) {
    return { ok: false, code: "locked" };
  }

  const groupKinds = ["full", "groups"] as const;
  const isGroupCopy =
    (groupKinds as readonly string[]).includes(source.challenges.kind) &&
    (groupKinds as readonly string[]).includes(target.challenges.kind);
  const isPlayoffCopy =
    source.challenges.kind === "full" && target.challenges.kind === "playoff";

  if (isGroupCopy) {
    return copyGroup(supabase, source, target, now);
  }
  if (isPlayoffCopy) {
    return copyPlayoff(supabase, source, target, now);
  }
  return { ok: false, code: "invalid" };
}

async function copyGroup(
  supabase: Awaited<ReturnType<typeof createClient>>,
  source: EntryWithChallenge,
  target: EntryWithChallenge,
  now: Date,
): Promise<CopyResult> {
  const [{ data: srcPreds }, { data: matches }] = await Promise.all([
    supabase
      .from("match_predictions")
      .select("match_id, outcome, home_score, away_score")
      .eq("entry_id", source.id),
    supabase
      .from("matches")
      .select("id, group_code, matchday, kickoff_utc, status, home_team_id, away_team_id")
      .eq("stage", "group"),
  ]);

  const matchDTOs: GroupMatchDTO[] = (matches ?? [])
    .filter((m) => m.home_team_id != null && m.away_team_id != null)
    .map((m) => ({
      id: m.id,
      group: m.group_code as GroupMatchDTO["group"],
      matchday: m.matchday,
      kickoffUtc: m.kickoff_utc,
      status: m.status,
      homeTeamId: m.home_team_id!,
      awayTeamId: m.away_team_id!,
      homeScore: null,
      awayScore: null,
    }));

  const sourcePreds: SourceGroupPrediction[] = (srcPreds ?? []).map((p) => ({
    matchId: p.match_id,
    outcome: p.outcome,
    homeScore: p.home_score,
    awayScore: p.away_score,
  }));

  const plan = planGroupCopy(sourcePreds, target.hardcore, matchDTOs, now);
  if (plan.rows.length > 0) {
    const { error } = await supabase.from("match_predictions").upsert(
      plan.rows.map((r) => ({
        entry_id: target.id,
        match_id: r.matchId,
        outcome: r.outcome,
        home_score: r.homeScore ?? null,
        away_score: r.awayScore ?? null,
      })),
      { onConflict: "entry_id,match_id" },
    );
    if (error) return { ok: false, code: "error" };
  }

  revalidatePath("/[locale]/challenges", "page");
  return {
    ok: true,
    copied: plan.rows.length,
    skippedLocked: plan.skippedLocked,
    skippedNeedsScore: plan.skippedNeedsScore,
    skippedMismatch: 0,
  };
}

async function copyPlayoff(
  supabase: Awaited<ReturnType<typeof createClient>>,
  source: EntryWithChallenge,
  target: EntryWithChallenge,
  now: Date,
): Promise<CopyResult> {
  const [{ data: srcRows }, { data: realMatches }] = await Promise.all([
    supabase
      .from("bracket_predictions")
      .select("slot, home_team_id, away_team_id, winner_team_id, home_score, away_score, aet_pens")
      .eq("entry_id", source.id)
      .eq("generation", 0)
      .gte("slot", 73)
      .lte("slot", 88),
    supabase
      .from("matches")
      .select("fifa_match_number, kickoff_utc, status, home_team_id, away_team_id")
      .eq("stage", "r32")
      .not("fifa_match_number", "is", null),
  ]);

  const predicted: PredictedBracketSlot[] = (srcRows ?? [])
    .filter((r) => r.winner_team_id != null)
    .map((r) => ({
      slot: r.slot,
      homeTeamId: r.home_team_id,
      awayTeamId: r.away_team_id,
      winnerTeamId: r.winner_team_id,
      homeScore: r.home_score,
      awayScore: r.away_score,
      aetPens: r.aet_pens,
    }));

  const real: RealBracketSlot[] = (realMatches ?? [])
    .filter((m) => m.home_team_id != null && m.away_team_id != null)
    .map((m) => ({
      slot: m.fifa_match_number!,
      homeTeamId: m.home_team_id!,
      awayTeamId: m.away_team_id!,
      locked:
        isMatchLocked({ kickoffUtc: m.kickoff_utc }, now) ||
        !(EDITABLE_MATCH_STATUSES as readonly string[]).includes(m.status),
    }));

  const plan = planPlayoffCopy(predicted, real, target.hardcore);
  if (plan.rows.length > 0) {
    const { error } = await supabase.from("bracket_predictions").upsert(
      plan.rows.map((r) => ({
        entry_id: target.id,
        generation: 0,
        slot: r.slot,
        home_team_id: r.homeTeamId,
        away_team_id: r.awayTeamId,
        winner_team_id: r.winnerTeamId,
        home_score: r.homeScore,
        away_score: r.awayScore,
        aet_pens: r.aetPens,
      })),
      { onConflict: "entry_id,generation,slot" },
    );
    if (error) return { ok: false, code: "error" };
  }

  revalidatePath("/[locale]/challenges", "page");
  return {
    ok: true,
    copied: plan.rows.length,
    skippedLocked: plan.skippedLocked,
    skippedNeedsScore: plan.skippedNeedsScore,
    skippedMismatch: plan.skippedMismatch,
  };
}
