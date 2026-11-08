import { useId, useState } from "react";
import { shownValue } from "../game/state";
import type { Puzzle } from "../game/types";
import { ordinal, SwapLabel } from "./pixel";

/**
 * Under a finished list's board, for the curious (the owner, Nov 8: "after playing a list, show the top 11-20 in
 * addition to the top 10"): a quiet key that opens ranks 11 to 20 below it, in the board's own row style (rank, name,
 * figure). Closed by default, so the results stay compact; it opens downward, so nothing above it moves. Ranks the
 * list doesn't have are skipped (the key says how far it goes); a list with none of them has no key. The ones the
 * player guessed (each cost a life) are marked as the misses are, in pink.
 */
export function MoreRanks({ puzzle, guessed }: { puzzle: Puzzle; guessed: ReadonlySet<number> }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rows = puzzle.extras.filter((e) => e.rank >= 11 && e.rank <= 20).sort((a, b) => a.rank - b.rank);
  if (!rows.length) return null;
  const last = rows[rows.length - 1].rank;
  const span = last > 11 ? `11 to ${last}` : "#11";
  return (
    <>
      <div className="board-foot">
        <button
          type="button"
          className="key key-xs"
          data-testid="more-ranks-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          <SwapLabel off={`See ${span}`} on={`Hide ${span}`} active={open} />
        </button>
      </div>
      <ol className="slots more-ranks" id={id} data-testid="more-ranks" aria-label={`Ranks ${span}`} hidden={!open}>
        {rows.map((e) => {
          const mine = guessed.has(e.rank);
          return (
            <li key={e.name} className={`slot extra${mine ? " guessed" : ""}`} data-testid="more-rank" data-rank={e.rank} data-guessed={mine || undefined}>
              <span className="rank">{ordinal(e.rank)}</span>
              <span className="slot-body">
                <span className="name">
                  {e.name}
                  {mine && <span className="sr-only"> (you guessed it)</span>}
                </span>
                {shownValue(e) && <span className="value">{shownValue(e)}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
