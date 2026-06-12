"use client";

import { useTranslations } from "next-intl";

import KickoffTime from "@/components/KickoffTime";
import {
  isGroupMatchLocked,
  type DerivedGroup,
  type TeamIndex,
} from "@/lib/predictions/derive";
import type {
  GroupMatchDTO,
  LocalPrediction,
  PredictionOutcome,
} from "@/lib/predictions/types";

import type { RowStatus } from "./PredictionFlow";

function TeamLabel({ teamId, index, away }: { teamId: number; index: TeamIndex; away?: boolean }) {
  const team = index.byId.get(teamId)!;
  return (
    <span className={`flex items-center gap-1.5 text-sm font-semibold ${away ? "flex-row-reverse" : ""}`}>
      <span aria-hidden="true">{team.flag}</span>
      <span>{team.code}</span>
    </span>
  );
}

function Stepper({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | undefined;
  onChange: (next: number) => void;
  disabled: boolean;
  label: string;
}) {
  const shown = value ?? 0;
  const btn =
    "h-8 w-8 rounded-full bg-pitch-700 text-base font-bold leading-none text-text-primary transition-colors enabled:hover:bg-pitch-700/70 disabled:opacity-40";
  return (
    <span className="flex items-center gap-1.5" aria-label={label}>
      <button type="button" className={btn} disabled={disabled} onClick={() => onChange(Math.max(0, shown - 1))}>
        −
      </button>
      <span
        className={`w-6 text-center font-mono text-base font-bold ${value === undefined ? "text-text-muted" : "text-text-primary"}`}
      >
        {shown}
      </span>
      <button type="button" className={btn} disabled={disabled} onClick={() => onChange(Math.min(99, shown + 1))}>
        +
      </button>
    </span>
  );
}

function MatchRow({
  match,
  pred,
  status,
  hardcore,
  readOnly,
  now,
  index,
  onPick,
}: {
  match: GroupMatchDTO;
  pred: LocalPrediction | undefined;
  status: RowStatus | undefined;
  hardcore: boolean;
  readOnly: boolean;
  now: Date;
  index: TeamIndex;
  onPick: (matchId: number, value: LocalPrediction) => void;
}) {
  const t = useTranslations("Predict.group");
  const tp = useTranslations("Predict");
  const locked = readOnly || isGroupMatchLocked(match, now);
  const finished = match.status === "finished";
  const hasRealScore = match.homeScore != null && match.awayScore != null;
  const needsScore =
    hardcore && pred?.outcome !== undefined && (pred.homeScore === undefined || pred.awayScore === undefined);

  const pickOutcome = (outcome: PredictionOutcome) => onPick(match.id, { outcome });
  const pickScore = (side: "home" | "away", value: number) => {
    const homeScore = side === "home" ? value : (pred?.homeScore ?? 0);
    const awayScore = side === "away" ? value : (pred?.awayScore ?? 0);
    const outcome: PredictionOutcome =
      homeScore > awayScore ? "home" : homeScore < awayScore ? "away" : "draw";
    onPick(match.id, { outcome, homeScore, awayScore });
  };

  const outcomeBtn = (selected: boolean) =>
    [
      "flex-1 rounded-lg px-2 py-2 text-xs font-bold uppercase tracking-wide transition-colors",
      selected
        ? "bg-gold-500 text-pitch-950"
        : "bg-pitch-700 text-text-muted enabled:hover:text-text-primary disabled:opacity-50",
    ].join(" ");

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-pitch-700 bg-pitch-900 p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
        <TeamLabel teamId={match.homeTeamId} index={index} />
        <span className="font-mono">
          {hasRealScore ? (
            <>
              {match.homeScore}–{match.awayScore}{" "}
              <span className="text-[10px] uppercase">{finished ? t("ft") : t("live")}</span>
            </>
          ) : (
            <KickoffTime utc={match.kickoffUtc} dateStyle="short" />
          )}
        </span>
        <TeamLabel teamId={match.awayTeamId} index={index} away />
      </div>

      {locked ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">🔒 {t("locked")}</span>
          {pred?.outcome ? (
            <span className="font-semibold text-text-primary">
              {pred.homeScore !== undefined && pred.awayScore !== undefined
                ? `${pred.homeScore}:${pred.awayScore}`
                : pred.outcome === "home"
                  ? `1 — ${index.byId.get(match.homeTeamId)!.code}`
                  : pred.outcome === "away"
                    ? `2 — ${index.byId.get(match.awayTeamId)!.code}`
                    : t("draw")}
            </span>
          ) : (
            <span className="rounded-full bg-danger/15 px-2 py-0.5 font-semibold text-danger">
              {t("lockedNoPick")}
            </span>
          )}
        </div>
      ) : hardcore ? (
        <div className="flex items-center justify-between">
          <Stepper
            value={pred?.homeScore}
            disabled={locked}
            label={index.byId.get(match.homeTeamId)!.code}
            onChange={(v) => pickScore("home", v)}
          />
          <span className="text-text-muted">:</span>
          <Stepper
            value={pred?.awayScore}
            disabled={locked}
            label={index.byId.get(match.awayTeamId)!.code}
            onChange={(v) => pickScore("away", v)}
          />
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button type="button" className={outcomeBtn(pred?.outcome === "home")} onClick={() => pickOutcome("home")}>
            {index.byId.get(match.homeTeamId)!.code}
          </button>
          <button type="button" className={outcomeBtn(pred?.outcome === "draw")} onClick={() => pickOutcome("draw")}>
            {t("draw")}
          </button>
          <button type="button" className={outcomeBtn(pred?.outcome === "away")} onClick={() => pickOutcome("away")}>
            {index.byId.get(match.awayTeamId)!.code}
          </button>
        </div>
      )}

      {(status || needsScore) && (
        <p className={`text-[11px] ${status === "error" ? "text-danger" : "text-gold-400"}`}>
          {status === "error" ? tp("saveError") : status === "saving" ? tp("saving") : t("needsScore")}
        </p>
      )}
    </li>
  );
}

