"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";

import { submitEntry, withdrawEntry } from "./actions";

/**
 * Submit / Withdraw controls for a challenge entry (Stage 9 items 19 + 20).
 * Shared by the challenge CARD and the END of every prediction flow so the
 * "I'm done" action lives in both places. Submit finalizes the entry
 * (read-only + on the leaderboard); Withdraw clears `submitted_at` only —
 * no prediction is erased — re-opening editing for not-yet-kicked-off matches
 * while the challenge is still unlocked.
 *
 * Server-side is the trust boundary (entries_update RLS + the can_edit_*
 * submitted guard); this just drives the two actions and refreshes.
 */
export default function EntrySubmitControls({
  entryId,
  submitted,
  locked,
  missing = 0,
  variant = "card",
}: {
  entryId: string;
  submitted: boolean;
  /** The challenge itself is locked — neither submit nor withdraw is possible. */
  locked: boolean;
  /** Still-fillable picks not yet made (drives the submit warning). */
  missing?: number;
  variant?: "card" | "flow";
}) {
  const t = useTranslations("Submit");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (locked) return null;

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  const btnPrimary =
    "rounded-full bg-gold-500 px-5 py-2 text-xs font-semibold text-pitch-950 transition-colors hover:bg-gold-400 disabled:opacity-60";
  const btnGhost =
    "rounded-full border border-pitch-700 bg-pitch-800 px-5 py-2 text-xs font-semibold text-text-primary transition-colors hover:border-gold-500/40 disabled:opacity-60";

  if (submitted) {
    const inner = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-success">
            <span aria-hidden="true">✓</span>
            {t("submittedTitle")}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => withdrawEntry(entryId))}
            className={btnGhost}
          >
            {pending ? t("withdrawing") : t("withdraw")}
          </button>
        </div>
        <p className="text-[11px] text-text-muted">{t("withdrawHint")}</p>
      </>
    );
    return variant === "flow" ? (
      <div className="flex flex-col gap-2 rounded-2xl border border-success/30 bg-pitch-800 p-5">
        {inner}
      </div>
    ) : (
      <div className="flex flex-col gap-2">{inner}</div>
    );
  }

  const inner = (
    <>
      {variant === "flow" && <p className="text-sm font-bold">{t("readyTitle")}</p>}
      {missing > 0 && (
        <p className="rounded-lg bg-gold-500/10 px-3 py-2 text-[11px] text-gold-400">
          {t("warning", { count: missing })}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => submitEntry(entryId))}
        className={`${btnPrimary} ${variant === "flow" ? "self-start" : ""}`}
      >
        {pending ? t("submitting") : t("submit")}
      </button>
      <p className="text-[11px] text-text-muted">{t("submitHint")}</p>
    </>
  );

  return variant === "flow" ? (
    <div className="flex flex-col gap-2 rounded-2xl border border-gold-500/40 bg-pitch-800 p-5">
      {inner}
    </div>
  ) : (
    <div className="flex flex-col gap-2">{inner}</div>
  );
}
