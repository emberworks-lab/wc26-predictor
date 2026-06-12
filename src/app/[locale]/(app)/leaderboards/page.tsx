import { getTranslations } from "next-intl/server";

export default async function LeaderboardsPage() {
  const t = await getTranslations("Leaderboards");

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1>
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-pitch-700 bg-pitch-800 p-10 text-center">
        <span aria-hidden="true" className="text-3xl">
          🥇
        </span>
        <p className="text-sm text-text-muted">{t("comingSoon")}</p>
      </div>
    </section>
  );
}
