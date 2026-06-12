"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import BracketView from "@/components/BracketView";
import KickoffTime from "@/components/KickoffTime";
import { MATCHES_BY_ROUND, roundOfMatch } from "@/engine/knockoutSim";
import type { BracketMatch, KnockoutRound } from "@/engine/types";
import { KO_ROUND_ORDER } from "@/engine/types";
import {
  bracketSnapshot,
  buildTeamIndex,
  deriveBracket,
  staleSlots,
} from "@/lib/predictions/derive";
import type { BracketPickDTO, LocalPick, TeamDTO } from "@/lib/predictions/types";

import {
  redistribute,
  saveBracket,
  type RedistributionStage,
} from "./actions";

export interface RealKoResultDTO {
  slot: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  /** Set when finished. */
  winnerTeamId: number | null;
  homeScore90: number | null;
  awayScore90: number | null;
  homeScoreEt: number | null;
  awayScoreEt: number | null;
  homePens: number | null;
  awayPens: number | null;
  finished: boolean;
}

export interface RedistributionDTO {
  generation: number;
  stage: RedistributionStage;
  multiplier: number;
}

const STAGE_ORDER: readonly RedistributionStage[] = ["r32", "r16", "qf", "sf", "final"];
const STAGE_TO_ROUND: Record<RedistributionStage, KnockoutRound> = {
  r32: "R32",
  r16: "R16",
  qf: "QF",
  sf: "SF",
  final: "F",
};
/** SPEC multiplier table — display only; the DB function is authoritative. */
const MULTIPLIER: Record<RedistributionStage, number> = {
  r32: 0.7,
  r16: 0.6,
  qf: 0.5,
  sf: 0.4,
  final: 0.3,
};

const BRACKET_SAVE_DEBOUNCE_MS = 800;

/**
 * Post-group-stage panel on the Full challenge (SPEC → "Knockout
 * redistribution"): re-pick the knockout bracket on the REAL qualified 32 at
 * the cost of a multiplier on all further knockout points. Past rounds are
 * fixed to real results (locked slots); the active generation stays editable
 * until its stage's round kicks off. One redistribution per stage, stages
 * strictly forward — the DB function enforces all of it.
 */
