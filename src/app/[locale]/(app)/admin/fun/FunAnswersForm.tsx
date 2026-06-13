"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { saveFunCorrectAnswer } from "@/app/[locale]/(app)/admin/actions";
import PlayerPicker from "@/components/PlayerPicker";
import type { PlayerSuggestion } from "@/lib/predictions/types";

export interface AdminFunQuestionDTO {
  id: number;
  key: string;
  qtype: "numeric" | "pick" | "yesno";
  maxPts: number;
  tolerance: number | null;
  correctNumeric: number | null;
  correctText: string | null;
  correctBool: boolean | null;
}

function QuestionRow({
  question,
  players,
}: {
  question: AdminFunQuestionDTO;
  players: PlayerSuggestion[];
}) {
  const t = useTranslations("Admin.fun");
  const tq = useTranslations("Fun.questions");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const [numeric, setNumeric] = useState(String(question.correctNumeric ?? ""));
  const [text, setText] = useState(question.correctText ?? "");
  const [bool, setBool] = useState<boolean | null>(question.correctBool);

  const hasStored =
    question.correctNumeric != null || question.correctText != null || question.correctBool != null;

  const save = (value: { numeric?: number | null; text?: string | null; bool?: boolean | null }) => {
    setMessage(null);
    startTransition(async () => {
      const res = await saveFunCorrectAnswer(question.id, value);
      setMessage(res.ok ? t("saved") : res.message);
      router.refresh();
    });
  };

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{tq(question.key)}</span>
        {hasStored && (
          <span className="rounded bg-success/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-success">
            {t("setBadge")}
          </span>
        )}
        <span className="ml-auto text-[10px] text-text-muted">
          {question.qtype === "numeric"
            ? `±${question.tolerance ?? "?"} · ${question.maxPts}p`
            : `${question.maxPts}p`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {question.qtype === "numeric" && (
          <input
            type="number"
            min={0}
            value={numeric}
            onChange={(e) => setNumeric(e.target.value)}
            className="h-9 w-28 rounded-lg border border-pitch-700 bg-pitch-950 px-3 text-center font-mono text-sm font-bold text-text-primary outline-none focus:border-gold-500/60"
          />
        )}
        {question.qtype === "pick" && (
          <div className="w-full max-w-xs">
            <PlayerPicker
              value={text}
              disabled={pending}
              players={players}
              placeholder={t("pickPlaceholder")}
              onChange={setText}
              onSelect={setText}
            />
          </div>
        )}
        {question.qtype === "yesno" &&
          ([true, false] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              disabled={pending}
              onClick={() => setBool(v)}
              className={[
                "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
                bool === v
                  ? "bg-gold-500 text-pitch-950"
                  : "border border-pitch-700 bg-pitch-800 text-text-muted",
              ].join(" ")}
            >
              {v ? t("yes") : t("no")}
            </button>
          ))}

        <button
          type="button"
          disabled={pending}
          onClick={() =>
            save(
              question.qtype === "numeric"
                ? { numeric: numeric.trim() === "" ? null : Number(numeric) }
                : question.qtype === "pick"
                  ? { text: text.trim() === "" ? null : text }
                  : { bool },
            )
          }
          className="rounded-full bg-gold-500 px-4 py-1.5 text-xs font-semibold text-pitch-950 transition-colors hover:bg-gold-400 disabled:opacity-50"
        >
          {pending ? t("working") : t("save")}
        </button>
        {hasStored && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setNumeric("");
              setText("");
              setBool(null);
              save(
                question.qtype === "numeric"
                  ? { numeric: null }
                  : question.qtype === "pick"
                    ? { text: null }
                    : { bool: null },
              );
            }}
            className="rounded-full border border-pitch-700 bg-pitch-800 px-4 py-1.5 text-xs font-semibold text-text-primary disabled:opacity-50"
          >
            {t("clear")}
          </button>
        )}
        {message && <span className="text-xs text-text-muted">{message}</span>}
      </div>
    </li>
  );
}

export default function FunAnswersForm({
  questions,
  players,
}: {
  questions: AdminFunQuestionDTO[];
  players: PlayerSuggestion[];
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {questions.map((q) => (
        <QuestionRow key={q.id} question={q} players={players} />
      ))}
    </ul>
  );
}
