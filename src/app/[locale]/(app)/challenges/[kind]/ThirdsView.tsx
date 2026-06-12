"use client";

import { useTranslations } from "next-intl";

import type { DerivedGroups, TeamIndex } from "@/lib/predictions/derive";

/**
 * The predicted third-place ranking (engine bestThirds): all 12 thirds,
 * best first, the top 8 marked as qualified. Groups challenge ends here;
 * Full continues to the bracket.
 */
export default function ThirdsView({
  derived,
  challengeKind,
  index,
  onToBracket,
}: {
  derived: DerivedGroups;
  challengeKind: "full" | "groups";
  index: TeamIndex;
  onToBracket: () => void;
}) {
  const t = useTranslations("Predict.thirds");

  if (!derived.thirds) {
    const missing = 12 - derived.groups.filter((g) => g.complete).length;
    return (
      <div className="rounded-2xl border border-pitch-700 bg-pitch-800 p-5 text-sm text-text-muted">
        <p>{t("incomplete")}</p>
        <p className="mt-2 font-semibold text-gold-400">{t("missing", { count: missing })}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">{t("title")}</h2>
        <p className="mt-1 text-xs text-text-muted">{t("subtitle")}</p>
      </div>

      <ol className="flex flex-col gap-1.5">
        {derived.thirds.ranking.map((e, i) => {
          const team = index.byCode.get(e.row.team)!;
          const qualified = i < 8;
          return (
            <li
              key={e.row.team}
              className={[
                "flex items-center gap-3 rounded-xl border px-4 py-2.5",
                qualified
                  ? "border-gold-500/40 bg-pitch-800"
                  : "border-pitch-700 bg-pitch-900 opacity-60",
              ].join(" ")}
            >
              <span className="w-5 font-mono text-xs text-text-muted">{i + 1}</span>
              <span className="flex flex-1 items-center gap-2 text-sm font-semibold">
                <span aria-hidden="true">{team.flag}</span>
                {team.name}
                <span className="text-[11px] font-normal text-text-muted">({e.group})</span>
              </span>
              <span className="font-mono text-xs text-text-muted">
                {e.row.points} · {e.row.goalDiff > 0 ? `+${e.row.goalDiff}` : e.row.goalDiff}
              </span>
              <span
                className={[
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
                  qualified ? "bg-success/15 text-success" : "bg-pitch-700 text-text-muted",
                ].join(" ")}
              >
                {qualified ? t("qualifies") : t("out")}
              </span>
            </li>
          );
        })}
      </ol>

      {challengeKind === "full" ? (
        <button
          type="button"
          onClick={onToBracket}
          className="self-end rounded-full bg-gold-500 px-5 py-2 text-xs font-semibold text-pitch-950 transition-colors hover:bg-gold-400"
        >
          {t("cta")}
        </button>
      ) : (
        <p className="rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-3 text-sm text-success">
          {t("groupsDone")}
        </p>
      )}
    </div>
  );
}
