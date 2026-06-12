"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export default function LocaleSwitcher() {
  const t = useTranslations("Header.switchLocale");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchLocale(next: string) {
    router.replace(pathname, { locale: next });
  }

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-pitch-700 bg-pitch-800 px-1 py-1"
      role="group"
      aria-label="Language switcher"
    >
      {routing.locales.map((loc) => {
        const isActive = loc === locale;
        return (
          <button
            key={loc}
            onClick={() => switchLocale(loc)}
            aria-pressed={isActive}
            className={[
              "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors",
              isActive
                ? "bg-gold-500 text-pitch-950"
                : "text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {t(loc)}
          </button>
        );
      })}
    </div>
  );
}
