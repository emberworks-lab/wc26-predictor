"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type { CopyResult } from "@/lib/predictions/copy";

import { copyPredictions } from "./actions";

/**
 * One-click "use my Full Tournament predictions as a template" (Stage 9 item
 * 3). Surfaced on the Groups / Playoff cards once the user has both a Full
 * entry with predictions and a (joined, open) target entry. The action runs on
 * the user's JWT; this only confirms, calls it, and reports what was copied or
 * skipped.
 */
export default function CopyFromFull({
  sourceEntryId,
  targetEntryId,
}: {
  sourceEntryId: string;
  targetEntryId: string;
}) {
  const t = useTranslations("ChallengesHome.copy");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CopyResult | null>(null);

  const run = () => {
    if (!window.confirm(t("confirm"))) return;
    setResult(null);
    startTransition(async () => {
      const res = await copyPredictions({ sourceEntryId, targetEntryId }).catch(
        () => ({ ok: false as const, code: "error" as const }),
      );
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  const skips = result?.ok
    ? [
        result.skippedLocked > 0 ? t("skippedLocked", { count: result.skippedLocked }) : null,
        result.skippedNeedsScore > 0
          ? t("skippedNeedsScore", { count: result.skippedNeedsScore })
          : null,
        result.skippedMismatch > 0
          ? t("skippedMismatch", { count: result.skippedMismatch })
          : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 self-start rounded-full border border-pitch-700 bg-pitch-800 px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:border-gold-500/40 disabled:opacity-50"
      >
        <Copy className="size-3.5" aria-hidden="true" />
        {pending ? t("copying") : t("button")}
      </button>
      {result &&
        (result.ok ? (
          <p className="text-[11px] text-success">
            {t("done", { count: result.copied })}
            {skips.length > 0 && <span className="text-text-muted"> {skips.join(" ")}</span>}
          </p>
        ) : (
          <p className="text-[11px] text-danger">{t(`error.${result.code}`)}</p>
        ))}
    </div>
  );
}
