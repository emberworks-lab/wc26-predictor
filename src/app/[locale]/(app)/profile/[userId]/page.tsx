import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

import ProfileView from "../ProfileView";

/** Another user's public profile (own profile lives at /profile). */
export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>;
}) {
  const { locale, userId } = await params;
  const t = await getTranslations("Profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === userId) {
    redirect({ href: "/profile", locale });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) notFound();

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight">{profile!.display_name}</h1>
        <p className="text-xs text-text-muted">
          {t("memberSince")}{" "}
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeZone: "UTC",
          }).format(new Date(profile!.created_at))}
        </p>
      </div>
      <p className="text-[11px] text-text-muted">{t("visitorNote")}</p>
      <ProfileView userId={userId} isOwner={false} />
    </section>
  );
}
