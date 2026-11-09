import { dailyGame, type DailyEntry } from "../game/daily";
import type { Saved } from "../game/storage";

export interface TodayStatus {
  /** What the key says on top: "new", "playing", "6/10" ("none yet" without a daily). */
  status: string;
  done: boolean;
}

/** Today's list, the one daily, as Home's key (and the menu's tile) show it. */
export function todayStatus(saved: Saved, entry: DailyEntry | undefined): TodayStatus {
  const game = entry && dailyGame(saved, entry);
  const done = !!game && game.status !== "playing";
  return {
    status: !entry ? "none yet" : done ? `${game.found.length}/10` : game ? "playing" : "new",
    done,
  };
}
