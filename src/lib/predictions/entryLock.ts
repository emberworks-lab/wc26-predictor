/**
 * Shared helpers for prediction server actions (Stage 5/7). Server-only:
 * imports the cookie-scoped Supabase client. RLS is the enforcement point —
 * these exist for clean error codes and an engine/locks pre-check so the
 * client can roll back optimistic state without parsing PostgREST errors.
 */

import { isChallengeLocked } from "@/engine/locks";
import { toChallengeLockState } from "@/lib/predictions/derive";
import { createClient } from "@/lib/supabase/server";

export type SaveResult = { ok: true } | { ok: false; code: "locked" | "invalid" | "error" };

export const failureCode = (pgCode: string | undefined): "locked" | "invalid" | "error" =>
  pgCode === "42501" ? "locked" : pgCode === "P0001" || pgCode?.startsWith("23") ? "invalid" : "error";

export interface EntryState {
  locked: boolean;
  /** Submitted entries are read-only (Stage 9 item 20) — gen-0 writes refused. */
  submitted: boolean;
  hardcore: boolean;
  kind: "full" | "groups" | "playoff" | "fun";
  challengeId: number;
}

/** Lock state + metadata behind an entry, via the public rows (viewer's RLS). */
export async function entryState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entryId: string,
): Promise<EntryState | null> {
  const { data } = await supabase
    .from("challenge_entries")
    .select("id, hardcore, submitted_at, challenges (id, kind, opens_at, locks_at, manual_override)")
    .eq("id", entryId)
    .maybeSingle();
  const c = data?.challenges;
  if (!c) return null;
  return {
    hardcore: data!.hardcore,
    submitted: data!.submitted_at != null,
    kind: c.kind,
    challengeId: c.id,
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
