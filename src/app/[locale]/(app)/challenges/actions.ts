"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

/**
 * Join / toggle rely on RLS for the real enforcement: entries_insert and
 * entries_update both require `user_id = auth.uid()`, not banned, and the
 * challenge not locked (server-side lock check via challenge_is_locked).
 */
export async function joinChallenge(formData: FormData) {
  const challengeId = Number(formData.get("challengeId"));
  const hardcore = formData.get("hardcore") === "on";
  if (!Number.isInteger(challengeId)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("challenge_entries").insert({
    user_id: user.id,
    challenge_id: challengeId,
    hardcore,
  });
  revalidatePath("/[locale]/challenges", "page");
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
 * Submit an entry → it now participates in the leaderboards (Stage 9 item 4).
 * RLS does the real enforcement: entries_update requires `user_id = auth.uid()`
 * and the challenge not locked, so a submit after the deadline is refused and a
 * once-submitted entry can never be edited/withdrawn post-lock. Submitting is
 * allowed with incomplete picks (missing ones simply score 0). Editing
 * predictions afterwards keeps the entry submitted — submitted stays submitted.
 */
export async function submitEntry(formData: FormData) {
  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) return;

  const supabase = await createClient();
  await supabase
    .from("challenge_entries")
    .update({ submitted_at: new Date().toISOString() })
    .eq("id", entryId);
  revalidatePath("/[locale]/challenges", "page");
}
