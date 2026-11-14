import { createContext, useContext } from "react";
import type { DailyEntry } from "../../game/daily";

/** The menu's destinations that are screens, so the one on show can be marked. */
export type MenuScreen = "today-list" | "today-fathom" | "archive" | "history" | "stats" | "settings" | "privacy";

/**
 * What the menu needs from the app: the screen on show, today's list, and the app's own ways to get there. Rolls go
 * through App's roll functions, so a random game from the menu keeps today's and future days' lists out, like Home's.
 */
export interface MenuNav {
  /** The screen on show, when it is one of the menu's destinations. */
  current?: MenuScreen;
  /** The player's local date: Today's Fathom's day. */
  today: string;
  /** Today's daily; missing only if the schedule failed to load. */
  entry?: DailyEntry;
  /** How many lists are open for a free Blitz right now (none: the Random Blitz tile is off). */
  blitzOpen: number;
  /** The list of the Blitz screen on show, if one is: while its round runs, the menu says the clock keeps going. */
  blitzOnScreen?: string;
  onDaily: () => void;
  /** A random list (never the one on screen). */
  onRoll: () => void;
  /** A random Blitz (never the one on screen). */
  onBlitz: () => void;
  /** Today's Fathom. */
  onFathom: () => void;
}

export const MenuContext = createContext<MenuNav | null>(null);

export const useMenuNav = () => useContext(MenuContext);
