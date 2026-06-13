import { getTranslations } from "next-intl/server";

import Countdown from "@/components/Countdown";
import KickoffTime from "@/components/KickoffTime";
import { isChallengeOpen } from "@/engine/locks";
import { Link } from "@/i18n/navigation";
import type { EntryCompletion } from "@/lib/predictions/completion";

import { joinChallenge, setHardcore, submitEntry } from "./actions";

export interface ChallengeRow {
  id: number;
  kind: "full" | "groups" | "playoff" | "fun";
  opens_at: string | null;
  locks_at: string | null;
  manual_override: string | null;
}

export interface EntryRow {
  id: string;
  hardcore: boolean;
  submitted_at: string | null;
}

const EMOJI: Record<ChallengeRow["kind"], string> = {
  full: "🏆",
  groups: "📊",
  playoff: "⚔️",
  fun: "🎲",
};

/** Playoff `opens_at` far-future sentinel = "waiting for the group stage". */
const isOpensSentinel = (opensAt: string | null) =>
  opensAt != null && new Date(opensAt).getFullYear() > 2900;

type Status = "open" | "locked" | "opensAfterGroups";

function statusOf(challenge: ChallengeRow, now: Date): Status {
  if (challenge.manual_override == null && isOpensSentinel(challenge.opens_at)) {
    return "opensAfterGroups";
  }
  const open = isChallengeOpen(
    {
      opensAtUtc: isOpensSentinel(challenge.opens_at) ? null : challenge.opens_at,
      locksAtUtc: challenge.locks_at,
      manualState:
        challenge.manual_override === "open"
          ? "OPEN"
          : challenge.manual_override === "locked"
            ? "LOCKED"
            : null,
    },
    now,
  );
  return open ? "open" : "locked";
}

/** Total still-fillable picks the user hasn't made (drives the submit warning). */
function missingPicks(completion: EntryCompletion | null): number {
  if (!completion) return 0;
  let m = 0;
  if (completion.group) m += completion.group.available - completion.group.done;
  if (completion.bracket) m += completion.bracket.total - completion.bracket.done;
  if (completion.fun) m += completion.fun.total - completion.fun.done;
  return m;
}

export default async function ChallengeCard({
  challenge,
  entry,
  completion,
}: {
  challenge: ChallengeRow;
  entry: EntryRow | null;
  completion?: EntryCompletion | null;
}) {
  const t = await getTranslations("ChallengesHome");
  const tc = await getTranslations("Challenges.items");
  const status = statusOf(challenge, new Date());
  const submitted = entry?.submitted_at != null;
  const missing = missingPicks(completion ?? null);
  const check = <span className="text-success">✓</span>;

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-pitch-700 bg-pitch-800 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="text-2xl">
            {EMOJI[challenge.kind]}
          </span>
          <div>
            <h2 className="font-bold">{tc(`${challenge.kind}.title`)}</h2>
            <p className="text-sm text-text-muted">{tc(`${challenge.kind}.description`)}</p>
          </div>
        </div>
        <span
          className={[
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
            status === "open"
              ? "bg-success/15 text-success"
              : status === "locked"
                ? "bg-danger/15 text-danger"
                : "bg-pitch-700 text-text-muted",
          ].join(" ")}
        >
          {t(`status.${status}`)}
        </span>
      </div>

      {status === "open" && challenge.locks_at && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          <span>
            {t("locksAt")}{" "}
            <KickoffTime utc={challenge.locks_at} className="text-text-primary" />
          </span>
          <Countdown to={challenge.locks_at} />
        </div>
      )}
      {status === "opensAfterGroups" && challenge.locks_at && (
        <p className="text-xs text-text-muted">
          {t("playoffHint")}{" "}
          <KickoffTime utc={challenge.locks_at} className="text-text-primary" />
        </p>
      )}

      {entry ? (
        <div className="flex flex-col gap-3 rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-success">
              {t("joined")}
              {entry.hardcore && (
                <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gold-400">
                  {t("hardcoreBadge")}
                </span>
              )}
              {submitted && (
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-success">
                  {t("submitted")}
                </span>
              )}
            </span>
            {status === "open" && (
              <form action={setHardcore}>
                <input type="hidden" name="entryId" value={entry.id} />
                <input
                  type="hidden"
                  name="hardcore"
                  value={entry.hardcore ? "false" : "true"}
                />
                <button
                  type="submit"
                  className="text-xs font-medium text-text-muted underline-offset-2 transition-colors hover:text-gold-400 hover:underline"
                >
                  {entry.hardcore ? t("hardcoreOff") : t("hardcoreOn")}
                </button>
              </form>
            )}
          </div>

          {completion && (
            <div className="flex flex-col gap-0.5 text-xs text-text-muted">
              {completion.group && (
                <span>
                  {t("groupProgress", {
                    done: completion.group.done,
                    available: completion.group.available,
                  })}{" "}
                  {completion.group.complete && check}
                  {completion.group.locked > 0 && (
                    <span className="text-text-muted/70">
                      {" "}
                      {t("groupLocked", { count: completion.group.locked })}
                    </span>
                  )}
                </span>
              )}
              {completion.bracket && (
                <span>
                  {t("bracketProgress", {
                    done: completion.bracket.done,
                    total: completion.bracket.total,
                  })}{" "}
                  {completion.bracket.complete && check}
                  {completion.bracket.championName && (
                    <span className="text-text-primary">
                      {" · "}
                      {t("championLabel", { name: completion.bracket.championName })}
                    </span>
                  )}
                </span>
              )}
              {completion.fun && (
                <span>
                  {t("funProgress", {
                    done: completion.fun.done,
                    total: completion.fun.total,
                  })}{" "}
                  {completion.fun.complete && check}
                </span>
              )}
            </div>
          )}

          {status === "open" && !submitted && missing > 0 && (
            <p className="rounded-lg bg-gold-500/10 px-3 py-2 text-[11px] text-gold-400">
              {t("submitWarning", { count: missing })}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/challenges/${challenge.kind}`}
              className={[
                "rounded-full px-5 py-2 text-xs font-semibold transition-colors",
                status === "open" && submitted
                  ? "border border-pitch-700 bg-pitch-800 text-text-primary hover:border-gold-500/40"
                  : "bg-gold-500 text-pitch-950 hover:bg-gold-400",
              ].join(" ")}
            >
              {status !== "open"
                ? t("viewPredictions")
                : submitted
                  ? t("editPredictions")
                  : t("predict")}
            </Link>
            {status === "open" && !submitted && (
              <form action={submitEntry}>
                <input type="hidden" name="entryId" value={entry.id} />
                <button
                  type="submit"
                  className="rounded-full bg-gold-500 px-5 py-2 text-xs font-semibold text-pitch-950 transition-colors hover:bg-gold-400"
                >
                  {t("submit")}
                </button>
              </form>
            )}
          </div>
          {status === "open" && !submitted && (
            <p className="text-[11px] text-text-muted">{t("submitGateHint")}</p>
          )}
        </div>
      ) : status === "open" ? (
        <form
          action={joinChallenge}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <input type="hidden" name="challengeId" value={challenge.id} />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
            <input type="checkbox" name="hardcore" className="accent-[#d4af37]" />
            {t("joinHardcore")}
          </label>
          <button
            type="submit"
            className="rounded-full bg-gold-500 px-5 py-2 text-xs font-semibold text-pitch-950 transition-colors hover:bg-gold-400"
          >
            {t("join")}
          </button>
        </form>
      ) : (
        <p className="text-xs text-text-muted">
          {t(status === "locked" ? "lockedHint" : "playoffJoinHint")}
        </p>
      )}
    </article>
  );
}
