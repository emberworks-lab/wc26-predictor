import { redirect } from "@/i18n/navigation";

/**
 * The marketing landing was dropped (Stage 9 item 8): a friends app gains
 * nothing from a hero page. `/[locale]` now lands straight on the public
 * Tournament tab. Logged-out visitors keep the public tabs; auth-gated tabs
 * redirect to sign-in via the (app) layout. The sign-in page itself stays.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/tournament", locale });
}
