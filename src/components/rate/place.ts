/**
 * Where the reasons after a thumbs down float, over the page and never growing it (UX 9). In px, page coordinates
 * (any origin, as long as all of them share it).
 *
 * - `prefer: "above"` (a list's or a Blitz round's results: the row ends the card, the board above it): above the row;
 *   below only when the top of the screen would cut them off and the screen has room under the row.
 * - `prefer: "below"` (a Fathom question's row, under the question it rates): below the row, over what follows, while
 *   the page has room for them there; else above, but above the whole question (`anchorTop`, its row's top), so they
 *   never cover the question being rated.
 *
 * `up` is how far above the rating row their bottom edge sits when they go up (the gap, plus the question when there
 * is one).
 */
export interface ReasonsPlace {
  down: boolean;
  up: number;
}

const GAP = 6;

export function placeReasons(p: {
  prefer: "above" | "below";
  /** The rating row's top and bottom. */
  rowTop: number;
  rowBottom: number;
  /** The reasons' height. */
  height: number;
  /** How far the page goes: the screen's bottom for "above", the page's content for "below". */
  limit: number;
  /** The top of the screen (or the page) above which they'd be cut off. */
  ceiling: number;
  /** The rated question's top ("below" only): going up, they clear it. */
  anchorTop?: number;
}): ReasonsPlace {
  const { prefer, rowTop, rowBottom, height, limit, ceiling } = p;
  if (prefer === "above") {
    return { down: rowTop - height - GAP - 2 < ceiling && rowBottom + height + GAP + 2 <= limit, up: GAP };
  }
  const anchor = Math.min(p.anchorTop ?? rowTop, rowTop);
  const roomBelow = limit - rowBottom;
  const roomAbove = anchor - ceiling;
  const down = roomBelow >= height + GAP || roomAbove < height + GAP;
  return { down, up: rowTop - anchor + GAP };
}
