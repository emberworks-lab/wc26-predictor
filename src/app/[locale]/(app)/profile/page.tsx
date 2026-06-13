import { Flame } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";

import { signOut } from "./actions";
import ProfileView from "./ProfileView";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("Profile");
  const tc = await getTranslations("Challenges.items");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: entries }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, locale, role, created_at")
      .eq("id", user!.id)
      .single(),
    supabase
      .from("challenge_entries")
      .select("id, hardcore, challenges(kind)")
      .eq("user_id", user!.id),
  ]);

  const hardcoreKinds = (entries ?? [])
    .filter((e) => e.hardcore)
    .map((e) => e.challenges?.kind)
    .filter((k): k is NonNullable<typeof k> => k != null);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1>

      <div className="flex flex-col gap-4 rounded-2xl border border-pitch-700 bg-pitch-800 p-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-text-muted">
            {t("displayName")}
          </p>
          <p className="text-lg font-bold">{profile?.display_name}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-text-muted">
            {t("preferredLocale")}
          </p>
          <p className="text-sm">{t(`locales.${profile?.locale ?? "en"}`)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-text-muted">
            {t("hardcoreBadges")}
          </p>
          {hardcoreKinds.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {hardcoreKinds.map((kind) => (
                <span
                  key={kind}
                  className="inline-flex items-center gap-1 rounded-full bg-gold-500/15 px-3 py-1 text-xs font-semibold text-gold-400"
                >
                  <Flame className="size-3.5" aria-hidden="true" />
                  {tc(`${kind}.title`)}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">{t("noHardcore")}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
          {t("myPredictions")}
        </h2>
        <ProfileView userId={user!.id} isOwner />
      </div>

      <form action={signOut} className="flex">
        <input type="hidden" name="locale" value={locale} />
        <button
          type="submit"
          className="rounded-full border border-pitch-700 px-6 py-2.5 text-sm font-semibold text-danger transition-colors hover:border-danger"
        >
          {t("signOut")}
        </button>
      </form>
    </section>
  );
}
