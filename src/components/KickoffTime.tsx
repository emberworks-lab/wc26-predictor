"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "next-intl";

/** SPEC default when the user's timezone is unknown (SSR pass). */
const DEFAULT_TZ = "Europe/Kyiv";

// The browser timezone is external, immutable state: no subscription needed.
const noopSubscribe = () => () => {};
const getBrowserTz = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ;
const getServerTz = () => DEFAULT_TZ;

export interface KickoffTimeProps {
  utc: string | Date;
  /** "none" renders the time only (e.g. schedule rows under a date header). */
  dateStyle?: Intl.DateTimeFormatOptions["dateStyle"] | "none";
  timeStyle?: Intl.DateTimeFormatOptions["timeStyle"];
  className?: string;
}

/**
 * The one shared kickoff/deadline renderer: stores UTC, shows the user's
 * local time. SSR renders Europe/Kyiv; the client swaps in the browser
 * timezone after hydration (suppressHydrationWarning bridges the two).
 */
export default function KickoffTime({
  utc,
  dateStyle = "medium",
  timeStyle = "short",
  className,
}: KickoffTimeProps) {
  const locale = useLocale();
  const timeZone = useSyncExternalStore(noopSubscribe, getBrowserTz, getServerTz);

  const date = typeof utc === "string" ? new Date(utc) : utc;
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: dateStyle === "none" ? undefined : dateStyle,
    timeStyle,
    timeZone,
  }).format(date);

  return (
    <time dateTime={date.toISOString()} className={className} suppressHydrationWarning>
      {formatted}
    </time>
  );
}
