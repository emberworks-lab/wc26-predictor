import { createClient } from "@/lib/supabase/server";

/**
 * The admin gate: a live session whose profile is role 'admin' and not
 * banned. Used by the /admin layout (redirect) and by every admin server
 * action (refuse) — actions never trust the layout, the layout never trusts
 * the nav. Read through the caller's own RLS-scoped client.
 */
export async function getAdminUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, banned_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || profile.banned_at !== null) return null;
  return user.id;
}
