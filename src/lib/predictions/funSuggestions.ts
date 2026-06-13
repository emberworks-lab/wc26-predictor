import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { FUN_PLAYER_SUGGESTIONS } from "@/lib/predictions/funPlayers";
import type { PlayerSuggestion } from "@/lib/predictions/types";

/**
 * The ONE player-suggestion list for fun pick questions: static stars
 * filtered to actually-qualified teams, then live scorers on top (dedup by
 * name — the static spelling wins). Fun pick scoring is an exact string
 * match, so the user form AND the admin correct-answer form must build their
 * suggestions through this same helper.
 */
export async function buildPlayerSuggestions(
  supabase: SupabaseClient<Database>,
): Promise<PlayerSuggestion[]> {
  const [{ data: teams }, { data: scorers }] = await Promise.all([
    supabase.from("teams").select("fifa_code, flag_emoji").not("group_code", "is", null),
    supabase
      .from("scorers_cache")
      .select("player_name, teams (fifa_code)")
      .order("goals", { ascending: false })
      .limit(100),
  ]);

  const flagByCode = new Map((teams ?? []).map((t) => [t.fifa_code, t.flag_emoji]));

  const suggestionByName = new Map<string, PlayerSuggestion>();
  for (const p of FUN_PLAYER_SUGGESTIONS) {
    const flag = flagByCode.get(p.team);
    if (flag) suggestionByName.set(p.name, { name: p.name, team: p.team, flag });
  }
  for (const s of scorers ?? []) {
    const code = s.teams?.fifa_code;
    if (!code || suggestionByName.has(s.player_name)) continue;
    suggestionByName.set(s.player_name, {
      name: s.player_name,
      team: code,
      flag: flagByCode.get(code) ?? "",
    });
  }
  return [...suggestionByName.values()].sort(
    (a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name),
  );
}
