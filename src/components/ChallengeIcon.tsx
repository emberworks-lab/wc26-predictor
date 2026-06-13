import { Dices, LayoutGrid, Swords, Trophy, type LucideIcon } from "lucide-react";

/**
 * One consistent lucide icon per challenge kind (Stage 9 item 15) — replaces
 * the decorative 🏆📊⚔️🎲 emojis. Team flag emojis are data and stay.
 */
export const CHALLENGE_ICON: Record<"full" | "groups" | "playoff" | "fun", LucideIcon> = {
  full: Trophy,
  groups: LayoutGrid,
  playoff: Swords,
  fun: Dices,
};
