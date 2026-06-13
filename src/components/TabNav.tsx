"use client";

import { CircleUser, Goal, Medal, Target, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";

const TABS: ReadonlyArray<{ href: string; key: string; Icon: LucideIcon }> = [
  { href: "/challenges", key: "challenges", Icon: Target },
  { href: "/tournament", key: "tournament", Icon: Goal },
  { href: "/leaderboards", key: "leaderboards", Icon: Medal },
  { href: "/profile", key: "profile", Icon: CircleUser },
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
                  "flex flex-col items-center gap-0.5 px-3 py-2 text-[11px] font-medium transition-colors md:flex-row md:gap-2 md:py-3 md:text-sm",
                  isActive
                    ? "text-gold-400"
                    : "text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                <tab.Icon className="size-5 md:size-4" aria-hidden="true" />
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
