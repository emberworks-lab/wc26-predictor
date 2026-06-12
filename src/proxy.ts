import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { routing } from "./i18n/routing";

const handleI18n = createMiddleware(routing);

/**
 * Locale routing + Supabase session refresh. The i18n middleware produces the
 * response (possibly a locale redirect); the Supabase client then refreshes an
 * expired auth session and writes the rotated cookies onto that response so
 * server components always see a valid session.
 */
export default async function proxy(request: NextRequest) {
  const response = handleI18n(request);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touching auth state triggers the token refresh when needed.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Match all pathnames except for
    // - …if they start with `/api`, `/auth` (Supabase callback), `/_next` or `/_vercel`
    // - …the ones containing a dot (e.g. `favicon.ico`)
    "/((?!api|auth|_next|_vercel|.*\\..*).*)",
  ],
};
