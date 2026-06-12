import { useTranslations } from "next-intl";
import LocaleSwitcher from "./LocaleSwitcher";

export default function Header() {
  const t = useTranslations("Header");

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-4 py-3 border-b border-pitch-700 bg-pitch-900/90 backdrop-blur-sm">
      <span className="text-lg font-bold tracking-tight text-gold-400">
        {t("wordmark")}
      </span>
      <LocaleSwitcher />
    </header>
  );
}
