import { headers } from "next/headers";

const FALLBACK_ORIGIN = "https://wc26-predictor-gilt.vercel.app";

/** Request origin for auth redirects (works on Vercel previews + localhost). */
export async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return FALLBACK_ORIGIN;
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
