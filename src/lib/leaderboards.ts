/**
 * Leaderboard data access for the UI (Stage 6).
 *
 * Live ranks come from the leaderboard_ranked / leaderboard_overall_ranked
 * views (migration 6 — SPEC tiebreaker chain in the window ORDER BY).
 *
 * Rank movement ("▲▼ since last matchday"): the baseline is the newest
 * snapshot taken BEFORE the matchday of the most recently finished match.
 * While a matchday is in progress its own boundary snapshot doesn't exist
 * yet, so this is "movement since the end of the previous matchday"; during
 * the quiet hours after a matchday completes, the baseline stays one matchday
 * back, so the arrows keep showing the night's movement instead of resetting
 * to zero the moment the boundary snapshot lands. A matchday is the football
 * night (kickoff_utc - 6h)::date — same convention as
 * write_leaderboard_snapshots() in migration 6.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

export type Board = "global" | "hardcore";

export interface LeaderboardRow {
  userId: string;
  displayName: string;
  points: number;
  rank: number;
  /** Baseline rank minus live rank (positive = climbed). Null = no baseline. */
  movement: number | null;
  /** In the board now but absent from the baseline snapshot. */
  isNew: boolean;
  correctQualifiers: number;
  correctKoPicks: number;
  correctOutcomes: number;
}

type Supabase = SupabaseClient<Database>;

/** The football-night date (UTC-6h) a kickoff belongs to, as YYYY-MM-DD. */
export function matchdayDateOf(kickoffUtc: string): string {
  return new Date(new Date(kickoffUtc).getTime() - 6 * 3600_000)
    .toISOString()
    .slice(0, 10);
}

