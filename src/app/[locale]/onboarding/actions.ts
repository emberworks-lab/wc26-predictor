"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export interface OnboardingState {
  status: "idle" | "error";
  /** Message key under Onboarding.errors. */
  error?: "invalidName" | "nameTaken" | "generic";
}

/** 3–20 chars: letters (any script), digits, space, _ . - */
const NAME_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_ .-]{1,18}[\p{L}\p{N}_.]$/u;

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = (routing.locales as readonly string[]).includes(rawLocale)
    ? rawLocale
    : routing.defaultLocale;

  if (!NAME_RE.test(displayName)) {
    return { status: "error", error: "invalidName" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/sign-in`);
  }

  // The citext unique constraint is the real (server-side) uniqueness check;
  // 23505 = someone else owns this name, case-insensitively.
  const { error } = await supabase.from("profiles").insert({
    id: user.id,
    display_name: displayName,
    locale,
  });

  if (error) {
    if (error.code === "23505") {
      return { status: "error", error: "nameTaken" };
    }
    return { status: "error", error: "generic" };
  }

  revalidatePath(`/${locale}`, "layout");
  redirect(`/${locale}/challenges`);
}
