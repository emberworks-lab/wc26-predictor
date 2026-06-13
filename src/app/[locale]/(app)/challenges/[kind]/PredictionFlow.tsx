"use client";

import { Flame } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import Countdown from "@/components/Countdown";
import KickoffTime from "@/components/KickoffTime";
import { isChallengeLocked } from "@/engine/locks";
import type { GroupId } from "@/engine/types";
import { GROUP_IDS } from "@/engine/types";
import {
  bracketSnapshot,
  buildTeamIndex,
  deriveBracket,
  deriveGroups,
  isGroupMatchLocked,
  staleSlots,
  toChallengeLockState,
} from "@/lib/predictions/derive";
import type {
  BracketPickDTO,
  ChallengeDTO,
  GroupMatchDTO,
  LocalPick,
  LocalPrediction,
  MatchPredictionDTO,
  TeamDTO,
} from "@/lib/predictions/types";

import { saveBracket, saveMatchPrediction } from "./actions";
import BracketView from "@/components/BracketView";
import GroupStage from "./GroupStage";
import ThirdsView from "./ThirdsView";

export type View = { kind: "group"; group: GroupId } | { kind: "thirds" } | { kind: "bracket" };
export type RowStatus = "saving" | "error";

const MATCH_SAVE_DEBOUNCE_MS = 500;
const BRACKET_SAVE_DEBOUNCE_MS = 800;

/** A prediction that counts toward progress (and resume). */
function hasPick(pred: LocalPrediction | undefined): boolean {
  return pred !== undefined && (pred.outcome !== undefined || pred.homeScore !== undefined);
}

/** Hardcore entries need scores; an outcome-only pick predates a hardcore flip. */
function needsScore(pred: LocalPrediction | undefined, hardcore: boolean): boolean {
  return (
    hardcore &&
    pred !== undefined &&
    pred.outcome !== undefined &&
    (pred.homeScore === undefined || pred.awayScore === undefined)
  );
}

