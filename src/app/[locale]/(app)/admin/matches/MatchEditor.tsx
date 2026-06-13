"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { clearCorrection, correctMatch } from "@/app/[locale]/(app)/admin/actions";
import type { MatchCorrection } from "@/lib/admin/types";

export interface AdminMatchDTO {
  id: number;
  stage: string;
  groupCode: string | null;
  fifaMatchNumber: number | null;
  kickoffUtc: string;
  status: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeLabel: string;
  awayLabel: string;
  homeScore: number | null;
  awayScore: number | null;
  homeScoreEt: number | null;
  awayScoreEt: number | null;
  homePens: number | null;
  awayPens: number | null;
  winnerTeamId: number | null;
  manuallyCorrected: boolean;
}

const STATUSES = ["finished", "awarded", "in_play", "postponed", "cancelled"] as const;

const intOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export default function MatchEditor({ match }: { match: AdminMatchDTO }) {
  const t = useTranslations("Admin.matches");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const [homeScore, setHomeScore] = useState(String(match.homeScore ?? ""));
  const [awayScore, setAwayScore] = useState(String(match.awayScore ?? ""));
  const [status, setStatus] = useState(match.status);
  const [winner, setWinner] = useState<number | null>(match.winnerTeamId);
  const [homeEt, setHomeEt] = useState(String(match.homeScoreEt ?? ""));
  const [awayEt, setAwayEt] = useState(String(match.awayScoreEt ?? ""));
  const [homePens, setHomePens] = useState(String(match.homePens ?? ""));
  const [awayPens, setAwayPens] = useState(String(match.awayPens ?? ""));

  const isGroup = match.stage === "group";
  const kickoff = new Date(match.kickoffUtc).toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const submit = () => {
    setMessage(null);
    const correction: MatchCorrection = {
      homeScore: Number(homeScore),
      awayScore: Number(awayScore),
      status: status as MatchCorrection["status"],
      winnerTeamId: isGroup ? null : winner,
      homeScoreEt: intOrNull(homeEt),
      awayScoreEt: intOrNull(awayEt),
      homePens: intOrNull(homePens),
      awayPens: intOrNull(awayPens),
    };
    startTransition(async () => {
      const res = await correctMatch(match.id, correction);
      setMessage(res.ok ? t("saved") : res.message);
      router.refresh();
    });
  };

  const clear = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await clearCorrection(match.id);
      setMessage(res.ok ? t("cleared") : res.message);
      router.refresh();
    });
  };

  const scoreInput = (value: string, set: (v: string) => void, label: string) => (
    <label className="flex flex-col gap-0.5 text-[10px] text-text-muted">
      {label}
      <input
        type="number"
        min={0}
        max={99}
        value={value}
        onChange={(e) => set(e.target.value)}
        className="h-8 w-14 rounded-lg border border-pitch-700 bg-pitch-950 px-2 text-center text-sm font-semibold text-text-primary outline-none focus:border-gold-500/60"
      />
    </label>
  );

  return (
    <div className="rounded-xl border border-pitch-700 bg-pitch-900">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <span className="font-mono text-[10px] text-text-muted">
          {match.fifaMatchNumber != null ? `M${match.fifaMatchNumber}` : (match.groupCode ?? "")}
        </span>
        <span className="font-semibold">
          {match.homeLabel} {match.homeScore != null ? match.homeScore : ""}
          {" – "}
          {match.awayScore != null ? match.awayScore : ""} {match.awayLabel}
        </span>
        <span className="text-[10px] uppercase text-text-muted">{match.status}</span>
        {match.manuallyCorrected && (
          <span className="rounded bg-gold-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-gold-400">
            {t("correctedBadge")}
          </span>
        )}
        <span className="ml-auto text-[10px] text-text-muted">{kickoff} UTC</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-pitch-700 px-3 py-3">
          <div className="flex flex-wrap items-end gap-3">
            {scoreInput(homeScore, setHomeScore, `${match.homeLabel} 90'`)}
            {scoreInput(awayScore, setAwayScore, `${match.awayLabel} 90'`)}
            <label className="flex flex-col gap-0.5 text-[10px] text-text-muted">
              {t("status")}
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-8 rounded-lg border border-pitch-700 bg-pitch-950 px-2 text-sm text-text-primary outline-none focus:border-gold-500/60"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!isGroup && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-0.5 text-[10px] text-text-muted">
                {t("winner")}
                <div className="flex gap-1.5">
                  {(
                    [
                      [match.homeTeamId, match.homeLabel],
                      [match.awayTeamId, match.awayLabel],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={label}
                      type="button"
                      disabled={id == null}
                      onClick={() => setWinner(id)}
                      className={[
                        "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                        winner != null && winner === id
                          ? "bg-gold-500 text-pitch-950"
                          : "border border-pitch-700 bg-pitch-800 text-text-muted",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {scoreInput(homeEt, setHomeEt, t("homeEt"))}
              {scoreInput(awayEt, setAwayEt, t("awayEt"))}
              {scoreInput(homePens, setHomePens, t("homePens"))}
              {scoreInput(awayPens, setAwayPens, t("awayPens"))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="rounded-full bg-gold-500 px-4 py-1.5 text-xs font-semibold text-pitch-950 transition-colors hover:bg-gold-400 disabled:opacity-50"
            >
              {pending ? t("working") : t("save")}
            </button>
            {match.manuallyCorrected && (
              <button
                type="button"
                disabled={pending}
                onClick={clear}
                className="rounded-full border border-pitch-700 bg-pitch-800 px-4 py-1.5 text-xs font-semibold text-text-primary disabled:opacity-50"
              >
                {t("clearFlag")}
              </button>
            )}
            {message && <span className="text-xs text-text-muted">{message}</span>}
          </div>
          <p className="text-[10px] text-text-muted">{t("explainer")}</p>
        </div>
      )}
    </div>
  );
}
