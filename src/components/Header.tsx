import { getTranslations } from "next-intl/server";

import Brand from "@/components/Brand";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

import LocaleSwitcher from "./LocaleSwitcher";

export default async function Header() {
  const t = await getTranslations("Header");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName: string | null = null;
  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, role, banned_at")
      .eq("id", user.id)
      .maybeSingle();
    displayName = profile?.display_name ?? null;
    isAdmin = profile?.role === "admin" && profile.banned_at === null;
  }

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between gap-2 border-b border-pitch-700 bg-pitch-900/90 px-4 py-3 backdrop-blur-sm">
      <Link href="/" className="min-w-0">
        <Brand wordmark={t("wordmark")} />
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <LocaleSwitcher />
        {isAdmin && (
          <Link
            href="/admin"
            className="rounded-full border border-pitch-700 bg-pitch-800 px-3 py-1.5 text-xs font-semibold text-text-muted transition-colors hover:border-gold-500 hover:text-gold-400"
          >
            {t("admin")}
          </Link>
        )}
        {user ? (
          <Link
            href="/profile"
            className="max-w-32 truncate rounded-full border border-pitch-700 bg-pitch-800 px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:border-gold-500"
          >
            {displayName ?? t("account")}
          </Link>
        ) : (
          <Link
            href="/sign-in"
            className="whitespace-nowrap rounded-full bg-gold-500 px-4 py-1.5 text-xs font-semibold text-pitch-950 transition-colors hover:bg-gold-400"
          >
            {t("signIn")}
          </Link>
        )}
      </div>
    </header>
  );
}
