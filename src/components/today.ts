import { dailyGame, type DailyEntry } from "../game/daily";
import type { Saved } from "../game/storage";

export interface TodayStatus {
  /** What the key says on top: "new", "playing", "6/10", "120 pts" ("none yet" without a daily). */
  status: string;
  done: boolean;
}

/** Today's list and Today's Blitz as Home's keys (and the menu's tiles) show them. */
export function todayStatus(saved: Saved, entry: DailyEntry | undefined, today: string): { list: TodayStatus; blitz: TodayStatus } {
  const game = entry && dailyGame(saved, entry);
  const listDone = !!game && game.status !== "playing";
  const blitz = saved.blitzDaily?.[today];
  return {
    list: {
      status: !entry ? "none yet" : listDone ? `${game.found.length}/10` : game ? "playing" : "new",
      done: listDone,
    },
    blitz: { status: blitz ? `${blitz.score} pts` : "new", done: !!blitz },
  };
}
