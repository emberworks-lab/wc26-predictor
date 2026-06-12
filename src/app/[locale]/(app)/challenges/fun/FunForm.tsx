"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import Countdown from "@/components/Countdown";
import KickoffTime from "@/components/KickoffTime";
import { isChallengeLocked } from "@/engine/locks";
import { toChallengeLockState } from "@/lib/predictions/derive";
import type { ChallengeDTO } from "@/lib/predictions/types";

import { saveFunAnswer } from "./actions";

export interface FunQuestionDTO {
  id: number;
  key: string;
  qtype: "numeric" | "pick" | "yesno";
  maxPts: number;
}

export interface FunAnswerDTO {
  questionId: number;
  numeric: number | null;
  text: string | null;
  bool: boolean | null;
}

export interface PlayerSuggestion {
  name: string;
  team: string;
  flag: string;
}

/** The client's working copy of one answer (exactly one field set). */
interface LocalAnswer {
  numeric?: number;
  text?: string;
  bool?: boolean;
}

type RowStatus = "saving" | "error";

const SAVE_DEBOUNCE_MS = 600;
const MAX_NUMERIC = 9999;

/** Question keys that get an extra hint line under the label. */
const HINTED = new Set(["fastest_goal_minute", "highest_scoring_match", "host_reaches_qf"]);

const hasValue = (a: LocalAnswer | undefined): boolean =>
  a !== undefined && (a.numeric !== undefined || a.text !== undefined || a.bool !== undefined);

function toLocal(a: FunAnswerDTO): LocalAnswer {
  if (a.numeric != null) return { numeric: a.numeric };
  if (a.text != null) return { text: a.text };
  if (a.bool != null) return { bool: a.bool };
  return {};
}

function NumericInput({
  value,
  disabled,
  onChange,
}: {
  value: number | undefined;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const btn =
    "h-9 w-9 shrink-0 rounded-full bg-pitch-700 text-base font-bold leading-none text-text-primary transition-colors enabled:hover:bg-pitch-700/70 disabled:opacity-40";
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        className={btn}
        disabled={disabled || value === undefined || value <= 0}
        onClick={() => onChange(Math.max(0, (value ?? 0) - 1))}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_NUMERIC}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => {
          const parsed = Math.floor(Number(e.target.value));
          if (Number.isFinite(parsed)) onChange(Math.min(MAX_NUMERIC, Math.max(0, parsed)));
        }}
        className="h-9 w-20 rounded-lg border border-pitch-700 bg-pitch-950 text-center font-mono text-base font-bold text-text-primary outline-none focus:border-gold-500/60 disabled:opacity-50"
      />
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={() => onChange(Math.min(MAX_NUMERIC, (value ?? 0) + 1))}
      >
        +
      </button>
    </span>
  );
}

