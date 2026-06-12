"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function signOut(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}`);
}
