import Header from "@/components/Header";
import TabNav from "@/components/TabNav";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Protected shell: requires a session AND a completed onboarding (= profiles
 * row exists; there is deliberately no auth trigger — onboarding creates it).
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect({ href: "/sign-in", locale });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, banned_at")
    .eq("id", user!.id)
    .maybeSingle();
  if (!profile) {
    redirect({ href: "/onboarding", locale });
  }
  // Banned users lose app access immediately (RLS already refuses their
  // writes and hides them from boards; the auth-level ban stops sign-ins).
  if (profile!.banned_at !== null) {
    redirect({ href: { pathname: "/sign-in", query: { banned: "1" } }, locale });
  }

  return (
    <div className="flex min-h-screen flex-col bg-pitch-950">
      <Header />
      <TabNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24 md:pb-10">
        {children}
      </main>
    </div>
  );
}
