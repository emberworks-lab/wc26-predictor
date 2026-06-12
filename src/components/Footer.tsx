import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

export default function Footer() {
  const t = useTranslations("Footer");

  return (
    <footer className="mt-auto flex flex-col items-center gap-2 border-t border-pitch-700 px-4 py-6 text-center text-sm text-text-muted">
      <Link
        href="/rules"
        className="font-medium text-gold-400 underline-offset-2 hover:underline"
      >
        {t("rulesLink")}
      </Link>
      <span>{t("tagline")}</span>
    </footer>
  );
}
