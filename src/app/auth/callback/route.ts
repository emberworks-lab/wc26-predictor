import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";

/**
 * OAuth + magic-link landing point (outside the [locale] tree — excluded from
 * the i18n middleware). Exchanges the auth code for a session, then sends the
 * user to `next` (always locale-prefixed by the sign-in actions).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? `/${routing.defaultLocale}/challenges`;
  // Only allow same-origin relative targets.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  const locale =
    routing.locales.find((l) => safeNext.startsWith(`/${l}/`)) ?? routing.defaultLocale;
  return NextResponse.redirect(`${origin}/${locale}/sign-in?error=auth`);
}
