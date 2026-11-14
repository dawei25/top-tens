import type { Entry, Puzzle } from "../game/types";

/** What a finished list shows under its top 10: ranks 11 to 20, and the words that say how far they go. */
export interface NextRanks {
  /** The list's entries ranked 11 to 20, in rank order (ties kept, each one a row). */
  rows: Entry[];
  /** The divider's label: "11 to 20", or "11 to 15" when the list stops sooner, "#11" for one rank. */
  label: string;
  /** The rows' name for a screen reader: "Ranks 11 to 20", "Rank 11". */
  name: string;
}

/**
 * Ranks 11 to 20 of a list, for its results (the owner, Nov 8: "show the top 11-20 in addition to the top 10"; Nov 14:
 * "instead of having this as a button just show it directly"). Unranked answers (rank 0) and ranks past 20 are left
 * out. Null when the list has nothing ranked 11 to 20.
 */
export function nextRanks(puzzle: Pick<Puzzle, "extras">): NextRanks | null {
  const rows = puzzle.extras.filter((e) => e.rank >= 11 && e.rank <= 20).sort((a, b) => a.rank - b.rank);
  if (!rows.length) return null;
  const first = rows[0].rank;
  const last = rows[rows.length - 1].rank;
  if (first === last) return { rows, label: `#${first}`, name: `Rank ${first}` };
  const label = `${first} to ${last}`;
  return { rows, label, name: `Ranks ${label}` };
}
