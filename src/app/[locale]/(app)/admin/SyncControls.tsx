"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { forceSync } from "@/app/[locale]/(app)/admin/actions";
import type { SyncMode } from "@/lib/admin/types";

const MODES: SyncMode[] = ["fixtures", "stats", "recompute"];

export default function SyncControls() {
  const t = useTranslations("Admin.sync");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<SyncMode | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const run = (mode: SyncMode) => {
    setRunning(mode);
    setResult(null);
    startTransition(async () => {
      const res = await forceSync(mode);
      setRunning(null);
      setResult(res.ok ? `${mode}: ${res.detail ?? "ok"}` : `${mode}: ${res.message}`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-pitch-700 bg-pitch-900 p-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">
        {t("forceTitle")}
      </h2>
      <div className="flex flex-wrap gap-2">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={pending}
            onClick={() => run(mode)}
            className="rounded-full bg-gold-500 px-4 py-1.5 text-xs font-semibold text-pitch-950 transition-colors hover:bg-gold-400 disabled:opacity-50"
          >
            {running === mode ? t("running") : mode}
          </button>
        ))}
      </div>
      {result && (
        <p className="break-all font-mono text-[11px] text-text-muted">{result}</p>
      )}
    </div>
  );
}
