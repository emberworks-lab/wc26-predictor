import { getTranslations } from "next-intl/server";

import Header from "@/components/Header";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect({ href: "/sign-in", locale });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user!.id)
    .maybeSingle();
  if (profile) {
    redirect({ href: "/challenges", locale });
  }

  const t = await getTranslations("Onboarding");

  return (
    <div className="flex min-h-screen flex-col bg-pitch-950">
      <Header />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-12">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-text-muted">{t("subtitle")}</p>
        </div>
        <OnboardingForm />
      </main>
    </div>
  );
}
