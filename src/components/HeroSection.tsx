import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function HeroSection() {
  const t = useTranslations("Hero");

  return (
    <section className="relative flex flex-col items-center justify-center px-6 py-20 text-center overflow-hidden md:py-32">
      {/* Stadium gradient backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, #1a2742 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 50% 100%, #0a0f1e 0%, transparent 80%)",
        }}
      />
      {/* Green pitch glow at the top */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-px w-3/4 bg-gradient-to-r from-transparent via-green-500/30 to-transparent"
      />

      <div className="relative z-10 flex flex-col items-center gap-6 max-w-sm md:max-w-xl">
        <p className="text-2xl tracking-widest" aria-hidden="true">
          {t("hosts")}
        </p>

        <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-text-primary md:text-5xl">
          {t("title")}
        </h1>

        <p className="text-lg text-text-muted md:text-xl">{t("tagline")}</p>

        <Link
          href="/login"
          aria-disabled="true"
          tabIndex={-1}
          className="pointer-events-none mt-2 inline-flex items-center justify-center rounded-full bg-gold-500 px-8 py-3 text-base font-semibold text-pitch-950 opacity-50 transition-opacity"
        >
          {t("signInButton")}
        </Link>
      </div>
    </section>
  );
}
