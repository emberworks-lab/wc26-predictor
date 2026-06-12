"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  FINAL_MATCH,
  THIRD_PLACE_MATCH,
  type SimulatedBracket,
  type SimulatedMatch,
} from "@/engine/knockoutSim";
import type { KnockoutRound, TeamId } from "@/engine/types";
import { KO_ROUND_ORDER } from "@/engine/types";
import type { TeamIndex } from "@/lib/predictions/derive";
import type { LocalPick } from "@/lib/predictions/types";

type Commit = (mutate: (next: Map<number, LocalPick>) => void) => void;

function TeamButton({
  code,
  picked,
  disabled,
  onClick,
  index,
}: {
  code: TeamId | undefined;
  picked: boolean;
  disabled: boolean;
  onClick: () => void;
  index: TeamIndex;
}) {
  const t = useTranslations("Predict.bracket");
  const team = code ? index.byCode.get(code) : undefined;
  return (
    <button
      type="button"
      disabled={disabled || !team}
      onClick={onClick}
      className={[
        "flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors",
        picked
          ? "bg-gold-500 text-pitch-950"
          : team
            ? "bg-pitch-700 text-text-primary enabled:hover:bg-pitch-700/70 disabled:opacity-60"
            : "bg-pitch-900 text-text-muted",
      ].join(" ")}
    >
      {team ? (
        <>
          <span aria-hidden="true">{team.flag}</span>
          <span className="truncate">{team.name}</span>
        </>
      ) : (
        <span className="text-xs italic">{t("tbd")}</span>
      )}
    </button>
  );
}

