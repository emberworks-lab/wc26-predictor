"use client";

import { Flame } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import BracketView from "@/components/BracketView";
import Countdown from "@/components/Countdown";
import KickoffTime from "@/components/KickoffTime";
import { isChallengeLocked } from "@/engine/locks";
import { MATCHES_BY_ROUND } from "@/engine/knockoutSim";
import type { BracketMatch } from "@/engine/types";
import {
  bracketSnapshot,
  buildTeamIndex,
  deriveBracket,
  staleSlots,
  toChallengeLockState,
} from "@/lib/predictions/derive";
import type {
  BracketPickDTO,
  ChallengeDTO,
  LocalPick,
  TeamDTO,
} from "@/lib/predictions/types";

import { saveBracket } from "../[kind]/actions";

export interface RealSlotDTO {
  slot: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
}

const BRACKET_SAVE_DEBOUNCE_MS = 800;

/**
 * Playoff prediction flow: the Stage 5 bracket picker over the REAL R32
 * (synced `matches.fifa_match_number` pairings) instead of a personal one.
 * Same autosave/lock/stale mechanics as PredictionFlow's bracket section,
 * minus everything group-derived (the base bracket can never change under
 * the user's feet — only their own upstream picks invalidate downstream).
 */
export default function PlayoffFlow({
  entry,
  challenge,
  teams,
  realSlots,
  initialBracket,
  serverNow,
}: {
  entry: { id: string; hardcore: boolean };
  challenge: ChallengeDTO;
  teams: TeamDTO[];
  realSlots: RealSlotDTO[];
  initialBracket: BracketPickDTO[];
  serverNow: string;
}) {
  const t = useTranslations("Playoff");
  const tp = useTranslations("Predict");
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
  const readOnly = isChallengeLocked(toChallengeLockState(challenge), new Date(nowMs));

  // The real R32: fixed pairings from the synced bracket.
  const r32 = useMemo<BracketMatch[]>(() => {
    const bySlot = new Map(realSlots.map((s) => [s.slot, s]));
    const out: BracketMatch[] = [];
    for (const n of MATCHES_BY_ROUND.R32) {
      const s = bySlot.get(n);
      if (!s || s.homeTeamId == null || s.awayTeamId == null) continue;
      const home = index.byId.get(s.homeTeamId);
      const away = index.byId.get(s.awayTeamId);
      if (!home || !away) continue;
      out.push({ matchNumber: n, round: "R32", home: home.code, away: away.code });
    }
    return out;
  }, [realSlots, index]);

  const initialBracketMap = useMemo(
    () =>
      new Map<number, LocalPick>(
        initialBracket.map((b) => [
          b.slot,
          {
            winnerTeamId: b.winnerTeamId,
            ...(b.homeScore != null && b.awayScore != null
              ? { homeScore: b.homeScore, awayScore: b.awayScore }
              : {}),
            ...(b.aetPens != null ? { aetPens: b.aetPens } : {}),
          },
        ]),
      ),
    [initialBracket],
  );
  const [bracket, setBracket] = useState<Map<number, LocalPick>>(() => new Map(initialBracketMap));
  const [bracketStatus, setBracketStatus] = useState<"idle" | "saving" | "error">("idle");
  const [clearedToast, setClearedToast] = useState(0);

  const sim = useMemo(() => deriveBracket(r32, bracket, index), [r32, bracket, index]);
  const stale = useMemo(() => staleSlots(sim, bracket, index), [sim, bracket, index]);

  // Bracket autosave (full gen-0 snapshot, latest-wins, rollback) — the
  // Stage 5 mechanics verbatim.
  const lastSavedBracket = useRef<Map<number, LocalPick> | null>(null);
  const bracketSeqRef = useRef(0);
  const bracketTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function persistBracket(picks: Map<number, LocalPick>) {
    const snapshot = bracketSnapshot(deriveBracket(r32, picks, index), picks, index);
    const seq = ++bracketSeqRef.current;
    setBracketStatus("saving");
    const res = await saveBracket({ entryId: entry.id, picks: snapshot }).catch(
      () => ({ ok: false as const, code: "error" as const }),
    );
    if (seq !== bracketSeqRef.current) return;
    if (res.ok) {
      lastSavedBracket.current = new Map(picks);
      setBracketStatus("idle");
    } else {
      setBracket(new Map(lastSavedBracket.current ?? initialBracketMap));
      setBracketStatus("error");
    }
  }

  const bracketRef = useRef(bracket);
  useEffect(() => {
    bracketRef.current = bracket;
  }, [bracket]);

  function commitBracket(mutate: (next: Map<number, LocalPick>) => void) {
    if (readOnly) return;
    const next = new Map(bracketRef.current);
    mutate(next);
    const toClear = staleSlots(deriveBracket(r32, next, index), next, index);
    for (const slot of toClear) next.delete(slot);
    if (toClear.length > 0) setClearedToast(toClear.length);
    bracketRef.current = next;
    setBracket(next);
    if (bracketTimer.current) clearTimeout(bracketTimer.current);
    bracketTimer.current = setTimeout(() => void persistBracket(next), BRACKET_SAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    if (clearedToast === 0) return;
    const timer = setTimeout(() => setClearedToast(0), 6000);
    return () => clearTimeout(timer);
  }, [clearedToast]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-extrabold tracking-tight">
            {t("title")}
            {entry.hardcore && (
              <span className="ml-2 inline-flex items-center align-middle rounded-full bg-gold-500/15 px-1.5 py-1 text-gold-400">
                <Flame className="size-3" aria-hidden="true" />
              </span>
            )}
          </h1>
        </div>
        <p className="text-xs text-text-muted">{t("subtitle")}</p>
        {readOnly ? (
          <p className="rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-2.5 text-xs text-danger">
            {t("lockedBanner")}
          </p>
        ) : (
          challenge.locksAt && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-2.5 text-xs text-text-muted">
              <span>
                {tp("locksIn")}{" "}
                <KickoffTime utc={challenge.locksAt} className="text-text-primary" />
              </span>
              <Countdown to={challenge.locksAt} />
            </p>
          )
        )}
      </div>

      {clearedToast > 0 && (
        <p className="rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-2.5 text-xs text-gold-400">
          {tp("bracket.staleCleared", { count: clearedToast })}
        </p>
      )}

      {r32.length < 16 ? (
        <div className="rounded-2xl border border-pitch-700 bg-pitch-800 p-5 text-sm text-text-muted">
          {t("bracketPending")}
        </div>
      ) : (
        <BracketView
          sim={sim}
          bracket={bracket}
          stale={stale}
          hardcore={entry.hardcore}
          readOnly={readOnly}
          saveStatus={bracketStatus}
          index={index}
          onCommit={commitBracket}
        />
      )}
    </section>
  );
}
