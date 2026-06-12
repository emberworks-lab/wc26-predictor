import { useTranslations } from "next-intl";

export default function Footer() {
  const t = useTranslations("Footer");

  return (
    <footer className="mt-auto border-t border-pitch-700 px-4 py-6 text-center text-sm text-text-muted">
      {t("tagline")}
    </footer>
  );
}
