"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";

const SECTIONS = [
  { href: "/admin", key: "sync" },
  { href: "/admin/matches", key: "matches" },
  { href: "/admin/challenges", key: "challenges" },
  { href: "/admin/users", key: "users" },
  { href: "/admin/fun", key: "fun" },
] as const;

export default function AdminNav() {
  const t = useTranslations("Admin.nav");
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-1.5">
      {SECTIONS.map((s) => {
        const isActive =
          s.href === "/admin" ? pathname === "/admin" : pathname.startsWith(s.href);
        return (
          <Link
            key={s.key}
            href={s.href}
            aria-current={isActive ? "page" : undefined}
            className={[
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              isActive
                ? "bg-gold-500 text-pitch-950"
                : "border border-pitch-700 bg-pitch-800 text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {t(s.key)}
          </Link>
        );
      })}
    </nav>
  );
}