async function baselineRanks(
  supabase: Supabase,
  challengeId: number | null,
  board: Board,
): Promise<Map<string, number> | null> {
  const { data: lastFinished } = await supabase
    .from("matches")
    .select("kickoff_utc")
    .in("status", ["finished", "awarded"])
    .order("kickoff_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastFinished) return null;
  const activeMatchday = matchdayDateOf(lastFinished.kickoff_utc);

  let baselineQuery = supabase
    .from("leaderboard_snapshots")
    .select("matchday_date")
    .eq("board", board)
    .lt("matchday_date", activeMatchday)
    .order("matchday_date", { ascending: false })
    .limit(1);
  baselineQuery =
    challengeId == null
      ? baselineQuery.is("challenge_id", null)
      : baselineQuery.eq("challenge_id", challengeId);
  const { data: baseline } = await baselineQuery.maybeSingle();
  if (!baseline) return null;

  let rowsQuery = supabase
    .from("leaderboard_snapshots")
    .select("user_id, rank")
    .eq("board", board)
    .eq("matchday_date", baseline.matchday_date);
  rowsQuery =
    challengeId == null
      ? rowsQuery.is("challenge_id", null)
      : rowsQuery.eq("challenge_id", challengeId);
  const { data: rows } = await rowsQuery;
  return new Map((rows ?? []).map((r) => [r.user_id, Number(r.rank)]));
}

/** Board rows with movement. challengeId null = the combined Overall board. */
export async function fetchBoard(
  supabase: Supabase,
  challengeId: number | null,
  board: Board,
): Promise<LeaderboardRow[]> {
  const liveQuery =
    challengeId == null
      ? supabase
          .from("leaderboard_overall_ranked")
          .select(
            "user_id, display_name, points, rank, correct_qualifiers, correct_ko_picks, correct_outcomes",
          )
          .eq("board", board)
      : supabase
          .from("leaderboard_ranked")
          .select(
            "user_id, display_name, points, rank, correct_qualifiers, correct_ko_picks, correct_outcomes",
          )
          .eq("board", board)
          .eq("challenge_id", challengeId);

  const [{ data: live }, baseline] = await Promise.all([
    liveQuery.order("rank", { ascending: true }),
    baselineRanks(supabase, challengeId, board),
  ]);

  return (live ?? []).map((r) => {
    const rank = Number(r.rank);
    const baseRank = baseline?.get(r.user_id!);
    return {
      userId: r.user_id!,
      displayName: r.display_name!,
      points: Number(r.points),
      rank,
      movement: baseRank !== undefined ? baseRank - rank : null,
      isNew: baseline != null && baseRank === undefined,
      correctQualifiers: r.correct_qualifiers ?? 0,
      correctKoPicks: r.correct_ko_picks ?? 0,
      correctOutcomes: r.correct_outcomes ?? 0,
    };
  });
}

/**
 * Batch variant: every board (overall + each challenge, × global/hardcore) in
 * ~5 queries total instead of ~4 per board. The leaderboards UI preloads the
 * whole payload once and switches tabs client-side — board switching used to
 * trigger a fresh server navigation with sequential per-board queries (Stage 9
 * item 7: "switching between leaderboards feels dead slow").
 *
 * The movement baseline (newest snapshot matchday before the active one) is
 * shared across every board — write_leaderboard_snapshots() inserts all boards
 * at the same matchday_date in one pass — so it's resolved once here.
 *
 * Returns a map keyed by tab ("overall" or a challenge kind) → board → rows.
 */
export async function fetchAllBoards(
  supabase: Supabase,
  challenges: ReadonlyArray<{ id: number; kind: string }>,
): Promise<Record<string, Record<Board, LeaderboardRow[]>>> {
  const kindById = new Map(challenges.map((c) => [c.id, c.kind]));

  // --- shared movement baseline -------------------------------------------
  const { data: lastFinished } = await supabase
    .from("matches")
    .select("kickoff_utc")
    .in("status", ["finished", "awarded"])
    .order("kickoff_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  const activeMatchday = lastFinished ? matchdayDateOf(lastFinished.kickoff_utc) : null;

  let baselineDate: string | null = null;
  if (activeMatchday) {
    const { data } = await supabase
      .from("leaderboard_snapshots")
      .select("matchday_date")
      .lt("matchday_date", activeMatchday)
      .order("matchday_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    baselineDate = data?.matchday_date ?? null;
  }

  // baseline rank per board key (`board|tab`) → user → rank. A key present here
  // means a baseline snapshot exists for that board (drives isNew semantics).
  const baselineByKey = new Map<string, Map<string, number>>();
  if (baselineDate) {
    const { data: snapRows } = await supabase
      .from("leaderboard_snapshots")
      .select("board, challenge_id, user_id, rank")
      .eq("matchday_date", baselineDate);
    for (const s of snapRows ?? []) {
      const tab = s.challenge_id == null ? "overall" : (kindById.get(s.challenge_id) ?? null);
      if (tab == null) continue;
      const key = `${s.board}|${tab}`;
      let m = baselineByKey.get(key);
      if (!m) baselineByKey.set(key, (m = new Map()));
      m.set(s.user_id, Number(s.rank));
    }
  }

  // --- live rows (all challenges + overall, both boards) -------------------
  const [{ data: ranked }, { data: overall }] = await Promise.all([
    supabase
      .from("leaderboard_ranked")
      .select(
        "board, challenge_id, user_id, display_name, points, rank, correct_qualifiers, correct_ko_picks, correct_outcomes",
      )
      .order("rank", { ascending: true }),
    supabase
      .from("leaderboard_overall_ranked")
      .select(
        "board, user_id, display_name, points, rank, correct_qualifiers, correct_ko_picks, correct_outcomes",
      )
      .order("rank", { ascending: true }),
  ]);

  const out: Record<string, Record<Board, LeaderboardRow[]>> = {};
  const push = (tab: string, board: Board, raw: NonNullable<typeof ranked>[number]) => {
    const baseline = baselineByKey.get(`${board}|${tab}`);
    const rank = Number(raw.rank);
    const baseRank = baseline?.get(raw.user_id!);
    (out[tab] ??= { global: [], hardcore: [] })[board].push({
      userId: raw.user_id!,
      displayName: raw.display_name!,
      points: Number(raw.points),
      rank,
      movement: baseRank !== undefined ? baseRank - rank : null,
      isNew: baseline != null && baseRank === undefined,
      correctQualifiers: raw.correct_qualifiers ?? 0,
      correctKoPicks: raw.correct_ko_picks ?? 0,
      correctOutcomes: raw.correct_outcomes ?? 0,
    });
  };

  for (const r of ranked ?? []) {
    const tab = r.challenge_id == null ? null : kindById.get(r.challenge_id);
    if (!tab) continue;
    push(tab, r.board === "hardcore" ? "hardcore" : "global", r);
  }
  for (const r of overall ?? []) {
    push("overall", r.board === "hardcore" ? "hardcore" : "global", {
      ...r,
      challenge_id: null,
    });
  }
  return out;
}
