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
