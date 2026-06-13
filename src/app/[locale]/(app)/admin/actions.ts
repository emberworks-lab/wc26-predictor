"use server";

import { revalidatePath } from "next/cache";

import { getAdminUserId } from "@/lib/admin/guard";
import type { AdminResult, MatchCorrection, SyncMode } from "@/lib/admin/types";
import { invokeSyncFunction } from "@/lib/sync/invoke";
import { loadMatches } from "@/lib/sync/recompute";
import { refreshStandings } from "@/lib/sync/standings";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Admin mutations (SPEC "Admin area"). Every action re-checks the admin gate
 * itself — the /admin layout redirect is cosmetic. Writes use the service
 * role (RLS deliberately has no admin-write policies); recomputes go through
 * the deployed sync Edge Function so they hit sync_log → the snapshot
 * trigger, exactly like a cron run.
 */

const forbidden: AdminResult = { ok: false, message: "forbidden" };

const fail = (message: string): AdminResult => ({ ok: false, message });

function revalidateAll() {
  revalidatePath("/", "layout");
}

// --- force sync --------------------------------------------------------------

export async function forceSync(mode: SyncMode): Promise<AdminResult> {
  if (!(await getAdminUserId())) return forbidden;
  if (!["fixtures", "stats", "recompute"].includes(mode)) return fail("bad mode");

  const res = await invokeSyncFunction(mode);
  revalidateAll();
  if (!res.ok) {
    const message =
      res.body && typeof res.body === "object" && "error" in res.body
        ? String((res.body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    return fail(message);
  }
  return { ok: true, detail: JSON.stringify(res.body) };
}

// --- result correction --------------------------------------------------------

const VALID_STATUS = ["finished", "awarded", "in_play", "postponed", "cancelled"];

const validScore = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 99;
const validOptScore = (n: unknown): n is number | null | undefined =>
  n == null || validScore(n);

export async function correctMatch(
  matchId: number,
  correction: MatchCorrection,
): Promise<AdminResult> {
  if (!(await getAdminUserId())) return forbidden;

  const { homeScore, awayScore, status, winnerTeamId } = correction;
  if (
    !Number.isInteger(matchId) ||
    !validScore(homeScore) ||
    !validScore(awayScore) ||
    !VALID_STATUS.includes(status) ||
    !validOptScore(correction.homeScoreEt) ||
    !validOptScore(correction.awayScoreEt) ||
    !validOptScore(correction.homePens) ||
    !validOptScore(correction.awayPens)
  ) {
    return fail("invalid correction");
  }

  const service = createServiceClient();
  const { data: match } = await service
    .from("matches")
    .select("id, stage, home_team_id, away_team_id")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) return fail("match not found");

  const isGroup = match.stage === "group";
  if (!isGroup && status === "finished") {
    if (
      winnerTeamId == null ||
      (winnerTeamId !== match.home_team_id && winnerTeamId !== match.away_team_id)
    ) {
      return fail("knockout result needs a winner from the pairing");
    }
  }

  const { error } = await service
    .from("matches")
    .update({
      home_score: homeScore,
      away_score: awayScore,
      status,
      winner_team_id: isGroup ? null : (winnerTeamId ?? null),
      home_score_et: correction.homeScoreEt ?? null,
      away_score_et: correction.awayScoreEt ?? null,
      home_pens: correction.homePens ?? null,
      away_pens: correction.awayPens ?? null,
      manually_corrected: true,
    })
    .eq("id", matchId);
  if (error) return fail(error.message);

  // Same pipeline as a sync run: standings from the engine, points via the
  // deployed function (sync_log row → snapshot trigger).
  await refreshStandings(service, await loadMatches(service));
  const recompute = await invokeSyncFunction("recompute");
  revalidateAll();
  if (!recompute.ok) return fail(`corrected, but recompute failed (HTTP ${recompute.status})`);
  return { ok: true };
}

/**
 * Clears the manually_corrected flag and immediately re-syncs: the next
 * fixtures pull restores the provider's result, then an explicit recompute
 * rebuilds points from it (the currently deployed function only auto-
 * recomputes on newly-finished matches).
 */
export async function clearCorrection(matchId: number): Promise<AdminResult> {
  if (!(await getAdminUserId())) return forbidden;
  if (!Number.isInteger(matchId)) return fail("bad match id");

  const service = createServiceClient();
  const { error } = await service
    .from("matches")
    .update({ manually_corrected: false })
    .eq("id", matchId);
  if (error) return fail(error.message);

  const fixtures = await invokeSyncFunction("fixtures");
  if (!fixtures.ok) {
    revalidateAll();
    return fail(`flag cleared, but fixtures sync failed (HTTP ${fixtures.status})`);
  }
  await refreshStandings(service, await loadMatches(service));
  const recompute = await invokeSyncFunction("recompute");
  revalidateAll();
  if (!recompute.ok) return fail(`restored, but recompute failed (HTTP ${recompute.status})`);
  return { ok: true };
}

// --- challenge override ---------------------------------------------------------

export async function setChallengeOverride(
  challengeId: number,
  override: "open" | "locked" | null,
): Promise<AdminResult> {
  if (!(await getAdminUserId())) return forbidden;
  if (!Number.isInteger(challengeId) || (override !== null && override !== "open" && override !== "locked")) {
    return fail("bad override");
  }

  const service = createServiceClient();
  const { error } = await service
    .from("challenges")
    .update({ manual_override: override })
    .eq("id", challengeId);
  if (error) return fail(error.message);
  revalidateAll();
  return { ok: true };
}

// --- user moderation -------------------------------------------------------------

/** Ten years — effectively permanent; auth refresh + new sign-ins refused. */
const BAN_DURATION = "87600h";

export async function banUser(userId: string): Promise<AdminResult> {
  const adminId = await getAdminUserId();
  if (!adminId) return forbidden;
  if (userId === adminId) return fail("cannot ban yourself");

  const service = createServiceClient();
  const { data: target } = await service
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (!target) return fail("user not found");
  if (target.role === "admin") return fail("cannot ban an admin");

  // banned_at drives RLS (writes refused, hidden from boards) instantly;
  // the auth-level ban stops new sign-ins and token refresh. Predictions
  // are retained per SPEC.
  const { error } = await service
    .from("profiles")
    .update({ banned_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return fail(error.message);

  const { error: authErr } = await service.auth.admin.updateUserById(userId, {
    ban_duration: BAN_DURATION,
  });
  if (authErr) return fail(`profile banned, auth ban failed: ${authErr.message}`);
  revalidateAll();
  return { ok: true };
}

export async function unbanUser(userId: string): Promise<AdminResult> {
  if (!(await getAdminUserId())) return forbidden;

  const service = createServiceClient();
  const { error } = await service
    .from("profiles")
    .update({ banned_at: null })
    .eq("id", userId);
  if (error) return fail(error.message);

  const { error: authErr } = await service.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (authErr) return fail(`profile unbanned, auth unban failed: ${authErr.message}`);
  revalidateAll();
  return { ok: true };
}

/** Same shape the onboarding form enforces (3–20 chars). */
const NAME_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_ .-]{1,18}[\p{L}\p{N}_.]$/u;

export async function renameUser(userId: string, displayName: string): Promise<AdminResult> {
  if (!(await getAdminUserId())) return forbidden;
  const name = displayName.trim();
  if (!NAME_RE.test(name)) return fail("invalid name");

  const service = createServiceClient();
  const { error } = await service
    .from("profiles")
    .update({ display_name: name })
    .eq("id", userId);
  if (error) return fail(error.code === "23505" ? "name already taken" : error.message);
  revalidateAll();
  return { ok: true };
}

export async function deleteEntry(entryId: string): Promise<AdminResult> {
  if (!(await getAdminUserId())) return forbidden;

  const service = createServiceClient();
  const { error, count } = await service
    .from("challenge_entries")
    .delete({ count: "exact" })
    .eq("id", entryId);
  if (error) return fail(error.message);
  if (!count) return fail("entry not found");
  revalidateAll();
  return { ok: true };
}

// --- fun answers ---------------------------------------------------------------

export async function saveFunCorrectAnswer(
  questionId: number,
  value: { numeric?: number | null; text?: string | null; bool?: boolean | null },
): Promise<AdminResult> {
  if (!(await getAdminUserId())) return forbidden;
  if (!Number.isInteger(questionId)) return fail("bad question id");

  const service = createServiceClient();
  const { data: question } = await service
    .from("fun_questions")
    .select("id, qtype")
    .eq("id", questionId)
    .maybeSingle();
  if (!question) return fail("question not found");

  let patch: { correct_numeric?: number | null; correct_text?: string | null; correct_bool?: boolean | null };
  if (question.qtype === "numeric") {
    const n = value.numeric;
    if (n != null && (!Number.isFinite(n) || n < 0 || n > 9999)) return fail("invalid number");
    patch = { correct_numeric: n ?? null };
  } else if (question.qtype === "pick") {
    const text = value.text?.trim() ?? null;
    if (text !== null && (text.length === 0 || text.length > 120)) return fail("invalid text");
    patch = { correct_text: text };
  } else {
    patch = { correct_bool: value.bool ?? null };
  }

  const { error } = await service.from("fun_questions").update(patch).eq("id", questionId);
  if (error) return fail(error.message);

  const recompute = await invokeSyncFunction("recompute");
  revalidateAll();
  if (!recompute.ok) return fail(`saved, but recompute failed (HTTP ${recompute.status})`);
  return { ok: true };
}