export default function PredictionFlow({
  challengeKind,
  entry,
  challenge,
  teams,
  matches,
  initialPredictions,
  initialBracket,
  serverNow,
}: {
  challengeKind: "full" | "groups";
  entry: { id: string; hardcore: boolean };
  challenge: ChallengeDTO;
  teams: TeamDTO[];
  matches: GroupMatchDTO[];
  initialPredictions: MatchPredictionDTO[];
  initialBracket: BracketPickDTO[];
  serverNow: string;
}) {
  const t = useTranslations("Predict");
  const index = useMemo(() => buildTeamIndex(teams), [teams]);

  // Trust the server clock, not the device clock (the lock moment the UI
  // shows must match what RLS will enforce). SSR + first client render use
  // the server timestamp verbatim; an effect then keeps it ticking with the
  // device-clock offset applied.
  const serverNowMs = useMemo(() => Date.parse(serverNow), [serverNow]);
  const [nowMs, setNowMs] = useState(serverNowMs);
  useEffect(() => {
    const offset = serverNowMs - Date.now();
    const tick = () => setNowMs(Date.now() + offset);
    const i = setInterval(tick, 30_000);
    return () => clearInterval(i);
  }, [serverNowMs]);
  const now = new Date(nowMs);

  const readOnly = isChallengeLocked(toChallengeLockState(challenge), now);

  // --- working state ---------------------------------------------------------
  const initialPredMap = useMemo(
    () =>
      new Map<number, LocalPrediction>(
        initialPredictions.map((p) => [
          p.matchId,
          {
            outcome: p.outcome,
            ...(p.homeScore != null && p.awayScore != null
              ? { homeScore: p.homeScore, awayScore: p.awayScore }
              : {}),
          },
        ]),
      ),
    [initialPredictions],
  );
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
  const [preds, setPreds] = useState<Map<number, LocalPrediction>>(() => new Map(initialPredMap));
  const [bracket, setBracket] = useState<Map<number, LocalPick>>(() => new Map(initialBracketMap));
  const [rowStatus, setRowStatus] = useState<Map<number, RowStatus>>(new Map());
  const [bracketStatus, setBracketStatus] = useState<"idle" | "saving" | "error">("idle");
  const [clearedToast, setClearedToast] = useState(0);

  // --- derivations (the engine does all the thinking) -------------------------
  const derived = useMemo(
    () => deriveGroups(matches, preds, entry.hardcore, index),
    [matches, preds, entry.hardcore, index],
  );
  const sim = useMemo(
    () => (challengeKind === "full" && derived.r32 ? deriveBracket(derived.r32, bracket, index) : undefined),
    [challengeKind, derived.r32, bracket, index],
  );
  const stale = useMemo(
    () => (sim ? staleSlots(sim, bracket, index) : []),
    [sim, bracket, index],
  );

  const progressDone = matches.filter((m) => hasPick(preds.get(m.id))).length;

  // --- match autosave (optimistic, latest-wins, rollback on rejection) --------
  // Last server-confirmed value per match; matches never saved this session
  // fall back to the initial (DB-loaded) value at rollback time.
  const lastSavedPred = useRef(new Map<number, LocalPrediction | undefined>());
  const matchSeq = useRef(new Map<number, number>());
  const matchTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  async function persistMatch(matchId: number, value: LocalPrediction) {
    const seq = (matchSeq.current.get(matchId) ?? 0) + 1;
    matchSeq.current.set(matchId, seq);
    setRowStatus((prev) => new Map(prev).set(matchId, "saving"));

    const payload =
      entry.hardcore && value.homeScore !== undefined && value.awayScore !== undefined
        ? { entryId: entry.id, matchId, homeScore: value.homeScore, awayScore: value.awayScore }
        : { entryId: entry.id, matchId, outcome: value.outcome };
    const res = await saveMatchPrediction(payload).catch(() => ({ ok: false as const, code: "error" as const }));

    if (matchSeq.current.get(matchId) !== seq) return; // superseded by a newer save
    if (res.ok) {
      lastSavedPred.current.set(matchId, value);
      setRowStatus((prev) => {
        const next = new Map(prev);
        next.delete(matchId);
        return next;
      });
    } else {
      const previous = lastSavedPred.current.has(matchId)
        ? lastSavedPred.current.get(matchId)
        : initialPredMap.get(matchId);
      setPreds((prev) => {
        const next = new Map(prev);
        if (previous === undefined) next.delete(matchId);
        else next.set(matchId, previous);
        return next;
      });
      setRowStatus((prev) => new Map(prev).set(matchId, "error"));
    }
  }

  function commitPrediction(matchId: number, value: LocalPrediction) {
    if (readOnly) return;
    setPreds((prev) => new Map(prev).set(matchId, value));
    const pending = matchTimers.current.get(matchId);
    if (pending) clearTimeout(pending);
    // Hardcore picks persist only once both scores exist (the trigger
    // rejects scoreless hardcore rows).
    if (entry.hardcore && (value.homeScore === undefined || value.awayScore === undefined)) return;
    matchTimers.current.set(
      matchId,
      setTimeout(() => void persistMatch(matchId, value), MATCH_SAVE_DEBOUNCE_MS),
    );
  }

  // --- bracket autosave --------------------------------------------------------
  type R32 = NonNullable<typeof derived.r32>;
  const lastSavedBracket = useRef<Map<number, LocalPick> | null>(null);
  const bracketSeqRef = useRef(0);
  const bracketTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function scheduleBracketSave(next: Map<number, LocalPick>, r32: R32) {
    if (bracketTimer.current) clearTimeout(bracketTimer.current);
    bracketTimer.current = setTimeout(
      () => void persistBracket(next, r32),
      BRACKET_SAVE_DEBOUNCE_MS,
    );
  }

  async function persistBracket(picks: Map<number, LocalPick>, r32: R32) {
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

  // Live mirror of the bracket state: updated synchronously on every commit
  // so two mutations inside the same event-loop tick (before React re-renders)
  // compose instead of overwriting each other.
  const bracketRef = useRef(bracket);
  useEffect(() => {
    bracketRef.current = bracket;
  }, [bracket]);

  /** Applies a bracket mutation, auto-clears invalidated downstream picks, saves. */
  function commitBracket(mutate: (next: Map<number, LocalPick>) => void) {
    const r32 = derived.r32;
    if (readOnly || !r32) return;
    const next = new Map(bracketRef.current);
    mutate(next);
    const toClear = staleSlots(deriveBracket(r32, next, index), next, index);
    for (const slot of toClear) next.delete(slot);
    if (toClear.length > 0) setClearedToast(toClear.length);
    bracketRef.current = next;
    setBracket(next);
    scheduleBracketSave(next, r32);
  }

  // Group-prediction edits reshape the personal R32 → previously saved picks
  // may now name eliminated teams. Auto-clear them (with a toast) on every
  // R32 change EXCEPT the initial mount (stale-on-load is only flagged
  // visually until the user edits something). Refs are synced via effects so
  // this effect can depend on the pairing fingerprint alone.
  const r32Ref = useRef(derived.r32);
  useEffect(() => {
    r32Ref.current = derived.r32;
  }, [derived.r32]);

  const r32Key = derived.r32?.map((m) => `${m.matchNumber}:${m.home}-${m.away}`).join("|");
  const prevR32KeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevR32KeyRef.current;
    prevR32KeyRef.current = r32Key;
    // Act only on a real pairing CHANGE (StrictMode-safe): the initial
    // computation and the incomplete→complete transition just flag staleness
    // visually via the staleOnLoad banner.
    if (prev === undefined || prev === r32Key) return;
    const r32 = r32Ref.current;
    if (readOnly || !r32) return;
    const current = bracketRef.current;
    const toClear = staleSlots(deriveBracket(r32, current, index), current, index);
    if (toClear.length === 0) return;
    const next = new Map(current);
    for (const slot of toClear) next.delete(slot);
    setClearedToast(toClear.length);
    setBracket(next);
    scheduleBracketSave(next, r32);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r32Key]);

  useEffect(() => {
    if (clearedToast === 0) return;
    const timer = setTimeout(() => setClearedToast(0), 6000);
    return () => clearTimeout(timer);
  }, [clearedToast]);

  // --- view / resume ------------------------------------------------------------
  const [view, setView] = useState<View>(() => {
    const initialNow = new Date(serverNowMs);
    for (const g of derived.groups) {
      const attention = g.matches.some(
        (m) =>
          !isGroupMatchLocked(m, initialNow) &&
          (!hasPick(preds.get(m.id)) || needsScore(preds.get(m.id), entry.hardcore)),
      );
      if (attention) return { kind: "group", group: g.group };
    }
    if (challengeKind === "full" && derived.allComplete) return { kind: "bracket" };
    if (derived.allComplete) return { kind: "thirds" };
    return { kind: "group", group: "A" };
  });

  const groupAttention = (g: GroupId): boolean => {
    const dg = derived.byGroup.get(g);
    if (!dg) return false;
    return dg.matches.some(
      (m) =>
        !isGroupMatchLocked(m, now) &&
        (!hasPick(preds.get(m.id)) || needsScore(preds.get(m.id), entry.hardcore)),
    );
  };

  const navChip = (active: boolean, attention: boolean, complete: boolean) =>
    [
      "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
      active
        ? "bg-gold-500 text-pitch-950"
        : complete
          ? "bg-pitch-800 text-success"
          : attention
            ? "bg-pitch-800 text-text-primary ring-1 ring-gold-500/40"
            : "bg-pitch-800 text-text-muted",
    ].join(" ");

  return (
    <section className="flex flex-col gap-4">
      {/* header: title, lock countdown, progress */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-extrabold tracking-tight">
            {t(`titles.${challengeKind}`)}
            {entry.hardcore && (
              <span className="ml-2 inline-flex items-center align-middle rounded-full bg-gold-500/15 px-1.5 py-1 text-gold-400">
                <Flame className="size-3" aria-hidden="true" />
              </span>
            )}
          </h1>
          <span className="text-xs font-semibold text-text-muted" data-testid="progress">
            {t("progress", { done: progressDone, total: matches.length })}
          </span>
        </div>
        {readOnly ? (
          <p className="rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-2.5 text-xs text-danger">
            {t("lockedBanner")}
          </p>
        ) : (
          challenge.locksAt && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-2.5 text-xs text-text-muted">
              <span>
                {t("locksIn")}{" "}
                <KickoffTime utc={challenge.locksAt} className="text-text-primary" />
              </span>
              <Countdown to={challenge.locksAt} />
            </p>
          )
        )}
        <div className="h-1.5 overflow-hidden rounded-full bg-pitch-800">
          <div
            className="h-full rounded-full bg-gold-500 transition-all"
            style={{ width: `${Math.round((progressDone / Math.max(matches.length, 1)) * 100)}%` }}
          />
        </div>
      </div>

      {/* navigation: group chips + thirds + bracket */}
      <nav className="flex flex-wrap gap-1.5 pb-1" aria-label={t("nav.groupsLabel")}>
        {GROUP_IDS.map((g) => {
          const dg = derived.byGroup.get(g);
          const active = view.kind === "group" && view.group === g;
          return (
            <button
              key={g}
              type="button"
              onClick={() => setView({ kind: "group", group: g })}
              className={navChip(active, groupAttention(g), dg?.complete ?? false)}
            >
              {g}
              {dg?.complete && !active ? " ✓" : ""}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setView({ kind: "thirds" })}
          className={navChip(view.kind === "thirds", false, derived.allComplete)}
        >
          {t("nav.thirds")}
        </button>
        {challengeKind === "full" && (
          <button
            type="button"
            onClick={() => setView({ kind: "bracket" })}
            className={navChip(view.kind === "bracket", stale.length > 0, sim?.champion !== undefined)}
          >
            {t("nav.bracket")}
          </button>
        )}
      </nav>

      {/* invalidation toast */}
      {clearedToast > 0 && (
        <p className="rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-2.5 text-xs text-gold-400">
          {t("bracket.staleCleared", { count: clearedToast })}
        </p>
      )}

      {/* body */}
      {view.kind === "group" && derived.byGroup.get(view.group) && (
        <GroupStage
          derivedGroup={derived.byGroup.get(view.group)!}
          preds={preds}
          rowStatus={rowStatus}
          hardcore={entry.hardcore}
          readOnly={readOnly}
          now={now}
          index={index}
          onPick={commitPrediction}
          onNext={() => {
            const i = GROUP_IDS.indexOf(view.group);
            setView(i < 11 ? { kind: "group", group: GROUP_IDS[i + 1] } : { kind: "thirds" });
          }}
        />
      )}
      {view.kind === "thirds" && (
        <ThirdsView
          derived={derived}
          challengeKind={challengeKind}
          index={index}
          onToBracket={() => setView({ kind: "bracket" })}
        />
      )}
      {view.kind === "bracket" && challengeKind === "full" && (
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
