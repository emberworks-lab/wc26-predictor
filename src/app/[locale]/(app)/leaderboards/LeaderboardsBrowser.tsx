"use client";

import { Flame, Medal } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { Board, LeaderboardRow } from "@/lib/leaderboards";

const CHALLENGE_TABS = ["overall", "full", "groups", "playoff", "fun"] as const;
type ChallengeTab = (typeof CHALLENGE_TABS)[number];
const BOARDS = ["global", "hardcore"] as const;

function Movement({
  movement,
  isNew,
  newLabel,
}: {
  movement: number | null;
  isNew: boolean;
  newLabel: string;
}) {
  if (isNew) {
    return (
      <span className="rounded bg-gold-500/15 px-1 text-[9px] font-bold uppercase text-gold-400">
        {newLabel}
      </span>
    );
  }
  if (movement == null || movement === 0) {
    return <span className="text-xs text-text-muted">·</span>;
  }
  return movement > 0 ? (
    <span className="text-xs font-bold text-success">▲{movement}</span>
  ) : (
    <span className="text-xs font-bold text-danger">▼{-movement}</span>
  );
}

/**
 * Client-side leaderboard switcher (Stage 9 item 7). The server preloads every
 * board into `boards`; switching tab/board is pure state — no navigation, no
 * refetch. The URL is kept in sync via history.replaceState so a board stays
 * shareable/bookmarkable without triggering a server round-trip.
 */
export default function LeaderboardsBrowser({
  boards,
  initialTab,
  initialBoard,
  userId,
}: {
  boards: Record<string, Record<Board, LeaderboardRow[]>>;
  initialTab: ChallengeTab;
  initialBoard: Board;
  userId: string | undefined;
}) {
  const t = useTranslations("Leaderboards");
  const tc = useTranslations("Challenges.items");
  const [tab, setTab] = useState<ChallengeTab>(initialTab);
  const [board, setBoard] = useState<Board>(initialBoard);

  const syncUrl = (c: ChallengeTab, b: Board) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (c !== "overall") params.set("c", c);
    if (b !== "global") params.set("b", b);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };

  const selectTab = (c: ChallengeTab) => {
    setTab(c);
    syncUrl(c, board);
  };
  const selectBoard = (b: Board) => {
    setBoard(b);
    syncUrl(tab, b);
  };

  const rows = boards[tab]?.[board] ?? [];
  const me = rows.find((r) => r.userId === userId);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1>

      <nav aria-label={t("challengeTabs")} className="flex flex-wrap gap-1.5">
        {CHALLENGE_TABS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => selectTab(c)}
            aria-current={c === tab ? "page" : undefined}
            className={[
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              c === tab
                ? "bg-gold-500 text-pitch-950"
                : "bg-pitch-800 text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {c === "overall" ? t("overall") : tc(`${c}.title`)}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-1.5">
        {BOARDS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => selectBoard(b)}
            aria-current={b === board ? "page" : undefined}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              b === board
                ? "bg-pitch-700 text-gold-400"
                : "bg-pitch-900 text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {b === "hardcore" ? (
              <span className="inline-flex items-center gap-1">
                <Flame className="size-3.5" aria-hidden="true" />
                {t("boardHardcore")}
              </span>
            ) : (
              t("boardGlobal")
            )}
          </button>
        ))}
      </div>

      {board === "hardcore" && (
        <p className="text-[11px] text-text-muted">{t("hardcoreHint")}</p>
      )}

      {me && (
        <div className="flex items-center justify-between rounded-2xl border border-gold-500/40 bg-pitch-800 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-extrabold text-gold-400">#{me.rank}</span>
            <div className="flex flex-col">
              <span className="text-sm font-bold">{me.displayName}</span>
              <span className="text-[11px] text-text-muted">{t("yourPosition")}</span>
            </div>
            <Movement movement={me.movement} isNew={me.isNew} newLabel={t("movementNew")} />
          </div>
          <span className="font-mono text-lg font-extrabold text-gold-400">{me.points}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-pitch-700 bg-pitch-800 p-10 text-center">
          <Medal className="size-8 text-text-muted" aria-hidden="true" />
          <p className="text-sm text-text-muted">{t("empty")}</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const isMe = r.userId === userId;
            return (
              <li key={r.userId}>
                <Link
                  href={`/profile/${r.userId}`}
                  className={[
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                    isMe
                      ? "border-gold-500/60 bg-gold-500/5"
                      : "border-pitch-700 bg-pitch-900 hover:border-pitch-700/40 hover:bg-pitch-800",
                  ].join(" ")}
                >
                  <span className="w-7 shrink-0 text-right font-mono text-sm font-bold text-text-muted">
                    {r.rank}
                  </span>
                  <span className="w-8 shrink-0 text-center">
                    <Movement movement={r.movement} isNew={r.isNew} newLabel={t("movementNew")} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {r.displayName}
                      {isMe && (
                        <span className="ml-2 rounded bg-gold-500/15 px-1.5 text-[9px] font-bold uppercase text-gold-400">
                          {t("you")}
                        </span>
                      )}
                    </span>
                    <span className="block text-[10px] text-text-muted">
                      {t("statLine", {
                        qualifiers: r.correctQualifiers,
                        outcomes: r.correctOutcomes,
                      })}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-base font-extrabold text-gold-400">
                    {r.points}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
