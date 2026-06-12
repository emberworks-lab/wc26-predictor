import { useTranslations } from "next-intl";

const CHALLENGE_KEYS = ["full", "groups", "playoff", "fun"] as const;

export default function ChallengesSection() {
  const t = useTranslations("Challenges");

  return (
    <section className="px-4 py-12 md:py-20">
      <h2 className="mb-8 text-center text-xl font-bold text-text-primary md:text-2xl">
        {t("heading")}
      </h2>

      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {CHALLENGE_KEYS.map((key) => (
          <div
            key={key}
            className="flex flex-col gap-2 rounded-2xl border border-pitch-700 bg-pitch-800 p-5 transition-colors hover:border-gold-600"
          >
            <span className="text-3xl" aria-hidden="true">
              {t(`items.${key}.emoji`)}
            </span>
            <h3 className="text-base font-semibold text-text-primary">
              {t(`items.${key}.title`)}
            </h3>
            <p className="text-sm leading-relaxed text-text-muted">
              {t(`items.${key}.description`)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