function PlayerPicker({
  value,
  disabled,
  players,
  placeholder,
  onChange,
  onSelect,
}: {
  value: string;
  disabled: boolean;
  players: readonly PlayerSuggestion[];
  placeholder: string;
  onChange: (next: string) => void;
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    const pool = query
      ? players.filter(
          (p) => p.name.toLowerCase().includes(query) || p.team.toLowerCase() === query,
        )
      : players;
    return pool.slice(0, 8);
  }, [players, query]);

  return (
    <div ref={wrapRef} className="relative w-full">
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="h-9 w-full rounded-lg border border-pitch-700 bg-pitch-950 px-3 text-sm font-semibold text-text-primary outline-none placeholder:font-normal placeholder:text-text-muted focus:border-gold-500/60 disabled:opacity-50"
      />
      {open && !disabled && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-pitch-700 bg-pitch-900 py-1 shadow-xl">
          {matches.map((p) => (
            <li key={`${p.team}:${p.name}`}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-pitch-800"
                onClick={() => {
                  onSelect(p.name);
                  setOpen(false);
                }}
              >
                <span aria-hidden="true">{p.flag}</span>
                <span className="flex-1 truncate font-semibold">{p.name}</span>
                <span className="text-xs text-text-muted">{p.team}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function FunForm({
  entryId,
  challenge,
  questions,
  initialAnswers,
  players,
  serverNow,
}: {
  entryId: string;
  challenge: ChallengeDTO;
  questions: FunQuestionDTO[];
  initialAnswers: FunAnswerDTO[];
  players: PlayerSuggestion[];
  serverNow: string;
}) {
  const t = useTranslations("Fun");
  const tp = useTranslations("Predict");

  // Server-clock offset (same pattern as PredictionFlow): the lock moment the
  // UI shows must match what RLS will enforce.
  const serverNowMs = useMemo(() => Date.parse(serverNow), [serverNow]);
  const [nowMs, setNowMs] = useState(serverNowMs);
  useEffect(() => {
    const offset = serverNowMs - Date.now();
    const tick = () => setNowMs(Date.now() + offset);
    const i = setInterval(tick, 30_000);
    return () => clearInterval(i);
  }, [serverNowMs]);
  const readOnly = isChallengeLocked(toChallengeLockState(challenge), new Date(nowMs));

  const initialMap = useMemo(
    () => new Map<number, LocalAnswer>(initialAnswers.map((a) => [a.questionId, toLocal(a)])),
    [initialAnswers],
  );
  const [answers, setAnswers] = useState<Map<number, LocalAnswer>>(() => new Map(initialMap));
  const [rowStatus, setRowStatus] = useState<Map<number, RowStatus>>(new Map());

  // Optimistic autosave: latest-wins per question, rollback to the last
  // server-confirmed value on rejection (RLS lock, validation).
  const lastSaved = useRef(new Map<number, LocalAnswer | undefined>());
  const seqRef = useRef(new Map<number, number>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  async function persist(questionId: number, value: LocalAnswer) {
    const seq = (seqRef.current.get(questionId) ?? 0) + 1;
    seqRef.current.set(questionId, seq);
    setRowStatus((prev) => new Map(prev).set(questionId, "saving"));

    const res = await saveFunAnswer({
      entryId,
      questionId,
      ...(value.numeric !== undefined ? { numericAnswer: value.numeric } : {}),
      ...(value.text !== undefined ? { textAnswer: value.text } : {}),
      ...(value.bool !== undefined ? { boolAnswer: value.bool } : {}),
    }).catch(() => ({ ok: false as const, code: "error" as const }));

    if (seqRef.current.get(questionId) !== seq) return; // superseded
    if (res.ok) {
      lastSaved.current.set(questionId, value);
      setRowStatus((prev) => {
        const next = new Map(prev);
        next.delete(questionId);
        return next;
      });
    } else {
      const previous = lastSaved.current.has(questionId)
        ? lastSaved.current.get(questionId)
        : initialMap.get(questionId);
      setAnswers((prev) => {
        const next = new Map(prev);
        if (previous === undefined) next.delete(questionId);
        else next.set(questionId, previous);
        return next;
      });
      setRowStatus((prev) => new Map(prev).set(questionId, "error"));
    }
  }

  function commit(questionId: number, value: LocalAnswer, save: boolean) {
    if (readOnly) return;
    setAnswers((prev) => new Map(prev).set(questionId, value));
    const pending = timers.current.get(questionId);
    if (pending) clearTimeout(pending);
    if (!save) return;
    timers.current.set(
      questionId,
      setTimeout(() => void persist(questionId, value), SAVE_DEBOUNCE_MS),
    );
  }

  const answered = questions.filter((q) => hasValue(answers.get(q.id))).length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1>
          <span className="text-xs font-semibold text-text-muted" data-testid="fun-progress">
            {t("progress", { done: answered, total: questions.length })}
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
                {tp("locksIn")}{" "}
                <KickoffTime utc={challenge.locksAt} className="text-text-primary" />
              </span>
              <Countdown to={challenge.locksAt} />
            </p>
          )
        )}
        <div className="h-1.5 overflow-hidden rounded-full bg-pitch-800">
          <div
            className="h-full rounded-full bg-gold-500 transition-all"
            style={{ width: `${Math.round((answered / Math.max(questions.length, 1)) * 100)}%` }}
          />
        </div>
      </div>

      <ol className="flex flex-col gap-2.5">
        {questions.map((q, i) => {
          const local = answers.get(q.id);
          const status = rowStatus.get(q.id);
          const yesNoBtn = (selected: boolean) =>
            [
              "flex-1 rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors",
              selected
                ? "bg-gold-500 text-pitch-950"
                : "bg-pitch-700 text-text-muted enabled:hover:text-text-primary disabled:opacity-50",
            ].join(" ");
          return (
            <li
              key={q.id}
              className="flex flex-col gap-2.5 rounded-xl border border-pitch-700 bg-pitch-900 p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">
                  <span className="mr-1.5 text-text-muted">{i + 1}.</span>
                  {t(`questions.${q.key}`)}
                </p>
                <span className="shrink-0 rounded-full bg-pitch-800 px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                  {q.qtype === "numeric"
                    ? t("ptsUpTo", { pts: q.maxPts })
                    : t("ptsExact", { pts: q.maxPts })}
                </span>
              </div>
              {HINTED.has(q.key) && (
                <p className="-mt-1.5 text-[11px] text-text-muted">{t(`hints.${q.key}`)}</p>
              )}

              <div className="flex items-center gap-2">
                {q.qtype === "numeric" && (
                  <NumericInput
                    value={local?.numeric}
                    disabled={readOnly}
                    onChange={(v) => commit(q.id, { numeric: v }, true)}
                  />
                )}
                {q.qtype === "yesno" && (
                  <div className="flex w-full max-w-60 gap-1.5">
                    <button
                      type="button"
                      disabled={readOnly}
                      className={yesNoBtn(local?.bool === true)}
                      onClick={() => commit(q.id, { bool: true }, true)}
                    >
                      {t("yes")}
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      className={yesNoBtn(local?.bool === false)}
                      onClick={() => commit(q.id, { bool: false }, true)}
                    >
                      {t("no")}
                    </button>
                  </div>
                )}
                {q.qtype === "pick" && (
                  <PlayerPicker
                    value={local?.text ?? ""}
                    disabled={readOnly}
                    players={players}
                    placeholder={t("playerPlaceholder")}
                    onChange={(text) =>
                      commit(q.id, text.trim() ? { text } : {}, text.trim().length > 0)
                    }
                    onSelect={(name) => commit(q.id, { text: name }, true)}
                  />
                )}
                <span className="w-5 shrink-0 text-center text-xs" aria-live="polite">
                  {status === "saving" ? (
                    <span className="text-text-muted">…</span>
                  ) : status === "error" ? (
                    <span title={tp("saveError")} className="text-danger">
                      !
                    </span>
                  ) : hasValue(local) ? (
                    <span className="text-success">✓</span>
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="pb-2 text-center text-[11px] text-text-muted">{t("autosaveHint")}</p>
    </section>
  );
}
