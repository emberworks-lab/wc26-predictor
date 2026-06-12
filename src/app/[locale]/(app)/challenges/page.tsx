import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";

import ChallengeCard, { type ChallengeRow, type EntryRow } from "./ChallengeCard";

const KIND_ORDER: Array<ChallengeRow["kind"]> = ["full", "groups", "playoff", "fun"];

export default async function ChallengesPage() {
  const t = await getTranslations("ChallengesHome");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: challenges }, { data: entries }] = await Promise.all([
    supabase
      .from("challenges")
      .select("id, kind, opens_at, locks_at, manual_override"),
    supabase
      .from("challenge_entries")
      .select("id, challenge_id, hardcore")
      .eq("user_id", user!.id),
  ]);

  const sorted = (challenges ?? []).sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
  );
  const entryByChallenge = new Map(
    (entries ?? []).map((e) => [e.challenge_id, e as EntryRow & { challenge_id: number }])
  );

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1>
      {sorted.map((challenge) => (
        <ChallengeCard
          key={challenge.id}
          challenge={challenge}
          entry={entryByChallenge.get(challenge.id) ?? null}
        />
      ))}
    </section>
  );
}