function ScoreStepper({
  value,
  disabled,
  onChange,
}: {
  value: number | undefined;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const shown = value ?? 0;
  const btn =
    "h-7 w-7 rounded-full bg-pitch-700 text-sm font-bold leading-none text-text-primary transition-colors enabled:hover:bg-pitch-700/70 disabled:opacity-40";
  return (
    <span className="flex items-center gap-1">
      <button type="button" className={btn} disabled={disabled} onClick={() => onChange(Math.max(0, shown - 1))}>
        −
      </button>
      <span
        className={`w-5 text-center font-mono text-sm font-bold ${value === undefined ? "text-text-muted" : "text-text-primary"}`}
      >
        {shown}
      </span>
      <button type="button" className={btn} disabled={disabled} onClick={() => onChange(Math.min(99, shown + 1))}>
        +
      </button>
    </span>
  );
}

function MatchCard({
  match,
  pick,
  isStale,
  hardcore,
  readOnly,
  index,
  onCommit,
}: {
  match: SimulatedMatch;
  pick: LocalPick | undefined;
  isStale: boolean;
  hardcore: boolean;
  readOnly: boolean;
  index: TeamIndex;
  onCommit: Commit;
}) {
  const t = useTranslations("Predict.bracket");
  const slot = match.matchNumber;
  const pairingKnown = match.home !== undefined && match.away !== undefined;
  const disabled = readOnly || !pairingKnown;

  const label =
    slot === THIRD_PLACE_MATCH
      ? t("thirdPlaceMatch")
      : slot === FINAL_MATCH
        ? t("finalMatch")
        : t("match", { number: slot });

  const pickWinner = (code: TeamId | undefined) => {
    if (!code) return;
    const id = index.byCode.get(code)!.id;
    onCommit((next) => {
      const current = next.get(slot);
      next.set(slot, hardcore ? { ...current, winnerTeamId: id } : { winnerTeamId: id, ...(current?.aetPens !== undefined ? { aetPens: current.aetPens } : {}) });
    });
  };

  const setScore = (side: "home" | "away", value: number) => {
    onCommit((next) => {
      const current = next.get(slot) ?? {};
      const homeScore = side === "home" ? value : (current.homeScore ?? 0);
      const awayScore = side === "away" ? value : (current.awayScore ?? 0);
      const updated: LocalPick = { ...current, homeScore, awayScore };
      // A decisive score implies the winner; the explicit advancer only
      // matters on a draw (engine resolveAdvancer convention).
      if (homeScore !== awayScore) delete updated.winnerTeamId;
      next.set(slot, updated);
    });
  };

  const toggleAet = () => {
    onCommit((next) => {
      const current = next.get(slot);
      if (!current?.winnerTeamId) return;
      next.set(slot, { ...current, aetPens: !current.aetPens });
    });
  };

  const isDraw =
    hardcore && pick?.homeScore !== undefined && pick.homeScore === pick.awayScore;
  const winnerCode = match.winner;
  const pickedHome = winnerCode !== undefined && winnerCode === match.home;
  const pickedAway = winnerCode !== undefined && winnerCode === match.away;

  return (
    <li
      className={[
        "flex flex-col gap-2 rounded-xl border p-3",
        isStale ? "border-gold-500/70 bg-gold-500/5" : "border-pitch-700 bg-pitch-900",
      ].join(" ")}
    >
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-text-muted">
        <span>{label}</span>
        {isStale && <span className="font-semibold text-gold-400">{t("advancerPrompt")}</span>}
      </div>

      {hardcore ? (
        <div className="flex flex-col gap-2">
          {(["home", "away"] as const).map((side) => {
            const code = side === "home" ? match.home : match.away;
            const team = code ? index.byCode.get(code) : undefined;
            const value = side === "home" ? pick?.homeScore : pick?.awayScore;
            const isWinner = side === "home" ? pickedHome : pickedAway;
            return (
              <div key={side} className="flex items-center justify-between gap-2">
                <span
                  className={`flex flex-1 items-center gap-2 truncate text-sm font-semibold ${isWinner ? "text-gold-400" : team ? "text-text-primary" : "text-text-muted"}`}
                >
                  {team ? (
                    <>
                      <span aria-hidden="true">{team.flag}</span>
                      <span className="truncate">{team.name}</span>
                    </>
                  ) : (
                    <span className="text-xs italic">{t("tbd")}</span>
                  )}
                </span>
                <ScoreStepper value={value} disabled={disabled} onChange={(v) => setScore(side, v)} />
              </div>
            );
          })}
          {isDraw && pairingKnown && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-muted">{t("advancerPrompt")}</span>
              {[match.home!, match.away!].map((code) => {
                const team = index.byCode.get(code)!;
                const selected = pick?.winnerTeamId === team.id;
                return (
                  <button
                    key={code}
                    type="button"
                    disabled={disabled}
                    onClick={() => pickWinner(code)}
                    className={[
                      "rounded-full px-3 py-1 text-xs font-bold transition-colors",
                      selected
                        ? "bg-gold-500 text-pitch-950"
                        : "bg-pitch-700 text-text-muted enabled:hover:text-text-primary",
                    ].join(" ")}
                  >
                    {team.code}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-1.5">
            <TeamButton
              code={match.home}
              picked={pickedHome}
              disabled={disabled}
              onClick={() => pickWinner(match.home)}
              index={index}
            />
            <TeamButton
              code={match.away}
              picked={pickedAway}
              disabled={disabled}
              onClick={() => pickWinner(match.away)}
              index={index}
            />
          </div>
          {winnerCode !== undefined && (
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={pick?.aetPens ?? false}
                disabled={readOnly}
                onChange={toggleAet}
                className="accent-[#d4af37]"
              />
              {t("aet")}
            </label>
          )}
        </>
      )}
    </li>
  );
}

export default function BracketView({
  sim,
  bracket,
  stale,
  hardcore,
  readOnly,
  saveStatus,
  index,
  onCommit,
}: {
  sim: SimulatedBracket | undefined;
  bracket: ReadonlyMap<number, LocalPick>;
  stale: readonly number[];
  hardcore: boolean;
  readOnly: boolean;
  saveStatus: "idle" | "saving" | "error";
  index: TeamIndex;
  onCommit: Commit;
}) {
  const t = useTranslations("Predict.bracket");
  const tp = useTranslations("Predict");
  const [round, setRound] = useState<KnockoutRound>("R32");

  if (!sim) {
    return (
      <div className="rounded-2xl border border-pitch-700 bg-pitch-800 p-5 text-sm text-text-muted">
        {t("needsGroups")}
      </div>
    );
  }

  const picksLeft = sim.matches.filter((m) => m.winner === undefined).length;
  const staleSet = new Set(stale);
  const roundMatches = sim.matches.filter((m) => m.round === round);
  const champion = sim.champion ? index.byCode.get(sim.champion) : undefined;
  const thirdPlace = sim.thirdPlaceWinner ? index.byCode.get(sim.thirdPlaceWinner) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {KO_ROUND_ORDER.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRound(r)}
              className={[
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                r === round ? "bg-gold-500 text-pitch-950" : "bg-pitch-800 text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {t(`rounds.${r}`)}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-semibold text-text-muted">
          {saveStatus === "saving"
            ? tp("saving")
            : saveStatus === "error"
              ? tp("saveError")
              : picksLeft > 0
                ? t("picksLeft", { count: picksLeft })
                : t("complete")}
        </span>
      </div>

      {stale.length > 0 && (
        <p className="rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-2.5 text-xs text-gold-400">
          {t("staleOnLoad", { count: stale.length })}
        </p>
      )}

      <p className="text-[11px] text-text-muted">{hardcore ? t("scoreHint") : t("pickHint")}</p>

      <h2 className="text-lg font-bold">{t(`roundsLong.${round}`)}</h2>
      <ul className="flex flex-col gap-2">
        {roundMatches.map((m) => (
          <MatchCard
            key={m.matchNumber}
            match={m}
            pick={bracket.get(m.matchNumber)}
            isStale={staleSet.has(m.matchNumber)}
            hardcore={hardcore}
            readOnly={readOnly}
            index={index}
            onCommit={onCommit}
          />
        ))}
      </ul>

      {(champion || thirdPlace) && (
        <div className="flex flex-col gap-2 rounded-2xl border border-gold-500/40 bg-pitch-800 p-5">
          {champion && (
            <p className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden="true">
                🏆
              </span>
              <span>
                <span className="block text-[11px] uppercase tracking-wider text-text-muted">
                  {t("champion")}
                </span>
                <span className="text-lg font-extrabold text-gold-400">
                  {champion.flag} {champion.name}
                </span>
              </span>
            </p>
          )}
          {thirdPlace && (
            <p className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden="true">
                🥉
              </span>
              <span>
                <span className="block text-[11px] uppercase tracking-wider text-text-muted">
                  {t("thirdPlace")}
                </span>
                <span className="text-sm font-bold">
                  {thirdPlace.flag} {thirdPlace.name}
                </span>
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
