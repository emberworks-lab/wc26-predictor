"use server";

import { redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { getOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export interface MagicLinkState {
  status: "idle" | "sent" | "error";
  /** Message key under SignIn.errors. */
  error?: "invalidEmail" | "rateLimited" | "generic";
}

const isLocale = (l: string): l is (typeof routing.locales)[number] =>
  (routing.locales as readonly string[]).includes(l);

function safeLocale(raw: FormDataEntryValue | null): string {
  const l = typeof raw === "string" ? raw : "";
  return isLocale(l) ? l : routing.defaultLocale;
}

export async function sendMagicLink(
  _prev: MagicLinkState,
  formData: FormData
): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim();
  const locale = safeLocale(formData.get("locale"));

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", error: "invalidEmail" };
  }

  const supabase = await createClient();
  const origin = await getOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/${locale}/challenges`,
    },
  });

  if (error) {
    return {
      status: "error",
      error: error.status === 429 ? "rateLimited" : "generic",
    };
  }
  return { status: "sent" };
}

export async function signInWithGoogle(formData: FormData) {
  const locale = safeLocale(formData.get("locale"));
  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=/${locale}/challenges`,
    },
  });

  if (error || !data.url) {
    redirect(`/${locale}/sign-in?error=auth`);
  }
  redirect(data.url);
}
