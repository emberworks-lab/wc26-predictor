"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { setChallengeOverride } from "@/app/[locale]/(app)/admin/actions";

const OPTIONS = [null, "open", "locked"] as const;

export default function OverrideControl({
  challengeId,
  current,
}: {
  challengeId: number;
  current: string | null;
}) {
  const t = useTranslations("Admin.challenges");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const apply = (value: "open" | "locked" | null) => {
    setMessage(null);
    startTransition(async () => {
      const res = await setChallengeOverride(challengeId, value);
      if (!res.ok) setMessage(res.message);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {OPTIONS.map((value) => {
        const active = current === value || (value === null && current === null);
        return (
          <button
            key={value ?? "auto"}
            type="button"
            disabled={pending}
            onClick={() => apply(value)}
            className={[
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
              active
                ? "bg-gold-500 text-pitch-950"
                : "border border-pitch-700 bg-pitch-800 text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {value === null ? t("auto") : value === "open" ? t("forceOpen") : t("forceLocked")}
          </button>
        );
      })}
      {message && <span className="text-xs text-danger">{message}</span>}
    </div>
  );
}
