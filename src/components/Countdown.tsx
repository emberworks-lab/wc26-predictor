"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** Live "Xd Yh Zm" countdown to a deadline; renders nothing once passed. */
export default function Countdown({ to }: { to: string }) {
  const t = useTranslations("Countdown");
  // null until mounted — the server can't know "now", so SSR renders nothing.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(new Date(to).getTime() - Date.now());
    tick();
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, [to]);

  if (remaining == null || remaining <= 0) return null;

  const minutes = Math.floor(remaining / 60_000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;

  const text =
    days > 0
      ? t("daysHours", { days, hours })
      : hours > 0
        ? t("hoursMinutes", { hours, minutes: mins })
        : t("minutes", { minutes: mins });

  return (
    <span className="font-mono text-xs text-gold-400" suppressHydrationWarning>
      {t("prefix", { remaining: text })}
    </span>
  );
}
