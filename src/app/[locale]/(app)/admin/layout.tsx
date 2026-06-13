import { getTranslations } from "next-intl/server";

import AdminNav from "@/app/[locale]/(app)/admin/AdminNav";
import { redirect } from "@/i18n/navigation";
import { getAdminUserId } from "@/lib/admin/guard";

/**
 * Role gate for the admin area. The (app) layout already requires a session +
 * profile; this adds role === 'admin'. Server actions re-check on their own —
 * this redirect is UX, not the enforcement point.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(await getAdminUserId())) {
    redirect({ href: "/challenges", locale });
  }
  const t = await getTranslations("Admin");

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1>
      <AdminNav />
      {children}
    </section>
  );
}