export default function GroupStage({
  derivedGroup,
  preds,
  rowStatus,
  hardcore,
  readOnly,
  now,
  index,
  onPick,
  onNext,
}: {
  derivedGroup: DerivedGroup;
  preds: ReadonlyMap<number, LocalPrediction>;
  rowStatus: ReadonlyMap<number, RowStatus>;
  hardcore: boolean;
  readOnly: boolean;
  now: Date;
  index: TeamIndex;
  onPick: (matchId: number, value: LocalPrediction) => void;
  onNext: () => void;
}) {
  const t = useTranslations("Predict.group");

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">{t("title", { group: derivedGroup.group })}</h2>

      <ul className="flex flex-col gap-2">
        {derivedGroup.matches.map((m) => (
          <MatchRow
            key={m.id}
            match={m}
            pred={preds.get(m.id)}
            status={rowStatus.get(m.id)}
            hardcore={hardcore}
            readOnly={readOnly}
            now={now}
            index={index}
            onPick={onPick}
          />
        ))}
      </ul>

      {/* live predicted table */}
      <div className="rounded-xl border border-pitch-700 bg-pitch-900 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
          {t("tableTitle")}
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-text-muted">
              <th className="w-6 pb-1 font-medium">#</th>
              <th className="pb-1 font-medium" />
              <th className="w-8 pb-1 text-center font-medium">P</th>
              <th className="w-10 pb-1 text-center font-medium">GD</th>
              <th className="w-10 pb-1 text-center font-medium">Pts</th>
            </tr>
          </thead>
          <tbody>
            {derivedGroup.table.map((row) => {
              const team = index.byCode.get(row.team)!;
              const cut =
                row.position <= 2
                  ? "border-l-2 border-gold-500"
                  : row.position === 3
                    ? "border-l-2 border-dashed border-gold-500/40"
                    : "border-l-2 border-transparent";
              return (
                <tr key={row.team} className={`${cut}`}>
                  <td className="py-1 pl-2 font-mono text-xs text-text-muted">{row.position}</td>
                  <td className="py-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <span aria-hidden="true">{team.flag}</span>
                      {team.code}
                    </span>
                  </td>
                  <td className="py-1 text-center font-mono text-xs">{row.played}</td>
                  <td className="py-1 text-center font-mono text-xs">
                    {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                  </td>
                  <td className="py-1 text-center font-mono text-xs font-bold text-gold-400">
                    {row.points}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-gold-500 align-middle" />
            {t("legendTop2")}
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm border border-dashed border-gold-500/60 align-middle" />
            {t("legendThird")}
          </span>
        </p>
      </div>

      <button
        type="button"
        onClick={onNext}
        className="self-end rounded-full bg-pitch-700 px-5 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-pitch-700/70"
      >
        →
      </button>
    </div>
  );
}
