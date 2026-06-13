import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * Service-role client — bypasses RLS. Server-only (the key never reaches the
 * client bundle: this module is imported exclusively from server actions that
 * have passed the admin guard). Admin mutations use this instead of broad
 * admin-write RLS policies, per the rls_policies migration design note.
 */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
