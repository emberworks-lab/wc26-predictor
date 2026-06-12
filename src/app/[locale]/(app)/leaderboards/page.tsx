import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { fetchBoard, type Board } from "@/lib/leaderboards";
import { createClient } from "@/lib/supabase/server";

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

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; b?: string }>;
}) {
  const params = await searchParams;
  const tab: ChallengeTab = (CHALLENGE_TABS as readonly string[]).includes(params.c ?? "")
    ? (params.c as ChallengeTab)
    : "overall";
  const board: Board = params.b === "hardcore" ? "hardcore" : "global";

  const t = await getTranslations("Leaderboards");
  const tc = await getTranslations("Challenges.items");
  const supabase = await createClient();

  const [
    {
      data: { user },
    },
    { data: challenges },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("challenges").select("id, kind"),
  ]);

  const challengeId =
    tab === "overall" ? null : (challenges?.find((c) => c.kind === tab)?.id ?? null);
  const rows = await fetchBoard(supabase, challengeId, board);
  const me = rows.find((r) => r.userId === user?.id);

  const tabHref = (c: ChallengeTab, b: Board) => ({
    pathname: "/leaderboards",
    query: { ...(c !== "overall" ? { c } : {}), ...(b !== "global" ? { b } : {}) },
  });

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1>

      <nav aria-label={t("challengeTabs")} className="flex flex-wrap gap-1.5">
        {CHALLENGE_TABS.map((c) => (
          <Link
            key={c}
            href={tabHref(c, board)}
            aria-current={c === tab ? "page" : undefined}
            className={[
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              c === tab
                ? "bg-gold-500 text-pitch-950"
                : "bg-pitch-800 text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {c === "overall" ? t("overall") : tc(`${c}.title`)}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-1.5">
        {BOARDS.map((b) => (
          <Link
            key={b}
            href={tabHref(tab, b)}
            aria-current={b === board ? "page" : undefined}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              b === board
                ? "bg-pitch-700 text-gold-400"
                : "bg-pitch-900 text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {b === "hardcore" ? `🔥 ${t("boardHardcore")}` : t("boardGlobal")}
          </Link>
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
          <span className="font-mono text-lg font-extrabold text-gold-400">
            {me.points}
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-pitch-700 bg-pitch-800 p-10 text-center">
          <span aria-hidden="true" className="text-3xl">
            🥇
          </span>
          <p className="text-sm text-text-muted">{t("empty")}</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const isMe = r.userId === user?.id;
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
                    <Movement
                      movement={r.movement}
                      isNew={r.isNew}
                      newLabel={t("movementNew")}
                    />
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
