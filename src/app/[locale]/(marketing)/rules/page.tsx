import { getTranslations, setRequestLocale } from "next-intl/server";

import KickoffTime from "@/components/KickoffTime";
import { POINTS } from "@/engine/scoring";
import { createClient } from "@/lib/supabase/server";

/** SPEC → "Knockout redistribution": multiplier by stage redistributed before. */
const REDISTRIBUTION = [
  { stage: "r32", multiplier: 0.7 },
  { stage: "r16", multiplier: 0.6 },
  { stage: "qf", multiplier: 0.5 },
  { stage: "sf", multiplier: 0.4 },
  { stage: "final", multiplier: 0.3 },
] as const;

function RuleTable({
  caption,
  rows,
}: {
  caption: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <table className="w-full border-collapse overflow-hidden rounded-2xl text-sm">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-pitch-700 last:border-b-0">
            <td className="bg-pitch-800 px-4 py-2.5">{row.label}</td>
            <td className="w-24 bg-pitch-800 px-4 py-2.5 text-right font-mono font-semibold text-gold-400">
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function RulesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Rules");

  const supabase = await createClient();
  const { data: challenges } = await supabase
    .from("challenges")
    .select("kind, locks_at");
  const lockOf = (kind: string) =>
    challenges?.find((c) => c.kind === kind)?.locks_at ?? null;
  const mainLock = lockOf("full");
  const playoffLock = lockOf("playoff");

  const pts = (n: number) => t("pts", { points: n });

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-5 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-text-muted">{t("intro")}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-gold-400">{t("deadlines.title")}</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-text-muted">
          <li>
            {t("deadlines.main")}{" "}
            {mainLock && <KickoffTime utc={mainLock} className="text-text-primary" />}
          </li>
          <li>
            {t("deadlines.playoff")}{" "}
            {playoffLock && (
              <KickoffTime utc={playoffLock} className="text-text-primary" />
            )}
          </li>
          <li>{t("deadlines.kickedOff")}</li>
          <li>{t("deadlines.serverSide")}</li>
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-gold-400">{t("hardcore.title")}</h2>
        <p className="text-sm text-text-muted">{t("hardcore.body")}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-gold-400">{t("group.title")}</h2>
        <RuleTable
          caption={t("group.title")}
          rows={[
            { label: t("group.outcome"), value: pts(POINTS.groupOutcome) },
            { label: t("group.exactOrder"), value: pts(POINTS.groupExactOrder) },
            { label: t("group.top2"), value: pts(POINTS.qualifierTop2) },
            { label: t("group.third"), value: pts(POINTS.qualifierThird) },
          ]}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-gold-400">{t("knockout.title")}</h2>
        <p className="text-sm text-text-muted">{t("knockout.note")}</p>
        <RuleTable
          caption={t("knockout.title")}
          rows={[
            { label: t("knockout.r16"), value: pts(POINTS.reach.R16) },
            { label: t("knockout.qf"), value: pts(POINTS.reach.QF) },
            { label: t("knockout.sf"), value: pts(POINTS.reach.SF) },
            { label: t("knockout.final"), value: pts(POINTS.reach.F) },
            { label: t("knockout.champion"), value: pts(POINTS.champion) },
            { label: t("knockout.thirdPlace"), value: pts(POINTS.thirdPlaceWinner) },
            { label: t("knockout.aetFlag"), value: `+${POINTS.aetFlag}` },
          ]}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-gold-400">{t("hardcoreTable.title")}</h2>
        <p className="text-sm text-text-muted">{t("hardcoreTable.note")}</p>
        <RuleTable
          caption={t("hardcoreTable.title")}
          rows={[
            { label: t("hardcoreTable.exactScore"), value: pts(POINTS.hcExactScore) },
            { label: t("hardcoreTable.goalDiff"), value: pts(POINTS.hcGoalDiff) },
            { label: t("hardcoreTable.advancePick"), value: pts(POINTS.hcAdvancePick) },
          ]}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-gold-400">{t("fun.title")}</h2>
        <p className="text-sm text-text-muted">{t("fun.body")}</p>
        <RuleTable
          caption={t("fun.title")}
          rows={[
            { label: t("fun.pick"), value: pts(POINTS.funPickExact) },
            { label: t("fun.yesNo"), value: pts(POINTS.funYesNo) },
            { label: t("fun.numeric"), value: t("fun.numericValue") },
          ]}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-gold-400">
          {t("redistribution.title")}
        </h2>
        <p className="text-sm text-text-muted">{t("redistribution.body")}</p>
        <RuleTable
          caption={t("redistribution.title")}
          rows={REDISTRIBUTION.map((r) => ({
            label: t(`redistribution.stages.${r.stage}`),
            value: `×${r.multiplier}`,
          }))}
        />
        <p className="text-xs text-text-muted">{t("redistribution.note")}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-gold-400">{t("tiebreakers.title")}</h2>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text-muted">
          <li>{t("tiebreakers.qualifiers")}</li>
          <li>{t("tiebreakers.koPicks")}</li>
          <li>{t("tiebreakers.outcomes")}</li>
          <li>{t("tiebreakers.registration")}</li>
        </ol>
      </div>
    </section>
  );
}
