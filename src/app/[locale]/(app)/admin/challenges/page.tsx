import { getTranslations } from "next-intl/server";

import OverrideControl from "@/app/[locale]/(app)/admin/challenges/OverrideControl";
import { createClient } from "@/lib/supabase/server";

/**
 * Challenge open/close override (SPEC admin area). The manual_override column
 * wins over both timestamps in challenge_is_locked() (DB) and engine
 * locks.ts; match-kickoff locking still applies even under 'open' —
 * a started match is never editable.
 */
export default async function AdminChallengesPage() {
  const t = await getTranslations("Admin.challenges");
  const tc = await getTranslations("Challenges.items");
  const supabase = await createClient();

  const { data: challenges } = await supabase
    .from("challenges")
    .select("id, kind, opens_at, locks_at, manual_override")
    .order("id");

  const fmt = (iso: string | null) =>
    iso == null
      ? "—"
      : new Date(iso).getFullYear() >= 2999
        ? t("notOpenSentinel")
        : `${new Date(iso).toLocaleString("en-GB", {
            timeZone: "UTC",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })} UTC`;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-muted">{t("hint")}</p>
      <ul className="flex flex-col gap-1.5">
        {(challenges ?? []).map((c) => (
          <li
            key={c.id}
            className="flex flex-col gap-2 rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2.5"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold">{tc(`${c.kind}.title`)}</span>
              <span className="text-[10px] text-text-muted">
                {t("opens")}: {fmt(c.opens_at)} · {t("locks")}: {fmt(c.locks_at)}
              </span>
            </div>
            <OverrideControl challengeId={c.id} current={c.manual_override} />
          </li>
        ))}
      </ul>
    </div>
  );
}
