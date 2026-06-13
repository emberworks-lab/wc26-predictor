"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";

// Tournament first (Stage 9 item 24) — the public live-data tab is the landing
// surface and the most-visited. Iconless: clean typographic nav.
const TABS: ReadonlyArray<{ href: string; key: string }> = [
  { href: "/tournament", key: "tournament" },
  { href: "/challenges", key: "challenges" },
  { href: "/leaderboards", key: "leaderboards" },
  { href: "/profile", key: "profile" },
];

/** Bottom tab bar on mobile, horizontal nav under the header on desktop. */
export default function TabNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-pitch-700 bg-pitch-900/95 backdrop-blur-sm md:sticky md:top-[57px] md:bottom-auto md:border-t-0 md:border-b md:bg-pitch-900/80"
    >
      <ul className="mx-auto flex max-w-3xl items-stretch justify-around md:justify-start md:gap-2 md:px-4">
        {TABS.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <li key={tab.key} className="flex-1 md:flex-none">
              <Link
                href={tab.href}
                prefetch
                aria-current={isActive ? "page" : undefined}
                className={[
                  "flex items-center justify-center px-3 py-3 text-xs font-semibold transition-colors md:text-sm",
                  isActive ? "text-gold-400" : "text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