export default function RedistributionPanel({
  entry,
  redistributions,
  realKo,
  roundStarts,
  genBracket,
  teams,
  serverNow,
}: {
  entry: { id: string; hardcore: boolean };
  redistributions: RedistributionDTO[];
  realKo: RealKoResultDTO[];
  /** First kickoff per redistribution stage's ROUND ('final' incl. M103). */
  roundStarts: Partial<Record<RedistributionStage, string | null>>;
  /** Bracket rows of the newest generation (empty when none yet). */
  genBracket: BracketPickDTO[];
  teams: TeamDTO[];
  serverNow: string;
}) {
  const t = useTranslations("Redistribution");
  const tr = useTranslations("Predict.bracket.rounds");
  const tt = useTranslations("Tournament");
  const tp = useTranslations("Predict");
  const router = useRouter();
  const index = useMemo(() => buildTeamIndex(teams), [teams]);

  // Server-clock offset (same pattern as PredictionFlow).
  const serverNowMs = useMemo(() => Date.parse(serverNow), [serverNow]);
  const [nowMs, setNowMs] = useState(serverNowMs);
  useEffect(() => {
    const offset = serverNowMs - Date.now();
    const tick = () => setNowMs(Date.now() + offset);
    const i = setInterval(tick, 30_000);
    return () => clearInterval(i);
  }, [serverNowMs]);

  const last = redistributions.length
    ? redistributions[redistributions.length - 1]
    : undefined;

  const stageStarted = (s: RedistributionStage): boolean => {
    const at = roundStarts[s];
    return at == null || nowMs >= Date.parse(at);
  };

  // The next stage the user could redistribute before: strictly after every
  // existing redistribution, round not yet started.
  const nextStage = STAGE_ORDER.find(
    (s) =>
      (!last || STAGE_ORDER.indexOf(s) > STAGE_ORDER.indexOf(last.stage)) &&
      !stageStarted(s),
  );

  // --- real bracket inputs ---------------------------------------------------
  const koBySlot = useMemo(() => new Map(realKo.map((m) => [m.slot, m])), [realKo]);

  const realR32 = useMemo<BracketMatch[]>(() => {
    const out: BracketMatch[] = [];
    for (const n of MATCHES_BY_ROUND.R32) {
      const m = koBySlot.get(n);
      if (!m || m.homeTeamId == null || m.awayTeamId == null) continue;
      const home = index.byId.get(m.homeTeamId);
      const away = index.byId.get(m.awayTeamId);
      if (!home || !away) continue;
      out.push({ matchNumber: n, round: "R32", home: home.code, away: away.code });
    }
    return out;
  }, [koBySlot, index]);

  const startRound = last ? STAGE_TO_ROUND[last.stage] : undefined;
  const startIdx = startRound ? KO_ROUND_ORDER.indexOf(startRound) : -1;

  /** Slots of rounds BEFORE the redistribution stage: fixed real results. */
  const lockedSlots = useMemo(() => {
    const set = new Set<number>();
    if (startIdx <= 0) return set;
    for (let n = 73; n <= 104; n += 1) {
      if (KO_ROUND_ORDER.indexOf(roundOfMatch(n)) < startIdx) set.add(n);
    }
    return set;
  }, [startIdx]);

  /** Real-result pick for a locked slot (hardcore carries the 90' score). */
  const realPick = (m: RealKoResultDTO): LocalPick | undefined => {
    if (!m.finished || m.winnerTeamId == null) return undefined;
    return {
      winnerTeamId: m.winnerTeamId,
      ...(entry.hardcore && m.homeScore90 != null && m.awayScore90 != null
        ? { homeScore: m.homeScore90, awayScore: m.awayScore90 }
        : {}),
    };
  };

  const initialPicks = useMemo(() => {
    const map = new Map<number, LocalPick>();
    for (const b of genBracket) {
      map.set(b.slot, {
        winnerTeamId: b.winnerTeamId,
        ...(b.homeScore != null && b.awayScore != null
          ? { homeScore: b.homeScore, awayScore: b.awayScore }
          : {}),
        ...(b.aetPens != null ? { aetPens: b.aetPens } : {}),
      });
    }
    // Locked rounds always mirror reality — also covers real results that
    // landed after the redistribution was created.
    for (const slot of lockedSlots) {
      const m = koBySlot.get(slot);
      const pick = m && realPick(m);
      if (pick) map.set(slot, pick);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genBracket, lockedSlots, koBySlot, entry.hardcore]);

  const [picks, setPicks] = useState<Map<number, LocalPick>>(() => new Map(initialPicks));
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [rejected, setRejected] = useState(false);

  const sim = useMemo(
    () => (realR32.length === 16 ? deriveBracket(realR32, picks, index) : undefined),
    [realR32, picks, index],
  );
  const stale = useMemo(
    () => (sim ? staleSlots(sim, picks, index).filter((s) => !lockedSlots.has(s)) : []),
    [sim, picks, index, lockedSlots],
  );

  /** Result strings for the fixed rounds (mirrors the Tournament tab format). */
  const results = useMemo(() => {
    const map = new Map<number, string>();
    for (const slot of lockedSlots) {
      const m = koBySlot.get(slot);
      if (!m || !m.finished) continue;
      const hs = m.homeScoreEt ?? m.homeScore90;
      const as = m.awayScoreEt ?? m.awayScore90;
      if (hs == null || as == null) continue;
      map.set(
        slot,
        m.homePens != null
          ? `${hs}:${as} (${m.homePens}:${m.awayPens} ${tt("pens")})`
          : m.homeScoreEt != null
            ? `${hs}:${as} ${tt("aet")}`
            : `${hs}:${as}`,
      );
    }
    return map;
  }, [lockedSlots, koBySlot, tt]);

  const editable = last !== undefined && !stageStarted(last.stage);

  // --- autosave (Stage 5 mechanics, generation-aware) -------------------------
  const lastSaved = useRef<Map<number, LocalPick> | null>(null);
  const seqRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function persist(next: Map<number, LocalPick>) {
    if (!last || realR32.length !== 16) return;
    const snapshot = bracketSnapshot(deriveBracket(realR32, next, index), next, index);
    const seq = ++seqRef.current;
    setSaveStatus("saving");
    const res = await saveBracket({
      entryId: entry.id,
      picks: snapshot,
      generation: last.generation,
    }).catch(() => ({ ok: false as const, code: "error" as const }));
    if (seq !== seqRef.current) return;
    if (res.ok) {
      lastSaved.current = new Map(next);
      setSaveStatus("idle");
    } else {
      setPicks(new Map(lastSaved.current ?? initialPicks));
      setSaveStatus("error");
    }
  }

  const picksRef = useRef(picks);
  useEffect(() => {
    picksRef.current = picks;
  }, [picks]);

  function commit(mutate: (next: Map<number, LocalPick>) => void) {
    if (!editable || !sim) return;
    const next = new Map(picksRef.current);
    mutate(next);
    const toClear = staleSlots(deriveBracket(realR32, next, index), next, index).filter(
      (s) => !lockedSlots.has(s),
    );
    for (const slot of toClear) next.delete(slot);
    picksRef.current = next;
    setPicks(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(next), BRACKET_SAVE_DEBOUNCE_MS);
  }

  async function confirmRedistribute() {
    if (!nextStage || pending) return;
    setPending(true);
    setRejected(false);
    const res = await redistribute({ entryId: entry.id, stage: nextStage }).catch(
      () => ({ ok: false as const, code: "error" as const }),
    );
    setPending(false);
    setConfirming(false);
    if (res.ok) {
      router.refresh();
    } else {
      setRejected(true);
    }
  }

  const percent = (m: number) => Math.round(m * 100);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-gold-500/30 bg-pitch-800 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">{t("title")}</h2>
        {last && (
          <span className="rounded-full bg-gold-500/15 px-2.5 py-1 text-[11px] font-semibold text-gold-400">
            {t("activeBadge", {
              round: tr(STAGE_TO_ROUND[last.stage]),
              percent: percent(Number(last.multiplier)),
            })}
          </span>
        )}
      </div>

      <p className="text-xs text-text-muted">{t("explainer")}</p>

      {redistributions.map((r) => (
        <p key={r.generation} className="text-[11px] text-text-muted">
          {t("logRow", {
            generation: r.generation,
            round: tr(STAGE_TO_ROUND[r.stage]),
            percent: percent(Number(r.multiplier)),
          })}
        </p>
      ))}

      {nextStage && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded-full bg-gold-500 px-5 py-2 text-xs font-semibold text-pitch-950 transition-colors hover:bg-gold-400"
        >
          {t("cta", { round: tr(STAGE_TO_ROUND[nextStage]) })}
        </button>
      )}

      {nextStage && confirming && (
        <div className="flex flex-col gap-3 rounded-xl border border-gold-500/40 bg-pitch-900 p-4">
          <p className="text-sm font-semibold">{t("confirmTitle")}</p>
          <p className="text-xs text-text-muted">
            {t("confirmBody", {
              round: tr(STAGE_TO_ROUND[nextStage]),
              percent: percent(MULTIPLIER[nextStage]),
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => void confirmRedistribute()}
              className="rounded-full bg-gold-500 px-5 py-2 text-xs font-semibold text-pitch-950 transition-colors hover:bg-gold-400 disabled:opacity-50"
            >
              {pending ? tp("saving") : t("confirm", { percent: percent(MULTIPLIER[nextStage]) })}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="rounded-full bg-pitch-700 px-5 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-pitch-700/70"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {rejected && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-xs text-danger">
          {t("rejected")}
        </p>
      )}

      {last && (
        <div className="flex flex-col gap-3 border-t border-pitch-700 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold">
              {t(editable ? "editorTitle" : "editorTitleLocked", {
                round: tr(STAGE_TO_ROUND[last.stage]),
              })}
            </h3>
            {editable && roundStarts[last.stage] && (
              <span className="text-[11px] text-text-muted">
                {t("editableUntil")}{" "}
                <KickoffTime utc={roundStarts[last.stage]!} className="text-text-primary" />
              </span>
            )}
          </div>
          {lockedSlots.size > 0 && (
            <p className="text-[11px] text-text-muted">{t("lockedRoundsHint")}</p>
          )}
          <BracketView
            sim={sim}
            bracket={picks}
            stale={stale}
            hardcore={entry.hardcore}
            readOnly={!editable}
            saveStatus={saveStatus}
            index={index}
            onCommit={commit}
            results={results}
            lockedSlots={lockedSlots}
          />
        </div>
      )}
    </section>
  );
}
