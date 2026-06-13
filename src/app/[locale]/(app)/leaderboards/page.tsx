import { fetchAllBoards, type Board } from "@/lib/leaderboards";
import { createClient } from "@/lib/supabase/server";

import LeaderboardsBrowser from "./LeaderboardsBrowser";

const CHALLENGE_TABS = ["overall", "full", "groups", "playoff", "fun"] as const;
type ChallengeTab = (typeof CHALLENGE_TABS)[number];

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; b?: string }>;
}) {
  const params = await searchParams;
  const initialTab: ChallengeTab = (CHALLENGE_TABS as readonly string[]).includes(params.c ?? "")
    ? (params.c as ChallengeTab)
    : "overall";
  const initialBoard: Board = params.b === "hardcore" ? "hardcore" : "global";

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

  // All boards are preloaded once; the client switches tab/board instantly.
  const boards = await fetchAllBoards(supabase, challenges ?? []);

  return (
    <LeaderboardsBrowser
      boards={boards}
      initialTab={initialTab}
      initialBoard={initialBoard}
      userId={user?.id}
    />
  );
}
